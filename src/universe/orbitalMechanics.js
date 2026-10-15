import * as THREE from 'three';

const TAU = Math.PI * 2;

/** Solve Kepler's equation for an educational, display-scaled ellipse. */
export function solveEccentricAnomaly(meanAnomaly, eccentricity = 0) {
  const e = Math.min(.98, Math.max(0, eccentricity));
  const mean = ((meanAnomaly % TAU) + TAU) % TAU;
  let eccentric = mean;
  for (let iteration = 0; iteration < 7; iteration++) {
    const f = eccentric - e * Math.sin(eccentric) - mean;
    eccentric -= f / (1 - e * Math.cos(eccentric));
  }
  return eccentric;
}

export function pointOnOrbit(body, meanAnomaly, target = new THREE.Vector3(), eccentricIsSolved = false) {
  const radius = body.orbitRadius || 0;
  if (!radius) return target.set(0, 0, 0);
  const e = body.eccentricity || 0;
  const E = eccentricIsSolved ? meanAnomaly : solveEccentricAnomaly(meanAnomaly, e);
  const major = radius * (Math.cos(E) - e);
  const minor = radius * Math.sqrt(1 - e * e) * Math.sin(E);
  const inclination = body.inclination || 0;
  const node = body.node || 0;
  const cosNode = Math.cos(node);
  const sinNode = Math.sin(node);
  return target.set(
    major * cosNode - minor * Math.cos(inclination) * sinNode,
    minor * Math.sin(inclination),
    major * sinNode + minor * Math.cos(inclination) * cosNode
  );
}

export function createOrbitLine(body, color = 0x6698ba, opacity = .23) {
  const points = [];
  const segments = 300;
  for (let i = 0; i < segments; i++) {
    points.push(pointOnOrbit(body, TAU * i / segments, new THREE.Vector3(), true));
  }
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  return new THREE.LineLoop(
    geometry,
    new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false })
  );
}
