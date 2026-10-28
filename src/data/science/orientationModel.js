// T28: deterministic J2000 pole/rotation approximations and date-based
// Sun/Earth/Moon viewing geometry. This is a teaching model, not an eclipse
// forecast or a high-precision terrestrial/lunar attitude service.
// Sources: IAU WGCCRE 2015 (planetary cartographic elements, simplified),
// https://www.usgs.gov/media/files/report-iau-working-group
// Earth/Moon: approximate J2000 orientation; IERS and lunar libration terms
// are deliberately outside this version's scope.
import { eclipticToScene } from './ephemeris.js';

const RAD = Math.PI / 180;
const DAY_MS = 86400000;
const J2000_MS = Date.UTC(2000, 0, 1, 12);
const OBLIQUITY_RAD = 23.4392911 * RAD;
const EPS = 1e-12;

// Pole RA/Dec (ICRF degrees), prime-meridian W at J2000 and W rate (deg/day).
// Long-period terms, nutation, libration and differential rotation omitted.
const POLES = Object.freeze({
  sun: [286.13, 63.87, 84.176, 14.1844],
  mercury: [281.0103, 61.4155, 329.5988, 6.1385108],
  venus: [272.76, 67.16, 160.20, -1.4813688],
  earth: [0, 90, 190.147, 360.9856235],
  moon: [269.9949, 66.5392, 38.3213, 13.17635815],
  mars: [317.2692, 54.4325, 176.63, 350.89198226],
  jupiter: [268.056595, 64.495303, 284.95, 870.536],
  saturn: [40.589, 83.537, 38.90, 810.7939024],
  uranus: [257.311, -15.175, 203.81, -501.1600928],
  neptune: [299.36, 43.46, 249.978, 541.1397757]
});
export const ORIENTATION_MODEL_IDS = Object.freeze(Object.keys(POLES));

function clamp(value) { return Math.max(-1, Math.min(1, value)); }
function difference(a, b) { return a.map((v, i) => v - b[i]); }
function dot(a, b) { return a.reduce((sum, v, i) => sum + v * b[i], 0); }
function length(a) { return Math.hypot(...a); }
function unit(a) {
  const n = length(a);
  return n > EPS ? a.map(v => v / n) : null;
}
function positiveAngle(angle) {
  return ((angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
}
function eclipticLongitude(sceneVector) {
  // T26 eclipticToScene maps [x, y, z] to [x, z, -y].
  return Math.atan2(-sceneVector[2], sceneVector[0]);
}

export function poleToScene(raDeg, decDeg) {
  const ra = raDeg * RAD;
  const dec = decDeg * RAD;
  const x = Math.cos(dec) * Math.cos(ra);
  const y = Math.cos(dec) * Math.sin(ra);
  const z = Math.sin(dec);
  return eclipticToScene([
    x, y * Math.cos(OBLIQUITY_RAD) + z * Math.sin(OBLIQUITY_RAD),
    -y * Math.sin(OBLIQUITY_RAD) + z * Math.cos(OBLIQUITY_RAD)
  ], 1);
}

export function orientationAtUtc(bodyId, utcMs) {
  const model = POLES[bodyId];
  if (!model || !Number.isFinite(utcMs)) return null;
  const elapsedDays = (utcMs - J2000_MS) / DAY_MS;
  const [ra, dec, primeDeg, rateDegPerDay] = model;
  const poleScene = unit(poleToScene(ra, dec));
  const spinDegrees = ((primeDeg + elapsedDays * rateDegPerDay) % 360 + 360) % 360;
  return {
    bodyId, poleScene, spinRadians: spinDegrees * RAD,
    utcMs, spinRateDegPerDay: rateDegPerDay,
    source: bodyId === 'earth' || bodyId === 'moon'
      ? 'educational-j2000-approximation' : 'iau-wgccre-simplified',
    limitations: 'Constant pole and linear rotation; no nutation, precession, libration or texture prime-meridian calibration.'
  };
}

export function calculateDateObservations(frame, utcMs) {
  if (!Number.isFinite(utcMs) || !frame?.sun || !frame?.earth || !frame?.moon) {
    return { enabled: false, utcMs: null, reason: '需要启用有星历支持的 UTC 日期' };
  }
  if (['sun', 'earth', 'moon'].some(id => frame[id].source !== 'horizons-date')) {
    return { enabled: false, utcMs: null, reason: '太阳、地球、月球日期星历不完整' };
  }
  const sun = frame.sun.absoluteKm;
  const earth = frame.earth.absoluteKm;
  const moon = frame.moon.absoluteKm;
  const toSun = unit(difference(sun, moon));
  const toEarth = unit(difference(earth, moon));
  const earthSun = unit(difference(sun, earth));
  const earthMoon = unit(difference(moon, earth));
  if (!toSun || !toEarth || !earthSun || !earthMoon) {
    return { enabled: false, utcMs: null, reason: '日期几何向量不可用' };
  }
  const illuminatedFraction = (1 + clamp(dot(toSun, toEarth))) / 2;
  const phaseProgress = positiveAngle(
    eclipticLongitude(earthMoon) - eclipticLongitude(earthSun)
  ) / (Math.PI * 2);
  const waxing = phaseProgress < 0.5;
  const phaseName = illuminatedFraction < 0.035 ? '新月附近' :
    illuminatedFraction > 0.965 ? '满月附近' :
    Math.abs(illuminatedFraction - 0.5) <= 0.045 ? (waxing ? '上弦附近' : '下弦附近') :
    illuminatedFraction < 0.5 ? (waxing ? '娥眉月' : '残月') :
      (waxing ? '盈凸月' : '亏凸月');
  const pole = orientationAtUtc('earth', utcMs).poleScene;
  const subsolarLatitudeDeg = Math.asin(clamp(dot(pole, earthSun))) / RAD;
  return {
    enabled: true, utcMs, source: 'DE441 geometric vectors + simplified J2000 pole',
    earth: {
      subsolarLatitudeDeg,
      sunDirectionScene: earthSun,
      seasonHint: subsolarLatitudeDeg > 1 ? '北半球偏夏、南半球偏冬' :
        subsolarLatitudeDeg < -1 ? '北半球偏冬、南半球偏夏' : '接近春分或秋分方向'
    },
    moon: {
      illuminatedFraction, phaseProgress, phaseName, waxing,
      elongationDeg: Math.acos(clamp(dot(earthSun, earthMoon))) / RAD
    },
    note: '几何月相和太阳直射纬度为简化科普计算；不提供食预报、观测地日出日落或月球天平动。'
  };
}
