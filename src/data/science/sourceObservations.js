// T25: frozen, manually transcribed numerical observations from official
// NASA GSFC / JPL reference tables reviewed 2026-10-26.
// This is an independent comparison layer, not a replacement for the existing
// rounded educational cards. See audit-t25-observations.mjs for reconciliations.
// Reference URLs, publisher revision dates and row/column locators are explicit.
// For a new verification, reconfirm against the live publisher revision.

export const SOURCE_OBSERVED_ON = '2026-10-26';
export const OBSERVATION_DOCUMENTS = Object.freeze({
  'jpl-planet-physical': {
    url: 'https://ssd.jpl.nasa.gov/planets/phys_par.html',
    title: 'JPL SSD · Planetary Physical Parameters',
    publisherUpdatedAt: null,
    revision: 'Online planetary physical table, revision not labeled',
    scope: 'Planet, mass, mean radius, sidereal rotation and orbital period'
  },
  'nasa-planet-metric': {
    url: 'https://nssdc.gsfc.nasa.gov/planetary/factsheet/',
    title: 'NASA GSFC · Planetary Fact Sheet (Metric)',
    publisherUpdatedAt: '2025-03-18',
    revision: 'Fact sheet updated 18 March 2025',
    scope: 'Planet, rounded mean distance from the Sun'
  },
  'nasa-sun': {
    url: 'https://nssdc.gsfc.nasa.gov/planetary/factsheet/sunfact.html',
    title: 'NASA GSFC · Sun Fact Sheet',
    publisherUpdatedAt: '2024-05-09',
    revision: 'Sun Fact Sheet updated 9 May 2024',
    scope: 'Solar mass, volumetric mean radius and latitude-dependent rotation'
  },
  'nasa-moon': {
    url: 'https://nssdc.gsfc.nasa.gov/planetary/factsheet/moonfact.html',
    title: 'NASA GSFC · Moon Fact Sheet',
    publisherUpdatedAt: '2024-01-11',
    revision: 'Moon Fact Sheet updated 11 January 2024',
    scope: 'Lunar mass, radius, sidereal rotation, sidereal revolution, orbital semimajor axis'
  },
  'jpl-satellite-physical': {
    url: 'https://ssd.jpl.nasa.gov/sats/phys_par/',
    title: 'JPL SSD · Planetary Satellite Physical Parameters',
    publisherUpdatedAt: null,
    revision: 'Online physical table with named ephemeris versions and radius reference 1',
    scope: 'Satellite volumetric mean radius, with uncertainties'
  },
  'nasa-jovian': {
    url: 'https://nssdc.gsfc.nasa.gov/planetary/factsheet/joviansatfact.html',
    title: 'NASA GSFC · Jovian Satellite Fact Sheet',
    publisherUpdatedAt: '2023-12-06',
    revision: 'Fact sheet updated 6 December 2023',
    scope: 'Jovian satellite mass, semimajor axis, orbital period, S synchronized spin'
  },
  'nasa-saturnian': {
    url: 'https://nssdc.gsfc.nasa.gov/planetary/factsheet/saturniansatfact.html',
    title: 'NASA GSFC · Saturnian Satellite Fact Sheet',
    publisherUpdatedAt: '2025-07-22',
    revision: 'Fact sheet updated 22 July 2025',
    scope: 'Saturnian satellite mass, semimajor axis, orbital period, S synchronized spin'
  },
  'nasa-neptunian': {
    url: 'https://nssdc.gsfc.nasa.gov/planetary/factsheet/neptuniansatfact.html',
    title: 'NASA GSFC · Neptunian Satellite Fact Sheet',
    publisherUpdatedAt: '2024-03-11',
    revision: 'Fact sheet updated 11 March 2024',
    scope: 'Triton mass, orbital semimajor axis, retrograde period, S synchronized spin'
  }
});
Object.values(OBSERVATION_DOCUMENTS).forEach(Object.freeze);

// Raw official table cells:
// planet: id, table row, mass (x10^24 kg), mean radius (km), sidereal
// rotation (days), sidereal orbit (Julian years), mean distance (x10^6 km).
const PLANET_ROWS = Object.freeze([
  ['mercury', 'Mercury', 0.330103, 2439.4, 58.6462, .2408467, 57.9],
  ['venus', 'Venus', 4.86731, 6051.8, -243.018, .61519726, 108.2],
  ['earth', 'Earth', 5.97217, 6371.0084, .99726968, 1.0000174, 149.6],
  ['mars', 'Mars', .641691, 3389.50, 1.02595676, 1.8808476, 228.0],
  ['jupiter', 'Jupiter', 1898.125, 69911, .41354, 11.862615, 778.5],
  ['saturn', 'Saturn', 568.317, 58232, .44401, 29.447498, 1432.0],
  ['uranus', 'Uranus', 86.8099, 25362, -.71833, 84.016846, 2867.0],
  ['neptune', 'Neptune', 102.4092, 24622, .67125, 164.79132, 4515.0]
]);

// satellite: id, official row label, parent system, mass (x10^20 kg),
// JPL volumetric mean radius (km), NASA revolution period (days),
// NASA mean semimajor axis (x10^3 km), source orbital flag (S, R).
const SATELLITE_ROWS = Object.freeze([
  ['io', 'Io (I)', 'jovian', 893.2, 1821.49, 1.769138, 421.8, 'S'],
  ['europa', 'Europa (II)', 'jovian', 480.0, 1560.80, 3.551181, 671.1, 'S'],
  ['ganymede', 'Ganymede (III)', 'jovian', 1481.9, 2631.20, 7.154553, 1070.4, 'S'],
  ['callisto', 'Callisto (IV)', 'jovian', 1075.9, 2410.30, 16.689017, 1882.7, 'S'],
  ['titan', 'Titan (VI)', 'saturnian', 1345.5, 2574.76, 15.945421, 1221.87, 'S'],
  ['mimas', 'Mimas (I)', 'saturnian', .379, 198.20, .9424218, 185.52, 'S'],
  ['enceladus', 'Enceladus (II)', 'saturnian', 1.08, 252.10, 1.370218, 238.02, 'S'],
  ['tethys', 'Tethys (III)', 'saturnian', 6.18, 531.10, 1.887802, 294.66, 'S'],
  ['dione', 'Dione (IV)', 'saturnian', 11.0, 561.40, 2.736915, 377.40, 'S'],
  ['rhea', 'Rhea (V)', 'saturnian', 23.1, 763.50, 4.517500, 527.04, 'S'],
  ['iapetus', 'Iapetus (VIII)', 'saturnian', 18.1, 734.30, 79.330183, 3560.85, 'S'],
  ['triton', 'Triton (NI)', 'neptunian', 214.0, 1352.60, 5.876854, 354.76, 'S+R']
]);

function observation(sourceId, row, column, rawValue, rawUnit, convertedValue,
  unit, conversion, notes = null, uncertainty = null) {
  const doc = OBSERVATION_DOCUMENTS[sourceId];
  return Object.freeze({
    observedValue: convertedValue,
    unit, sourceId,
    url: doc.url,
    sourceRevision: doc.revision,
    publisherUpdatedAt: doc.publisherUpdatedAt,
    observedOn: SOURCE_OBSERVED_ON,
    recordLocator: row + ' / ' + column,
    raw: Object.freeze({ value: rawValue, unit: rawUnit }),
    conversion,
    uncertainty,
    notes
  });
}
function buildSun() {
  return Object.freeze({
    massKg: observation('nasa-sun', 'Sun', 'Bulk parameters / Mass', 1988400,
      '10^24 kg', 1988400e24, 'kg', 'x10^24'),
    diameterKm: observation('nasa-sun', 'Sun', 'Bulk parameters / Volumetric mean radius',
      695700, 'km radius', 1391400, 'km', 'mean radius x 2'),
    rotationHours: observation('nasa-sun', 'Sun',
      'Rotational and Orbital parameters / Sidereal rotation period',
      609.12, 'hour', 609.12, 'h', 'identity',
      'Latitude 16 degrees. Differential rotation varies by latitude.'),
    orbitalPeriodDays: null,
    distanceKm: null
  });
}
function buildMoon() {
  return Object.freeze({
    diameterKm: observation('nasa-moon', 'Moon', 'Bulk parameters / Volumetric mean radius',
      1737.4, 'km radius', 3474.8, 'km', 'mean radius x 2'),
    massKg: observation('nasa-moon', 'Moon', 'Bulk parameters / Mass',
      .07346, '10^24 kg', .07346e24, 'kg', 'x10^24'),
    rotationHours: observation('nasa-moon', 'Moon',
      'Orbital parameters / Sidereal rotation period', 655.720, 'h',
      655.720, 'h', 'identity'),
    orbitalPeriodDays: observation('nasa-moon', 'Moon',
      'Orbital parameters / Revolution period', 27.3217, 'day',
      27.3217, 'day', 'identity'),
    distanceKm: observation('nasa-moon', 'Moon',
      'Orbital parameters / Semimajor axis', .3844, '10^6 km',
      384400, 'km', 'x10^6')
  });
}
const observations = [['sun', buildSun()], ['moon', buildMoon()]];
for (const [id, row, mass, radius, rotation, period, distance] of PLANET_ROWS) {
  observations.push([id, Object.freeze({
    diameterKm: observation('jpl-planet-physical', row,
      'Mean Radius', radius, 'km radius', radius * 2, 'km', 'mean radius x 2'),
    massKg: observation('jpl-planet-physical', row,
      'Mass', mass, '10^24 kg', mass * 1e24, 'kg', 'x10^24'),
    rotationHours: observation('jpl-planet-physical', row,
      'Sidereal Rotation Period', rotation, 'sidereal day',
      rotation * 24, 'h', 'Julian day x 24',
      rotation < 0 ? 'Negative indicates retrograde rotation.' : null),
    orbitalPeriodDays: observation('jpl-planet-physical', row,
      'Sidereal Orbital Period', period, 'Julian year',
      period * 365.25, 'day', 'Julian year x 365.25'),
    distanceKm: observation('nasa-planet-metric', row,
      'Distance from Sun', distance, '10^6 km',
      distance * 1e6, 'km', 'x10^6',
      'Rounded educational orbital-distance measure, not an instantaneous ephemeris.')
  })]);
}
for (const [id, row, system, mass, radius, period, distance, flags] of SATELLITE_ROWS) {
  const group = 'nasa-' + system;
  const orbitalNote = flags.includes('R')
    ? 'Orbital period is retrograde (R). S marks synchronous rotation.'
    : 'S marks synchronous rotation, so spin period matches orbital period.';
  observations.push([id, Object.freeze({
    diameterKm: observation('jpl-satellite-physical', row,
      'Physical parameters / Mean Radius', radius, 'km radius',
      radius * 2, 'km', 'mean radius x 2',
      'Volumetric mean radius; not necessarily equatorial radius.'),
    massKg: observation(group, row, 'Bulk parameters / Mass',
      mass, '10^20 kg', mass * 1e20, 'kg', 'x10^20'),
    rotationHours: observation(group, row,
      'Orbital parameters / Rotation Period = S',
      'S', 'synchronous', period * 24, 'h',
      'Synchronous spin period = NASA listed orbital period x 24',
      orbitalNote),
    orbitalPeriodDays: observation(group, row,
      'Orbital parameters / Orbital Period', period, 'day',
      period, 'day', 'identity', orbitalNote),
    distanceKm: observation(group, row,
      'Orbital parameters / Semimajor axis',
      distance, '10^3 km', distance * 1000, 'km', 'x10^3',
      'Mean semimajor axis only; not a time-specific distance.')
  })]);
}
export const OFFICIAL_OBSERVATIONS = Object.freeze(Object.fromEntries(observations));
export function getOfficialObservation(bodyId, key) {
  const group = Object.hasOwn(OFFICIAL_OBSERVATIONS, bodyId)
    ? OFFICIAL_OBSERVATIONS[bodyId] : null;
  return group && Object.hasOwn(group, key) ? group[key] : null;
}