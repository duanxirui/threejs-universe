// T29: static Gaia DR3 catalog access. No runtime requests to ESA TAP.
// Coordinates are ICRS at J2016.0; screen positions are a deliberately
// scaled local-volume map centred on the observer, not a galactic map.
const RAD = Math.PI / 180;
const OBLIQUITY = 23.4392911 * RAD;
export const GAIA_SCENE_UNITS_PER_PC = 0.14;
export const GAIA_DISTANCE_LIMITS = Object.freeze([100, 400, 1000]);
export const GAIA_MAG_LIMITS = Object.freeze([12, 14, 16]);
const SCHEMA = 'cosmos-gaia-dr3-v1';
const CHUNK_SCHEMA = 'cosmos-gaia-dr3-chunk-v1';
let cachedManifest = null;

export function gaiaIcrsDirection(raDeg, decDeg) {
  if (!Number.isFinite(raDeg) || !Number.isFinite(decDeg) ||
    raDeg < 0 || raDeg >= 360 || decDeg < -90 || decDeg > 90) return null;
  const ra = raDeg * RAD;
  const dec = decDeg * RAD;
  const x = Math.cos(dec) * Math.cos(ra);
  const eqY = Math.cos(dec) * Math.sin(ra);
  const eqZ = Math.sin(dec);
  const eclY = eqY * Math.cos(OBLIQUITY) + eqZ * Math.sin(OBLIQUITY);
  const eclZ = -eqY * Math.sin(OBLIQUITY) + eqZ * Math.cos(OBLIQUITY);
  return [x, eclZ, -eclY]; // T26 ecliptic -> scene
}

export function gaiaDistancePc(parallaxMas, signalToNoise) {
  // Inverse parallax is used only when fractional errors are small. Null
  // means no reliable 3D distance. Never invent a radial coordinate.
  return Number.isFinite(parallaxMas) && parallaxMas > 0 &&
    Number.isFinite(signalToNoise) && signalToNoise > 10
    ? 1000 / parallaxMas : null;
}

export function gaiaRecordFromTuple(row) {
  if (!Array.isArray(row) || row.length !== 10 ||
    typeof row[0] !== 'string' || !/^\d{15,20}$/.test(row[0])) {
    throw Error('Gaia DR3 source ID or field count invalid');
  }
  const [sourceId, raDeg, decDeg, parallaxMas, parallaxErrorMas,
    parallaxOverError, gMag, bpRp, pmRaMasYr, pmDecMasYr] = row;
  if (![raDeg, decDeg, parallaxMas, parallaxErrorMas,
    parallaxOverError, gMag, bpRp].every(Number.isFinite) ||
    !(parallaxErrorMas > 0) || !(gMag < 16)) {
    throw Error('Gaia DR3 source values invalid: ' + sourceId);
  }
  const direction = gaiaIcrsDirection(raDeg, decDeg);
  if (!direction) throw Error('Gaia DR3 source sky position invalid: ' + sourceId);
  const distancePc = gaiaDistancePc(parallaxMas, parallaxOverError);
  const position = distancePc === null ? null :
    direction.map(v => v * distancePc * GAIA_SCENE_UNITS_PER_PC);
  return Object.freeze({
    sourceId, designation: 'Gaia DR3 ' + sourceId,
    raDeg, decDeg, parallaxMas, parallaxErrorMas, parallaxOverError,
    gMag, bpRp, pmRaMasYr, pmDecMasYr, distancePc,
    position, sourceRelease: 'Gaia DR3', referenceEpoch: 2016
  });
}

export function validateGaiaManifest(manifest) {
  if (!manifest || manifest.schema !== SCHEMA || manifest.release !== 'Gaia DR3' ||
    manifest.referenceEpoch !== 2016 || manifest.referenceFrame !== 'ICRS' ||
    !Array.isArray(manifest.chunks) || manifest.chunks.length !== 3 ||
    !Number.isInteger(manifest.total) || manifest.total < 1000) {
    throw Error('Gaia DR3 manifest version or reference frame invalid');
  }
  const ids = ['near', 'mid', 'far'];
  for (let i = 0; i < ids.length; i++) {
    const chunk = manifest.chunks[i];
    if (chunk.id !== ids[i] || chunk.file !== ids[i] + '.json' ||
      !Number.isInteger(chunk.count) || chunk.count < 0 ||
      !Number.isFinite(chunk.minPc) || !Number.isFinite(chunk.maxPc) ||
      chunk.minPc >= chunk.maxPc) {
      throw Error('Gaia manifest chunk data invalid: ' + ids[i]);
    }
  }
  if (manifest.chunks.reduce((sum, chunk) => sum + chunk.count, 0) !== manifest.total) {
    throw Error('Gaia manifest count mismatch');
  }
  return manifest;
}

export function createGaiaCatalog(manifest, fetchChunk) {
  validateGaiaManifest(manifest);
  const loaded = new Map();
  const pending = new Map();
  const recordsById = new Map();
  async function ensureDistance(maxPc = 1000) {
    for (const part of manifest.chunks) {
      if (part.minPc >= maxPc) break;
      if (!loaded.has(part.id)) {
        if (!pending.has(part.id)) {
          const promise = Promise.resolve(fetchChunk(part.file)).then(payload => {
            if (!payload || payload.schema !== CHUNK_SCHEMA ||
              payload.release !== manifest.release || payload.band !== part.id ||
              !Array.isArray(payload.records) || payload.records.length !== part.count) {
              throw Error('Gaia chunk version/count mismatch: ' + part.file);
            }
            const rows = payload.records.map(gaiaRecordFromTuple);
            for (const row of rows) {
              if (recordsById.has(row.sourceId)) throw Error('Gaia duplicate source: ' + row.sourceId);
              if (!(row.distancePc >= part.minPc && row.distancePc < part.maxPc)) {
                throw Error('Gaia distance partition mismatch: ' + row.sourceId);
              }
            }
            loaded.set(part.id, rows);
            for (const row of rows) recordsById.set(row.sourceId, row);
            return rows;
          }).finally(() => pending.delete(part.id));
          pending.set(part.id, promise);
        }
        await pending.get(part.id);
      }
    }
    return allRecords();
  }
  function allRecords() {
    return manifest.chunks.flatMap(chunk => loaded.get(chunk.id) || []);
  }
  function search(query, { maxPc = 1000, maxMag = 16, limit = 30 } = {}) {
    const term = String(query || '').replace(/^gaia\s*(?:dr3)?\s*/i, '').trim();
    return allRecords().filter(row =>
      row.distancePc !== null && row.distancePc < maxPc &&
      row.gMag < maxMag && (!term || row.sourceId.includes(term))
    ).sort((a, b) => a.gMag - b.gMag || a.sourceId.localeCompare(b.sourceId))
      .slice(0, limit);
  }
  return Object.freeze({
    manifest, ensureDistance, allRecords, search,
    getSource: sourceId => recordsById.get(String(sourceId)) || null,
    loadedBands: () => [...loaded.keys()],
    loadedCount: () => recordsById.size,
    isComplete: () => recordsById.size === manifest.total
  });
}

export async function loadGaiaCatalog({
  fetcher = globalThis.fetch,
  baseUrl = import.meta.env?.BASE_URL || '/'
} = {}) {
  if (cachedManifest) return cachedManifest;
  const pending = (async () => {
    const root = new URL('data/science/gaia-dr3/v1/',
      new URL(baseUrl, globalThis.location?.origin || 'http://localhost/'));
    const getJson = async name => {
      if (!/^(manifest|near|mid|far)\.json$/.test(name)) {
        throw Error('Illegal Gaia catalog filename');
      }
      const response = await fetcher(new URL(name, root).href, { cache: 'force-cache' });
      if (!response.ok) throw Error('Gaia ' + name + ': HTTP ' + response.status);
      return response.json();
    };
    const manifest = validateGaiaManifest(await getJson('manifest.json'));
    return createGaiaCatalog(manifest, filename => getJson(filename));
  })();
  cachedManifest = pending.catch(error => {
    cachedManifest = null;
    throw error;
  });
  return cachedManifest;
}
