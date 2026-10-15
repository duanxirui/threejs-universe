import * as THREE from 'three';
import { CELESTIALS, SATELLITES } from '../data/celestials.js';
import {
  addNightSideLighting,
  createAtmosphereMaterial,
  createCloudTexture,
  createGlowSprite,
  createNightLightsTexture,
  createPlanetTexture,
  createRingMaterial,
  createSunMaterial,
  seededRandom
} from './proceduralTextures.js';
import { createOrbitLine, pointOnOrbit } from './orbitalMechanics.js';
import { createTextureManager } from './textureManager.js';

const TAU = Math.PI * 2;
const sphereGeometry = new THREE.SphereGeometry(1, 64, 48);
const mediumSphereGeometry = new THREE.SphereGeometry(1, 32, 24);
const lowSphereGeometry = new THREE.SphereGeometry(1, 16, 12);

function createOrbit(body) {
  return createOrbitLine(body, 0x6c93b4, .23);
}

function createAsteroidBelt() {
  const random = seededRandom(181101);
  const count = 1750;
  const geometry = new THREE.IcosahedronGeometry(1, 0);
  const material = new THREE.MeshStandardMaterial({
    color: 0xa3aab3,
    roughness: 1,
    metalness: 0,
    flatShading: true
  });
  const belt = new THREE.InstancedMesh(geometry, material, count);
  belt.name = 'Asteroid Belt';
  const helper = new THREE.Object3D();
  const color = new THREE.Color();

  for (let i = 0; i < count; i++) {
    const angle = random() * TAU;
    const radius = 22.7 + random() * 3.9;
    const height = (random() - .5) * 1.2;
    const size = .025 + Math.pow(random(), 5) * .12;
    helper.position.set(Math.cos(angle) * radius, height, Math.sin(angle) * radius);
    helper.rotation.set(random() * TAU, random() * TAU, random() * TAU);
    helper.scale.setScalar(size);
    helper.updateMatrix();
    belt.setMatrixAt(i, helper.matrix);
    color.setHSL(.10 + random() * .08, .06 + random() * .12, .32 + random() * .28);
    belt.setColorAt(i, color);
  }
  belt.instanceMatrix.needsUpdate = true;
  belt.frustumCulled = false;
  return belt;
}

function makePlanet(body, glowTexture) {
  const root = new THREE.Group();
  root.name = body.en;

  const radius = body.radius;
  const highDetail = ['earth', 'jupiter', 'saturn'].includes(body.id);
  const texture = createPlanetTexture(body.id, highDetail ? 768 : 512, highDetail ? 384 : 256);
  const material = new THREE.MeshStandardMaterial({
    map: texture,
    roughness: body.id === 'earth' ? .88 : 1,
    metalness: 0,
    emissive: new THREE.Color(body.secondary),
    emissiveIntensity: .028
  });
  if (body.id === 'earth') {
    material.emissive = new THREE.Color(0xffc68b);
    material.emissiveIntensity = .8;
    material.emissiveMap = createNightLightsTexture();
    addNightSideLighting(material);
  }
  const mesh = new THREE.Mesh(sphereGeometry, material);
  mesh.scale.setScalar(radius);
  mesh.rotation.z = body.id === 'uranus' ? 1.71 : body.id === 'earth' ? .41 : .06;
  mesh.userData.bodyId = body.id;
  root.add(mesh);

  let clouds = null;
  if (body.id === 'earth') {
    clouds = new THREE.Mesh(
      sphereGeometry,
      new THREE.MeshStandardMaterial({
        map: createCloudTexture(),
        transparent: true,
        depthWrite: false,
        opacity: .83,
        roughness: 1
      })
    );
    clouds.scale.setScalar(radius * 1.017);
    clouds.rotation.z = .41;
    root.add(clouds);
    const atmosphere = new THREE.Mesh(
      sphereGeometry,
      createAtmosphereMaterial(0x55a8f1)
    );
    atmosphere.scale.setScalar(radius * 1.13);
    root.add(atmosphere);
  }

  if (['venus', 'uranus', 'neptune'].includes(body.id)) {
    const tint = body.id === 'venus' ? 0xe0af76 : body.id === 'uranus' ? 0x9bdbdd : 0x4165d5;
    const atmosphere = new THREE.Mesh(sphereGeometry, createAtmosphereMaterial(tint));
    atmosphere.scale.setScalar(radius * 1.09);
    root.add(atmosphere);
  }

  if (body.id === 'saturn') {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(radius * 1.28, radius * 2.34, 256),
      createRingMaterial()
    );
    ring.rotation.x = -Math.PI / 2 + .26;
    ring.rotation.y = .16;
    root.add(ring);
  }

  // Uranus also has a faint, nearly perpendicular ring system.
  if (body.id === 'uranus') {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(radius * 1.48, radius * 1.84, 160),
      new THREE.MeshBasicMaterial({
        color: 0xa2d0d5,
        opacity: .28,
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false
      })
    );
    ring.rotation.z = Math.PI / 2.12;
    root.add(ring);
  }

  return { root, mesh, clouds };
}

function makeSatellite(body) {
  const root = new THREE.Group();
  root.name = body.en;
  const material = new THREE.MeshStandardMaterial({
    map: createPlanetTexture(body.id === 'titan' ? 'venus' : 'mercury', 256, 128),
    roughness: 1,
    metalness: 0
  });
  const mesh = new THREE.Mesh(mediumSphereGeometry, material);
  mesh.scale.setScalar(body.radius);
  mesh.userData.bodyId = body.id;
  root.add(mesh);
  if (body.id === 'titan') {
    const atmosphere = new THREE.Mesh(
      mediumSphereGeometry,
      createAtmosphereMaterial(0xdba95c)
    );
    atmosphere.scale.setScalar(body.radius * 1.16);
    root.add(atmosphere);
  }
  return { root, mesh };
}

function createSolarFlares(glowTexture) {
  const random = seededRandom(11732);
  const positions = [];
  const colors = [];
  const tint = new THREE.Color();
  for (let i = 0; i < 950; i++) {
    const angle = random() * TAU;
    const z = random() * 2 - 1;
    const radius = 2.85 + Math.pow(random(), 3.5) * 2.8;
    const planar = Math.sqrt(1 - z * z);
    positions.push(Math.cos(angle) * planar * radius, z * radius, Math.sin(angle) * planar * radius);
    tint.setHSL(.05 + random() * .085, .95, .57 + random() * .28);
    colors.push(tint.r, tint.g, tint.b);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const material = new THREE.PointsMaterial({
    map: glowTexture, size: .34, vertexColors: true, transparent: true,
    opacity: .54, blending: THREE.AdditiveBlending, depthWrite: false,
    sizeAttenuation: true
  });
  return new THREE.Points(geometry, material);
}

export function createSolarSystem(glowTexture) {
  const group = new THREE.Group();
  group.name = 'Solar System';
  group.visible = false;
  const orbitsGroup = new THREE.Group();
  group.add(orbitsGroup);
  const bodies = {};
  const raycastMeshes = [];
  const moonOrbitGroups = [];
  const textures = createTextureManager();

  const solarLight = new THREE.PointLight(0xffe4be, 1350, 0, 2);
  solarLight.position.set(0, 0, 0);
  group.add(solarLight);

  const sun = CELESTIALS[0];
  const sunRoot = new THREE.Group();
  const sunMaterial = createSunMaterial();
  const sunMesh = new THREE.Mesh(sphereGeometry, sunMaterial);
  sunMesh.scale.setScalar(sun.radius);
  sunMesh.userData.bodyId = sun.id;
  sunRoot.add(sunMesh);

  const innerGlow = createGlowSprite(glowTexture, '#ffb04f', 12, .34);
  const outerGlow = createGlowSprite(glowTexture, '#ff842e', 29, .12);
  const faintGlow = createGlowSprite(glowTexture, '#ffbd76', 55, .042);
  sunRoot.add(faintGlow, outerGlow, innerGlow);
  const flares = createSolarFlares(glowTexture);
  sunRoot.add(flares);
  group.add(sunRoot);
  bodies.sun = { data: sun, root: sunRoot, mesh: sunMesh };
  raycastMeshes.push(sunMesh);

  for (const body of CELESTIALS.slice(1)) {
    orbitsGroup.add(createOrbit(body));
    const planet = makePlanet(body, glowTexture);
    group.add(planet.root);
    bodies[body.id] = { data: body, ...planet };
    raycastMeshes.push(planet.mesh);
  }

  for (const moon of SATELLITES) {
    const parent = bodies[moon.parentId];
    const satellite = makeSatellite(moon);
    const orbit = createOrbitLine(moon, 0x7c98b8, .18);
    parent.root.add(orbit, satellite.root);
    moonOrbitGroups.push(orbit);
    bodies[moon.id] = { data: moon, ...satellite };
    raycastMeshes.push(satellite.mesh);
  }

  const belt = createAsteroidBelt();
  group.add(belt);

  let elapsedSimulation = 0;
  const update = (delta, speed) => {
    if (speed > 0) elapsedSimulation += delta * speed;
    sunMaterial.uniforms.uTime.value = elapsedSimulation;
    sunMesh.rotation.y += delta * speed * sun.rotationSpeed;
    flares.rotation.y += delta * speed * .07;
    belt.rotation.y += delta * speed * .004;

    for (const body of CELESTIALS.slice(1)) {
      const planet = bodies[body.id];
      const angle = body.phase + elapsedSimulation * body.orbitSpeed;
      pointOnOrbit(body, angle, planet.root.position);
      planet.mesh.rotation.y += delta * speed * body.rotationSpeed;
      if (planet.clouds) planet.clouds.rotation.y += delta * speed * .038;
    }
    for (const moon of SATELLITES) {
      const satellite = bodies[moon.id];
      pointOnOrbit(moon, moon.phase + elapsedSimulation * moon.orbitSpeed, satellite.root.position);
      satellite.mesh.rotation.y += delta * speed * moon.rotationSpeed;
    }
  };

  update(0, 1);

  return {
    group,
    bodies,
    raycastMeshes,
    orbitsGroup,
    update,
    setOrbitsVisible(visible) {
      orbitsGroup.visible = visible;
      for (const orbit of moonOrbitGroups) orbit.visible = visible;
    },
    updateLevelOfDetail(camera) {
      const world = new THREE.Vector3();
      for (const body of CELESTIALS.slice(1)) {
        const planet = bodies[body.id];
        planet.root.getWorldPosition(world);
        const projectedRadius = body.radius / Math.max(1, world.distanceTo(camera.position));
        planet.mesh.geometry = projectedRadius > .045 ? sphereGeometry :
          projectedRadius > .009 ? mediumSphereGeometry : lowSphereGeometry;
      }
    },
    async loadTextures() {
      const highPriority = ['earth', 'jupiter', 'saturn', 'mars', 'venus', 'mercury', 'uranus', 'neptune'];
      const requests = highPriority.map(id => textures.applyMap(bodies[id].mesh, id));
      requests.push(textures.get('sun').then(texture => {
        if (texture) {
          sunMaterial.uniforms.uSurface.value = texture;
          sunMaterial.uniforms.uUseSurface.value = 1;
        }
      }));
      for (const moon of SATELLITES) requests.push(textures.applyMap(bodies[moon.id].mesh, moon.id, true));
      await Promise.allSettled(requests);
    },
    getSimulationDays() { return elapsedSimulation * 5; }
  };
}
