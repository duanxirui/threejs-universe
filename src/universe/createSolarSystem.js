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
import { createSurfaceDetailMaps } from './surfaceDetail.js';
import { createTextureManager } from './textureManager.js';
import { addEclipseShading, addJupiterBandDrift, createEclipseUpdater } from './celestialLighting.js';
import { createPhysicalFrame, renderRelativeKm, chooseFloatingOrigin,
  getPhysicalRadiusScene, SCALE_MODES, SCENE_UNITS_PER_AU } from '../data/science/scaleModel.js';
import { orientationAtUtc, calculateDateObservations } from '../data/science/orientationModel.js';

const TAU = Math.PI * 2;

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

function makePlanet(body, glowTexture, sphereGeometry, sunWorld) {
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
    addNightSideLighting(material, sunWorld);
  }
  const bandUniforms = body.id === 'jupiter' ? addJupiterBandDrift(material) : null;
  const eclipseUniforms = [addEclipseShading(material, sunWorld)];
  const mesh = new THREE.Mesh(sphereGeometry, material);
  mesh.scale.setScalar(radius);
  mesh.userData.bodyId = body.id;
  root.add(mesh);

  let clouds = null;
  let atmosphere = null;
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
    // The moving translucent cloud shell already receives solar lighting.
    // Applying a second eclipse mask to it produced overlapping gray rings.
    root.add(clouds);
    atmosphere = new THREE.Mesh(
      sphereGeometry,
      createAtmosphereMaterial(0x55a8f1)
    );
    atmosphere.scale.setScalar(radius * 1.13);
    root.add(atmosphere);
  }

  if (['venus', 'uranus', 'neptune'].includes(body.id)) {
    const tint = body.id === 'venus' ? 0xe0af76 : body.id === 'uranus' ? 0x9bdbdd : 0x4165d5;
    atmosphere = new THREE.Mesh(sphereGeometry, createAtmosphereMaterial(tint));
    atmosphere.scale.setScalar(radius * 1.09);
    root.add(atmosphere);
  }

  if (body.id === 'saturn') {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(radius * 1.28, radius * 2.34, 256),
      createRingMaterial()
    );
    ring.rotation.x = -Math.PI / 2;
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
    ring.rotation.x = -Math.PI / 2;
    root.add(ring);
  }

  // Separate the planet's visual surface from its root: moon orbit offsets
  // attach to the root later and must NOT inherit a planetary size scale.
  const visual = new THREE.Group();
  const axis = new THREE.Group();
  axis.name = body.en + ' spin axis';
  visual.add(axis);
  for (const child of [...root.children]) {
    // The translucent atmosphere does not need longitude rotation. Rings,
    // clouds and the painted surface share the same planetary axial pole.
    if (child === atmosphere) visual.add(child);
    else axis.add(child);
  }
  root.add(visual);
  return { root, visual, axis, mesh, clouds, atmosphere, eclipseUniforms, bandUniforms };
}

function makeSatellite(body, mediumSphereGeometry, sunWorld) {
  const root = new THREE.Group();
  root.name = body.en;
  const material = new THREE.MeshStandardMaterial({
    map: createPlanetTexture(
      body.textureSource === 'procedural' ? body.id : body.id === 'titan' ? 'venus' : 'mercury',
      256, 128
    ),
    roughness: 1,
    metalness: 0
  });
  const eclipseUniforms = [addEclipseShading(material, sunWorld)];
  const mesh = new THREE.Mesh(mediumSphereGeometry, material);
  mesh.scale.setScalar(body.radius);
  mesh.userData.bodyId = body.id;
  const axis = new THREE.Group();
  axis.add(mesh);
  root.add(axis);
  let atmosphere = null;
  if (body.id === 'titan') {
    atmosphere = new THREE.Mesh(
      mediumSphereGeometry,
      createAtmosphereMaterial(0xdba95c)
    );
    atmosphere.scale.setScalar(body.radius * 1.16);
    root.add(atmosphere);
  }
  return { root, axis, mesh, atmosphere, eclipseUniforms };
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

export function createSolarSystem(glowTexture, renderer) {
  // Per-instance LOD geometries also need disposal when a different tier is
  // active at shutdown, so keep ownership within this solar system.
  const sphereGeometry = new THREE.SphereGeometry(1, 64, 48);
  const mediumSphereGeometry = new THREE.SphereGeometry(1, 32, 24);
  const lowSphereGeometry = new THREE.SphereGeometry(1, 16, 12);
  const group = new THREE.Group();
  group.name = 'Solar System';
  group.visible = false;
  // Shared world-space Sun location for night-side and eclipse shaders.
  // Under T27 floating origin this is not necessarily world (0,0,0).
  const sunWorld = new THREE.Vector3();
  const orbitsGroup = new THREE.Group();
  group.add(orbitsGroup);
  const bodies = {};
  const raycastMeshes = [];
  const moonOrbitGroups = [];
  const textures = createTextureManager(renderer);

  const textureJobs = new Map();
  const texturePriorities = { focus: 0, overview: 1, nearby: 2, background: 3 };
  const maxConcurrentTextures = 2;
  let texturesEnabled = false;
  let activeTextureLoads = 0;
  let pumpScheduled = false;
  let idleHandle = null;
  let jobSequence = 0;
  let disposed = false;
  const reliefTasks = new Map();

  function scheduleReliefTask(task) {
    if (disposed || !texturesEnabled || task.handle) return;
    const run = () => {
      task.handle = null;
      if (disposed || !texturesEnabled || reliefTasks.get(task.id) !== task) return;
      reliefTasks.delete(task.id);
      task.apply();
    };
    if (typeof window.requestIdleCallback === 'function') {
      task.handle = { type: 'idle', id: window.requestIdleCallback(run, { timeout: 1600 }) };
    } else {
      task.handle = { type: 'timeout', id: window.setTimeout(run, 0) };
    }
  }

  function pauseReliefTasks() {
    for (const task of reliefTasks.values()) {
      if (!task.handle) continue;
      if (task.handle.type === 'idle') window.cancelIdleCallback(task.handle.id);
      else window.clearTimeout(task.handle.id);
      task.handle = null;
    }
  }

  async function applyTexturedRelief(id, mesh, satellite = false, signal = null) {
    // The albedo loader retains its existing fallback CanvasTexture on failure.
    const loaded = await textures.applyMap(mesh, id, satellite, signal);
    if (disposed || signal?.aborted) return false;
    // Avoid doing three height-gradient conversions in the first render frame.
    // The colour texture is usable immediately; the queued JPG slot is freed
    // before generating the derived normal/roughness maps.
    const addDetail = () => {
      try {
        const material = mesh.material;
        const details = createSurfaceDetailMaps(id, material.map);
        if (!details) return;
        material.normalMap?.dispose();
        material.normalMap = details.normalMap;
        material.normalScale.set(details.normalScale, details.normalScale);
        if (details.roughnessMap) {
          material.roughnessMap?.dispose();
          material.roughnessMap = details.roughnessMap;
        }
        material.needsUpdate = true;
      } catch (error) {
        // A failed relief conversion must not remove the colour texture.
        console.warn(`Surface relief fallback for ${id}`, error);
      }
    };
    const task = { id, apply: addDetail, handle: null };
    reliefTasks.set(id, task);
    scheduleReliefTask(task);
    return loaded;
  }

  async function loadTextureForBody(id, signal) {
    if (id === 'sun') {
      const texture = await textures.get('sun', false, signal);
      if (!texture || disposed || signal.aborted) return false;
      sunMaterial.uniforms.uSurface.value = texture;
      sunMaterial.uniforms.uUseSurface.value = 1;
      return true;
    }
    const body = bodies[id];
    if (!body) return false;
    // These six Saturnian moons are deliberately illustrated at runtime.
    // Avoid probing non-existent JPG files (and clogging the texture queue).
    if (body.data.textureSource === 'procedural') return true;
    const satellite = Boolean(body.data.parentId);
    if (['earth', 'moon', 'mars'].includes(id)) {
      return applyTexturedRelief(id, body.mesh, satellite, signal);
    }
    return textures.applyMap(body.mesh, id, satellite, signal);
  }

  function nextQueuedTexture() {
    let next = null;
    for (const job of textureJobs.values()) {
      if (job.state !== 'queued') continue;
      if (!next || job.priority < next.priority ||
        (job.priority === next.priority && job.sequence < next.sequence)) next = job;
    }
    return next;
  }

  function cancelIdleLoad() {
    if (!idleHandle) return;
    if (idleHandle.type === 'idle') window.cancelIdleCallback(idleHandle.id);
    else window.clearTimeout(idleHandle.id);
    idleHandle = null;
  }

  function queueTexturePump() {
    if (!texturesEnabled || pumpScheduled) return;
    pumpScheduled = true;
    Promise.resolve().then(() => {
      pumpScheduled = false;
      pumpTextures();
    });
  }

  function startTextureJob(job) {
    job.state = 'loading';
    job.controller = new AbortController();
    activeTextureLoads++;
    Promise.resolve()
      .then(() => loadTextureForBody(job.id, job.controller.signal))
      .catch(error => {
        console.warn(`Texture job fallback for ${job.id}`, error);
        return false;
      })
      .then(success => {
        if (job.state === 'cancelled' || disposed) return;
        job.state = 'complete';
        job.resolve(Boolean(success));
      })
      .finally(() => {
        activeTextureLoads--;
        queueTexturePump();
      });
  }

  function scheduleIdleTexture() {
    if (idleHandle) return;
    const startWhenIdle = () => {
      idleHandle = null;
      if (!texturesEnabled || activeTextureLoads >= maxConcurrentTextures) return;
      const job = nextQueuedTexture();
      if (job) startTextureJob(job);
      queueTexturePump();
    };
    if (typeof window.requestIdleCallback === 'function') {
      idleHandle = { type: 'idle', id: window.requestIdleCallback(startWhenIdle, { timeout: 1200 }) };
    } else {
      idleHandle = { type: 'timeout', id: window.setTimeout(startWhenIdle, 180) };
    }
  }

  function pumpTextures() {
    if (!texturesEnabled) return;
    while (activeTextureLoads < maxConcurrentTextures) {
      const next = nextQueuedTexture();
      if (!next) {
        cancelIdleLoad();
        return;
      }
      // The selected body and key overview planets are requested immediately.
      // Other planets and nearby moons wait for an idle slice before each start.
      if (next.priority > texturePriorities.overview) {
        scheduleIdleTexture();
        return;
      }
      startTextureJob(next);
    }
  }

  function requestTexture(id, priority = 'focus') {
    if (disposed) return Promise.resolve(false);
    if (!bodies[id]) return Promise.resolve(false);
    if (bodies[id].data.textureSource === 'procedural') return Promise.resolve(true);
    const level = texturePriorities[priority] ?? texturePriorities.focus;
    let job = textureJobs.get(id);
    if (job) {
      if (job.state === 'queued') job.priority = Math.min(level, job.priority);
    } else {
      job = { id, priority: level, sequence: jobSequence++, state: 'queued' };
      job.promise = new Promise(resolve => { job.resolve = resolve; });
      textureJobs.set(id, job);
    }
    queueTexturePump();
    return job.promise;
  }

  function loadOverviewTextures() {
    for (const id of ['sun', 'earth', 'jupiter', 'saturn']) requestTexture(id, 'overview');
    for (const id of ['mercury', 'venus', 'mars', 'uranus', 'neptune']) requestTexture(id, 'background');
  }

  function requestNearbyTextures(id) {
    const body = bodies[id]?.data;
    if (!body) return;
    if (body.parentId) {
      requestTexture(body.parentId, 'overview');
      return;
    }
    for (const moon of SATELLITES) {
      if (moon.parentId === id) requestTexture(moon.id, 'nearby');
    }
  }

  function cancelPendingTextureJobs() {
    for (const [id, job] of textureJobs) {
      if (job.state === 'complete') continue;
      job.state = 'cancelled';
      job.controller?.abort();
      job.resolve(false);
      textureJobs.delete(id);
    }
  }

  function setTextureLoadingEnabled(enabled) {
    if (disposed) return;
    texturesEnabled = Boolean(enabled);
    if (texturesEnabled) {
      for (const task of reliefTasks.values()) scheduleReliefTask(task);
      queueTexturePump();
    } else {
      cancelIdleLoad();
      pauseReliefTasks();
      cancelPendingTextureJobs();
    }
  }

  function dispose() {
    if (disposed) return { textures: new Set(), geometries: new Set() };
    texturesEnabled = false;
    cancelIdleLoad();
    pauseReliefTasks();
    reliefTasks.clear();
    cancelPendingTextureJobs();
    textureJobs.clear();
    disposed = true;
    const releasedTextures = textures.dispose();
    const releasedGeometries = new Set([
      sphereGeometry, mediumSphereGeometry, lowSphereGeometry
    ]);
    for (const geometry of releasedGeometries) geometry.dispose();
    return { textures: releasedTextures, geometries: releasedGeometries };
  }

  const solarLight = new THREE.PointLight(0xffe4be, 1350, 0, 2);
  solarLight.position.set(0, 0, 0);
  group.add(solarLight);

  const sun = CELESTIALS[0];
  const sunRoot = new THREE.Group();
  const sunMaterial = createSunMaterial();
  const sunMesh = new THREE.Mesh(sphereGeometry, sunMaterial);
  sunMesh.scale.setScalar(sun.radius);
  sunMesh.userData.bodyId = sun.id;
  const sunAxis = new THREE.Group();
  sunAxis.add(sunMesh);
  sunRoot.add(sunAxis);

  const innerGlow = createGlowSprite(glowTexture, '#ffb04f', 12, .34);
  const outerGlow = createGlowSprite(glowTexture, '#ff842e', 29, .12);
  const faintGlow = createGlowSprite(glowTexture, '#ffbd76', 55, .042);
  sunRoot.add(faintGlow, outerGlow, innerGlow);
  const flares = createSolarFlares(glowTexture);
  sunRoot.add(flares);
  group.add(sunRoot);
  bodies.sun = { data: sun, sourceData: sun, root: sunRoot, axis: sunAxis, mesh: sunMesh };
  raycastMeshes.push(sunMesh);

  for (const body of CELESTIALS.slice(1)) {
    orbitsGroup.add(createOrbit(body));
    const planet = makePlanet(body, glowTexture, sphereGeometry, sunWorld);
    group.add(planet.root);
    bodies[body.id] = { data: body, sourceData: body, ...planet };
    raycastMeshes.push(planet.mesh);
  }

  for (const moon of SATELLITES) {
    const parent = bodies[moon.parentId];
    const satellite = makeSatellite(moon, mediumSphereGeometry, sunWorld);
    const orbit = createOrbitLine(moon, 0x7c98b8, .18);
    parent.root.add(orbit, satellite.root);
    moonOrbitGroups.push(orbit);
    bodies[moon.id] = { data: moon, sourceData: moon, ...satellite };
    raycastMeshes.push(satellite.mesh);
  }

  const belt = createAsteroidBelt();
  group.add(belt);
  const updateEclipses = createEclipseUpdater(bodies, sunRoot);
  let qualityTier = 0;

  let elapsedSimulation = 0;
  let ephemerisStore = null;
  let ephemerisUtcMs = null;
  let orbitsRequested = true;
  let ephemerisReachedEnd = false;
  let scaleMode = 'enhanced';
  let originAnchorId = 'sun';
  let physicalFrame = Object.create(null);
  let observationInfo = { enabled: false, utcMs: null };
  const poseUp = new THREE.Vector3(0, 1, 0);
  const posePole = new THREE.Vector3();
  const EPHEMERIS_DAY_MS = 86400000;
  function updateOrbitVisibility() {
    const visible = orbitsRequested && !ephemerisStore && scaleMode === 'enhanced';
    orbitsGroup.visible = visible;
    for (const orbit of moonOrbitGroups) orbit.visible = visible;
  }
  function applyPose(id, entry, demoRate, demoTilt = 0) {
    const datePose = ephemerisStore ? orientationAtUtc(id, ephemerisUtcMs) : null;
    if (datePose) {
      posePole.fromArray(datePose.poleScene);
      entry.axis.quaternion.setFromUnitVectors(poseUp, posePole);
      entry.mesh.rotation.set(0, datePose.spinRadians, 0);
    } else {
      // Without a supported pole model the legacy display spin is illustrative.
      entry.axis.rotation.set(0, 0, demoTilt);
      entry.mesh.rotation.set(0, elapsedSimulation * demoRate, 0);
    }
    return datePose;
  }
  const update = (delta, speed) => {
    if (speed > 0) elapsedSimulation += delta * speed;
    ephemerisReachedEnd = false;
    if (ephemerisStore && speed > 0) {
      // One UTC day per real second at 1x, scaled by the existing playback
      // control. A time boundary clamps and pauses via the UniverseApp caller.
      const next = ephemerisUtcMs + delta * speed * EPHEMERIS_DAY_MS;
      if (next >= ephemerisStore.endMs) ephemerisReachedEnd = true;
      ephemerisUtcMs = Math.min(next, ephemerisStore.endMs);
    }
    const positions = ephemerisStore
      ? ephemerisStore.getDisplayPositions(ephemerisUtcMs) : null;
    physicalFrame = createPhysicalFrame({
      elapsed: elapsedSimulation,
      store: ephemerisStore,
      utcMs: ephemerisUtcMs
    });
    observationInfo = calculateDateObservations(
      physicalFrame, ephemerisStore ? ephemerisUtcMs : null
    );
    if (scaleMode === 'physical') {
      group.position.fromArray(chooseFloatingOrigin(physicalFrame, originAnchorId));
    } else {
      group.position.set(0, 0, 0);
    }
    sunWorld.copy(group.position);
    sunMaterial.uniforms.uTime.value = elapsedSimulation;
    // T14: derive every spin from the simulation clock. A date seek or a
    // backwards scrub must place both orbital centres and rotations on the
    // chosen frame, regardless of the previous playback history.
    applyPose('sun', bodies.sun, sun.rotationSpeed);
    flares.rotation.y = elapsedSimulation * .07;
    belt.rotation.y = elapsedSimulation * .004;

    for (const body of CELESTIALS.slice(1)) {
      const planet = bodies[body.id];
      if (scaleMode === 'physical') {
        planet.root.position.fromArray(renderRelativeKm(physicalFrame[body.id].relativeKm));
      } else if (positions?.[body.id]) {
        planet.root.position.fromArray(positions[body.id]);
      } else {
        // Unsupported planets retain their old, clearly labelled demonstration
        // orbit and do not acquire a fictitious ephemeris date.
        const angle = body.phase + elapsedSimulation * body.orbitSpeed;
        pointOnOrbit(body, angle, planet.root.position);
      }
      const datePose = applyPose(body.id, planet, body.rotationSpeed,
        body.id === 'uranus' ? 1.71 : body.id === 'earth' ? .41 : .06);
      if (planet.clouds) planet.clouds.rotation.y = datePose
        ? datePose.spinRadians + .08 : elapsedSimulation * .038;
    }
    for (const moon of SATELLITES) {
      const satellite = bodies[moon.id];
      if (scaleMode === 'physical') {
        satellite.root.position.fromArray(renderRelativeKm(physicalFrame[moon.id].relativeKm));
      } else if (positions?.[moon.id]) satellite.root.position.fromArray(positions[moon.id]);
      else pointOnOrbit(moon, moon.phase + elapsedSimulation * moon.orbitSpeed, satellite.root.position);
      applyPose(moon.id, satellite, moon.rotationSpeed);
    }
    bodies.jupiter.bandUniforms.uJupiterBandTime.value = elapsedSimulation;
    // The galaxy landing view keeps the solar group hidden. Skip the analytic
    // eclipse CPU work until the user actually enters the solar scene.
    if (group.visible) updateEclipses(qualityTier);
    return ephemerisReachedEnd;
  };

  update(0, 1);

  return {
    group,
    bodies,
    raycastMeshes,
    orbitsGroup,
    update,
    dispose,
    setTextureLoadingEnabled,
    loadOverviewTextures,
    requestTexture,
    requestNearbyTextures,
    setScaleMode(nextMode, anchorId = 'sun') {
      if (!SCALE_MODES.includes(nextMode)) return false;
      scaleMode = nextMode;
      originAnchorId = bodies[anchorId] ? anchorId : 'sun';
      for (const [id, entry] of Object.entries(bodies)) {
        const radius = getPhysicalRadiusScene(id);
        if (!(radius > 0)) throw Error('Missing physical radius for ' + id);
        const factor = nextMode === 'physical' ? radius / entry.sourceData.radius : 1;
        // The Sun and individual satellites have no nested orbiting children;
        // planets use a separate visual group to preserve child-moon offsets.
        if (entry.visual) entry.visual.scale.setScalar(factor);
        else entry.root.scale.setScalar(factor);
        entry.data = nextMode === 'physical'
          ? { ...entry.sourceData, radius, physicalScale: true }
          : entry.sourceData;
      }
      belt.visible = nextMode === 'enhanced';
      // Point-light inverse-square falloff needs the same distance conversion
      // as the geometry; otherwise planets become almost unlit at 1 AU.
      solarLight.intensity = nextMode === 'physical'
        ? 1350 * (SCENE_UNITS_PER_AU / 14.1) ** 2 : 1350;
      updateOrbitVisibility();
      update(0, 0);
      return true;
    },
    setFloatingOriginAnchor(bodyId = 'sun') {
      if (scaleMode !== 'physical' || !bodies[bodyId]) return null;
      const before = group.position.clone();
      originAnchorId = bodyId;
      group.position.fromArray(chooseFloatingOrigin(physicalFrame, originAnchorId));
      return group.position.clone().sub(before);
    },
    getScaleInfo() {
      return {
        mode: scaleMode, anchorId: originAnchorId,
        origin: group.position.toArray(),
        unitsPerAu: SCENE_UNITS_PER_AU,
        physicalRadiusKm: 'diameterKm / 2'
      };
    },
    getPhysicalPositionKm(id) {
      return physicalFrame[id]?.absoluteKm.slice() || null;
    },
    getPhysicalRelativeKm(id) {
      return physicalFrame[id]?.relativeKm.slice() || null;
    },
    getObservationInfo() { return observationInfo; },
    getOrientationInfo(id) {
      const entry = bodies[id];
      if (!entry) return null;
      const datePose = ephemerisStore ? orientationAtUtc(id, ephemerisUtcMs) : null;
      return {
        bodyId: id, source: datePose?.source || 'demonstration-spin',
        poleScene: datePose?.poleScene || null,
        spinRadians: entry.mesh.rotation.y,
        axisQuaternion: entry.axis.quaternion.toArray()
      };
    },
    getSunWorldPosition() { return sunWorld.toArray(); },
    enableEphemeris(store, utcMs) {
      if (!store?.hasUtc(utcMs) || !store.getDisplayPositions(utcMs)) return false;
      ephemerisStore = store;
      ephemerisUtcMs = utcMs;
      updateOrbitVisibility();
      update(0, 0);
      return true;
    },
    seekEphemerisUtc(utcMs) {
      if (!ephemerisStore?.hasUtc(utcMs) || !ephemerisStore.getDisplayPositions(utcMs)) {
        return false;
      }
      ephemerisUtcMs = utcMs;
      update(0, 0);
      return true;
    },
    disableEphemeris() {
      if (!ephemerisStore) return false;
      ephemerisStore = null;
      ephemerisUtcMs = null;
      updateOrbitVisibility();
      update(0, 0);
      return true;
    },
    getEphemerisInfo() {
      return ephemerisStore ? {
        enabled: true, utcMs: ephemerisUtcMs,
        startMs: ephemerisStore.startMs, endMs: ephemerisStore.endMs,
        sourceVersion: ephemerisStore.manifest.sourceVersion,
        source: ephemerisStore.manifest.source,
        lastSample: ephemerisReachedEnd
      } : { enabled: false, utcMs: null };
    },
    setSimulationDays(days) {
      if (!Number.isFinite(days)) return false;
      // The date selector uses an arbitrary educational calendar epoch;
      // the existing solar model runs in units of five displayed days.
      elapsedSimulation = days / 5;
      update(0, 0);
      return true;
    },
    setQualityTier(tier) {
      qualityTier = THREE.MathUtils.clamp(tier, 0, 2);
      // InstancedMesh.count and drawRange avoid reallocating GPU buffers.
      belt.count = [500, 1050, 1750][qualityTier];
      flares.geometry.setDrawRange(0, [280, 620, 950][qualityTier]);
      for (const entry of Object.values(bodies)) {
        for (const uniforms of entry.eclipseUniforms || []) {
          uniforms.uEclipseStrength.value = qualityTier === 0 ? 0 :
            qualityTier === 1 ? .34 : .55;
          if (qualityTier < 2) uniforms.uEclipseCasterB.value.set(0, 0, 0, 0);
        }
        if (entry.atmosphere) {
          entry.atmosphere.material.uniforms.uQualityTier.value = qualityTier;
        }
      }
      bodies.jupiter.bandUniforms.uJupiterBandStrength.value =
        qualityTier === 0 ? 0 : qualityTier === 1 ? .45 : 1;
      // A quality switch must not briefly display the previous caster pose.
      if (group.visible) updateEclipses(qualityTier);
    },
    setOrbitsVisible(visible) {
      orbitsRequested = visible;
      updateOrbitVisibility();
    },
    updateLevelOfDetail(camera) {
      const world = new THREE.Vector3();
      for (const body of CELESTIALS.slice(1)) {
        const planet = bodies[body.id];
        planet.root.getWorldPosition(world);
        const projectedRadius = planet.data.radius /
          Math.max(.0001, world.distanceTo(camera.position));
        // Separate entry/exit thresholds prevent camera damping and tiny
        // orbital movements from toggling the sphere tessellation repeatedly.
        const current = planet.mesh.geometry;
        let next = current;
        if (current === sphereGeometry) {
          if (projectedRadius < .007) next = lowSphereGeometry;
          else if (projectedRadius < .038) next = mediumSphereGeometry;
        } else if (current === mediumSphereGeometry) {
          if (projectedRadius > .052) next = sphereGeometry;
          else if (projectedRadius < .007) next = lowSphereGeometry;
        } else if (projectedRadius > .052) {
          next = sphereGeometry;
        } else if (projectedRadius > .012) {
          next = mediumSphereGeometry;
        }
        if (next !== current) planet.mesh.geometry = next;
      }
    },
    getSimulationDays() { return elapsedSimulation * 5; }
  };
}
