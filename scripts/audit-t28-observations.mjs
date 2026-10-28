// T28 software geometry audit. Source values are simplified teaching inputs;
// this verifies implementation invariants, not a scientific ephemeris review.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createEphemerisStore } from '../src/data/science/ephemeris.js';
import { createPhysicalFrame } from '../src/data/science/scaleModel.js';
import { ORIENTATION_MODEL_IDS, orientationAtUtc,
  calculateDateObservations } from '../src/data/science/orientationModel.js';

const base = 'public/data/science/v1/';
const manifest = JSON.parse(await readFile(base + 'manifest.json', 'utf8'));
const files = Object.fromEntries(await Promise.all(manifest.years.map(async ({ year, file }) =>
  [year, JSON.parse(await readFile(base + file, 'utf8'))]
)));
const store = createEphemerisStore(manifest, files);
const frameAt = utcMs => createPhysicalFrame({ store, utcMs });
const observeAt = utcMs => calculateDateObservations(frameAt(utcMs), utcMs);
const report = {
  task: 'T28', generatedAt: new Date().toISOString(),
  environment: 'Node.js float64 math / bundled DE441 sample positions',
  limitations: ['Simplified IAU pole and rotation coefficients.',
    'Earth IERS orientation, lunar libration, local rise/set and eclipses excluded.',
    'No real GPU, mobile device or scientific certification.'],
  checks: [], errors: []
};
function check(name, fn) {
  try {
    const detail = fn();
    report.checks.push({ name, pass: true, detail: detail ?? null });
    console.log('PASS ' + name);
  } catch (error) {
    const message = String(error);
    report.errors.push({ name, message });
    report.checks.push({ name, pass: false, message });
    console.error('FAIL ' + name + ' — ' + message);
  }
}
const sampleUtc = Date.UTC(2026, 9, 28, 12);
check('ten modeled axes are normalized and finite', () => {
  assert.equal(ORIENTATION_MODEL_IDS.length, 10);
  for (const id of ORIENTATION_MODEL_IDS) {
    const pose = orientationAtUtc(id, sampleUtc);
    assert.ok(pose.poleScene.every(Number.isFinite));
    assert.ok(Math.abs(Math.hypot(...pose.poleScene) - 1) < 1e-12);
    assert.ok(pose.spinRadians >= 0 && pose.spinRadians < Math.PI * 2);
  }
});
check('Earth axis is about 23.44 degrees from ecliptic north', () => {
  const axis = orientationAtUtc('earth', sampleUtc).poleScene;
  const obliquity = Math.acos(axis[1]) * 180 / Math.PI;
  assert.ok(Math.abs(obliquity - 23.4393) < .01, obliquity);
  return { obliquityDeg: obliquity };
});
check('retrograde Venus and Uranus use negative spin rate', () => {
  assert.ok(orientationAtUtc('venus', sampleUtc).spinRateDegPerDay < 0);
  assert.ok(orientationAtUtc('uranus', sampleUtc).spinRateDegPerDay < 0);
});
check('date orientation is repeatable and advances with UTC', () => {
  const first = orientationAtUtc('earth', sampleUtc);
  const repeat = orientationAtUtc('earth', sampleUtc);
  const later = orientationAtUtc('earth', sampleUtc + 12 * 3600000);
  assert.deepEqual(first, repeat);
  assert.ok(Math.abs(first.spinRadians - later.spinRadians) > 1);
});
check('unmodeled satellites and demo geometry do not claim date orientation', () => {
  assert.equal(orientationAtUtc('io', sampleUtc), null);
  assert.equal(orientationAtUtc('earth', null), null);
  assert.equal(calculateDateObservations(createPhysicalFrame({ elapsed: 4 }), sampleUtc).enabled, false);
  assert.equal(calculateDateObservations(frameAt(sampleUtc), null).enabled, false);
});
check('date observation returns valid lunar phase and solar declination', () => {
  const result = observeAt(sampleUtc);
  assert.equal(result.enabled, true);
  assert.ok(result.moon.illuminatedFraction >= 0 && result.moon.illuminatedFraction <= 1);
  assert.ok(result.moon.phaseProgress >= 0 && result.moon.phaseProgress < 1);
  assert.ok(result.moon.elongationDeg >= 0 && result.moon.elongationDeg <= 180);
  assert.ok(Math.abs(result.earth.subsolarLatitudeDeg) <= 23.5);
  return { phase: result.moon.illuminatedFraction,
    subsolarLatitudeDeg: result.earth.subsolarLatitudeDeg };
});
check('known March new moon has less illumination than April full moon', () => {
  const newMoon = observeAt(Date.UTC(2026, 2, 19, 0));
  const fullMoon = observeAt(Date.UTC(2026, 3, 2, 0));
  assert.ok(newMoon.moon.illuminatedFraction < .15);
  assert.ok(fullMoon.moon.illuminatedFraction > .85);
  return { newMoon: newMoon.moon.illuminatedFraction,
    fullMoon: fullMoon.moon.illuminatedFraction };
});
check('opposite solstices put subsolar latitude in opposite hemispheres', () => {
  const june = observeAt(Date.UTC(2026, 5, 21, 12));
  const december = observeAt(Date.UTC(2026, 11, 21, 12));
  assert.ok(june.earth.subsolarLatitudeDeg > 20);
  assert.ok(december.earth.subsolarLatitudeDeg < -20);
  return { june: june.earth.subsolarLatitudeDeg,
    december: december.earth.subsolarLatitudeDeg };
});
check('geometric moon illumination obeys phase-angle dot product', () => {
  const frame = frameAt(sampleUtc);
  const sun = frame.sun.absoluteKm.map((v, i) => v - frame.moon.absoluteKm[i]);
  const earth = frame.earth.absoluteKm.map((v, i) => v - frame.moon.absoluteKm[i]);
  const dot = sun.reduce((s, v, i) => s + v * earth[i], 0);
  const expected = (1 + dot / (Math.hypot(...sun) * Math.hypot(...earth))) / 2;
  assert.ok(Math.abs(observeAt(sampleUtc).moon.illuminatedFraction - expected) < 1e-12);
});
check('observation calculation leaves positions and radii unchanged', () => {
  const frame = frameAt(sampleUtc);
  const copy = JSON.stringify(frame);
  calculateDateObservations(frame, sampleUtc);
  assert.equal(JSON.stringify(frame), copy);
});

report.summary = {
  passed: report.checks.filter(c => c.pass).length,
  failed: report.checks.filter(c => !c.pass).length,
  errors: report.errors.length
};
await mkdir('docs/baselines', { recursive: true });
await writeFile('docs/baselines/2026-10-28-T28-observation-audit.json',
  JSON.stringify(report, null, 2) + '\n');
console.log('T28 observation audit:', JSON.stringify(report.summary));
if (report.summary.failed || report.summary.errors) process.exitCode = 1;
