// T26 - NASA/JPL Horizons DE441 vector snapshots, loaded only when date mode
// is enabled. UTC samples are geometric vectors referenced to the solar-system
// barycenter, in J2000 ecliptic axes; units: km and km/s.
// This module never treats the old educational orbit phase as real time.
const DAY_MS = 86400000;
const DAY_SECONDS = 86400;
export const AU_KM = 149597870.7;
export const EPHEMERIS_BODIES = Object.freeze(['sun', 'earth', 'moon', 'mars']);
const YEAR_SCHEMA = 'cosmos-vectors-v1';
const MANIFEST_SCHEMA = 'cosmos-ephemeris-v1';
let cached = null;

function fail(message) {
  throw Error('星历数据错误：' + message);
}
export function parseUtcDateTime(value) {
  if (typeof value !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value)) return null;
  const normalized = value.length === 16 ? value + ':00' : value;
  const ms = Date.parse(normalized + 'Z');
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 19) !== normalized) {
    return null;
  }
  return ms;
}
export function formatUtcInput(utcMs) {
  return Number.isFinite(utcMs) ? new Date(utcMs).toISOString().slice(0, 16) : '';
}
export function formatUtcDisplay(utcMs) {
  return Number.isFinite(utcMs) ? new Date(utcMs).toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : '—';
}
function toMs(value, field) {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms) || !String(value).endsWith('Z')) fail(field + ' 日期无效');
  return ms;
}
function finiteVector(row) {
  return Array.isArray(row) && row.length === 6 && row.every(Number.isFinite);
}

// Cubic Hermite interpolation uses the Horizons daily position and velocity.
// The 86400 multiplier converts km/s derivatives to km per sample interval.
export function interpolateVector(rows, sampleOffset) {
  const low = Math.floor(sampleOffset);
  if (low < 0 || low >= rows.length || !Number.isFinite(sampleOffset)) {
    return null;
  }
  if (low === rows.length - 1) {
    return { positionKm: rows[low].slice(0, 3), velocityKmS: rows[low].slice(3, 6) };
  }
  const a = rows[low];
  const b = rows[low + 1];
  const t = sampleOffset - low;
  const t2 = t * t;
  const t3 = t2 * t;
  const p = [];
  const v = [];
  for (let axis = 0; axis < 3; axis++) {
    const m0 = a[axis + 3] * DAY_SECONDS;
    const m1 = b[axis + 3] * DAY_SECONDS;
    p[axis] =
      (2 * t3 - 3 * t2 + 1) * a[axis] +
      (t3 - 2 * t2 + t) * m0 +
      (-2 * t3 + 3 * t2) * b[axis] +
      (t3 - t2) * m1;
    v[axis] = (
      (6 * t2 - 6 * t) * a[axis] +
      (3 * t2 - 4 * t + 1) * m0 +
      (-6 * t2 + 6 * t) * b[axis] +
      (3 * t2 - 2 * t) * m1
    ) / DAY_SECONDS;
  }
  return { positionKm: p, velocityKmS: v };
}
export function subtractPosition(a, b) {
  return a.map((value, axis) => value - b[axis]);
}
export function eclipticToScene(position, visualScale) {
  return [position[0] * visualScale, position[2] * visualScale, -position[1] * visualScale];
}

export function createEphemerisStore(manifest, files) {
  if (!manifest || manifest.schema !== MANIFEST_SCHEMA ||
      manifest.referenceFrame !== 'Ecliptic of J2000.0' ||
      manifest.timeScale !== 'UT / UTC (after 1962)' ||
      manifest.stepSeconds !== DAY_SECONDS ||
      !Array.isArray(manifest.years) || !manifest.years.length ||
      !EPHEMERIS_BODIES.every(id => manifest.bodies?.includes(id))) {
    fail('manifest 版本、坐标系、时间单位或天体列表不符');
  }
  const startMs = toMs(manifest.startUtc, 'startUtc');
  const endMs = toMs(manifest.endUtc, 'endUtc');
  const years = new Map();
  for (const part of manifest.years) {
    const file = files[part.year];
    if (!file || file.schema !== YEAR_SCHEMA || file.year !== part.year ||
        file.stepSeconds !== DAY_SECONDS ||
        file.startUtc !== part.startUtc || file.endUtc !== part.endUtc) {
      fail(part.year + ' 年数据版本或时间范围不符');
    }
    const firstMs = toMs(file.startUtc, 'year start');
    const lastMs = toMs(file.endUtc, 'year end');
    const count = Math.round((lastMs - firstMs) / DAY_MS) + 1;
    if (count < 2 || !EPHEMERIS_BODIES.every(id =>
      Array.isArray(file.bodies?.[id]) &&
      file.bodies[id].length === count &&
      file.bodies[id].every(finiteVector))) {
      fail(part.year + ' 年样本数量或位置/速度格式无效');
    }
    years.set(part.year, { ...file, firstMs, lastMs });
  }
  if (!(endMs > startMs) || years.size !== manifest.years.length) fail('时间范围不完整');
  const getState = (id, utcMs) => {
    if (!EPHEMERIS_BODIES.includes(id) ||
        !Number.isFinite(utcMs) || utcMs < startMs || utcMs > endMs) return null;
    const date = new Date(utcMs);
    const year = Math.min(date.getUTCFullYear(), manifest.years.at(-1).year);
    const file = years.get(year);
    if (!file || utcMs < file.firstMs || utcMs > file.lastMs) return null;
    const sampled = interpolateVector(file.bodies[id], (utcMs - file.firstMs) / DAY_MS);
    return sampled ? { ...sampled, bodyId: id, utcMs, referenceCenter: 'solar-system-barycenter',
      frame: manifest.referenceFrame, sourceVersion: manifest.sourceVersion } : null;
  };
  const getDisplayPositions = utcMs => {
    const sun = getState('sun', utcMs);
    const earth = getState('earth', utcMs);
    const moon = getState('moon', utcMs);
    const mars = getState('mars', utcMs);
    if (!sun || !earth || !moon || !mars) return null;
    return {
      sun: [0, 0, 0],
      earth: eclipticToScene(subtractPosition(earth.positionKm, sun.positionKm), 14.1 / AU_KM),
      mars: eclipticToScene(subtractPosition(mars.positionKm, sun.positionKm), 14.1 / AU_KM),
      // The Earth-Moon distance is enlarged for visibility in the 3D model.
      moon: eclipticToScene(subtractPosition(moon.positionKm, earth.positionKm), 1.9 / 384400)
    };
  };
  return Object.freeze({
    manifest,
    startMs,
    endMs,
    hasUtc: utcMs => Number.isFinite(utcMs) && utcMs >= startMs && utcMs <= endMs,
    getState,
    getDisplayPositions
  });
}

export async function loadEphemerisStore({
  fetcher = globalThis.fetch,
  baseUrl = import.meta.env?.BASE_URL || '/'
} = {}) {
  if (cached) return cached;
  const promise = (async () => {
    const root = new URL('data/science/v1/', new URL(baseUrl, globalThis.location?.origin || 'http://localhost/'));
    async function fetchJson(filename) {
      const response = await fetcher(new URL(filename, root).href, { cache: 'force-cache' });
      if (!response.ok) fail(filename + ' 请求失败（HTTP ' + response.status + '）');
      return response.json();
    }
    const manifest = await fetchJson('manifest.json');
    if (!Array.isArray(manifest.years) || !manifest.years.length) fail('manifest 缺少年份');
    const loaded = await Promise.all(manifest.years.map(async year => {
      if (!/^\d{4}\.json$/.test(year.file)) fail('非法年份文件名');
      return [year.year, await fetchJson(year.file)];
    }));
    return createEphemerisStore(manifest, Object.fromEntries(loaded));
  })();
  cached = promise.catch(error => {
    cached = null; // Allow a retry if the network or offline cache failed.
    throw error;
  });
  return cached;
}
