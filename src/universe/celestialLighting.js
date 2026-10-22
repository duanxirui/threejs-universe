import * as THREE from 'three';

// Analytic sphere eclipses. Only the direct contribution of the existing solar
// point light is attenuated; ambient light and night-side city lights remain.
// This is a soft illustrative penumbra, not an ephemeris or a shadow map.
export function addEclipseShading(material) {
  const uniforms = {
    uEclipseStrength: { value: 0 },
    uEclipseCasterA: { value: new THREE.Vector4(0, 0, 0, 0) },
    uEclipseCasterB: { value: new THREE.Vector4(0, 0, 0, 0) }
  };
  const previousCompile = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey.bind(material);

  material.onBeforeCompile = shader => {
    previousCompile.call(material, shader);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader.replace(
      '#include <worldpos_vertex>',
      `#include <worldpos_vertex>
       vT12SurfaceWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;`
    ).replace(
      '#include <common>',
      '#include <common>\nvarying vec3 vT12SurfaceWorld;'
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      `#include <common>
       varying vec3 vT12SurfaceWorld;
       uniform float uEclipseStrength;
       uniform vec4 uEclipseCasterA;
       uniform vec4 uEclipseCasterB;
       float t12EclipseOcclusion(vec4 caster) {
         if (caster.w <= 0.0) return 0.0;
         float sunDistance = length(vT12SurfaceWorld);
         vec3 sunward = -vT12SurfaceWorld / max(sunDistance, 0.001);
         vec3 toCaster = caster.xyz - vT12SurfaceWorld;
         float along = dot(toCaster, sunward);
         if (along <= 0.001 || along >= sunDistance - 0.001) return 0.0;
         float lateral = length(toCaster - sunward * along);
         float softEdge = max(0.04, caster.w * 0.42);
         return 1.0 - smoothstep(caster.w - softEdge, caster.w + softEdge, lateral);
       }`
    ).replace(
      '#include <lights_fragment_end>',
      `#include <lights_fragment_end>
       if (uEclipseStrength > 0.001) {
         float obstruction = max(t12EclipseOcclusion(uEclipseCasterA),
                                 t12EclipseOcclusion(uEclipseCasterB));
         float lightLeft = 1.0 - obstruction * uEclipseStrength;
         reflectedLight.directDiffuse *= lightLeft;
         reflectedLight.directSpecular *= lightLeft;
       }`
    );
  };
  material.customProgramCacheKey = () => previousKey() + '|t12-eclipse-v1';
  return uniforms;
}

// Differential drift varies by latitude while preserving the existing JPG
// and its UV orientation. No per-frame texture upload is required.
export function addJupiterBandDrift(material) {
  const uniforms = {
    uJupiterBandTime: { value: 0 },
    uJupiterBandStrength: { value: 0 }
  };
  const previousCompile = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey.bind(material);
  material.onBeforeCompile = shader => {
    previousCompile.call(material, shader);
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      `#include <common>
       uniform float uJupiterBandTime;
       uniform float uJupiterBandStrength;`
    ).replace(
      '#include <map_fragment>',
      `#ifdef USE_MAP
         vec2 animatedUv = vMapUv;
         if (uJupiterBandStrength > 0.001) {
           float latitude = animatedUv.y;
           float broad = sin(latitude * 66.0 + uJupiterBandTime * 0.16) * 0.013;
           float fine = sin(latitude * 148.0 - uJupiterBandTime * 0.25) * 0.004;
           animatedUv.x += (broad + fine) * uJupiterBandStrength;
         }
         vec4 sampledDiffuseColor = texture2D(map, animatedUv);
         diffuseColor *= sampledDiffuseColor;
       #endif`
    );
  };
  material.customProgramCacheKey = () => previousKey() + '|t12-jupiter-bands-v1';
  return uniforms;
}

// Only related bodies share an illustrative shadow system. Display-scaled
// Mercury/Venus alignments used to cast enormous, fast-moving patches on Earth.
// Precompute parent, satellite and sibling candidates to limit per-frame work.
// Medium quality picks one caster, high quality up to two, low quality none.
// Moving casters are sampled every frame to keep their silhouettes continuous.
export function createEclipseUpdater(bodies) {
  const entries = Object.values(bodies).filter(entry => entry.data.id !== 'sun')
    .map(entry => ({ entry, position: new THREE.Vector3() }));
  for (const receiver of entries) {
    const target = receiver.entry.data;
    receiver.casters = entries.filter(candidate => {
      const body = candidate.entry.data;
      return body.parentId === target.id ||
        target.parentId === body.id ||
        (target.parentId && target.parentId === body.parentId);
    }).map(candidate => ({
      candidate,
      // A point-source shadow at the display scale would otherwise cover an
      // oversized portion of a parent planet during satellite transits.
      radius: candidate.entry.data.parentId === target.id
        ? candidate.entry.data.radius * 0.65 : candidate.entry.data.radius
    }));
  }
  const sunward = new THREE.Vector3();
  const offset = new THREE.Vector3();

  return function updateEclipses(qualityTier) {
    if (qualityTier === 0) return;
    for (const candidate of entries) {
      candidate.entry.root.getWorldPosition(candidate.position);
    }

    for (const receiver of entries) {
      if (!receiver.casters.length) continue;
      const position = receiver.position;
      const sunDistance = position.length();
      if (sunDistance <= 0.001) continue;
      sunward.copy(position).multiplyScalar(-1 / sunDistance);
      let first = null, second = null;
      let firstRadius = 0, secondRadius = 0;
      let firstScore = Infinity, secondScore = Infinity;

      for (const { candidate: caster, radius } of receiver.casters) {
        offset.copy(caster.position).sub(position);
        const along = offset.dot(sunward);
        if (along <= 0 || along >= sunDistance) continue;
        const lateralSq = Math.max(0, offset.lengthSq() - along * along);
        const allowed = radius + receiver.entry.data.radius + .08;
        if (lateralSq > allowed * allowed) continue;
        const score = Math.sqrt(lateralSq) / Math.max(radius, .05);
        if (score < firstScore) {
          second = first; secondScore = firstScore;
          secondRadius = firstRadius;
          first = caster; firstScore = score; firstRadius = radius;
        } else if (score < secondScore) {
          second = caster; secondScore = score; secondRadius = radius;
        }
      }

      for (const uniforms of receiver.entry.eclipseUniforms) {
        uniforms.uEclipseCasterA.value.set(
          first?.position.x ?? 0, first?.position.y ?? 0,
          first?.position.z ?? 0, firstRadius
        );
        const secondCaster = qualityTier === 2 ? second : null;
        uniforms.uEclipseCasterB.value.set(
          secondCaster?.position.x ?? 0, secondCaster?.position.y ?? 0,
          secondCaster?.position.z ?? 0, secondCaster ? secondRadius : 0
        );
      }
    }
  };
}
