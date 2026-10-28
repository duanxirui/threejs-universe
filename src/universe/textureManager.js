import * as THREE from 'three';
import compressedTextures from '../data/compressedTextures.json';

/** Native ETC2/KTX2 where supported; JPG, then procedural materials otherwise. */
export function createTextureManager(renderer) {
  const cache = new Map();
  const prefix = import.meta.env.BASE_URL + 'textures/';
  // Three.js r180 requires the ETC extension even on WebGL2 for GPU upload.
  const supported = Boolean(renderer?.extensions.has('WEBGL_compressed_texture_etc'));
  const enabled = new Set(compressedTextures.enabled);
  const maxAnisotropy = renderer?.capabilities.getMaxAnisotropy() ?? 8;
  let ktx2LoaderPromise = null;
  let disposed = false;

  function getKtx2Loader() {
    if (!ktx2LoaderPromise) {
      // These are pre-encoded ETC2 containers; no BasisU worker is required.
      ktx2LoaderPromise = import('three/addons/loaders/KTX2Loader.js')
        .then(({ KTX2Loader }) => disposed ? null : new KTX2Loader().detectSupport(renderer));
    }
    return ktx2LoaderPromise;
  }

  function configureTexture(texture) {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(8, maxAnisotropy);
    texture.wrapS = THREE.RepeatWrapping;
    return texture;
  }

  function releaseTexture(texture) {
    if (!texture) return;
    texture.dispose();
    // Texture.dispose() frees the GPU allocation but does not close ImageBitmap.
    texture.image?.close?.();
  }

  async function fetchResource(url, signal) {
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error('HTTP ' + response.status + ': ' + url);
    return response;
  }

  function decodeImageElement(blob, signal) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const image = new Image();
      let settled = false;
      const cleanup = () => {
        image.onload = null;
        image.onerror = null;
        signal?.removeEventListener('abort', onAbort);
        URL.revokeObjectURL(url);
      };
      const finish = error => {
        if (settled) return;
        settled = true;
        cleanup();
        if (error) reject(error);
        else resolve(image);
      };
      const onAbort = () => {
        image.src = '';
        finish(new DOMException('Texture request cancelled', 'AbortError'));
      };
      image.onload = () => finish(null);
      image.onerror = () => finish(new Error('Image decode failed'));
      signal?.addEventListener('abort', onAbort, { once: true });
      if (signal?.aborted) onAbort();
      else image.src = url;
    });
  }

  async function loadLocalTexture(key, signal) {
    if (signal.aborted) return null;
    if (supported && enabled.has(key)) {
      try {
        const ktx2Loader = await getKtx2Loader();
        if (signal.aborted || disposed) return null;
        const response = await fetchResource(prefix + 'ktx2/' + key + '.ktx2', signal);
        const buffer = await response.arrayBuffer();
        if (signal.aborted || disposed) return null;
        // KTX2Loader.loadAsync uses a non-cancellable FileLoader. Fetching first
        // lets AbortController stop the transfer; any completed parse is checked.
        const texture = await new Promise((resolve, reject) => {
          ktx2Loader.parse(buffer, resolve, reject);
        });
        if (signal.aborted || disposed) {
          releaseTexture(texture);
          return null;
        }
        if (!texture.isCompressedTexture || texture.format !== THREE.RGB_ETC2_Format) {
          releaseTexture(texture);
          throw new Error('Unsupported KTX2 GPU texture format');
        }
        return configureTexture(texture);
      } catch (error) {
        if (signal.aborted || disposed) return null;
        console.warn('KTX2 failed; falling back to JPG for ' + key, error);
      }
    }
    try {
      const response = await fetchResource(prefix + key + '.jpg', signal);
      // Match TextureLoader's HTML image orientation so derived normal maps
      // continue to align with the colour map on every WebGL browser.
      const image = await decodeImageElement(await response.blob(), signal);
      if (signal.aborted || disposed) {
        image.close?.();
        return null;
      }
      const texture = configureTexture(new THREE.Texture(image));
      texture.needsUpdate = true;
      return texture;
    } catch (error) {
      if (!signal.aborted && !disposed) console.warn('Texture fallback for ' + key, error);
      return null;
    }
  }

  function get(id, satellite = false, signal = null) {
    if (disposed || signal?.aborted) return Promise.resolve(null);
    const key = (satellite ? 'satellites/' : '') + id;
    let entry = cache.get(key);
    if (entry?.controller.signal.aborted) {
      cache.delete(key);
      entry = null;
    }
    if (!entry) {
      const controller = new AbortController();
      let current = null;
      const onAbort = () => {
        controller.abort();
        if (current?.texture) {
          releaseTexture(current.texture);
          current.texture = null;
        }
        if (cache.get(key) === current) cache.delete(key);
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      if (signal?.aborted) controller.abort();
      current = { controller, texture: null, promise: null };
      current.promise = loadLocalTexture(key, controller.signal)
        .then(texture => {
          if (disposed || controller.signal.aborted) {
            releaseTexture(texture);
            return null;
          }
          current.texture = texture; // Cache success and final null failure.
          return texture;
        })
        .finally(() => {
          signal?.removeEventListener('abort', onAbort);
          if (controller.signal.aborted && cache.get(key) === current) cache.delete(key);
        });
      cache.set(key, current);
      entry = current;
    }
    return entry.promise;
  }

  async function applyMap(mesh, id, satellite = false, signal = null) {
    const texture = await get(id, satellite, signal);
    if (!texture || disposed || signal?.aborted || !mesh.material) return false;
    // Keep the material object stable so normal/emissive effects survive upgrades.
    const previous = mesh.material.map;
    mesh.material.map = texture;
    mesh.material.needsUpdate = true;
    if (previous?.isCanvasTexture) previous.dispose();
    return true;
  }

  function dispose() {
    const released = new Set();
    if (disposed) return released;
    disposed = true;
    for (const entry of cache.values()) {
      entry.controller.abort();
      if (entry.texture) {
        releaseTexture(entry.texture);
        released.add(entry.texture);
      }
    }
    cache.clear();
    // The current raw ETC2 path never starts a transcoder. If that changes,
    // release its workers once the dynamically imported loader is available.
    ktx2LoaderPromise?.then(loader => {
      if (loader?.transcoderPending) loader.dispose();
    }).catch(() => {});
    return released;
  }

  return { get, applyMap, dispose };
}
