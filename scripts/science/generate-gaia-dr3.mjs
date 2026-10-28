// T29: reproducible ESA Gaia DR3 high-parallax-SNR *sample* for the
// local-volume teaching view. This is explicitly not a census of all stars.
// Rebuild offline from retained source CSVs, or --fetch from ESA TAP.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';

const RELEASE = 'Gaia DR3';
const DATE = '2026-10-28';
const TAP = 'https://gea.esac.esa.int/tap-server/tap/sync';
const RAW_DIR = path.resolve('data/sources/gaia-dr3', DATE);
const OUT_DIR = path.resolve('public/data/science/gaia-dr3/v1');
const WINDOWS = [[0, 60000], [60000, 120000], [120000, 180000], [180000, 240000]];
const COLS = [
  'source_id', 'ra', 'dec', 'parallax', 'parallax_error',
  'parallax_over_error', 'phot_g_mean_mag', 'bp_rp', 'pmra', 'pmdec',
  'ruwe', 'ref_epoch'
];
const WHERE = [
  'parallax > 1', 'parallax_over_error > 10',
  'phot_g_mean_mag < 16', 'ruwe < 1.4', 'bp_rp IS NOT NULL'
].join(' AND ');
const QUERIES = WINDOWS.map(([low, high]) =>
  'SELECT TOP 1200 ' + COLS.join(',') +
  ' FROM gaiadr3.gaia_source WHERE random_index >= ' + low +
  ' AND random_index < ' + high + ' AND ' + WHERE +
  ' ORDER BY random_index'
);
const fetchRequested = process.argv.includes('--fetch');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const round = (n, digits) => Number(n.toFixed(digits));

async function fetchCsv(index, query) {
  const file = path.join(RAW_DIR, 'slice-' + String(index).padStart(2, '0') + '.csv');
  if (!fetchRequested) return file;
  const temporary = file + '.partial';
  const args = [
    '-G', '--fail', '--location', '--silent', '--show-error',
    '--connect-timeout', '15', '--max-time', '120',
    '--data-urlencode', 'REQUEST=doQuery',
    '--data-urlencode', 'LANG=ADQL',
    '--data-urlencode', 'FORMAT=csv',
    '--data-urlencode', 'QUERY=' + query,
    '--output', temporary, TAP
  ];
  await new Promise((resolve, reject) => {
    const child = spawn(process.platform === 'win32' ? 'curl.exe' : 'curl', args, {
      stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true
    });
    let errorText = '';
    child.stderr.on('data', data => {
      errorText = (errorText + String(data)).slice(-2500);
    });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() :
      reject(Error('Gaia TAP request ' + index + ' failed (' + code + '): ' + errorText)));
  });
  const downloaded = await readFile(temporary, 'utf8');
  if (!downloaded.startsWith(COLS.join(','))) {
    throw Error('Gaia TAP returned an unexpected schema for slice ' + index +
      ': ' + downloaded.slice(0, 250));
  }
  await rename(temporary, file);
  console.log('Downloaded', path.basename(file), Buffer.byteLength(downloaded), 'bytes');
  return file;
}

function parseCsv(bytes, filename) {
  const lines = bytes.trim().split(/\r?\n/);
  if (lines.shift()?.replace(/^\uFEFF/, '') !== COLS.join(',')) {
    throw Error('Invalid Gaia CSV columns in ' + filename);
  }
  const records = [];
  for (const [idx, line] of lines.entries()) {
    if (!line.trim()) continue;
    const values = line.split(',');
    if (values.length !== COLS.length) {
      throw Error(filename + ' row ' + (idx + 2) + ' has ' + values.length + ' columns');
    }
    const [sourceId, ra, dec, parallax, parallaxError, snr,
      mag, bpRp, pmra, pmdec, ruwe, epoch] = values;
    if (!/^\d{15,20}$/.test(sourceId) ||
        ![ra, dec, parallax, parallaxError, snr, mag, bpRp, ruwe, epoch]
          .every(x => x !== '' && Number.isFinite(Number(x)))) {
      throw Error('Invalid Gaia numeric record ' + filename + ':' + (idx + 2));
    }
    const [raN, decN, plxN, errorN, snrN, magN, bpN, ruweN, epochN] =
      [ra, dec, parallax, parallaxError, snr, mag, bpRp, ruwe, epoch].map(Number);
    if (!(raN >= 0 && raN < 360 && decN >= -90 && decN <= 90 &&
      plxN > 1 && errorN > 0 && snrN > 10 && magN < 16 &&
      ruweN < 1.4 && epochN === 2016)) {
      throw Error('Gaia quality/epoch constraints failed at ' + filename + ':' + (idx + 2));
    }
    const distancePc = 1000 / plxN;
    if (!(distancePc > 0 && distancePc < 1000)) throw Error('Distance out of range');
    // Exact 64-bit sourceId stays a string. Other columns are numeric and
    // rounded only to remove insignificant byte-size overhead.
    records.push([
      sourceId, round(raN, 8), round(decN, 8),
      round(plxN, 6), round(errorN, 6), round(snrN, 3),
      round(magN, 4), round(bpN, 4),
      pmra === '' ? null : round(Number(pmra), 4),
      pmdec === '' ? null : round(Number(pmdec), 4)
    ]);
  }
  return records;
}

await mkdir(RAW_DIR, { recursive: true });
await mkdir(OUT_DIR, { recursive: true });
const raw = [];
const all = [];
for (let i = 0; i < QUERIES.length; i++) {
  const file = await fetchCsv(i, QUERIES[i]);
  const bytes = await readFile(file);
  const parsed = parseCsv(bytes.toString('utf8'), path.basename(file));
  raw.push({
    file: path.relative(process.cwd(), file).replaceAll('\\', '/'),
    sha256: sha256(bytes), count: parsed.length, query: QUERIES[i]
  });
  all.push(...parsed);
}
const ids = new Set(all.map(row => row[0]));
if (ids.size !== all.length || all.length < 1000) {
  throw Error('Expected 1000+ distinct Gaia DR3 sources; got ' + all.length +
    ', distinct ' + ids.size);
}
const bins = [
  { id: 'near', minPc: 0, maxPc: 100 },
  { id: 'mid', minPc: 100, maxPc: 400 },
  { id: 'far', minPc: 400, maxPc: 1000 }
];
const chunks = [];
for (const bin of bins) {
  const records = all.filter(row => {
    const pc = 1000 / row[3];
    return pc >= bin.minPc && pc < bin.maxPc;
  }).sort((a, b) => a[6] - b[6] || a[0].localeCompare(b[0]));
  const filename = bin.id + '.json';
  const payload = JSON.stringify({
    schema: 'cosmos-gaia-dr3-chunk-v1', release: RELEASE,
    band: bin.id, records
  }) + '\n';
  await writeFile(path.join(OUT_DIR, filename), payload);
  chunks.push({
    id: bin.id, file: filename, count: records.length,
    minPc: bin.minPc, maxPc: bin.maxPc, bytes: Buffer.byteLength(payload),
    sha256: sha256(payload)
  });
}
const manifest = {
  schema: 'cosmos-gaia-dr3-v1', release: RELEASE, snapshotDate: DATE,
  title: 'Gaia DR3 · high-SNR nearby sample',
  provider: 'ESA / Gaia / DPAC', sourceTable: 'gaiadr3.gaia_source',
  archive: 'https://gea.esac.esa.int/archive/',
  referenceEpoch: 2016.0, referenceFrame: 'ICRS',
  fields: ['sourceId', 'raDeg', 'decDeg', 'parallaxMas', 'parallaxErrorMas',
    'parallaxOverError', 'gMag', 'bpRp', 'pmRaMasYr', 'pmDecMasYr'],
  selection: {
    randomIndexRange: [0, 240000], criteria: WHERE,
    description: 'Deterministic random-index subset, high parallax SNR, G<16, RUWE<1.4; not a complete or volume-limited census.'
  },
  distance: {
    method: '1000 / positive parallax (mas), only for parallax_over_error > 10',
    units: 'pc', note: 'Approximation with measurement uncertainty and sample bias; no distances fabricated for missing or low-SNR parallaxes.'
  },
  total: all.length, raw, chunks,
  attribution: 'Gaia Collaboration, ESA, DPAC; Gaia Data Release 3 (2022).',
  notes: ['Positions are ICRS at epoch J2016.0; no epoch propagation in this scene.',
    'Apparent G magnitudes are not intrinsic luminosities.',
    'Rendered point sizes and colors are visual encoding.']
};
await writeFile(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log('Gaia DR3 sample:', all.length, 'records; chunks:',
  chunks.map(c => c.id + '=' + c.count + '/' + c.bytes + 'B').join(', '));
