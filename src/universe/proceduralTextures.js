import * as THREE from 'three';

const TAU = Math.PI * 2;
const clamp = (x, min = 0, max = 1) => Math.min(max, Math.max(min, x));
const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const lerp = (a, b, t) => a + (b - a) * t;

function hash(ix, iy, seed) {
  let n = Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 1442695041);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

// Tiling longitude avoids a visible seam on the sphere.
function valueNoise(u, v, frequency, seed) {
  const x = u * frequency;
  const y = v * frequency;
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = smoothstep(0, 1, x - ix);
  const fy = smoothstep(0, 1, y - iy);
  const x0 = ((ix % frequency) + frequency) % frequency;
  const x1 = (x0 + 1) % frequency;
  return lerp(
    lerp(hash(x0, iy, seed), hash(x1, iy, seed), fx),
    lerp(hash(x0, iy + 1, seed), hash(x1, iy + 1, seed), fx),
    fy
  );
}

function fbm(u, v, seed, baseFrequency = 3, octaves = 5) {
  let value = 0;
  let amplitude = 0.5;
  let weight = 0;
  let frequency = baseFrequency;
  for (let i = 0; i < octaves; i++) {
    value += valueNoise(u, v, frequency, seed + i * 29) * amplitude;
    weight += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return value / weight;
}

function blend(a, b, t) {
  const k = clamp(t);
  return [
    Math.round(lerp(a[0], b[0], k)),
    Math.round(lerp(a[1], b[1], k)),
    Math.round(lerp(a[2], b[2], k))
  ];
}

function planetColor(id, u, v, seed) {
  const latitude = Math.abs(v - 0.5) * 2;
  const n = fbm(u, v, seed, 3, 5);
  const detail = fbm(u + .157, v + .267, seed + 91, 9, 4);

  if (id === 'earth') {
    const continental = n * .84 + (detail - .5) * .19;
    let color;
    if (continental > .52) {
      const heights = smoothstep(.51, .72, continental);
      const green = blend([40, 99, 58], [100, 119, 61], heights);
      const deserts = blend(green, [173, 142, 92], smoothstep(.35, .78, detail) * (1 - latitude));
      color = blend(deserts, [125, 130, 124], smoothstep(.68, .86, heights));
    } else {
      const depth = smoothstep(.36, .52, continental);
      color = blend([5, 34, 83], [14, 96, 150], depth);
    }
    return blend(color, [232, 241, 240], smoothstep(.79, .97, latitude));
  }
  if (id === 'mercury') {
    const crater = Math.pow(Math.max(0, Math.sin(u * 117) * Math.cos(v * 91)), 14) * .11;
    const shade = clamp(.28 + n * .75 + (detail - .5) * .28 - crater);
    return blend([75, 79, 79], [183, 179, 169], shade);
  }
  if (id === 'venus') {
    const swirl = Math.sin(v * 68 + n * 19 + Math.sin(u * 22) * 2) * .12;
    return blend([153, 111, 67], [247, 218, 164], clamp(n * .85 + swirl + .2));
  }
  if (id === 'mars') {
    const dune = Math.sin(v * 55 + detail * 10) * .045;
    let color = blend([83, 40, 33], [218, 117, 77], clamp(n * .82 + detail * .18 + dune));
    color = blend(color, [225, 208, 186], smoothstep(.87, .98, latitude));
    return color;
  }
  if (id === 'jupiter') {
    const turbulence = (n - .5) * 11 + (detail - .5) * 4;
    const bands = Math.sin(v * 72 + turbulence + Math.sin(u * 14 + v * 20) * .8);
    const fine = Math.sin(v * 175 + turbulence * 1.8) * .075;
    const warm = blend([157, 99, 70], [228, 191, 152], clamp((bands + 1) * .51 + fine));
    return blend(warm, [237, 223, 195], smoothstep(.78, .94, n) * .5);
  }
  if (id === 'saturn') {
    const bands = Math.sin(v * 89 + n * 8) * .16 + Math.sin(v * 31) * .12;
    return blend([164, 135, 100], [237, 219, 178], clamp(.48 + bands + (n - .5) * .35));
  }
  if (id === 'uranus') {
    const bands = Math.sin(v * 47 + n * 5) * .035;
    return blend([84, 149, 165], [184, 232, 226], clamp(n * .78 + .18 + bands));
  }
  if (id === 'neptune') {
    const bands = Math.sin(v * 54 + n * 13) * .12;
    return blend([18, 44, 137], [91, 144, 238], clamp(n * .9 + bands));
  }
  return [200, 200, 200];
}

export function createPlanetTexture(id, width = 512, height = 256) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const image = ctx.createImageData(width, height);
  const seed = id.split('').reduce((acc, char) => acc * 31 + char.charCodeAt(0), 17);
  const data = image.data;

  for (let y = 0; y < height; y++) {
    const v = y / (height - 1);
    for (let x = 0; x < width; x++) {
      const u = x / (width - 1);
      const i = (y * width + x) * 4;
      const c = planetColor(id, u, v, seed);
      data[i] = c[0];
      data[i + 1] = c[1];
      data[i + 2] = c[2];
      data[i + 3] = 255;
    }
  }

  ctx.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

export function createCloudTexture() {
  const width = 512, height = 256;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const u = x / (width - 1), v = y / (height - 1);
      const n = fbm(u, v, 2819, 6, 5);
      const streak = Math.sin(v * 70 + n * 13) * .045;
      const a = smoothstep(.53, .69, n + streak);
      const index = (y * width + x) * 4;
      image.data[index] = 237;
      image.data[index + 1] = 245;
      image.data[index + 2] = 255;
      image.data[index + 3] = Math.round(a * 225);
    }
  }
  ctx.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Illustrated nighttime settlement lights, not satellite night-light imagery. */
export function createNightLightsTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const random = seededRandom(12572);
  const cities = [
    [-74, 40.7, 1.2], [-118, 34, .9], [-87.6, 41.9, .8], [-99.1, 19.4, 1],
    [-46.6, -23.5, .8], [-43.2, -22.9, .6], [-0.1, 51.5, 1], [2.35, 48.9, .9],
    [13.4, 52.5, .85], [28.9, 41, .8], [37.6, 55.8, 1], [31.2, 30, .9],
    [77.2, 28.6, 1.2], [72.9, 19.1, 1], [88.4, 22.6, .9], [90.4, 23.8, .9],
    [116.4, 39.9, 1.2], [121.5, 31.2, 1.3], [113.3, 23.1, 1.2], [114.2, 22.3, 1],
    [139.7, 35.7, 1.4], [135.5, 34.7, .9], [126.9, 37.6, 1], [121, 14.6, 1],
    [103.8, 1.3, 1.1], [106.8, -6.2, 1], [151.2, -33.9, .8], [144.9, -37.8, .7],
    [18.4, -33.9, .6], [28.0, -26.2, .7], [-3.7, 40.4, .8], [12.5, 41.9, .7]
  ];
  for (const [longitude, latitude, size] of cities) {
    const x = (longitude + 180) / 360 * canvas.width;
    const y = (90 - latitude) / 180 * canvas.height;
    for (let cluster = 0; cluster < 110 * size; cluster++) {
      const dx = (random() + random() + random() - 1.5) * 22 * size;
      const dy = (random() + random() + random() - 1.5) * 13 * size;
      const radius = .4 + random() * .85;
      ctx.fillStyle = `rgba(255, ${150 + Math.round(random() * 68)}, ${72 + Math.round(random() * 60)}, ${.22 + random() * .67})`;
      ctx.beginPath();
      ctx.arc(x + dx, y + dy, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Keep emissive city lights on the unlit side of a planet. */
export function addNightSideLighting(material) {
  material.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>',
      '#include <common>\nvarying vec3 vNightWorldNormal;\nvarying vec3 vNightWorldPosition;');
    shader.vertexShader = shader.vertexShader.replace('#include <worldpos_vertex>',
      '#include <worldpos_vertex>\nvNightWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvNightWorldNormal = normalize(mat3(modelMatrix) * normal);');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>',
      '#include <common>\nvarying vec3 vNightWorldNormal;\nvarying vec3 vNightWorldPosition;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>',
      '#include <emissivemap_fragment>\nfloat sunlight = dot(normalize(vNightWorldNormal), normalize(-vNightWorldPosition));\ntotalEmissiveRadiance *= 1.0 - smoothstep(-0.18, 0.12, sunlight);');
  };
  material.customProgramCacheKey = () => 'night-side-lighting';
  return material;
}

export function createGlowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(.10, 'rgba(255,255,255,.86)');
  gradient.addColorStop(.29, 'rgba(255,255,255,.30)');
  gradient.addColorStop(.63, 'rgba(255,255,255,.055)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(canvas);
}

const sunVertex = [
  'varying vec2 vUv;',
  'varying vec3 vLocal;',
  'varying vec3 vNormalWorld;',
  'varying vec3 vWorld;',
  'void main() {',
  '  vUv = uv;',
  '  vLocal = position;',
  '  vNormalWorld = normalize(mat3(modelMatrix) * normal);',
  '  vec4 world = modelMatrix * vec4(position, 1.0);',
  '  vWorld = world.xyz;',
  '  gl_Position = projectionMatrix * viewMatrix * world;',
  '}'
].join('\n');

const sunFragment = [
  'uniform float uTime;',
  'uniform float uUseSurface;',
  'uniform sampler2D uSurface;',
  'varying vec2 vUv;',
  'varying vec3 vLocal;',
  'varying vec3 vNormalWorld;',
  'varying vec3 vWorld;',
  'float pattern(vec3 p) {',
  '  return sin(p.x * 9.0 + sin(p.z * 11.0 + uTime * .65) * 1.6)',
  '       * cos(p.y * 13.0 - uTime * .46)',
  '       + sin(p.z * 22.0 + p.x * 8.0 + uTime * .83) * .28;',
  '}',
  'void main() {',
  '  vec3 p = normalize(vLocal);',
  '  float noise = pattern(p) * .5 + .5;',
  '  noise += sin(p.y * 49.0 + p.z * 28.0 - uTime * 1.35) * .09;',
  '  vec3 low = vec3(.83, .20, .045);',
  '  vec3 mid = vec3(1.0, .51, .12);',
  '  vec3 high = vec3(1.0, .88, .46);',
  '  vec3 color = mix(low, mid, smoothstep(.08, .65, noise));',
  '  color = mix(color, high, smoothstep(.55, .94, noise));',
  '  if (uUseSurface > .5) {',
  '    vec3 mapped = texture2D(uSurface, vec2(fract(vUv.x + uTime * .0007), vUv.y)).rgb;',
  '    color = mix(color, mapped * 1.18, .67);',
  '  }',
  '  vec3 direction = normalize(cameraPosition - vWorld);',
  '  float rim = pow(1.0 - abs(dot(normalize(vNormalWorld), direction)), 3.0);',
  '  color += vec3(.48, .20, .06) * rim;',
  '  gl_FragColor = vec4(color * 1.4, 1.0);',
  '  #include <tonemapping_fragment>',
  '  #include <colorspace_fragment>',
  '}'
].join('\n');

export function createSunMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uUseSurface: { value: 0 }, uSurface: { value: null } },
    vertexShader: sunVertex,
    fragmentShader: sunFragment
  });
}

const atmosphereVertex = [
  'varying vec3 vNormalWorld;',
  'varying vec3 vWorld;',
  'void main() {',
  '  vNormalWorld = normalize(mat3(modelMatrix) * normal);',
  '  vec4 world = modelMatrix * vec4(position, 1.0);',
  '  vWorld = world.xyz;',
  '  gl_Position = projectionMatrix * viewMatrix * world;',
  '}'
].join('\n');

const atmosphereFragment = [
  'uniform vec3 uColor;',
  'varying vec3 vNormalWorld;',
  'varying vec3 vWorld;',
  'void main() {',
  '  vec3 viewDirection = normalize(cameraPosition - vWorld);',
  '  float edge = 1.0 - abs(dot(normalize(vNormalWorld), viewDirection));',
  '  float glow = pow(edge, 3.1);',
  '  float sunlight = dot(normalize(vNormalWorld), normalize(-vWorld));',
  '  float day = smoothstep(-.2, .45, sunlight);',
  '  vec3 tint = mix(uColor * .45, uColor * 1.65, day);',
  '  gl_FragColor = vec4(tint, glow * (.35 + day * .5));',
  '}'
].join('\n');

export function createAtmosphereMaterial(color = 0x56b6ff) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) } },
    vertexShader: atmosphereVertex,
    fragmentShader: atmosphereFragment,
    blending: THREE.AdditiveBlending,
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false
  });
}

const ringVertex = [
  'varying vec2 vUv;',
  'void main() {',
  '  vUv = uv;',
  '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
  '}'
].join('\n');

const ringFragment = [
  'varying vec2 vUv;',
  'void main() {',
  '  float r = length(vUv - vec2(.5)) * 2.0;',
  '  float stripes = sin(r * 225.0) * .13 + sin(r * 580.0) * .08;',
  '  float gaps = smoothstep(.08, .19, abs(sin(r * 44.0)));',
  '  float alpha = (.43 + stripes) * gaps;',
  '  alpha *= smoothstep(.51, .61, r) * (1.0 - smoothstep(.93, 1.0, r));',
  '  vec3 color = mix(vec3(.44, .37, .29), vec3(.92, .81, .61), r * .62 + .24 + stripes);',
  '  gl_FragColor = vec4(color, alpha);',
  '  #include <tonemapping_fragment>',
  '  #include <colorspace_fragment>',
  '}'
].join('\n');

export function createRingMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader: ringVertex,
    fragmentShader: ringFragment,
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: false
  });
}

export function createGlowSprite(texture, color, size, opacity = 1) {
  const material = new THREE.SpriteMaterial({
    map: texture,
    color,
    opacity,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(size, size, 1);
  return sprite;
}

export function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}
