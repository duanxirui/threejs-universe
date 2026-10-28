// T27 - Physical positions stay in float64 JavaScript kilometres regardless
// of rendering mode. Only the final render mapping uses Three.js scene units.
// 1000 scene units = one AU; actual ratios are invariant to that choice.
import { CELESTIALS, SATELLITES } from '../celestials.js';
import { getEducationalNumber, KM_PER_AU } from './physicalCatalog.js';
import { eclipticToScene, subtractPosition } from './ephemeris.js';
import { pointOnOrbit } from '../../universe/orbitalMechanics.js';

export const SCENE_UNITS_PER_AU = 1000;
export const SCENE_UNITS_PER_KM = SCENE_UNITS_PER_AU / KM_PER_AU;
export const SCALE_MODES = Object.freeze(['enhanced', 'physical']);

export function getPhysicalRadiusKm(id) {
  const diameter = getEducationalNumber(id, 'diameterKm');
  return Number.isFinite(diameter) && diameter > 0 ? diameter / 2 : null;
}
export function getPhysicalRadiusScene(id) {
  const radius = getPhysicalRadiusKm(id);
  return radius === null ? null : radius * SCENE_UNITS_PER_KM;
}
function add(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}
function educationalRelativeKm(body, elapsed) {
  const km = getEducationalNumber(body.id, 'distanceKm');
  if (!Number.isFinite(km) || !body.orbitRadius) return [0, 0, 0];
  const target = pointOnOrbit(body, body.phase + elapsed * body.orbitSpeed);
  const s = km / body.orbitRadius;
  return [target.x * s, target.y * s, target.z * s];
}

// One CPU-side model for ALL 22 bodies. Unsupported date targets preserve
// explicitly illustrative orbital phases, but their mean distances and
// diameters still use the same physical km->render scale in "physical" mode.
export function createPhysicalFrame({ elapsed = 0, store = null, utcMs = null } = {}) {
  const states = Object.create(null);
  const hasDate = store && store.hasUtc(utcMs) &&
    ['sun', 'earth', 'moon', 'mars'].every(id => store.getState(id, utcMs));
  const date = hasDate ? Object.fromEntries(['sun', 'earth', 'moon', 'mars']
    .map(id => [id, store.getState(id, utcMs).positionKm])) : null;
  const sunBary = date?.sun;
  for (const body of CELESTIALS) {
    const sourceDate = date?.[body.id];
    const relativeKm = body.id === 'sun' ? [0, 0, 0] :
      sourceDate ? eclipticToScene(subtractPosition(sourceDate, sunBary), 1) :
      educationalRelativeKm(body, elapsed);
    states[body.id] = {
      bodyId: body.id,
      centerId: 'sun',
      relativeKm,
      absoluteKm: relativeKm.slice(),
      radiusKm: getPhysicalRadiusKm(body.id),
      source: sourceDate ? 'horizons-date' : 'educational-orbit',
      utcMs: sourceDate ? utcMs : null
    };
  }
  for (const body of SATELLITES) {
    const parent = states[body.parentId];
    if (!parent) throw Error('Missing orbit centre for ' + body.id);
    const relativeKm = body.id === 'moon' && date
      ? eclipticToScene(subtractPosition(date.moon, date.earth), 1)
      : educationalRelativeKm(body, elapsed);
    states[body.id] = {
      bodyId: body.id,
      centerId: body.parentId,
      relativeKm,
      absoluteKm: add(parent.absoluteKm, relativeKm),
      radiusKm: getPhysicalRadiusKm(body.id),
      source: body.id === 'moon' && date ? 'horizons-date' : 'educational-orbit',
      utcMs: body.id === 'moon' && date ? utcMs : null
    };
  }
  return states;
}

export function renderRelativeKm(relativeKm) {
  return relativeKm.map(value => value * SCENE_UNITS_PER_KM);
}

export function chooseFloatingOrigin(frame, bodyId = 'sun') {
  const selected = frame[bodyId] ?? frame.sun;
  return selected.absoluteKm.map(value => -value * SCENE_UNITS_PER_KM);
}
