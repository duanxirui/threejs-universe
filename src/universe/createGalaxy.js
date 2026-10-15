import * as THREE from 'three';
import { createGlowSprite, seededRandom } from './proceduralTextures.js';

const TAU = Math.PI * 2;

const vertexShader = [
  'attribute float aSize;',
  'attribute float aPhase;',
  'uniform float uTime;',
  'uniform float uPixelRatio;',
  'varying vec3 vColor;',
  'varying float vAlpha;',
  'void main() {',
  '  vColor = color;',
  '  vAlpha = .75 + .25 * sin(uTime * .7 + aPhase);',
  '  vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);',
  '  gl_Position = projectionMatrix * viewPosition;',
  '  gl_PointSize = min(15.0, aSize * uPixelRatio * (165.0 / max(2.0, -viewPosition.z)));',
  '}'
].join('\n');

const fragmentShader = [
  'varying vec3 vColor;',
  'varying float vAlpha;',
  'void main() {',
  '  float distanceToCenter = length(gl_PointCoord - .5);',
  '  float core = 1.0 - smoothstep(.0, .22, distanceToCenter);',
  '  float halo = 1.0 - smoothstep(.09, .5, distanceToCenter);',
  '  float intensity = core + halo * .42;',
  '  gl_FragColor = vec4(vColor * (core * .75 + halo * .52), intensity * vAlpha);',
  '}'
].join('\n');

// Deform diffuse dust on the GPU: only a time uniform changes each frame.
const dustVertexShader = [
  'uniform float uTime;',
  'uniform float uMotion;',
  'uniform float uPixelRatio;',
  'varying vec3 vColor;',
  'void main() {',
  '  float waveA = sin(position.x * .19 + position.y * .07 + uTime * .27);',
  '  float waveB = cos(position.y * .16 - position.x * .06 - uTime * .21);',
  '  vec3 drifting = position + uMotion * vec3(waveA * .75, waveB * .75, waveA * waveB * .38);',
  '  vec4 viewPosition = modelViewMatrix * vec4(drifting, 1.0);',
  '  gl_Position = projectionMatrix * viewPosition;',
  '  gl_PointSize = min(16.0, max(1.0, 340.0 * uPixelRatio / max(3.0, -viewPosition.z)));',
  '  vColor = color;',
  '}'
].join('\n');

const dustFragmentShader = [
  'varying vec3 vColor;',
  'void main() {',
  '  float distanceToCenter = length(gl_PointCoord - .5);',
  '  float cloud = 1.0 - smoothstep(.03, .5, distanceToCenter);',
  '  gl_FragColor = vec4(vColor, cloud * .13);',
  '}'
].join('\n');

function createPointCloud(positions, colors, sizes, phases, pixelRatio) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('aSize', new THREE.Float32BufferAttribute(sizes, 1));
  geometry.setAttribute('aPhase', new THREE.Float32BufferAttribute(phases, 1));
  const material = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uPixelRatio: { value: pixelRatio } },
    vertexShader,
    fragmentShader,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });
  return new THREE.Points(geometry, material);
}

function randomOffset(random) {
  return (random() + random() + random() + random() - 2) * .55;
}

export function createStarfield(pixelRatio = 1) {
  const random = seededRandom(141201);
  const positions = [], colors = [], sizes = [], phases = [];
  const colorset = ['#96b3df', '#c8e7ff', '#f8dfc7', '#7c9ed4', '#e8f0ff'];
  for (let i = 0; i < 5200; i++) {
    const angle = random() * TAU;
    const z = random() * 2 - 1;
    const planar = Math.sqrt(1 - z * z);
    const radius = 400 + random() * 240;
    positions.push(
      Math.cos(angle) * planar * radius,
      Math.sin(angle) * planar * radius,
      z * radius
    );
    const color = new THREE.Color(colorset[Math.floor(random() * colorset.length)]);
    colors.push(color.r, color.g, color.b);
    sizes.push(random() > .989 ? 8 + random() * 7 : 1.25 + random() * 2.9);
    phases.push(random() * TAU);
  }
  const stars = createPointCloud(positions, colors, sizes, phases, pixelRatio);
  stars.renderOrder = -10;
  return stars;
}

export function createGalaxy(glowTexture, pixelRatio = 1, density = 1) {
  const group = new THREE.Group();
  group.name = 'Milky Way Galaxy';
  const random = seededRandom(240317);
  const positions = [], colors = [], sizes = [], phases = [];
  const warm = new THREE.Color('#f8dbba');
  const white = new THREE.Color('#cce6fb');
  const blue = new THREE.Color('#528dc9');
  const violet = new THREE.Color('#8864cc');
  const temp = new THREE.Color();

  // A four-arm logarithmic spiral with a warmer, thicker galactic bulge.
  for (let i = 0; i < Math.round(44000 * density); i++) {
    const radius = Math.pow(random(), .70) * 58;
    const arm = i % 4;
    const scatter = randomOffset(random);
    const angle = arm * TAU / 4 + radius * .255 + scatter * (.18 + radius * .005);
    const spread = randomOffset(random) * (.35 + radius * .035);
    const x = Math.cos(angle) * radius + Math.cos(angle + Math.PI / 2) * spread;
    const y = Math.sin(angle) * radius + Math.sin(angle + Math.PI / 2) * spread;
    const z = randomOffset(random) * Math.max(.24, 3.1 - radius * .047);
    positions.push(x, y, z);

    const center = Math.max(0, 1 - radius / 26);
    temp.copy(blue).lerp(white, .40 + random() * .44);
    if (random() < .20) temp.lerp(violet, .55);
    temp.lerp(warm, center * (.7 + random() * .2));
    colors.push(temp.r, temp.g, temp.b);
    sizes.push((random() > .994 ? 6 : 1.4) + random() * 2.8);
    phases.push(random() * TAU);
  }

  for (let i = 0; i < Math.round(5800 * density); i++) {
    const radius = Math.pow(random(), 1.9) * 11;
    const angle = random() * TAU;
    positions.push(Math.cos(angle) * radius, Math.sin(angle) * radius, randomOffset(random) * 3.5);
    temp.copy(warm).lerp(white, random() * .4);
    colors.push(temp.r, temp.g, temp.b);
    sizes.push(1.8 + random() * 3);
    phases.push(random() * TAU);
  }

  const stars = createPointCloud(positions, colors, sizes, phases, pixelRatio);
  group.add(stars);

  const haze = new THREE.Group();
  haze.add(createGlowSprite(glowTexture, '#e2b087', 38, .22));
  haze.add(createGlowSprite(glowTexture, '#86c5f6', 72, .085));
  haze.add(createGlowSprite(glowTexture, '#fdf2d9', 10, .38));

  const nebulaColors = ['#458ed4', '#4772da', '#9254c4', '#60bdc6', '#af749e'];
  const clouds = [];
  for (let i = 0; i < 66; i++) {
    const arm = i % 4;
    const radius = 9 + random() * 46;
    const angle = arm * TAU / 4 + radius * .255 + randomOffset(random) * .38;
    const cloud = createGlowSprite(
      glowTexture,
      nebulaColors[Math.floor(random() * nebulaColors.length)],
      7 + random() * 19,
      .025 + random() * .06
    );
    cloud.position.set(Math.cos(angle) * radius, Math.sin(angle) * radius, -.6 + random() * 1.2);
    clouds.push({
      sprite: cloud, origin: cloud.position.clone(), scale: cloud.scale.x,
      opacity: cloud.material.opacity, phase: random() * TAU
    });
    haze.add(cloud);
  }
  group.add(haze);

  // Diffuse colored clouds sit between the stellar arms to give the disk depth.
  const dustPositions = [], dustColors = [];
  const dustColorset = ['#285a92', '#697db2', '#7b4b98', '#aa6c76', '#327c93'];
  for (let i = 0; i < Math.round(9500 * density); i++) {
    const r = 7 + random() * 50;
    const arm = i % 4;
    const angle = arm * TAU / 4 + r * .255 + randomOffset(random) * .38;
    const radialSpread = randomOffset(random) * (1.1 + r * .09);
    dustPositions.push(
      Math.cos(angle) * r + Math.cos(angle + Math.PI / 2) * radialSpread,
      Math.sin(angle) * r + Math.sin(angle + Math.PI / 2) * radialSpread,
      randomOffset(random) * (1.5 + r * .03)
    );
    const color = new THREE.Color(dustColorset[Math.floor(random() * dustColorset.length)]);
    dustColors.push(color.r, color.g, color.b);
  }
  const dustGeometry = new THREE.BufferGeometry();
  dustGeometry.setAttribute('position', new THREE.Float32BufferAttribute(dustPositions, 3));
  dustGeometry.setAttribute('color', new THREE.Float32BufferAttribute(dustColors, 3));
  const dust = new THREE.Points(dustGeometry, new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 }, uMotion: { value: 1 }, uPixelRatio: { value: pixelRatio }
    },
    vertexShader: dustVertexShader, fragmentShader: dustFragmentShader,
    vertexColors: true, transparent: true, blending: THREE.AdditiveBlending,
    depthWrite: false
  }));
  group.add(dust);
  let qualityTier = 2;

  // A distinct beacon marks our location in the disk for direct navigation.
  const beacon = new THREE.Group();
  const distance = 35;
  const direction = distance * .255 + TAU / 4;
  beacon.position.set(Math.cos(direction) * distance, Math.sin(direction) * distance, .9);
  const beaconGlow = createGlowSprite(glowTexture, '#a6e3ff', 4.5, .7);
  const beaconCore = new THREE.Mesh(
    new THREE.SphereGeometry(.72, 12, 8),
    new THREE.MeshBasicMaterial({ color: 0xffedb5, transparent: true, opacity: .88 })
  );
  beaconCore.userData.isSolarMarker = true;
  const beaconRing = new THREE.Mesh(
    new THREE.TorusGeometry(2.6, .045, 6, 96),
    new THREE.MeshBasicMaterial({ color: 0x8acff0, transparent: true, opacity: .7, depthWrite: false })
  );
  beacon.add(beaconGlow, beaconCore, beaconRing);
  group.add(beacon);
  group.rotation.x = -.30;

  return {
    group,
    beacon,
    beaconCore,
    update(delta, elapsed) {
      group.rotation.z += delta * .003;
      stars.material.uniforms.uTime.value = elapsed;
      if (group.visible && qualityTier > 0) {
        dust.material.uniforms.uTime.value = elapsed;
        // Independent, slow phase offsets reshape the cloud silhouette.
        for (const cloud of clouds) {
          if (!cloud.sprite.visible) continue;
          const phase = elapsed * .19 + cloud.phase;
          cloud.sprite.position.set(
            cloud.origin.x + Math.sin(phase) * .95,
            cloud.origin.y + Math.cos(phase * .83) * .8,
            cloud.origin.z + Math.sin(phase * .56) * .3
          );
          const stretch = 1 + .13 * Math.sin(phase * 1.12);
          cloud.sprite.scale.set(cloud.scale * stretch, cloud.scale * (2 - stretch), 1);
          cloud.sprite.material.opacity = cloud.opacity * (1 + .20 * Math.cos(phase));
        }
      }
      beaconRing.rotation.y += delta * .35;
      beaconGlow.scale.setScalar(4.5 * (1 + Math.sin(elapsed * 2.4) * .1));
    },
    resize(pixelRatioValue) {
      stars.material.uniforms.uPixelRatio.value = pixelRatioValue;
      dust.material.uniforms.uPixelRatio.value = pixelRatioValue;
    },
    setQualityTier(tier) {
      qualityTier = THREE.MathUtils.clamp(tier, 0, 2);
      const ratio = [.38, .7, 1][qualityTier];
      stars.geometry.setDrawRange(0, Math.round(positions.length / 3 * ratio));
      dust.geometry.setDrawRange(0, Math.round(dustPositions.length / 3 * ratio));
      dust.material.uniforms.uMotion.value = qualityTier === 0 ? 0 : 1;
      clouds.forEach((cloud, index) => {
        cloud.sprite.visible = index < [22, 44, 66][qualityTier];
        if (qualityTier === 0) {
          cloud.sprite.position.copy(cloud.origin);
          cloud.sprite.scale.setScalar(cloud.scale);
          cloud.sprite.material.opacity = cloud.opacity;
        }
      });
    }
  };
}
