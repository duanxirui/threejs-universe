import * as THREE from 'three';

// These are scene units, not astronomical distances. Keep satellite clearances
// small enough that the closest moons remain reachable beside their parent.
export function getBodyClearance(body) {
  if (body.physicalScale) {
    return Math.max(body.radius * 1.4, body.radius + .002);
  }
  return Math.max(body.radius * 1.16, body.radius + (body.parentId ? .12 : .18), body.parentId ? .3 : 0);
}

export function getArrivalDistance(body) {
  if (body.physicalScale) {
    return Math.max(getBodyClearance(body) + Math.max(.005, body.radius * .6), body.radius * 2.1);
  }
  return Math.max(getBodyClearance(body) + .55, body.radius * 2.1);
}

// Clip a full camera movement segment against *all* solar bodies, including
// the Sun and satellites. Endpoint-only collision checks can tunnel at 4x speed.
export function constrainCameraSegment(from, to, bodies) {
  const start = from.clone();
  const end = to.clone();
  let blockedBody = null;

  // A moving orbit or a zoom may leave the camera inside a clearance sphere.
  // Reposition first so a following movement can be swept from a valid point.
  for (const entry of bodies) {
    const center = entry.root.getWorldPosition(new THREE.Vector3());
    const radius = getBodyClearance(entry.data);
    const away = start.clone().sub(center);
    if (away.lengthSq() >= radius * radius) continue;
    if (away.lengthSq() < 1e-10) {
      away.copy(end).sub(center);
      if (away.lengthSq() < 1e-10) away.set(0, 1, 0);
    }
    const adjustment = center.add(away.normalize().multiplyScalar(radius + .002)).sub(start);
    start.add(adjustment);
    end.add(adjustment);
    blockedBody = entry.data;
  }

  const travel = end.clone().sub(start);
  const travelSq = travel.lengthSq();
  if (travelSq < 1e-12) return { position: end, blockedBody };

  let firstHit = 1;
  for (const entry of bodies) {
    const center = entry.root.getWorldPosition(new THREE.Vector3());
    const radius = getBodyClearance(entry.data);
    const relative = start.clone().sub(center);
    const approach = relative.dot(travel);
    if (approach >= 0) continue; // Moving away from this body.
    const discriminant = approach * approach - travelSq * (relative.lengthSq() - radius * radius);
    if (discriminant < 0) continue;
    const fraction = (-approach - Math.sqrt(discriminant)) / travelSq;
    if (fraction >= 0 && fraction <= firstHit) {
      firstHit = fraction;
      blockedBody = entry.data;
    }
  }

  if (firstHit < 1) end.copy(start).addScaledVector(travel, Math.max(0, firstHit - .0001));
  return { position: end, blockedBody };
}
