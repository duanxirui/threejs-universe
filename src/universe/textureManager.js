import * as THREE from 'three';
import compressedTextures from '../data/compressedTextures.json';

/** Native ETC2/KTX2 where supported; JPG, then procedural materials otherwise. */
export function createTextureManager(renderer) {
  const loader = new THREE.TextureLoader();
  const promises = new Map();
  const prefix = `${import.meta.env.BASE_URL}textures/`;
  const supported = Boolean(renderer?.capabilities.isWebGL2 ||
    renderer?.extensions.has('WEBGL_compressed_texture_etc'));
  const enabled = new Set(compressedTextures.enabled);
  // Pre-encoded vkFormat ETC2 containers use KTX2Loader's direct/raw path.
  // The BasisU transcoder worker is not loaded for these native ETC2 assets.
  // Defer the JS decoder chunk until the first ETC2 atlas is requested.
  // The initial galaxy and nearby JPG planets incur no extra loader download.
  let ktx2LoaderPromise = null;
  const maxAnisotropy = renderer?.capabilities.getMaxAnisotropy() ?? 8;

  function getKtx2Loader() {
    if (!ktx2LoaderPromise) {
      ktx2LoaderPromise = import('three/addons/loaders/KTX2Loader.js')
        .then(({ KTX2Loader }) => new KTX2Loader().detectSupport(renderer));
    }
    return ktx2LoaderPromise;
  }

  function configureTexture(texture) {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(8, maxAnisotropy);
    texture.wrapS = THREE.RepeatWrapping;
    return texture;
  }

  async function loadLocalTexture(key) {
    if (supported && enabled.has(key)) {
      try {
        const ktx2Loader = await getKtx2Loader();
        const texture = await ktx2Loader.loadAsync(`${prefix}ktx2/${key}.ktx2`);
        if (!texture.isCompressedTexture || texture.format !== THREE.RGB_ETC2_Format) {
          texture.dispose();
          throw new Error('Unsupported KTX2 GPU texture format');
        }
        return configureTexture(texture);
      } catch (error) {
        console.warn(`KTX2 failed; falling back to JPG for ${key}`, error);
      }
    }
    try {
      return configureTexture(await loader.loadAsync(`${prefix}${key}.jpg`));
    } catch (error) {
      console.warn(`Texture fallback for ${key}`, error);
      return null;
    }
  }

  async function get(id, satellite = false) {
    const key = `${satellite ? 'satellites/' : ''}${id}`;
    if (!promises.has(key)) {
      // Cache a JPG or KTX2 success, and also a final null if both fail.
      // Re-selecting the same body never starts a duplicate request.
      promises.set(key, loadLocalTexture(key));
    }
    return promises.get(key);
  }

  async function applyMap(mesh, id, satellite = false) {
    const texture = await get(id, satellite);
    if (!texture || !mesh.material) return false;
    // Keep the material object stable so normal/emissive effects survive upgrades.
    const previous = mesh.material.map;
    mesh.material.map = texture;
    mesh.material.needsUpdate = true;
    if (previous?.isCanvasTexture) previous.dispose();
    return true;
  }

  return { get, applyMap };
}
