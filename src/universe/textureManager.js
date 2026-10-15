import * as THREE from 'three';

/** All textures are stored locally. Procedural materials remain if loading fails. */
export function createTextureManager() {
  const loader = new THREE.TextureLoader();
  const promises = new Map();
  const prefix = `${import.meta.env.BASE_URL}textures/`;

  async function get(id, satellite = false) {
    const key = `${satellite ? 'satellites/' : ''}${id}`;
    if (!promises.has(key)) {
      const promise = loader.loadAsync(`${prefix}${key}.jpg`).then(texture => {
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = Math.min(8, texture.anisotropy || 8);
        texture.wrapS = THREE.RepeatWrapping;
        return texture;
      }).catch(error => {
        console.warn(`Texture fallback for ${key}`, error);
        promises.delete(key);
        return null;
      });
      promises.set(key, promise);
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
