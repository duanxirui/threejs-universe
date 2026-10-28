// T25: one typed contract for the existing EDUCATIONAL physical numbers.
// Every number was previously in celestials.js/COMPARISON_FACTS. These are
// educational approximations with reference links, not certified predictions.
// Visual orbit radii, speeds, phases, and procedural textures do not belong here.

// IAU 2012 Resolution B2: the astronomical unit is defined as exactly this.
// https://www.iau.org/static/resolutions/IAU2012_English.pdf
export const KM_PER_AU = 149597870.7;
const HOURS_PER_DAY = 24;
const DAYS_PER_YEAR = 365.25;

export const SOURCE_COLLECTIONS = Object.freeze({
  'nasa-sun-overview': Object.freeze({
    title: 'NASA Science · Solar System Facts',
    url: 'https://science.nasa.gov/solar-system/solar-system-facts/',
    catalogIndexedOn: '2026-10-23', version: null, license: null,
    evidenceRole: 'topic-entry-only'
  }),
  'nasa-planet-facts': Object.freeze({
    title: 'NASA GSFC · Planetary Fact Sheet',
    url: 'https://nssdc.gsfc.nasa.gov/planetary/factsheet/',
    catalogIndexedOn: '2026-10-23', version: null, license: null,
    evidenceRole: 'candidate-collection'
  }),
  'nasa-moon-facts': Object.freeze({
    title: 'NASA GSFC · Moon Fact Sheet',
    url: 'https://nssdc.gsfc.nasa.gov/planetary/factsheet/moonfact.html',
    catalogIndexedOn: '2026-10-23', version: null, license: null,
    evidenceRole: 'candidate-collection'
  }),
  'jpl-satellite-physical': Object.freeze({
    title: 'NASA/JPL · Satellite Physical Parameters',
    url: 'https://ssd.jpl.nasa.gov/sats/phys_par/',
    catalogIndexedOn: '2026-10-23', version: null, license: null,
    evidenceRole: 'candidate-collection'
  })
});

// id, parent, diameter km, mass kg, rotation hours, orbital period days,
// approximate orbit-centre distance km. Precision is inherited from legacy
// cards, NOT independently established by this catalog.
const LEGACY_ROWS = [
  ['sun', null, 1392000, 1.9891e30, 609.12, null, null],
  ['mercury', null, 4879, 3.30103e23, 58.6 * HOURS_PER_DAY, 88, 0.39 * KM_PER_AU],
  ['venus', null, 12104, 4.86731e24, 243 * HOURS_PER_DAY, 225, 0.72 * KM_PER_AU],
  ['earth', null, 12742, 5.97217e24, 23.9, 365.25, KM_PER_AU],
  ['mars', null, 6779, 6.41691e23, 24.6, 687, 1.52 * KM_PER_AU],
  ['jupiter', null, 139820, 1.898125e27, 9.9, 11.86 * DAYS_PER_YEAR, 5.20 * KM_PER_AU],
  ['saturn', null, 116460, 5.68317e26, 10.7, 29.45 * DAYS_PER_YEAR, 9.58 * KM_PER_AU],
  ['uranus', null, 50724, 8.68099e25, 17.2, 84 * DAYS_PER_YEAR, 19.2 * KM_PER_AU],
  ['neptune', null, 49244, 1.024092e26, 16.1, 164.8 * DAYS_PER_YEAR, 30.1 * KM_PER_AU],
  ['moon', 'earth', 3475, 7.35e22, 27.3 * HOURS_PER_DAY, 27.3, 384000],
  ['io', 'jupiter', 3643, 8.93e22, 1.77 * HOURS_PER_DAY, 1.77, 422000],
  ['europa', 'jupiter', 3122, 4.8e22, 3.55 * HOURS_PER_DAY, 3.55, 671000],
  ['ganymede', 'jupiter', 5268, 1.482e23, 7.15 * HOURS_PER_DAY, 7.15, 1070000],
  ['callisto', 'jupiter', 4821, 1.076e23, 16.69 * HOURS_PER_DAY, 16.69, 1880000],
  ['titan', 'saturn', 5150, 1.346e23, 15.95 * HOURS_PER_DAY, 15.95, 1220000],
  ['mimas', 'saturn', 396, 3.79e19, .94 * HOURS_PER_DAY, .94, 186000],
  ['enceladus', 'saturn', 504, 1.08e20, 1.37 * HOURS_PER_DAY, 1.37, 238000],
  ['tethys', 'saturn', 1062, 6.17e20, 1.89 * HOURS_PER_DAY, 1.89, 295000],
  ['dione', 'saturn', 1123, 1.10e21, 2.74 * HOURS_PER_DAY, 2.74, 377000],
  ['rhea', 'saturn', 1528, 2.31e21, 4.52 * HOURS_PER_DAY, 4.52, 527000],
  ['iapetus', 'saturn', 1469, 1.81e21, 79.32 * HOURS_PER_DAY, 79.32, 3560000],
  ['triton', 'neptune', 2707, 2.15e22, 5.88 * HOURS_PER_DAY, 5.88, 355000]
];

export const QUANTITY_DEFINITIONS = Object.freeze({
  diameterKm: Object.freeze({
    unit: 'km', definition: 'Rounded educational diameter; mean/equatorial convention may vary.'
  }),
  massKg: Object.freeze({
    unit: 'kg', definition: 'Approximate mass for educational comparison.'
  }),
  rotationHours: Object.freeze({
    unit: 'h', definition: 'Approximate spin duration; sidereal/solar conventions may vary.'
  }),
  orbitalPeriodDays: Object.freeze({
    unit: 'day', definition: 'Approximate orbital period for educational comparison.'
  }),
  distanceKm: Object.freeze({
    unit: 'km', definition: 'Approximate orbit-centre distance, not an instantaneous ephemeris position.'
  })
});
export const PHYSICAL_KEYS = Object.freeze(Object.keys(QUANTITY_DEFINITIONS));

function collectionIdFor(bodyId, parentId) {
  if (bodyId === 'sun') return 'nasa-sun-overview';
  if (bodyId === 'moon') return 'nasa-moon-facts';
  return parentId ? 'jpl-satellite-physical' : 'nasa-planet-facts';
}

function createQuantity(key, value, sourceCollectionId, referenceCenter, bodyId) {
  const applicable = value !== null;
  return Object.freeze({
    scientificValue: value,
    ...QUANTITY_DEFINITIONS[key],
    referenceCenter: key === 'distanceKm' ? referenceCenter : null,
    status: applicable ? 'educational-approximation' : 'not-applicable',
    method: key === 'distanceKm' && applicable && referenceCenter === 'sun'
      ? 'derived-from-rounded-au' : 'legacy-rounded',
    uncertainty: null, validAt: null,
    source: Object.freeze({
      collectionId: sourceCollectionId,
      recordLocator: null, version: null, retrievedAt: null
    }),
    note: applicable
      ? 'Educational value; see the separate source table comparison where available.'
      : (bodyId === 'sun' ? 'The Sun has no solar-system orbit centre in this comparison.' :
        'Not applicable in the educational model.')
  });
}

function createEntry([id, parentId, ...numbers]) {
  const candidateSourceCollectionId = collectionIdFor(id, parentId);
  const referenceCenter = id === 'sun' ? null : parentId || 'sun';
  const quantities = Object.fromEntries(PHYSICAL_KEYS.map((key, index) =>
    [key, createQuantity(key, numbers[index], candidateSourceCollectionId, referenceCenter, id)]));
  return Object.freeze({
    bodyId: id, parentId,
    rotationSense: id === 'sun' ? 'differential' :
      ['venus', 'uranus', 'triton'].includes(id) ? 'retrograde' : 'unspecified',
    type: parentId ? 'satellite' : id === 'sun' ? 'star' : 'planet',
    referenceCenter, candidateSourceCollectionId,
    quantities: Object.freeze(quantities),
    displayModel: 'educational-approximation'
  });
}
export const PHYSICAL_CATALOG = Object.freeze(Object.fromEntries(
  LEGACY_ROWS.map(row => [row[0], createEntry(row)])
));
export function getPhysicalEntry(id) {
  return Object.hasOwn(PHYSICAL_CATALOG, id) ? PHYSICAL_CATALOG[id] : null;
}
export function getPhysicalQuantity(id, key) {
  const entry = getPhysicalEntry(id);
  return entry && Object.hasOwn(entry.quantities, key) ? entry.quantities[key] : null;
}
export function getEducationalNumber(id, key) {
  return getPhysicalQuantity(id, key)?.scientificValue ?? null;
}
// Preserve pre-T25 consumers while sharing a single numerical source.
export const LEGACY_COMPARISON_FACTS = Object.freeze(Object.fromEntries(
  Object.values(PHYSICAL_CATALOG).map(entry => [
    entry.bodyId, Object.freeze(Object.fromEntries(
      ['diameterKm', 'rotationHours', 'orbitalPeriodDays', 'distanceKm']
        .map(key => [key, entry.quantities[key].scientificValue])
    ))
  ])
));
