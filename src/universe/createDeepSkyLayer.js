import * as THREE from 'three';
import { DEEP_SKY_CATEGORIES } from '../data/science/deepSkyCatalog.js';

// On-screen marker hues convey object classes. These sprites are original,
// schematic graphics, NOT observational imagery or physical 3D objects.
const hues = Object.freeze({
  nebula: '#74a9ff',
  cluster: '#f5d1a6',
  galaxy: '#a8bdf7'
});
function makeSpriteTexture() {
  const size = 96;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(48, 48, 0, 48, 48, 48);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(.18, 'rgba(255,255,255,.94)');
  gradient.addColorStop(.42, 'rgba(255,255,255,.27)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
export function createDeepSkyLayer() {
  const group = new THREE.Group();
  group.name = 'OpenNGC J2000 · deep-sky directions only';
  group.visible = false;
  const texture = makeSpriteTexture();
  const markers = new Map();
  let selectedId = null;
  let activeCategory = 'all';
  let tier = 2;
  function update() {
    for (const [id, item] of markers) {
      const shown = activeCategory === 'all' || activeCategory === item.category;
      item.sprite.visible = shown && (tier > 0 || id === selectedId);
      item.marker.visible = shown;
      item.sprite.scale.setScalar(id === selectedId ? 13 : tier === 0 ? 5 : 8);
      item.marker.scale.setScalar(id === selectedId ? 1.6 : 1);
      item.marker.material.opacity = id === selectedId ? 1 : .68;
    }
    selection.visible = Boolean(selectedId &&
      markers.get(selectedId)?.marker.visible);
  }
  const selection = new THREE.Sprite(new THREE.SpriteMaterial({
    map: texture, color: '#85edff', transparent: true,
    opacity: .53, blending: THREE.AdditiveBlending,
    depthWrite: false, depthTest: false
  }));
  selection.name = 'T30 selected direction halo';
  selection.scale.setScalar(22);
  selection.visible = false;
  selection.renderOrder = 10;
  group.add(selection);
  function select(id) {
    selectedId = id && markers.has(id) ? id : null;
    selection.visible = Boolean(selectedId);
    if (selectedId) selection.position.copy(markers.get(selectedId).marker.position);
    update();
    return Boolean(selectedId);
  }
  function syncCatalog(catalog) {
    for (const object of catalog.objects) {
      if (markers.has(object.id)) continue;
      if (!DEEP_SKY_CATEGORIES.includes(object.category)) continue;
      const position = new THREE.Vector3().fromArray(object.markerPosition);
      const symbol = new THREE.Sprite(new THREE.SpriteMaterial({
        map: texture, color: hues[object.category], transparent: true,
        opacity: object.category === 'galaxy' ? .7 : .8,
        blending: THREE.AdditiveBlending,
        depthWrite: false, depthTest: false
      }));
      symbol.name = object.id + ' schematic halo';
      symbol.position.copy(position);
      symbol.renderOrder = 9;
      group.add(symbol);
      const geometry = new THREE.SphereGeometry(1.65, 12, 9);
      const marker = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
        color: hues[object.category], transparent: true, opacity: .68,
        depthWrite: false, depthTest: false
      }));
      marker.name = object.id + ' J2000 direction marker';
      marker.position.copy(position);
      marker.userData.deepSkyId = object.id;
      marker.renderOrder = 11;
      group.add(marker);
      markers.set(object.id, { marker, sprite: symbol, category: object.category });
    }
    update();
  }
  return {
    group, syncCatalog, select,
    setVisible(visible) { group.visible = Boolean(visible); },
    setCategory(category) {
      if (category !== 'all' && !DEEP_SKY_CATEGORIES.includes(category)) return false;
      activeCategory = category;
      update();
      return true;
    },
    setQualityTier(value) {
      tier = THREE.MathUtils.clamp(Math.floor(value), 0, 2);
      update();
    },
    getSnapshot() {
      return {
        visible: group.visible, count: markers.size, selectedId,
        category: activeCategory, qualityTier: tier,
        markersVisible: [...markers.values()].filter(item => item.marker.visible).length
      };
    }
  };
}
