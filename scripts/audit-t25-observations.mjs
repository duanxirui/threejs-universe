// T25 official-source snapshot versus the preexisting educational catalog.
// Values were manually transcribed from identified official table cells.
// This is an optional numerical consistency comparison, not a science approval gate.
import { ALL_BY_ID } from '../src/data/celestials.js';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  PHYSICAL_CATALOG, PHYSICAL_KEYS
} from '../src/data/science/physicalCatalog.js';
import {
  OFFICIAL_OBSERVATIONS, OBSERVATION_DOCUMENTS, SOURCE_OBSERVED_ON
} from '../src/data/science/sourceObservations.js';

const reportFile = 'docs/baselines/2026-10-27-T25-reference-crosscheck.json';
const report = {
  version: 'T25-reference-crosscheck-v2',
  generatedAt: new Date().toISOString(),
  manuallyTranscribedOn: SOURCE_OBSERVED_ON,
  method: 'Offline cross-comparison with a curated NASA GSFC / JPL table-cell snapshot.',
  dataPolicy: 'Snapshot values are independent educational references; numerical consistency is checked without requiring formal scientific review.',
  caution: [
    'Publisher pages may evolve. Data is provided for reference, not a formal prediction or certification.',
    'Synchronous satellite spin values are derived from publisher S notation and the listed orbital period.',
    'Mean radii and semimajor axes are not equatorial radii or time-specific ephemeris positions.',
    'Uncertainty is unknown unless explicitly transcribed from a matching source quantity.'
  ],
  sourceDocuments: OBSERVATION_DOCUMENTS,
  rows: [],
  errors: [],
  alerts: []
};
const bodyIds = Object.keys(PHYSICAL_CATALOG);
const sourceIds = Object.keys(OFFICIAL_OBSERVATIONS);
const allowedUnits = { diameterKm: 'km', massKg: 'kg',
  rotationHours: 'h', orbitalPeriodDays: 'day', distanceKm: 'km' };
const rawConversionFactors = Object.freeze({
  identity: 1, 'x10^24': 1e24, 'x10^20': 1e20,
  'x10^6': 1e6, 'x10^3': 1e3,
  'Julian day x 24': 24, 'Julian year x 365.25': 365.25,
  'mean radius x 2': 2
});
function consistentNumber(left, right) {
  return Number.isFinite(left) && Number.isFinite(right) &&
    Math.abs(left - right) <= 1e-10 * Math.max(1, Math.abs(right));
}
for (const id of sourceIds) if (!bodyIds.includes(id)) {
  report.errors.push({ code: 'extra-source-body', bodyId: id });
}
for (const id of bodyIds) {
  const catalog = PHYSICAL_CATALOG[id];
  const observed = OFFICIAL_OBSERVATIONS[id];
  if (!observed) {
    report.errors.push({ code: 'missing-source-body', bodyId: id });
    continue;
  }
  for (const key of PHYSICAL_KEYS) {
    const current = catalog.quantities[key];
    const comparison = observed[key];
    const notApplicable = current.scientificValue === null;
    if (notApplicable && comparison === null) continue;
    if (!comparison) {
      report.errors.push({ code: 'missing-evidence-cell', bodyId: id, key });
      continue;
    }
    const doc = OBSERVATION_DOCUMENTS[comparison.sourceId];
    if (!doc || comparison.url !== doc.url ||
      !comparison.recordLocator || !comparison.sourceRevision ||
      comparison.observedOn !== SOURCE_OBSERVED_ON ||
      comparison.unit !== allowedUnits[key] ||
      !Number.isFinite(comparison.observedValue)) {
      report.errors.push({ code: 'invalid-evidence-contract', bodyId: id, key });
      continue;
    }
    if (notApplicable) {
      report.errors.push({ code: 'unwanted-source-value', bodyId: id, key });
      continue;
    }
    // Check that every recorded table cell is transformed reproducibly.
    // Synchronous rotations are special: S is a source flag rather than a
    // measured spin duration, and the period is derived from the orbit row.
    const factor = rawConversionFactors[comparison.conversion];
    const expectedConverted = factor !== undefined
      ? Number(comparison.raw.value) * factor
      : comparison.conversion === 'Synchronous spin period = NASA listed orbital period x 24'
        ? observed.orbitalPeriodDays?.observedValue * 24 : null;
    if (!consistentNumber(comparison.observedValue, expectedConverted)) {
      report.errors.push({
        code: 'source-unit-conversion-mismatch', bodyId: id, key,
        converted: comparison.observedValue, expectedConverted,
        conversion: comparison.conversion
      });
    }
    const existing = current.scientificValue;
    const official = comparison.observedValue;
    const oppositeDirection = Math.sign(existing) !== Math.sign(official);
    const retrogradeMagnitudeExplained =
      key === 'rotationHours' && oppositeDirection &&
      catalog.rotationSense === 'retrograde' &&
      ALL_BY_ID[id]?.day.includes('逆行');
    const comparedOfficial = retrogradeMagnitudeExplained ? Math.abs(official) : official;
    const relativeDifference = Math.abs(existing - comparedOfficial) /
      Math.max(Number.MIN_VALUE, Math.abs(official));
    const category = retrogradeMagnitudeExplained
      ? 'retrograde-duration-magnitude-documented' :
      oppositeDirection ? 'retrograde-direction-conflict' :
      relativeDifference > 0.01 ? 'above-1-percent' :
      relativeDifference > 0.001 ? 'within-1-percent' :
      'within-0.1-percent';
    const row = {
      bodyId: id, field: key, legacyValue: existing,
      officialObservedValue: official, unit: comparison.unit,
      absoluteDifference: Math.abs(existing - comparedOfficial),
      rotationSense: key === 'rotationHours' ? catalog.rotationSense : null,
      relativeDifference, category,
      recordLocator: comparison.recordLocator,
      sourceId: comparison.sourceId,
      sourceUrl: comparison.url,
      sourceRevision: comparison.sourceRevision,
      publisherUpdatedAt: comparison.publisherUpdatedAt,
      observedOn: comparison.observedOn,
      raw: comparison.raw,
      conversion: comparison.conversion,
      uncertainty: comparison.uncertainty,
      notes: comparison.notes,
      sourceStatus: 'reference-table-transcription',
      catalogStatus: current.status
    };
    report.rows.push(row);
    if ((oppositeDirection && !retrogradeMagnitudeExplained) || relativeDifference > 0.01) {
      report.alerts.push({
        bodyId: id, field: key, category,
        legacyValue: existing, officialObservedValue: official,
        sourceUrl: comparison.url,
        reason: oppositeDirection
          ? 'Legacy signed direction differs. Resolve retrograde semantics separately from displayed absolute duration.'
          : 'Legacy educational number differs more than 1%; review the source definition and display precision.'
      });
    }
  }
}
const count = category => report.rows.filter(item => item.category === category).length;
report.summary = {
  bodyCount: bodyIds.length,
  observationDocuments: Object.keys(OBSERVATION_DOCUMENTS).length,
  relevantSourceCells: report.rows.length,
  expectedNumericalCells: 108,
  educationalApproximationCells: report.rows.filter(item => item.catalogStatus === 'educational-approximation').length,
  withinPointOnePercent: count('within-0.1-percent'),
  withinOnePercentDifference: count('within-1-percent'),
  aboveOnePercent: count('above-1-percent'),
  retrogradeDirectionConflicts: count('retrograde-direction-conflict'),
  retrogradeDurationDisclosed: count('retrograde-duration-magnitude-documented'),
  highPriorityAlerts: report.alerts.length,
  structuralErrors: report.errors.length,
  independentScientificReviewRequired: false
};
await mkdir(path.dirname(reportFile), { recursive: true });
await writeFile(reportFile, JSON.stringify(report, null, 2), 'utf8');
console.log('T25 official crosscheck:', JSON.stringify(report.summary), reportFile);
if (report.errors.length) process.exitCode = 1;
