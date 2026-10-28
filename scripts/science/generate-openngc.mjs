// T30 reproducible derived OpenNGC subset. Requires downloaded upstream CSVs.
// Derived catalog is distributed under CC BY-SA 4.0 with Mattia Verga/OpenNGC
// attribution; NASA Messier distance values are educational approximations.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const date = '2026-10-28';
const rawRoot = path.resolve('data/sources/openngc', date);
const outputRoot = path.resolve('public/data/science/deep-sky/v1');
const nasa = number => 'https://science.nasa.gov/mission/hubble/science/explore-the-night-sky/hubble-messier-catalog/messier-' + number + '/';
const SHA = content => createHash('sha256').update(content).digest('hex');

// Distances: NASA's Hubble Messier pages, read as approximate values (ly).
// Position and angular extent are always taken from the actual OpenNGC row.
// Keep the curated classroom copy here, separate from OpenNGC measurements.
const selections = [
  [1, '蟹状星云', 'Crab Nebula', 'nebula', '超新星遗迹', 6500,
    '恒星爆发留下的膨胀气体与脉冲星，让我们观察恒星演化的剧烈终点。'],
  [8, '礁湖星云', 'Lagoon Nebula', 'nebula', '发射星云', 5200,
    '气体与尘埃云中正在形成新恒星，紫外辐射使部分气体发光。'],
  [16, '鹰状星云', 'Eagle Nebula', 'nebula', '发射星云与星团', 7000,
    'M16 包含 NGC 6611 星团及邻近的 IC 4703 星云；创生之柱属于恒星形成区。'],
  [27, '哑铃星云', 'Dumbbell Nebula', 'nebula', '行星状星云', 1200,
    '演化末期的恒星释放外层气体，与行星并无直接关系。'],
  [42, '猎户座大星云', 'Orion Nebula', 'nebula', '恒星形成区', 1500,
    '年轻恒星照亮气体与尘埃，是观察恒星诞生过程的典型对象。'],
  [57, '环状星云', 'Ring Nebula', 'nebula', '行星状星云', 2000,
    '环形外观只是三维气体结构的投影，真实形状更复杂。'],
  [3, 'M3 球状星团', 'Messier 3', 'cluster', '球状星团', 34000,
    '数十万颗恒星密集地受引力束缚，可比较老年恒星群与年轻疏散星团。'],
  [13, '武仙座球状星团', 'Hercules Globular Cluster', 'cluster', '球状星团', 25000,
    '大量恒星拥挤在球状分布中，典型球状星团拥有丰富的恒星族群。'],
  [44, '蜂巢星团', 'Beehive Cluster', 'cluster', '疏散星团', 600,
    '较年轻的恒星在疏散星团中形成后仍共享一定的空间运动。'],
  [31, '仙女座星系', 'Andromeda Galaxy', 'galaxy', '旋涡星系', 2500000,
    '距离银河系较近的大型星系，理解本星系群的尺度。'],
  [51, '涡状星系', 'Whirlpool Galaxy', 'galaxy', '旋涡星系', 31000000,
    '明显的旋臂与邻近星系的相互作用展示星系结构和恒星形成。'],
  [81, '波德星系', "Bode's Galaxy", 'galaxy', '旋涡星系', 11600000,
    '明显的旋臂让人认识盘状星系与中央核球。'],
  [82, '雪茄星系', 'Cigar Galaxy', 'galaxy', '星暴星系', 12000000,
    '与 M81 的引力相互作用促进剧烈恒星形成，观测形态不同于典型旋涡星系。'],
  [101, '风车星系', 'Pinwheel Galaxy', 'galaxy', '旋涡星系', 25000000,
    '面向我们的旋涡星系可以看到大范围旋臂和恒星形成区。'],
  [104, '草帽星系', 'Sombrero Galaxy', 'galaxy', '旋涡星系', 28000000,
    '几乎侧向观看的星系，暗尘埃带使其具有草帽般的轮廓。']
];

const lessons = [
  {
    id: 'stellar-cycle', title: '气体云与恒星的一生',
    subtitle: '从诞生走向爆发',
    description: '观察恒星形成区、恒星晚期外壳以及超新星遗迹。路线是教学顺序，不是天体间的实际航线。',
    steps: [
      ['M42', '恒星的摇篮', '观察明亮气体与年轻恒星，思考星云为何会发光。'],
      ['M8', '成团的分子云', '比较猎户座星云与更遥远的礁湖星云；外观与拍摄波段有关。'],
      ['M16', '创生之柱', '区分星云 IC 4703 与星团 NGC 6611，理解尘埃柱背后的恒星形成。'],
      ['M1', '超新星之后', '由恒星诞生转向爆发遗迹，比较气体云的不同起源。']
    ]
  },
  {
    id: 'star-groups', title: '星团与恒星晚年',
    subtitle: '疏散星团、球状星团与气体外壳',
    description: '认识星团成员结构，再学习类似太阳的恒星如何抛出外层气体。',
    steps: [
      ['M44', '疏散星团', '观察相对松散的成员分布。'],
      ['M13', '密集的球状星团', '与 M44 比较结构与年龄，避免用示意点尺寸推断恒星物理半径。'],
      ['M3', '古老的恒星族群', '了解球状星团与变星的距离研究。'],
      ['M27', '行星状星云', '这是恒星外层气体，不是行星。'],
      ['M57', '投影与真实形状', '环状外观并不表示气体只形成一个薄平面。']
    ]
  },
  {
    id: 'galaxy-forms', title: '星系形态与距离阶梯',
    subtitle: '从本星系群到数千万光年',
    description: '比较星系的旋臂、尘埃带与星暴活动。距离是来源给出的近似值。',
    steps: [
      ['M31', '邻近的大星系', '以仙女座星系建立百万光年的距离概念。'],
      ['M81', '旋涡结构', '观察明亮的星系核与盘。'],
      ['M82', '星暴邻居', '思考与 M81 相互作用为何能改变恒星形成。'],
      ['M51', '旋臂与引力作用', '比较涡状星系的旋臂结构。'],
      ['M101', '正面看旋涡星系', '改变视角后星系形态会怎样改变？'],
      ['M104', '侧看与尘埃带', '侧视星系的明暗结构与正面视角有何不同？']
    ]
  }
];

function splitSemicolon(line) {
  // Handles quoted delimiters and escaped double quotes, but no embedded
  // line breaks: OpenNGC's published CSV has one catalog record per line.
  const fields = [];
  let value = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') { value += '"'; i++; }
      else quoted = !quoted;
    } else if (ch === ';' && !quoted) {
      fields.push(value); value = '';
    } else value += ch;
  }
  if (quoted) throw Error('Unclosed quote in OpenNGC row');
  fields.push(value);
  return fields;
}
function degreesHms(text) {
  const parts = text.split(':').map(Number);
  if (parts.length !== 3 || !parts.every(Number.isFinite) ||
    parts[0] < 0 || parts[0] >= 24 || parts[1] >= 60 || parts[2] >= 60) {
    throw Error('Invalid OpenNGC right ascension ' + text);
  }
  return 15 * (parts[0] + parts[1] / 60 + parts[2] / 3600);
}
function degreesDms(text) {
  const sign = text.startsWith('-') ? -1 : 1;
  const parts = text.replace(/^[+-]/, '').split(':').map(Number);
  if (parts.length !== 3 || !parts.every(Number.isFinite) ||
    parts[0] > 90 || parts[1] >= 60 || parts[2] >= 60) {
    throw Error('Invalid OpenNGC declination ' + text);
  }
  return sign * (parts[0] + parts[1] / 60 + parts[2] / 3600);
}
const rawName = 'NGC.csv';
const rawBytes = await readFile(path.join(rawRoot, rawName));
const addendumBytes = await readFile(path.join(rawRoot, 'addendum.csv'));
const lines = rawBytes.toString('utf8').replace(/^\uFEFF/, '').split(/\r?\n/);
const names = splitSemicolon(lines.shift());
const needed = ['Name', 'Type', 'RA', 'Dec', 'M', 'Const', 'MajAx',
  'MinAx', 'B-Mag', 'V-Mag', 'Common names'];
for (const key of needed) if (!names.includes(key)) {
  throw Error('OpenNGC is missing ' + key);
}
const found = new Map();
const selectedNumbers = new Set(selections.map(row => row[0]));
for (const line of lines) {
  if (!line) continue;
  const fields = splitSemicolon(line);
  if (fields.length !== names.length) {
    throw Error('OpenNGC column count mismatch: ' + fields[0] +
      ', ' + fields.length + ' rather than ' + names.length);
  }
  const get = label => fields[names.indexOf(label)];
  if (!/^\d+$/.test(get('M'))) continue;
  const number = Number(get('M'));
  if (!selectedNumbers.has(number)) continue;
  if (found.has(number)) throw Error('Duplicate Messier number M' + number);
  found.set(number, Object.fromEntries(needed.map(name => [name, get(name)])));
}
const objects = selections.map(([number, nameZh, nameEn, category,
  subtype, distanceLy, intro]) => {
  const row = found.get(number);
  if (!row) throw Error('Official OpenNGC has no Messier ' + number);
  const raDeg = degreesHms(row.RA), decDeg = degreesDms(row.Dec);
  if (!(raDeg >= 0 && raDeg < 360 && decDeg >= -90 && decDeg <= 90)) {
    throw Error('OpenNGC position out of range: M' + number);
  }
  const parseOptional = value => value === '' ? null : Number(value);
  const major = parseOptional(row.MajAx);
  const minor = parseOptional(row.MinAx);
  const vMag = parseOptional(row['V-Mag']);
  const bMag = parseOptional(row['B-Mag']);
  for (const value of [major, minor, vMag, bMag]) {
    if (value !== null && !Number.isFinite(value)) {
      throw Error('OpenNGC measurement not numeric: M' + number);
    }
  }
  return {
    id: 'M' + number, catalogId: row.Name, aliases: ['M ' + number, row.Name],
    nameZh, nameEn, category, subtype, intro,
    openNgcType: row.Type, constellationCode: row.Const,
    position: {
      raDeg: Number(raDeg.toFixed(8)), decDeg: Number(decDeg.toFixed(8)),
      rawRa: row.RA, rawDec: row.Dec, frame: 'ICRS J2000.0'
    },
    angularSizeArcmin: { major, minor },
    magnitude: vMag !== null ? { band: 'V', value: vMag } :
      bMag !== null ? { band: 'B', value: bMag } : null,
    distance: {
      approximateLightYears: distanceLy, qualifier: 'approximate',
      source: 'NASA / Hubble Messier Catalog',
      url: nasa(number),
      warning: 'Published estimates vary with data and method; not for precision position reconstruction.'
    },
    sources: {
      coordinates: 'OpenNGC / Mattia Verga (CC BY-SA 4.0)',
      catalogUrl: 'https://github.com/mattiaverga/OpenNGC',
      distanceAndDescriptionUrl: nasa(number)
    },
    imagery: {
      display: 'symbolic-marker', isObservedImage: false,
      observedPhotoGalleryUrl: nasa(number),
      credit: 'In-app icon is original schematic artwork; NASA source page gives image-specific credits.'
    }
  };
});
const idSet = new Set(objects.map(o => o.id));
for (const lesson of lessons) {
  if (lesson.steps.length < 3) throw Error('Route has fewer than 3 stops');
  for (const [id] of lesson.steps) {
    if (!idSet.has(id)) throw Error('Route references unknown object ' + id);
  }
}
const routeData = lessons.map(route => ({
  ...route,
  steps: route.steps.map(([objectId, title, prompt]) => ({
    objectId, title, prompt
  }))
}));
const payloads = {
  'objects.json': {
    schema: 'cosmos-deepsky-objects-v1', objects
  },
  'routes.json': {
    schema: 'cosmos-deepsky-routes-v1', routes: routeData
  }
};
await mkdir(outputRoot, { recursive: true });
const files = [];
for (const [filename, value] of Object.entries(payloads)) {
  const body = JSON.stringify(value, null, 2) + '\n';
  await writeFile(path.join(outputRoot, filename), body);
  files.push({ file: filename, bytes: Buffer.byteLength(body), sha256: SHA(body) });
}
const manifest = {
  schema: 'cosmos-deepsky-v1', generatedOn: date,
  title: 'T30 · OpenNGC J2000 sky object sample with NASA Messier classroom distances',
  objectCount: objects.length, routeCount: routeData.length,
  coordinateFrame: 'ICRS J2000.0', distanceUnit: 'light-year',
  source: {
    catalog: 'OpenNGC', author: 'Mattia Verga',
    license: 'CC BY-SA 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
    upstream: 'https://github.com/mattiaverga/OpenNGC',
    raw: [
      { filename: 'NGC.csv', bytes: rawBytes.length, sha256: SHA(rawBytes) },
      { filename: 'addendum.csv', bytes: addendumBytes.length, sha256: SHA(addendumBytes) }
    ],
    distanceReferences: objects.map(o => ({ id: o.id, url: o.distance.url }))
  },
  visualization: {
    description: 'App places direction-only markers on a virtual sky sphere of arbitrary radius.',
    physicalThreeDimensionalPositions: false,
    observedImagesBundled: false,
    note: 'All in-app markers are schematic; real photos and their detailed image credits are on linked NASA Messier pages.'
  },
  limitations: [
    'Curated selection of 15 objects, not a full sky census.',
    'Distances are approximate published estimates and not used for 3D positions.',
    'OpenNGC angles indicate sky direction at J2000, not actual physical depth.',
    'Lessons are educational sequences, not navigable physical routes.'
  ],
  files
};
await writeFile(path.join(outputRoot, 'manifest.json'),
  JSON.stringify(manifest, null, 2) + '\n');
console.log('T30 generated', objects.length, 'OpenNGC source-matched objects,',
  routeData.length, 'routes,', files.map(f => f.file + '=' + f.bytes + ' B').join(' '));
