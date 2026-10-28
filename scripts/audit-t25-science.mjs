// T25: verify structure, unit labels and consistency of educational values.
// Independent scientific approval is not required by the project.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ALL_BODIES, ALL_BY_ID, COMPARISON_FACTS, getOrbitReferenceId } from '../src/data/celestials.js';
import { ATLAS_CONTENT } from '../src/v3/atlasData.js';
import {
  PHYSICAL_CATALOG, PHYSICAL_KEYS, QUANTITY_DEFINITIONS,
  SOURCE_COLLECTIONS, KM_PER_AU
} from '../src/data/science/physicalCatalog.js';

const reportFile = process.env.COSMOS_T25_REPORT ||
  'docs/baselines/2026-10-27-T25-data-check.json';
const report = {
  version: 't25-data-check-v2',
  createdAt: new Date().toISOString(),
  task: 'T25',
  scope: '22 existing educational bodies and five legacy physical quantities',
  dataUsage: 'educational-approximation',
  independentScientificReviewRequired: false,
  meaning: 'Checks field coverage, units and display consistency. Data is for educational reference and not live ephemeris.',
  sourceAccess: 'Existing public reference links, not live-fetched by this command.',
  sources: SOURCE_COLLECTIONS,
  bodies: [],
  errors: [],
  warnings: []
};

function issue(code, details) { report.errors.push({ code, ...details }); }
function closeTo(actual, expected, absolute = 1e-7, relative = 1e-10) {
  return Number.isFinite(actual) && Number.isFinite(expected) &&
    Math.abs(actual - expected) <= Math.max(absolute, Math.abs(expected) * relative);
}
function numberFromLabel(text) {
  const match = String(text).replaceAll(',', '').match(/([0-9]+(?:\.[0-9]+)?)/);
  return match ? Number(match[1]) : null;
}
function diameterFromLabel(text) {
  const number = numberFromLabel(text);
  return number === null ? null : number * (String(text).includes('万') ? 10000 : 1);
}
function distanceFromLabel(body) {
  if (body.id === 'sun') return null;
  const label = body.distance;
  const num = numberFromLabel(label);
  return num === null ? null : num * (label.includes('AU') ? KM_PER_AU :
    label.includes('万') ? 10000 : 1);
}
function rotationFromLabel(text) {
  const value = numberFromLabel(text);
  return value === null ? null : value * (String(text).includes('天') ? 24 : 1);
}
function orbitFromLabel(text) {
  const value = numberFromLabel(text);
  return value === null ? null : value * (String(text).includes('年') ? 365.25 : 1);
}
function validDateOrNull(value) {
  return value === null ||
    (typeof value === 'string' && !Number.isNaN(Date.parse(value)));
}
const idSet = new Set(ALL_BODIES.map(body => body.id));
const expectedIds = Object.keys(PHYSICAL_CATALOG);
const comparisons = Object.keys(COMPARISON_FACTS);
const contentIds = Object.keys(ATLAS_CONTENT);
if (idSet.size !== ALL_BODIES.length) issue('duplicate-body-ids', {});
if (ALL_BODIES.length !== 22) issue('body-count', { expected: 22, actual: ALL_BODIES.length });
for (const [tag, actualIds] of [
  ['catalog', expectedIds], ['comparison', comparisons], ['atlas', contentIds]
]) {
  const extra = actualIds.filter(id => !idSet.has(id));
  const missing = ALL_BODIES.filter(body => !actualIds.includes(body.id)).map(body => body.id);
  if (extra.length || missing.length) issue('id-set-mismatch', { tag, extra, missing });
}
const statuses = { 'educational-approximation': 0, 'not-applicable': 0 };
const validation = { numeric: 0, absent: 0, sourceCandidates: 0, reconciled: 0 };
const visualExclusions = ['radius', 'orbitRadius', 'orbitSpeed', 'rotationSpeed',
  'phase', 'inclination', 'eccentricity', 'node', 'textureSource'];
for (const body of ALL_BODIES) {
  const record = PHYSICAL_CATALOG[body.id];
  if (!record) continue;
  const referenceCenter = getOrbitReferenceId(body);
  const source = SOURCE_COLLECTIONS[record.candidateSourceCollectionId];
  const atlas = ATLAS_CONTENT[body.id];
  const recordReport = {
    bodyId: body.id,
    name: body.name,
    referenceCenter,
    sourceCollectionId: record.candidateSourceCollectionId,
    sourceCollectionUrl: source?.url ?? null,
    dataClassification: record.displayModel,
    quantities: {},
    discrepancies: []
  };
  if (record.parentId !== (body.parentId || null) ||
      record.referenceCenter !== referenceCenter) {
    issue('reference-center-mismatch', { bodyId: body.id, catalogCenter: record.referenceCenter, referenceCenter });
  }
  if (referenceCenter && !idSet.has(referenceCenter)) {
    issue('missing-reference-body', { bodyId: body.id, referenceCenter });
  }
  if (!source || !/^https:\/\//.test(source.url)) {
    issue('missing-source-collection', { bodyId: body.id });
  } else {
    validation.sourceCandidates++;
  }
  if (source && atlas?.source.url !== source.url) {
    issue('atlas-source-drift', { bodyId: body.id, atlasUrl: atlas?.source.url, catalogUrl: source.url });
  }
  if (atlas?.sourceIndexedOn !== source?.catalogIndexedOn) {
    issue('atlas-source-date-drift', { bodyId: body.id });
  }
  for (const field of visualExclusions) {
    if (Object.hasOwn(record, field) || Object.hasOwn(record.quantities, field)) {
      issue('visual-field-in-science-catalog', { bodyId: body.id, field });
    }
  }
  for (const key of PHYSICAL_KEYS) {
    const quantity = record.quantities[key];
    if (!quantity || quantity.unit !== QUANTITY_DEFINITIONS[key].unit) {
      issue('missing-or-wrong-unit', { bodyId: body.id, key });
      continue;
    }
    if (!Object.hasOwn(statuses, quantity.status)) {
      issue('unknown-review-state', { bodyId: body.id, key, status: quantity.status });
      continue;
    }
    statuses[quantity.status]++;
    const numeric = quantity.scientificValue;
    if (numeric === null) {
      validation.absent++;
      if (quantity.status !== 'not-applicable' || body.id !== 'sun' ||
          !['distanceKm', 'orbitalPeriodDays'].includes(key)) {
        issue('unexpected-null-value', { bodyId: body.id, key, status: quantity.status });
      }
    } else {
      validation.numeric++;
      if (!Number.isFinite(numeric) || numeric <= 0) {
        issue('invalid-number', { bodyId: body.id, key, scientificValue: numeric });
      }
      if (quantity.status === 'not-applicable') {
        issue('numeric-marked-nonapplicable', { bodyId: body.id, key });
      }
    }
    if (key === 'distanceKm' && quantity.referenceCenter !== referenceCenter) {
      issue('distance-reference-mismatch', { bodyId: body.id, expected: referenceCenter });
    }
    if (key !== 'distanceKm' && quantity.referenceCenter !== null) {
      issue('wrong-field-reference', { bodyId: body.id, key });
    }
    if (quantity.source.collectionId !== record.candidateSourceCollectionId ||
        !validDateOrNull(quantity.validAt)) {
      issue('invalid-source-contract', { bodyId: body.id, key });
    }
    const oldComparison = COMPARISON_FACTS[body.id]?.[key];
    const oldMass = key === 'massKg' ? body.massKg : oldComparison;
    if (numeric !== oldMass && !closeTo(numeric, oldMass)) {
      issue('legacy-comparison-drift', { bodyId: body.id, key,
        catalogValue: numeric, oldValue: oldMass });
      recordReport.discrepancies.push(key);
    } else validation.reconciled++;
    recordReport.quantities[key] = {
      value: numeric, unit: quantity.unit, status: quantity.status,
      definition: quantity.definition, method: quantity.method,
      referenceCenter: quantity.referenceCenter,
      candidateSource: source?.url || null,
      rowEvidence: quantity.source.recordLocator,
      sourceVersion: quantity.source.version,
      retrievedAt: quantity.source.retrievedAt,
      uncertainty: quantity.uncertainty
    };
  }
  const displays = [
    ['diameterKm', diameterFromLabel(body.diameter)],
    ['distanceKm', distanceFromLabel(body)],
    ['rotationHours', rotationFromLabel(body.day)],
    ['orbitalPeriodDays', orbitFromLabel(body.year)]
  ];
  for (const [key, displayedNumber] of displays) {
    const normalized = record.quantities[key]?.scientificValue;
    if (displayedNumber === null && normalized === null) continue;
    // A printed educational value should reconcile within the precision of
    // the already-rounded cards; this is not external scientific validation.
    if (!closeTo(displayedNumber, normalized, 0.001, 1e-6)) {
      issue('display-value-drift', { bodyId: body.id, key,
        printed: displayedNumber, catalogValue: normalized });
      recordReport.discrepancies.push('display:' + key);
    }
  }
  report.bodies.push(recordReport);
}
report.summary = {
  bodies: report.bodies.length,
  uniqueCandidateCollections: Object.keys(SOURCE_COLLECTIONS).length,
  bodiesWithSourceCandidates: validation.sourceCandidates,
  physicalFieldsExpected: report.bodies.length * PHYSICAL_KEYS.length,
  numericalValues: validation.numeric,
  notApplicable: validation.absent,
  structurallyReconciled: validation.reconciled,
  educationalApproximationFields: statuses['educational-approximation'],
  independentScientificReviewRequired: false,
  structuralErrors: report.errors.length,
  warnings: report.warnings.length
};

if (report.summary.structuralErrors > 0) console.error('T25 structural errors:', report.errors.length);
await mkdir(path.dirname(reportFile), { recursive: true });
await writeFile(reportFile, JSON.stringify(report, null, 2), 'utf8');
console.log('T25 source audit:', JSON.stringify(report.summary), reportFile);
if (report.errors.length) process.exitCode = 1;
