// T26 - Build a versioned, offline-ready ephemeris from NASA/JPL Horizons.
// Explicit command only: npm run ephemeris:generate. Never request Horizons
// from animation frames. The generated JSON includes source and time metadata.
import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const SOURCE_URL = 'https://ssd.jpl.nasa.gov/api/horizons.api';
export const TARGETS = Object.freeze({ sun: '10', earth: '399', moon: '301', mars: '499' });
export const START_YEAR = 2026;
export const END_YEAR = 2027;
const DAY_MS = 86400000;
const OUT = path.resolve('public/data/science/v1');

function dayUtc(year, month = 0, day = 1) {
  return Date.UTC(year, month, day);
}

export function parseHorizonsVectors(raw, { startMs, endMs, bodyId }) {
  const soe = raw.indexOf('$$SOE');
  const eoe = raw.indexOf('$$EOE', soe);
  if (soe < 0 || eoe <= soe) throw Error(bodyId + ': missing Horizons vector markers');
  // Horizons writes the final ecliptic frame under "Reference frame",
  // not as a separate "Reference plane" header.
  if (!/Output units\s*:\s*KM-S/i.test(raw) ||
      !/Reference frame\s*:\s*Ecliptic of J2000/i.test(raw) ||
      !/Output type\s*:\s*GEOMETRIC cartesian states/i.test(raw) ||
      !/Start time\s*:.*UT\b/i.test(raw)) {
    throw Error(bodyId + ': unexpected units, frame, plane or time standard');
  }
  const lines = raw.slice(soe + 5, eoe).split(/\r?\n/).filter(line => line.trim());
  const expected = Math.round((endMs - startMs) / DAY_MS) + 1;
  if (lines.length !== expected) {
    throw Error(bodyId + ': expected ' + expected + ' daily rows, got ' + lines.length);
  }
  const values = lines.map((line, index) => {
    const fields = line.split(',').map(field => field.trim());
    if (fields.length < 8) throw Error(bodyId + ': incomplete CSV row ' + index);
    const jd = Number(fields[0]);
    const utc = (jd - 2440587.5) * DAY_MS;
    const expectedUtc = startMs + index * DAY_MS;
    if (!Number.isFinite(utc) || Math.abs(utc - expectedUtc) > 50) {
      throw Error(bodyId + ': unexpected UT date at row ' + index);
    }
    const coordinates = fields.slice(2, 8).map(Number);
    if (coordinates.length !== 6 || coordinates.some(value => !Number.isFinite(value))) {
      throw Error(bodyId + ': invalid position/velocity at row ' + index);
    }
    return coordinates;
  });
  const de = raw.match(/\{source:\s*(DE\d+)\}/);
  const name = raw.match(/Target body name:\s*(.*?)\s*\{/);
  return { values, ephemeris: de?.[1] || null, name: name?.[1]?.trim() || bodyId };
}

function download(bodyId, command) {
  const args = [
    '--fail', '--silent', '--show-error', '--location', '--get',
    '--connect-timeout', '12', '--max-time', '90', '--retry', '2', '--retry-delay', '2'
  ];
  const parameters = {
    format: 'text',
    COMMAND: "'" + command + "'",
    CENTER: "'500@0'",
    MAKE_EPHEM: "'YES'",
    EPHEM_TYPE: "'VECTORS'",
    START_TIME: "'" + START_YEAR + '-01-01' + "'",
    STOP_TIME: "'" + (END_YEAR + 1) + '-01-01' + "'",
    STEP_SIZE: "'1 d'",
    OUT_UNITS: "'KM-S'",
    REF_PLANE: "'ECLIPTIC'",
    REF_SYSTEM: "'ICRF'",
    VEC_TABLE: "'2'",
    CSV_FORMAT: "'YES'",
    TIME_TYPE: "'UT'"
  };
  for (const [key, value] of Object.entries(parameters)) {
    args.push('--data-urlencode', key + '=' + value);
  }
  args.push(SOURCE_URL);
  const response = spawnSync('curl.exe', args, {
    encoding: 'utf8', timeout: 105000, maxBuffer: 16 * 1024 * 1024,
    windowsHide: true
  });
  if (response.error || response.status !== 0) {
    throw Error(bodyId + ': Horizons request failed: ' +
      (response.error?.message || response.stderr || response.status));
  }
  return response.stdout;
}

export async function generate() {
  const startMs = dayUtc(START_YEAR);
  const endMs = dayUtc(END_YEAR + 1);
  const all = {};
  const sourceVersions = {};
  for (const [id, command] of Object.entries(TARGETS)) {
    const raw = download(id, command);
    const parsed = parseHorizonsVectors(raw, { startMs, endMs, bodyId: id });
    if (!parsed.ephemeris) throw Error(id + ': Horizons DE ephemeris identifier absent');
    all[id] = parsed.values;
    sourceVersions[id] = parsed.ephemeris;
    console.log('Horizons ' + id + ': ' + parsed.values.length + ' UTC vectors / ' + parsed.ephemeris);
  }
  const versionValues = new Set(Object.values(sourceVersions));
  if (versionValues.size !== 1) {
    throw Error('Horizons bodies have mixed source versions: ' + JSON.stringify(sourceVersions));
  }

  // Avoid partial output if any one of the four live requests fails.
  const yearFiles = [];
  await mkdir(OUT, { recursive: true });
  for (let year = START_YEAR; year <= END_YEAR; year++) {
    const firstIndex = Math.round((dayUtc(year) - startMs) / DAY_MS);
    const lastIndex = Math.round((dayUtc(year + 1) - startMs) / DAY_MS);
    const filename = year + '.json';
    const payload = {
      schema: 'cosmos-vectors-v1',
      year,
      startUtc: new Date(dayUtc(year)).toISOString(),
      endUtc: new Date(dayUtc(year + 1)).toISOString(),
      stepSeconds: 86400,
      bodies: Object.fromEntries(Object.keys(TARGETS).map(id =>
        [id, all[id].slice(firstIndex, lastIndex + 1)]))
    };
    await writeFile(path.join(OUT, filename), JSON.stringify(payload) + '\n', 'utf8');
    yearFiles.push({ year, file: filename, startUtc: payload.startUtc, endUtc: payload.endUtc });
  }
  const manifest = {
    schema: 'cosmos-ephemeris-v1',
    source: 'NASA/JPL Horizons API',
    sourceUrl: SOURCE_URL,
    sourceVersion: [...versionValues][0],
    generatedAtUtc: new Date().toISOString(),
    center: 'Solar System Barycenter (0)',
    requestedReferenceSystem: 'ICRF',
    referenceFrame: 'Ecliptic of J2000.0',
    timeScale: 'UT / UTC (after 1962)',
    vectorUnits: ['km', 'km/s'],
    stepSeconds: 86400,
    startUtc: new Date(startMs).toISOString(),
    endUtc: new Date(endMs).toISOString(),
    bodies: Object.keys(TARGETS),
    targetCommands: TARGETS,
    years: yearFiles,
    note: 'Interpolated geometric positions are reference data. Scene spacing and body radii remain visually enhanced.'
  };
  await writeFile(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  console.log('Wrote ' + yearFiles.map(file => file.file).join(', ') +
    ' and manifest.json to ' + OUT);
  return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await generate();
}
