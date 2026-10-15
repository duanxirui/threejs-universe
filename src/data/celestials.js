// Visual radii/distances and animation speeds are rescaled. Orbital eccentricities
// and inclinations are approximate; this is an educational display, not ephemeris.
export const CELESTIALS = [
  {
    id: 'sun', name: '太阳', en: 'SUN', index: '00', type: 'G 型主序恒星', category: 'G-TYPE STAR',
    accent: '#ffbf72', secondary: '#ea672e', radius: 2.8, orbitRadius: 0,
    orbitSpeed: 0, rotationSpeed: 0.04, phase: 0, inclination: 0, eccentricity: 0,
    distance: '0 AU', diameter: '139.2 万 km', day: '约 25 天', year: '—',
    short: '太阳系的中心', description: '一颗以核聚变照亮整个太阳系的恒星。太阳包含太阳系绝大部分质量，它的引力维系着八颗行星和无数小天体的轨道。'
  },
  {
    id: 'mercury', name: '水星', en: 'MERCURY', index: '01', type: '类地行星', category: 'TERRESTRIAL PLANET',
    accent: '#aeb4b4', secondary: '#777f85', radius: 0.36, orbitRadius: 6.4,
    orbitSpeed: 0.35, rotationSpeed: 0.012, phase: 2.3, inclination: 0.12, eccentricity: 0.2056,
    distance: '0.39 AU', diameter: '4,879 km', day: '58.6 天', year: '88 天',
    short: '最靠近太阳', description: '距离太阳最近，也是太阳系最小的行星。它的表面遍布陨石坑，白昼与黑夜之间存在巨大的温差。'
  },
  {
    id: 'venus', name: '金星', en: 'VENUS', index: '02', type: '类地行星', category: 'TERRESTRIAL PLANET',
    accent: '#e4bc84', secondary: '#aa7952', radius: 0.58, orbitRadius: 9.8,
    orbitSpeed: 0.26, rotationSpeed: -0.005, phase: 4.2, inclination: 0.059, eccentricity: 0.0068,
    distance: '0.72 AU', diameter: '12,104 km', day: '243 天', year: '225 天',
    short: '炽热的云层世界', description: '厚重的二氧化碳大气与硫酸云层包裹着金星，强烈的温室效应使它成为太阳系表面最热的行星。'
  },
  {
    id: 'earth', name: '地球', en: 'EARTH', index: '03', type: '类地行星', category: 'TERRESTRIAL PLANET',
    accent: '#57b9f3', secondary: '#276da9', radius: 0.63, orbitRadius: 14.1,
    orbitSpeed: 0.20, rotationSpeed: 0.25, phase: 0.8, inclination: 0.0, eccentricity: 0.0167,
    distance: '1.00 AU', diameter: '12,742 km', day: '23.9 小时', year: '365.25 天',
    short: '我们共同的家园', description: '已知唯一存在生命的行星。液态海洋、活跃的地质作用和保护性大气层，在宇宙中构成了独特而珍贵的蓝色世界。'
  },
  {
    id: 'mars', name: '火星', en: 'MARS', index: '04', type: '类地行星', category: 'TERRESTRIAL PLANET',
    accent: '#d98368', secondary: '#983e2d', radius: 0.45, orbitRadius: 19.1,
    orbitSpeed: 0.15, rotationSpeed: 0.24, phase: 3.4, inclination: 0.032, eccentricity: 0.0934,
    distance: '1.52 AU', diameter: '6,779 km', day: '24.6 小时', year: '687 天',
    short: '红色的探索目标', description: '氧化铁让火星呈现醒目的红色。这里有巨大的奥林帕斯山与古老河谷，是人类深空探索的重要目的地。'
  },
  {
    id: 'jupiter', name: '木星', en: 'JUPITER', index: '05', type: '气态巨行星', category: 'GAS GIANT',
    accent: '#e7c7a6', secondary: '#b98760', radius: 1.65, orbitRadius: 29.0,
    orbitSpeed: 0.085, rotationSpeed: 0.57, phase: 5.2, inclination: 0.023, eccentricity: 0.0489,
    distance: '5.20 AU', diameter: '139,820 km', day: '9.9 小时', year: '11.86 年',
    short: '行星中的巨人', description: '太阳系最大的行星，拥有壮观的云带和持续数百年的大红斑风暴。它强大的引力影响着周围许多小天体。'
  },
  {
    id: 'saturn', name: '土星', en: 'SATURN', index: '06', type: '气态巨行星', category: 'GAS GIANT',
    accent: '#ebd4a5', secondary: '#ad8f6c', radius: 1.38, orbitRadius: 39.0,
    orbitSpeed: 0.06, rotationSpeed: 0.52, phase: 1.8, inclination: 0.044, eccentricity: 0.0565,
    distance: '9.58 AU', diameter: '116,460 km', day: '10.7 小时', year: '29.45 年',
    short: '环绕冰屑的巨星', description: '明亮而庞大的行星环由无数冰粒和岩屑构成。从近处观察，土星环是太阳系最令人惊叹的结构之一。'
  },
  {
    id: 'uranus', name: '天王星', en: 'URANUS', index: '07', type: '冰巨行星', category: 'ICE GIANT',
    accent: '#a8e5e5', secondary: '#579fae', radius: 1.04, orbitRadius: 48.0,
    orbitSpeed: 0.040, rotationSpeed: -0.35, phase: 4.6, inclination: 0.013, eccentricity: 0.0457,
    distance: '19.2 AU', diameter: '50,724 km', day: '17.2 小时', year: '84.0 年',
    short: '侧卧旋转的冰巨星', description: '由于自转轴严重倾斜，天王星仿佛侧躺着绕太阳公转。大气中的甲烷令它呈现柔和的青蓝色。'
  },
  {
    id: 'neptune', name: '海王星', en: 'NEPTUNE', index: '08', type: '冰巨行星', category: 'ICE GIANT',
    accent: '#5588f2', secondary: '#2745a6', radius: 1.02, orbitRadius: 57.5,
    orbitSpeed: 0.029, rotationSpeed: 0.38, phase: 0.3, inclination: 0.031, eccentricity: 0.0113,
    distance: '30.1 AU', diameter: '49,244 km', day: '16.1 小时', year: '164.8 年',
    short: '遥远的蓝色风暴', description: '太阳系最外侧的行星。低温、深蓝色大气与高速风暴，构成了这个遥远冰巨星的独特面貌。'
  }
];

export const BODY_BY_ID = Object.fromEntries(CELESTIALS.map(body => [body.id, body]));

export const SATELLITES = [
  {
    id: 'moon', parentId: 'earth', name: '月球', en: 'MOON', index: '09', type: '天然卫星', category: 'NATURAL SATELLITE',
    accent: '#c7c5bd', secondary: '#727d85', radius: .18, orbitRadius: 1.9, orbitSpeed: .52,
    rotationSpeed: .02, phase: 1.3, inclination: .09, eccentricity: .0549,
    distance: '距地球约 38.4 万 km', diameter: '3,475 km', day: '27.3 天', year: '27.3 天',
    short: '地球的天然卫星', description: '月球稳定了地球自转轴的倾角，也主导着潮汐节律。它的表面保存着太阳系古老的撞击历史。'
  },
  {
    id: 'io', parentId: 'jupiter', name: '木卫一', en: 'IO', index: '10', type: '天然卫星', category: 'GALILEAN MOON',
    accent: '#e6cf7c', secondary: '#a58d3d', radius: .18, orbitRadius: 2.55, orbitSpeed: 1.2,
    rotationSpeed: .04, phase: .4, inclination: .01, eccentricity: .0041,
    distance: '距木星约 42.2 万 km', diameter: '3,643 km', day: '1.77 天', year: '1.77 天',
    short: '火山最活跃的世界', description: '木星潮汐引力持续拉扯木卫一，使其内部产生热量。这是太阳系火山活动最剧烈的天体之一。'
  },
  {
    id: 'europa', parentId: 'jupiter', name: '木卫二', en: 'EUROPA', index: '11', type: '天然卫星', category: 'GALILEAN MOON',
    accent: '#d5c7ae', secondary: '#877966', radius: .16, orbitRadius: 3.2, orbitSpeed: .83,
    rotationSpeed: .04, phase: 2.2, inclination: .04, eccentricity: .009,
    distance: '距木星约 67.1 万 km', diameter: '3,122 km', day: '3.55 天', year: '3.55 天',
    short: '冰层下的海洋', description: '木卫二被布满裂纹的冰壳覆盖。科学家认为冰层之下可能存在全球性的咸水海洋。'
  },
  {
    id: 'ganymede', parentId: 'jupiter', name: '木卫三', en: 'GANYMEDE', index: '12', type: '天然卫星', category: 'GALILEAN MOON',
    accent: '#b3a999', secondary: '#625d56', radius: .23, orbitRadius: 4.05, orbitSpeed: .59,
    rotationSpeed: .02, phase: 4.1, inclination: .03, eccentricity: .0013,
    distance: '距木星约 107 万 km', diameter: '5,268 km', day: '7.15 天', year: '7.15 天',
    short: '太阳系最大卫星', description: '木卫三比水星还大，拥有自己的磁场，冰层下可能存在深层海洋。'
  },
  {
    id: 'callisto', parentId: 'jupiter', name: '木卫四', en: 'CALLISTO', index: '13', type: '天然卫星', category: 'GALILEAN MOON',
    accent: '#a99789', secondary: '#51453d', radius: .22, orbitRadius: 5.0, orbitSpeed: .38,
    rotationSpeed: .025, phase: 5.2, inclination: .04, eccentricity: .0074,
    distance: '距木星约 188 万 km', diameter: '4,821 km', day: '16.69 天', year: '16.69 天',
    short: '古老的撞击地貌', description: '木卫四表面布满撞击坑，是保存太阳系早期历史的重要天体。'
  },
  {
    id: 'titan', parentId: 'saturn', name: '土卫六', en: 'TITAN', index: '14', type: '天然卫星', category: 'SATURNIAN MOON',
    accent: '#dfb982', secondary: '#846342', radius: .24, orbitRadius: 3.8, orbitSpeed: .42,
    rotationSpeed: .03, phase: 2.0, inclination: .05, eccentricity: .0288,
    distance: '距土星约 122 万 km', diameter: '5,150 km', day: '15.95 天', year: '15.95 天',
    short: '拥有甲烷湖泊', description: '土卫六拥有浓厚的氮气大气，表面有由液态甲烷和乙烷组成的湖泊与海洋。'
  },
  {
    id: 'triton', parentId: 'neptune', name: '海卫一', en: 'TRITON', index: '15', type: '天然卫星', category: 'NEPTUNIAN MOON',
    accent: '#b9b6b0', secondary: '#636c79', radius: .17, orbitRadius: 2.3, orbitSpeed: -.55,
    rotationSpeed: -.025, phase: 3.5, inclination: .2, eccentricity: .00002,
    distance: '距海王星约 35.5 万 km', diameter: '2,707 km', day: '5.88 天', year: '5.88 天',
    short: '逆行的冰冻世界', description: '海卫一沿逆行轨道环绕海王星，拥有极低温表面以及氮冰喷泉活动的证据。'
  }
];

export const ALL_BODIES = [...CELESTIALS, ...SATELLITES];
export const ALL_BY_ID = Object.fromEntries(ALL_BODIES.map(body => [body.id, body]));
export const SATELLITES_BY_PARENT = Object.fromEntries(
  CELESTIALS.map(body => [body.id, SATELLITES.filter(moon => moon.parentId === body.id)])
);
