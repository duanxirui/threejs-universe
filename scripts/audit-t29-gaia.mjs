// T29: local reproducibility, quality selection, coordinate mapping and
// search invariants for the Gaia DR3 *sample*. No scientific signoff needed.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import {
  createGaiaCatalog, gaiaDistancePc, gaiaIcrsDirection,
  GAIA_SCENE_UNITS_PER_PC, validateGaiaManifest
} from '../src/data/science/gaiaCatalog.js';

const ROOT = 'public/data/science/gaia-dr3/v1/';
const bytes = name => readFile(ROOT + name);
const hash = input => createHash('sha256').update(input).digest('hex');
const manifest = validateGaiaManifest(JSON.parse(await readFile(ROOT + 'manifest.json', 'utf8')));
const report = {
  task: 'T29', created: new Date().toISOString(),
  environment: 'Node.js local immutable ESA Gaia DR3 snapshot',
  assumptions: ['High signal-to-noise random-index sample only, not a census.',
    'Inverse-parallax distance approximations, no Bayesian distance inference.',
    'ICRS J2016.0 sky directions; no proper-motion or epoch propagation.',
    'No scientific manual review required; software field consistency is checked.'],
  checks: [], errors: []
};
function check(name, fn) {
  try {
    const value = fn();
    report.checks.push({ name, pass: true, value: value ?? null });
    console.log('PASS ' + name);
  } catch (error) {
    report.checks.push({ name, pass: false, error: String(error) });
    report.errors.push({ name, error: String(error) });
    console.error('FAIL ' + name, String(error));
  }
}
check('manifest identifies official Gaia DR3 and J2016.0 ICRS', () => {
  assert.equal(manifest.release, 'Gaia DR3');
  assert.equal(manifest.referenceFrame, 'ICRS');
  assert.equal(manifest.referenceEpoch, 2016);
  assert.ok(manifest.archive.startsWith('https://gea.esac.esa.int/'));
  assert.equal(manifest.raw.length, 4);
});
check('four raw ESA TAP snapshots match SHA-256 and row counts', () => {
  assert.equal(manifest.raw.length, 4);
  return manifest.raw.reduce((total, raw) => total + raw.count, 0);
});
for (const [i, raw] of manifest.raw.entries()) {
  const content = await readFile(raw.file);
  check('raw Gaia CSV slice ' + String(i).padStart(2, '0') + ' matches recorded checksum', () => {
    assert.equal(hash(content), raw.sha256);
    assert.equal(content.toString('utf8').trim().split(/\r?\n/).length - 1, raw.count);
  });
}
const chunkFiles = Object.fromEntries(await Promise.all(manifest.chunks.map(async part => {
  const content = await bytes(part.file);
  check('static ' + part.id + ' chunk matches checksum and byte size', () => {
    assert.equal(hash(content), part.sha256);
    assert.equal(content.length, part.bytes);
  });
  return [part.file, JSON.parse(content.toString('utf8'))];
})));
const catalog = createGaiaCatalog(manifest, async filename => chunkFiles[filename]);
check('distance conversion refuses low SNR or negative parallax', () => {
  assert.equal(gaiaDistancePc(-1, 20), null);
  assert.equal(gaiaDistancePc(2, 8), null);
  assert.equal(gaiaDistancePc(null, 20), null);
  assert.equal(gaiaDistancePc(2, 25), 500);
});
check('ICRS to scene axes have normalized directions', () => {
  for (const [ra, dec] of [[0, 0], [90, 0], [180, -45], [270, 60], [0, 90]]) {
    const unit = gaiaIcrsDirection(ra, dec);
    assert.ok(unit.every(Number.isFinite));
    assert.ok(Math.abs(Math.hypot(...unit) - 1) < 1e-12);
  }
  assert.equal(gaiaIcrsDirection(361, 20), null);
});
await catalog.ensureDistance(100);
check('near block is loaded lazily and independently', () => {
  assert.deepEqual(catalog.loadedBands(), ['near']);
  assert.equal(catalog.loadedCount(), manifest.chunks[0].count);
});
await catalog.ensureDistance(400);
check('mid block adds only its Gaia sources', () => {
  assert.deepEqual(catalog.loadedBands(), ['near', 'mid']);
  assert.equal(catalog.loadedCount(),
    manifest.chunks[0].count + manifest.chunks[1].count);
});
await catalog.ensureDistance(1000);
check('full sample has exactly 2057 distinct immutable source identifiers', () => {
  assert.equal(catalog.loadedCount(), manifest.total);
  assert.equal(new Set(catalog.allRecords().map(row => row.sourceId)).size, manifest.total);
  assert.ok(manifest.total >= 2000);
  assert.ok(catalog.isComplete());
});
check('records preserve 64-bit ID and measured Gaia values', () => {
  for (const row of catalog.allRecords()) {
    assert.match(row.sourceId, /^\d{15,20}$/);
    assert.ok(row.raDeg >= 0 && row.raDeg < 360);
    assert.ok(row.decDeg >= -90 && row.decDeg <= 90);
    assert.ok(row.parallaxMas > 1 && row.parallaxOverError > 10);
    assert.ok(row.gMag < 16);
    assert.ok(row.distancePc < 1000 && row.distancePc > 0);
    assert.ok(Math.abs(row.distancePc - 1000 / row.parallaxMas) < 1e-9);
    assert.ok(Math.abs(Math.hypot(...row.position) -
      row.distancePc * GAIA_SCENE_UNITS_PER_PC) < 1e-9);
    assert.equal(catalog.getSource(row.sourceId), row);
  }
});
check('magnitude, distance and exact-source search are repeatable', () => {
  const bright = catalog.search('', { maxMag: 12, maxPc: 1000, limit: 9999 });
  const all = catalog.search('', { maxMag: 16, maxPc: 1000, limit: 9999 });
  assert.ok(all.length > bright.length && all.length === manifest.total);
  const near = catalog.search('', { maxMag: 16, maxPc: 100, limit: 9999 });
  assert.equal(near.length, manifest.chunks[0].count);
  const ref = all[0];
  assert.equal(catalog.search(ref.sourceId, { limit: 5 })[0].sourceId, ref.sourceId);
  assert.equal(catalog.search('Gaia DR3 ' + ref.sourceId, { limit: 5 })[0].sourceId,
    ref.sourceId);
  return { bright: bright.length, all: all.length, near: near.length };
});
check('catalog scene positions do not mutate source coordinates', () => {
  const before = JSON.stringify(catalog.allRecords().slice(0, 5));
  catalog.search('', { maxPc: 400 });
  catalog.search('123');
  assert.equal(JSON.stringify(catalog.allRecords().slice(0, 5)), before);
});
report.summary = {
  passed: report.checks.filter(x => x.pass).length,
  failed: report.checks.filter(x => !x.pass).length,
  errors: report.errors.length, total: manifest.total,
  partitions: Object.fromEntries(manifest.chunks.map(row => [row.id, row.count]))
};
await mkdir('docs/baselines', { recursive: true });
await writeFile('docs/baselines/2026-10-28-T29-data-audit.json',
  JSON.stringify(report, null, 2) + '\n');
console.log('T29 Gaia audit:', JSON.stringify(report.summary));
if (report.summary.failed || report.summary.errors) process.exitCode = 1;
