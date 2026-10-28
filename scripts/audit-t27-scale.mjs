// T27 deterministic data check: one kilometre-space model, separate rendering.
// It checks ratios, time state and a floating local origin, not scientific sign-off.
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { ALL_BODIES } from '../src/data/celestials.js';
import { getEducationalNumber, KM_PER_AU } from '../src/data/science/physicalCatalog.js';
import { createEphemerisStore } from '../src/data/science/ephemeris.js';
import { createPhysicalFrame, getPhysicalRadiusKm, getPhysicalRadiusScene,
  renderRelativeKm, chooseFloatingOrigin, SCENE_UNITS_PER_AU } from '../src/data/science/scaleModel.js';

const manifest = JSON.parse(await readFile('public/data/science/v1/manifest.json', 'utf8'));
const files = Object.fromEntries(await Promise.all(manifest.years.map(async ({ year, file }) =>
  [year, JSON.parse(await readFile('public/data/science/v1/' + file, 'utf8'))]
)));
const store = createEphemerisStore(manifest, files);
const report = {
  task: 'T27',
  generatedAt: new Date().toISOString(),
  environment: 'Node.js float64 scene/data invariance',
  checks: [], errors: [],
  notes: ['Physical radii and distances share one uniform km scale.',
    'Time-sampled sources cover four bodies; other orbital directions remain educational approximations.']
};
function test(name, fn) {
  try {
    const detail = fn();
    report.checks.push({ name, pass: true, detail: detail || null });
    console.log('PASS ' + name);
  } catch (error) {
    report.errors.push({ name, message: String(error) });
    report.checks.push({ name, pass: false, message: String(error) });
    console.error('FAIL ' + name, error);
  }
}
function close(a, b, relative = 1e-10, absolute = 1e-10) {
  assert.ok(Number.isFinite(a) && Number.isFinite(b) &&
    Math.abs(a - b) <= Math.max(absolute, Math.abs(b) * relative),
  'expected ' + a + ' to equal ' + b);
}
const utc = Date.UTC(2026, 9, 27, 12);
const frame = createPhysicalFrame({ elapsed: 10, store, utcMs: utc });
test('all 22 bodies have valid double-precision km positions', () => {
  assert.equal(Object.keys(frame).length, ALL_BODIES.length);
  for (const entry of Object.values(frame)) {
    assert.equal(entry.absoluteKm.length, 3);
    assert.equal(entry.relativeKm.length, 3);
    assert.ok(entry.absoluteKm.every(Number.isFinite));
    assert.ok(entry.relativeKm.every(Number.isFinite));
    assert.ok(entry.radiusKm > 0);
  }
});
test('JPL date-driven bodies and approximate satellites remain distinguishable', () => {
  for (const id of ['sun', 'earth', 'moon', 'mars']) {
    assert.equal(frame[id].source, 'horizons-date');
    assert.equal(frame[id].utcMs, utc);
  }
  for (const id of ['jupiter', 'titan', 'neptune']) {
    assert.equal(frame[id].source, 'educational-orbit');
    assert.equal(frame[id].utcMs, null);
  }
});
test('Sun/Earth radius and 1AU centre distance use exactly the same scene scale', () => {
  close(getPhysicalRadiusKm('earth'), getEducationalNumber('earth', 'diameterKm') / 2);
  close(getPhysicalRadiusScene('earth') / SCENE_UNITS_PER_AU,
    getEducationalNumber('earth', 'diameterKm') / (2 * KM_PER_AU));
  close(renderRelativeKm([KM_PER_AU, 0, 0])[0], SCENE_UNITS_PER_AU);
  close(getPhysicalRadiusScene('sun') / getPhysicalRadiusScene('earth'),
    getEducationalNumber('sun', 'diameterKm') /
    getEducationalNumber('earth', 'diameterKm'));
});
test('Earth/Moon orbit centre and true-scale mean distance stay separate', () => {
  const earth = frame.earth.absoluteKm;
  const moon = frame.moon.absoluteKm;
  for (let i = 0; i < 3; i++) close(moon[i] - earth[i], frame.moon.relativeKm[i]);
  const distance = Math.hypot(...frame.moon.relativeKm);
  assert.ok(distance >= 330000 && distance <= 410000);
  close(getPhysicalRadiusScene('moon') / getPhysicalRadiusScene('earth'),
    getEducationalNumber('moon', 'diameterKm') /
    getEducationalNumber('earth', 'diameterKm'));
});
test('other 18 bodies use km mean orbit distances with intact parent relation', () => {
  const jupiter = frame.jupiter;
  close(Math.hypot(...jupiter.relativeKm) / KM_PER_AU,
    5.2 * (1 + 0), .09); // eccentric demo ellipse: actual radius varies.
  const io = frame.io;
  for (let axis = 0; axis < 3; axis++) {
    close(io.absoluteKm[axis] - jupiter.absoluteKm[axis], io.relativeKm[axis]);
  }
  assert.equal(io.centerId, 'jupiter');
});
test('floating origin cancels focused Earth position in double precision', () => {
  const local = chooseFloatingOrigin(frame, 'earth');
  const absolute = frame.earth.absoluteKm.map(value =>
    value * (SCENE_UNITS_PER_AU / KM_PER_AU));
  for (let i = 0; i < 3; i++) close(local[i] + absolute[i], 0);
  assert.ok(local.every(Number.isFinite));
});
test('switching render modes does not alter physical coordinates or UTC', () => {
  const copy = JSON.stringify(frame);
  const origin = chooseFloatingOrigin(frame, 'moon');
  const radius = getPhysicalRadiusScene('mars');
  assert.ok(radius > 0 && origin.some(v => v !== 0));
  const rebuilt = createPhysicalFrame({ elapsed: 10, store, utcMs: utc });
  assert.equal(JSON.stringify(rebuilt), copy);
});
test('UTC date change updates physical states without mutating catalog radii', () => {
  const later = createPhysicalFrame({ elapsed: 10, store, utcMs: utc + 86400000 });
  assert.ok(Math.hypot(...frame.earth.absoluteKm.map((v,i) =>
    v - later.earth.absoluteKm[i])) > 10000);
  close(later.earth.radiusKm, frame.earth.radiusKm);
  close(later.moon.radiusKm, frame.moon.radiusKm);
});
test('legacy enhanced-only orbit locations remain independent from JPL source', () => {
  const demo = createPhysicalFrame({ elapsed: 10 });
  assert.equal(demo.earth.source, 'educational-orbit');
  assert.ok(Math.hypot(...demo.earth.absoluteKm.map(
    (v,i) => v - frame.earth.absoluteKm[i])) > 1e6);
  assert.equal(demo.earth.radiusKm, frame.earth.radiusKm);
});

report.summary = {
  passed: report.checks.filter(x => x.pass).length,
  failed: report.checks.filter(x => !x.pass).length,
  errors: report.errors.length,
  physicalBodies: Object.keys(frame).length,
  unitsPerAu: SCENE_UNITS_PER_AU
};
await mkdir('docs/baselines', { recursive: true });
await writeFile('docs/baselines/2026-10-27-T27-scale-audit.json',
  JSON.stringify(report, null, 2) + '\n');
console.log('T27 scale audit:', JSON.stringify(report.summary));
if (report.errors.length) process.exitCode = 1;
