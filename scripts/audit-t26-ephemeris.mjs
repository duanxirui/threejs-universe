// T26: deterministic local checks for the checked-in JPL vector snapshot.
// These are software/data checks, not an independent scientific review.
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import {
  AU_KM, createEphemerisStore, formatUtcInput, interpolateVector,
  parseUtcDateTime, eclipticToScene
} from '../src/data/science/ephemeris.js';
const DATA_DIR = new URL('../public/data/science/v1/', import.meta.url);
const DAY = 86400000;
const report = {
  checkedAtUtc: new Date().toISOString(),
  task: 'T26', source: 'NASA/JPL Horizons DE441',
  scope: '4 bodies / UTC 2026-01-01 to 2028-01-01 / daily geometric vectors',
  checks: [], errors: [], summary: null
};
function check(name, fn) {
  try { const actual = fn(); report.checks.push({ name, pass: true, actual: actual ?? null }); }
  catch (error) {
    report.checks.push({ name, pass: false, detail: error.message });
    report.errors.push({ name, message: error.message });
  }
}
function distance(x) {
  return Math.hypot(...x);
}
function almostEqualVector(actual, expected) {
  assert.equal(actual.length, expected.length);
  for (let index = 0; index < actual.length; index++) {
    assert.ok(Math.abs(actual[index] - expected[index]) <=
      Math.max(1e-11, Math.abs(expected[index]) * 1e-12),
    'vector component ' + index + ' differs: ' + actual[index] + ' / ' + expected[index]);
  }
}
const loadJson = file => readFile(new URL(file, DATA_DIR), 'utf8').then(JSON.parse);
const manifest = await loadJson('manifest.json');
const annual = Object.fromEntries(await Promise.all(
  manifest.years.map(async year => [year.year, await loadJson(year.file)])
));
let store;
check('load complete year files and schema', () => {
  store = createEphemerisStore(manifest, annual);
  assert.equal(manifest.sourceVersion, 'DE441');
  assert.deepEqual(manifest.bodies, ['sun', 'earth', 'moon', 'mars']);
  assert.equal(manifest.years.length, 2);
  assert.equal(annual[2026].bodies.earth.length, 366);
  assert.equal(annual[2027].bodies.earth.length, 366);
  return { source: manifest.sourceVersion, years: manifest.years.length };
});
if (store) {
  check('valid UTC inputs and invalid calendar dates', () => {
    assert.equal(parseUtcDateTime('2026-10-27T10:36'), Date.UTC(2026, 9, 27, 10, 36));
    assert.equal(parseUtcDateTime('2026-02-30T12:00'), null);
    assert.equal(parseUtcDateTime('not-a-date'), null);
    assert.equal(formatUtcInput(Date.UTC(2026, 9, 27, 10, 36)), '2026-10-27T10:36');
  });
  check('data UTC range inclusive and overrun rejected', () => {
    assert.ok(store.hasUtc(Date.UTC(2026, 0, 1)));
    assert.ok(store.hasUtc(Date.UTC(2028, 0, 1)));
    assert.equal(store.getState('earth', Date.UTC(2025, 11, 31)), null);
    assert.equal(store.getState('earth', Date.UTC(2028, 0, 2)), null);
    assert.equal(store.getState('unknown', Date.UTC(2026, 0, 1)), null);
  });
  check('annual boundary position and velocity agree', () => {
    for (const id of manifest.bodies) {
      assert.deepEqual(annual[2026].bodies[id].at(-1), annual[2027].bodies[id][0]);
      const actual = store.getState(id, Date.UTC(2027, 0, 1));
      almostEqualVector([...actual.positionKm, ...actual.velocityKmS], annual[2027].bodies[id][0]);
    }
  });
  check('Hermite interpolation reproduces daily samples', () => {
    for (const id of manifest.bodies) {
      const rows = annual[2026].bodies[id];
      const t0 = interpolateVector(rows, 0);
      const t1 = interpolateVector(rows, 1);
      almostEqualVector(t0.positionKm, rows[0].slice(0, 3));
      almostEqualVector(t0.velocityKmS, rows[0].slice(3));
      almostEqualVector(t1.positionKm, rows[1].slice(0, 3));
      const half = interpolateVector(rows, .5);
      assert.ok(half.positionKm.every(Number.isFinite));
      assert.ok(half.velocityKmS.every(Number.isFinite));
      const exact = store.getState(id, Date.UTC(2026, 0, 1, 12));
      assert.deepEqual(half.positionKm, exact.positionKm);
    }
  });
  check('earth and mars solar-relative distances within expected planetary bands', () => {
    const utc = Date.UTC(2026, 9, 27);
    const sun = store.getState('sun', utc).positionKm;
    const earth = store.getState('earth', utc).positionKm;
    const mars = store.getState('mars', utc).positionKm;
    const sunEarth = distance(earth.map((v, axis) => v - sun[axis])) / AU_KM;
    const sunMars = distance(mars.map((v, axis) => v - sun[axis])) / AU_KM;
    assert.ok(sunEarth > .97 && sunEarth < 1.03);
    assert.ok(sunMars > 1.3 && sunMars < 1.75);
    return { sunEarthAu: sunEarth, sunMarsAu: sunMars };
  });
  check('moon relative position and exaggerated scene size remain separate', () => {
    const utc = Date.UTC(2026, 9, 27);
    const earth = store.getState('earth', utc).positionKm;
    const moon = store.getState('moon', utc).positionKm;
    const moonEarthKm = distance(moon.map((v, axis) => v - earth[axis]));
    assert.ok(moonEarthKm > 330000 && moonEarthKm < 410000);
    const mapped = store.getDisplayPositions(utc);
    assert.equal(mapped.sun.join(','), '0,0,0');
    const visualLunarDistance = distance(mapped.moon);
    assert.ok(visualLunarDistance > 1.5 && visualLunarDistance < 2.1);
    return { moonEarthKm, visualLunarDistance, note: 'Moon visual distance deliberately enlarged' };
  });
  check('source-frame conversion preserves handedness and height', () => {
    assert.deepEqual(eclipticToScene([2, 3, 4], 2), [4, 8, -6]);
    assert.ok(store.getDisplayPositions(Date.UTC(2027, 0, 1)));
    assert.ok(store.getDisplayPositions(Date.UTC(2028, 0, 1)));
    assert.equal(store.getDisplayPositions(Date.UTC(2028, 0, 1) + DAY), null);
  });
  check('no unsupported day injected into source files', () => {
    const source = annual[2026].bodies.sun[0];
    assert.ok(source.every(Number.isFinite));
    for (const [year, file] of Object.entries(annual)) {
      assert.equal(file.schema, 'cosmos-vectors-v1');
      const n = (Date.UTC(Number(year) + 1, 0, 1) - Date.UTC(Number(year), 0, 1)) / DAY + 1;
      for (const id of manifest.bodies) assert.equal(file.bodies[id].length, n);
    }
  });
}
report.summary = {
  passed: report.checks.filter(check => check.pass).length,
  failed: report.errors.length,
  dailyRowsPerBody: 731,
  sourceVersion: manifest.sourceVersion
};
await mkdir('docs/baselines', { recursive: true });
await writeFile('docs/baselines/2026-10-27-T26-ephemeris-audit.json',
  JSON.stringify(report, null, 2) + '\n');
console.log('T26 ephemeris audit:', JSON.stringify(report.summary));
if (report.errors.length) {
  for (const error of report.errors) console.error(error.name + ': ' + error.message);
  process.exitCode = 1;
}
