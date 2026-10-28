// T30 reproducible software catalog checks. They validate provenance and
// application contracts, not independent astronomical precision.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import {
  createDeepSkyCatalog, DEEP_SKY_RADIUS, loadDeepSkyCatalog
} from '../src/data/science/deepSkyCatalog.js';

const root = 'public/data/science/deep-sky/v1/';
const read = async name => readFile(root + name);
const SHA = content => createHash('sha256').update(content).digest('hex');
const manifest = JSON.parse(await read('manifest.json'));
const objects = JSON.parse(await read('objects.json'));
const routes = JSON.parse(await read('routes.json'));
const catalog = createDeepSkyCatalog(manifest, objects, routes);
const report = {
  task: 'T30', generatedAt: new Date().toISOString(),
  environment: 'Node.js deterministic catalog / local upstream OpenNGC CSV snapshot',
  limitations: [
    'A curated Messier classroom subset, not a whole-sky census.',
    'NASA object distances are published approximations, not precise 3D coordinates.',
    'No external image files distributed: NASA pages provide observed images and per-image credits.',
    'No independent scientific review required.'
  ],
  checks: [], errors: []
};
function test(name, fn) {
  try {
    const detail = fn();
    report.checks.push({ name, pass: true, detail: detail ?? null });
    console.log('PASS ' + name);
  } catch (error) {
    report.errors.push({ name, message: String(error) });
    report.checks.push({ name, pass: false, message: String(error) });
    console.error('FAIL ' + name + ': ' + error);
  }
}
test('OpenNGC CC BY-SA 4.0 and J2000 provenance explicitly recorded', () => {
  assert.equal(manifest.source.catalog, 'OpenNGC');
  assert.equal(manifest.source.author, 'Mattia Verga');
  assert.equal(manifest.source.license, 'CC BY-SA 4.0');
  assert.equal(manifest.coordinateFrame, 'ICRS J2000.0');
  assert.ok(manifest.source.upstream.startsWith('https://github.com/'));
});
for (const entry of manifest.source.raw) {
  const content = await readFile('data/sources/openngc/2026-10-28/' + entry.filename);
  test('upstream raw ' + entry.filename + ' matches SHA-256 and bytes', () => {
    assert.equal(content.length, entry.bytes);
    assert.equal(SHA(content), entry.sha256);
  });
}
for (const file of manifest.files) {
  const content = await read(file.file);
  test('derived static file ' + file.file + ' matches checksum', () => {
    assert.equal(content.length, file.bytes);
    assert.equal(SHA(content), file.sha256);
  });
}
test('15 distinct Messier objects across three classes', () => {
  assert.equal(catalog.objects.length, 15);
  assert.equal(new Set(catalog.objects.map(x => x.id)).size, 15);
  const counts = Object.fromEntries(['nebula', 'cluster', 'galaxy'].map(c =>
    [c, catalog.search('', { category: c }).length]));
  assert.deepEqual(counts, { nebula: 6, cluster: 3, galaxy: 6 });
  return counts;
});
test('J2000 celestial directions normalized; common virtual radius does not encode depth', () => {
  const rounded = new Set();
  for (const item of catalog.objects) {
    assert.ok(item.position.raDeg >= 0 && item.position.raDeg < 360);
    assert.ok(item.position.decDeg >= -90 && item.position.decDeg <= 90);
    assert.ok(item.skyDirection.every(Number.isFinite));
    assert.ok(Math.abs(Math.hypot(...item.skyDirection) - 1) < 1e-12);
    assert.ok(Math.abs(Math.hypot(...item.markerPosition) - DEEP_SKY_RADIUS) < 1e-8);
    rounded.add(Math.round(Math.hypot(...item.markerPosition)));
  }
  assert.equal(rounded.size, 1);
  assert.notEqual(catalog.get('M31').distance.approximateLightYears,
    catalog.get('M42').distance.approximateLightYears);
});
test('OpenNGC original string coordinates map to converted J2000 degrees', () => {
  for (const item of catalog.objects) {
    const [h, m, s] = item.position.rawRa.split(':').map(Number);
    const ra = (h + m / 60 + s / 3600) * 15;
    const decSign = item.position.rawDec.startsWith('-') ? -1 : 1;
    const [d, am, as] = item.position.rawDec.slice(1).split(':').map(Number);
    const dec = decSign * (d + am / 60 + as / 3600);
    assert.ok(Math.abs(ra - item.position.raDeg) < 1e-7);
    assert.ok(Math.abs(dec - item.position.decDeg) < 1e-7);
  }
});
test('15 published distance links and observed-image credits are traceable', () => {
  for (const item of catalog.objects) {
    assert.ok(item.distance.approximateLightYears > 0);
    assert.equal(item.distance.qualifier, 'approximate');
    assert.ok(item.distance.url.endsWith('messier-' + item.id.slice(1) + '/'));
    assert.equal(item.imagery.display, 'symbolic-marker');
    assert.equal(item.imagery.isObservedImage, false);
    assert.ok(item.imagery.observedPhotoGalleryUrl.startsWith('https://science.nasa.gov/'));
    assert.ok(item.imagery.credit.includes('schematic'));
  }
});
test('exact ID, NGC cross-ID and Chinese text search work', () => {
  assert.equal(catalog.search('M42').length, 1);
  assert.equal(catalog.search('NGC1976')[0].id, 'M42');
  assert.equal(catalog.search('猎户座')[0].id, 'M42');
  assert.ok(catalog.search('星系', { category: 'galaxy' }).length >= 3);
  assert.equal(catalog.search('M42', { category: 'galaxy' }).length, 0);
});
test('three routes contain valid stops and meaningful educational prompts', () => {
  assert.equal(catalog.routes.length, 3);
  const lengths = catalog.routes.map(r => r.steps.length);
  assert.deepEqual(lengths, [4, 5, 6]);
  for (const route of catalog.routes) {
    assert.ok(route.title && route.description);
    assert.equal(new Set(route.steps.map(s => s.objectId)).size, route.steps.length);
    for (const step of route.steps) {
      assert.ok(catalog.get(step.objectId));
      assert.ok(step.title.length > 2 && step.prompt.length > 8);
    }
  }
});
test('invalid catalog frame or missing provenance is rejected', () => {
  assert.throws(() => createDeepSkyCatalog({ ...manifest, coordinateFrame: 'Other' },
    objects, routes));
  assert.throws(() => createDeepSkyCatalog({ ...manifest,
    source: { ...manifest.source, license: 'unknown' } }, objects, routes));
});
report.summary = {
  passed: report.checks.filter(item => item.pass).length,
  failed: report.checks.filter(item => !item.pass).length,
  errors: report.errors.length, objects: catalog.objects.length,
  routes: catalog.routes.length
};
await mkdir('docs/baselines', { recursive: true });
await writeFile('docs/baselines/2026-10-28-T30-data-audit.json',
  JSON.stringify(report, null, 2) + '\n');
console.log('T30 catalog audit:', JSON.stringify(report.summary));
if (report.summary.failed || report.summary.errors) process.exitCode = 1;
