import { SOURCE_COLLECTIONS, getPhysicalEntry } from '../data/science/physicalCatalog.js';
import { ALL_BODIES, ALL_BY_ID, COMPARISON_FACTS, getOrbitReferenceId } from '../data/celestials.js';

export const ATLAS_CONTENT = Object.freeze(Object.fromEntries(ALL_BODIES.map(body => {
  const physicalEntry = getPhysicalEntry(body.id);
  const collection = SOURCE_COLLECTIONS[physicalEntry.candidateSourceCollectionId];
  const source = Object.freeze({ title: collection.title, url: collection.url });
  return [body.id, Object.freeze({
    id: body.id,
    title: body.name,
    introduction: body.description,
    highlight: body.short,
    source,
    sourceIndexedOn: collection.catalogIndexedOn,
    sourceRole: collection.evidenceRole,
    dataClassification: physicalEntry.displayModel,
    accuracy: '当前页面是近似科普数据；球体大小、轨道间距和运行速度另作视觉缩放。'
  })];
})));

export const ATLAS_ROUTES = Object.freeze([
  {
    id: 'solar-intro',
    title: '初识太阳系',
    subtitle: '从中心恒星出发，认识不同类型的行星',
    steps: [
      { bodyId: 'sun', title: '中心恒星', note: '太阳的引力维系着太阳系众多天体的运动。' },
      { bodyId: 'mercury', title: '最近的行星', note: '水星距离太阳最近，表面遍布陨石坑。' },
      { bodyId: 'earth', title: '蓝色家园', note: '液态海洋与大气是地球的重要特征。' },
      { bodyId: 'jupiter', title: '气态巨行星', note: '观察木星明显的云带与众多卫星。' },
      { bodyId: 'saturn', title: '冰环世界', note: '土星环由大量冰粒与岩屑组成。' },
      { bodyId: 'neptune', title: '遥远的冰巨星', note: '海王星位于八大行星中最远离太阳的位置。' }
    ]
  },
  {
    id: 'moon-worlds',
    title: '卫星世界',
    subtitle: '拜访月球、木星与土星周围的代表性卫星',
    steps: [
      { bodyId: 'moon', title: '地球的伙伴', note: '月球的古老撞击地貌保留着历史。' },
      { bodyId: 'io', title: '火山世界', note: '潮汐引力让木卫一拥有活跃的火山活动。' },
      { bodyId: 'europa', title: '冰封海洋', note: '科学家推测木卫二冰壳下可能有海洋。' },
      { bodyId: 'ganymede', title: '最大的卫星', note: '木卫三的直径超过水星。' },
      { bodyId: 'enceladus', title: '喷泉之月', note: '土卫二的冰羽流与地下海洋备受关注。' },
      { bodyId: 'titan', title: '浓厚的大气', note: '土卫六拥有浓厚的大气层。' }
    ]
  },
  {
    id: 'planet-contrasts',
    title: '行星差异',
    subtitle: '比较温度、体量与自转方式的多样性',
    steps: [
      { bodyId: 'mercury', title: '小而靠近太阳', note: '水星的直径比地球小得多。' },
      { bodyId: 'venus', title: '强烈温室效应', note: '金星被浓厚大气包围，表面非常炎热。' },
      { bodyId: 'earth', title: '海洋和生命', note: '地球是目前唯一确认存在生命的世界。' },
      { bodyId: 'mars', title: '岩石世界', note: '火星的氧化铁使其表面偏红。' },
      { bodyId: 'jupiter', title: '最大行星', note: '木星与地球的直径有显著差异。' },
      { bodyId: 'uranus', title: '倾斜的自转轴', note: '天王星的极大轴倾角令它显得侧躺。' }
    ]
  }
]);

export function getAtlasFacts(id) {
  const body = Object.hasOwn(ALL_BY_ID, id) ? ALL_BY_ID[id] : null;
  if (!body) return null;
  const physical = COMPARISON_FACTS[id] || {};
  const referenceId = getOrbitReferenceId(body);
  return {
    body,
    physical,
    reference: referenceId ? ALL_BY_ID[referenceId] : null,
    // This inclination belongs to the stylized scene model, not a JPL ephemeris.
    modelInclinationDegrees: body.inclination * 180 / Math.PI
  };
}

export function diameterRatio(leftId, rightId) {
  const left = COMPARISON_FACTS[leftId]?.diameterKm;
  const right = COMPARISON_FACTS[rightId]?.diameterKm;
  if (!(left > 0) || !(right > 0)) return null;
  return { left, right, ratio: left / right };
}
