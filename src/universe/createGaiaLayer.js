import * as THREE from 'three';
import { GAIA_DISTANCE_LIMITS, GAIA_MAG_LIMITS } from '../data/science/gaiaCatalog.js';

// T29: Gaia DR3 source positions are static in ICRS at J2016.0. The points
// have no galaxy-arm motion; diameter, hue and glow are visual encodings only.
const vertexShader = `
  attribute float aSize;
  varying vec3 vColor;
  uniform float uPixelRatio;
  void main() {
    vColor = color;
    vec4 view = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * view;
    gl_PointSize = clamp(aSize * uPixelRatio *
      (160.0 / max(24.0, -view.z)), 1.2, 9.0);
  }`;
const fragmentShader = `
  varying vec3 vColor;
  void main() {
    float r = length(gl_PointCoord - vec2(.5));
    float core = 1.0 - smoothstep(.0, .18, r);
    float halo = 1.0 - smoothstep(.12, .50, r);
    float a = core + .45 * halo;
    gl_FragColor = vec4(vColor * (core + .48 * halo), a);
  }`;

function colorForIndex(bpRp, color) {
  // An illustrative palette, NOT a calibrated blackbody temperature or
  // recovered stellar spectrum. BP-RP is an observed colour index.
  const t = THREE.MathUtils.clamp((bpRp + .2) / 3.2, 0, 1);
  color.setHSL((.63 - .56 * t), .38 + .34 * Math.abs(t - .5), .72);
  return color;
}

export function createGaiaLayer(pixelRatio = 1) {
  const group = new THREE.Group();
  group.name = 'Gaia DR3 · ICRS local catalog sample';
  group.visible = false;
  const bands = new Map();
  const tmp = new THREE.Color();
  const selection = new THREE.Points(
    new THREE.BufferGeometry().setAttribute('position',
      new THREE.Float32BufferAttribute([0, 0, 0], 3)),
    new THREE.PointsMaterial({
      color: 0x8ae9ff, size: 11, sizeAttenuation: false,
      transparent: true, depthWrite: false, opacity: .95
    })
  );
  selection.name = 'Selected Gaia source marker (visual aid)';
  selection.visible = false;
  selection.renderOrder = 11;
  group.add(selection);
  let distanceMaxPc = 1000;
  let gLimit = 16;
  let qualityTier = 2;
  let selectedId = null;

  function updateDrawRanges() {
    const qualityFraction = [.38, .7, 1][qualityTier];
    for (const entry of bands.values()) {
      entry.points.visible = entry.minPc < distanceMaxPc;
      if (!entry.points.visible) continue;
      const maxByMagnitude = entry.records.findIndex(r => r.gMag >= gLimit);
      const magnitudeCount = maxByMagnitude < 0 ? entry.records.length : maxByMagnitude;
      const count = Math.min(magnitudeCount,
        Math.round(magnitudeCount * qualityFraction));
      entry.points.geometry.setDrawRange(0, count);
    }
    const focus = bands.get(selectedId?.band);
    const selected = focus?.records.find(r => r.sourceId === selectedId?.sourceId);
    selection.visible = Boolean(group.visible && selected &&
      selected.distancePc < distanceMaxPc && selected.gMag < gLimit);
    if (selection.visible) {
      selection.position.fromArray(selected.position);
    }
  }

  function syncCatalog(catalog) {
    for (const chunk of catalog.manifest.chunks) {
      if (bands.has(chunk.id)) continue;
      const records = catalog.allRecords()
        .filter(r => r.distancePc >= chunk.minPc && r.distancePc < chunk.maxPc)
        .sort((a, b) => a.gMag - b.gMag);
      if (records.length !== chunk.count) continue;
      const positions = [], colors = [], sizes = [];
      for (const row of records) {
        positions.push(...row.position);
        colorForIndex(row.bpRp, tmp);
        colors.push(tmp.r, tmp.g, tmp.b);
        sizes.push(THREE.MathUtils.clamp(8.5 - row.gMag * .32, 2.2, 6.2));
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      geometry.setAttribute('aSize', new THREE.Float32BufferAttribute(sizes, 1));
      const material = new THREE.ShaderMaterial({
        uniforms: { uPixelRatio: { value: pixelRatio } },
        vertexShader, fragmentShader,
        vertexColors: true, transparent: true,
        depthWrite: false, blending: THREE.AdditiveBlending
      });
      const points = new THREE.Points(geometry, material);
      points.name = 'Gaia DR3 · ' + chunk.id + ' · ' + records.length;
      points.frustumCulled = false;
      group.add(points);
      bands.set(chunk.id, { points, records, minPc: chunk.minPc, maxPc: chunk.maxPc });
    }
    updateDrawRanges();
  }
  return {
    group, syncCatalog,
    setVisible(visible) {
      group.visible = Boolean(visible);
      updateDrawRanges();
    },
    setFilters({ distancePc = distanceMaxPc, magnitude = gLimit } = {}) {
      if (!GAIA_DISTANCE_LIMITS.includes(Number(distancePc)) ||
        !GAIA_MAG_LIMITS.includes(Number(magnitude))) return false;
      distanceMaxPc = Number(distancePc);
      gLimit = Number(magnitude);
      updateDrawRanges();
      return true;
    },
    setQualityTier(tier) {
      qualityTier = THREE.MathUtils.clamp(Math.round(tier), 0, 2);
      updateDrawRanges();
    },
    resize(value) {
      for (const { points } of bands.values()) {
        points.material.uniforms.uPixelRatio.value = value;
      }
    },
    selectSource(row) {
      selectedId = row ? {
        sourceId: row.sourceId,
        band: row.distancePc < 100 ? 'near' :
          row.distancePc < 400 ? 'mid' : 'far'
      } : null;
      updateDrawRanges();
    },
    getSnapshot() {
      return {
        visible: group.visible, qualityTier, distanceMaxPc, gLimit,
        loadedBands: [...bands.keys()],
        drawn: [...bands.values()].reduce((count, entry) =>
          count + (entry.points.visible ? entry.points.geometry.drawRange.count : 0), 0),
        selectedId: selectedId?.sourceId || null
      };
    }
  };
}
