// T30 static OpenNGC / NASA classroom catalog. Sky directions are true J2000
// directions; render positions are uniformly projected onto a virtual sphere.
// Distance estimates are only shown in text, never used as scene depth.
import { gaiaIcrsDirection } from './gaiaCatalog.js';

const MANIFEST = 'cosmos-deepsky-v1';
const OBJECTS = 'cosmos-deepsky-objects-v1';
const ROUTES = 'cosmos-deepsky-routes-v1';
export const DEEP_SKY_RADIUS = 160;
export const DEEP_SKY_CATEGORIES = ['nebula', 'cluster', 'galaxy'];
let cached = null;

export function createDeepSkyCatalog(manifest, objectPayload, routePayload) {
  if (!manifest || manifest.schema !== MANIFEST ||
    manifest.coordinateFrame !== 'ICRS J2000.0' ||
    manifest.source?.license !== 'CC BY-SA 4.0' ||
    !Array.isArray(manifest.files) ||
    objectPayload?.schema !== OBJECTS || !Array.isArray(objectPayload.objects) ||
    routePayload?.schema !== ROUTES || !Array.isArray(routePayload.routes)) {
    throw Error('T30 深空目录文件版本或引用坐标系错误');
  }
  const objects = [];
  const byId = new Map();
  for (const original of objectPayload.objects) {
    const { id, catalogId, category, position, distance, sources, imagery } = original;
    if (!/^M(?:[1-9]\d{0,2})$/.test(id) ||
      !/^(?:NGC|IC)\d{4}$/.test(catalogId) ||
      !DEEP_SKY_CATEGORIES.includes(category) || byId.has(id) ||
      !position || position.frame !== 'ICRS J2000.0' ||
      !distance || !(distance.approximateLightYears > 0) ||
      !distance.url?.startsWith('https://science.nasa.gov/') ||
      !sources?.catalogUrl?.startsWith('https://github.com/mattiaverga/') ||
      imagery?.isObservedImage !== false ||
      imagery?.display !== 'symbolic-marker') {
      throw Error('T30 深空对象结构或来源错误：' + String(id));
    }
    const dir = gaiaIcrsDirection(position.raDeg, position.decDeg);
    if (!dir || !dir.every(Number.isFinite)) {
      throw Error('T30 深空对象 J2000 方位无效：' + id);
    }
    const source = Object.freeze({
      ...original,
      // A virtual direction marker; this radius contains NO physical distance.
      skyDirection: Object.freeze(dir),
      markerPosition: Object.freeze(dir.map(n => n * DEEP_SKY_RADIUS))
    });
    byId.set(id, source);
    objects.push(source);
  }
  if (objects.length !== manifest.objectCount || objects.length < 12) {
    throw Error('T30 深空目录数量不一致');
  }
  const routes = routePayload.routes.map(route => {
    if (!/^[a-z-]+$/.test(route.id) ||
      !Array.isArray(route.steps) || route.steps.length < 3) {
      throw Error('T30 主题路线格式无效：' + route.id);
    }
    for (const step of route.steps) {
      if (!byId.has(step.objectId) || !step.title || !step.prompt) {
        throw Error('T30 主题路线关联天体错误：' + step.objectId);
      }
    }
    return Object.freeze(route);
  });
  if (routes.length !== manifest.routeCount || routes.length < 3 ||
    new Set(routes.map(route => route.id)).size !== routes.length) {
    throw Error('T30 深空路线数量或 ID 错误');
  }

  function search(query = '', { category = 'all', limit = 30 } = {}) {
    const term = String(query).trim().toLowerCase().replace(/\s+/g, '');
    return objects.filter(object =>
      (category === 'all' || object.category === category) &&
      (!term || [object.id, object.catalogId, object.nameZh,
        object.nameEn, object.subtype, object.constellationCode,
        ...(object.aliases || [])].some(value =>
        String(value).toLowerCase().replace(/\s+/g, '').includes(term)))
    ).slice(0, limit);
  }
  return Object.freeze({
    manifest,
    objects: Object.freeze(objects),
    routes: Object.freeze(routes),
    get: id => byId.get(id) ?? null,
    getRoute: id => routes.find(route => route.id === id) ?? null,
    search
  });
}

export async function loadDeepSkyCatalog({
  fetcher = globalThis.fetch,
  baseUrl = import.meta.env?.BASE_URL || '/'
} = {}) {
  if (cached) return cached;
  const pending = (async () => {
    const root = new URL('data/science/deep-sky/v1/',
      new URL(baseUrl, globalThis.location?.origin || 'http://localhost/'));
    async function read(name) {
      if (!['manifest.json', 'objects.json', 'routes.json'].includes(name)) {
        throw Error('T30 不合法的资源路径');
      }
      const response = await fetcher(new URL(name, root).href, { cache: 'force-cache' });
      if (!response.ok) throw Error('T30 资源 ' + name + ' HTTP ' + response.status);
      return response.json();
    }
    const manifest = await read('manifest.json');
    const [objects, routes] = await Promise.all([
      read('objects.json'), read('routes.json')
    ]);
    return createDeepSkyCatalog(manifest, objects, routes);
  })();
  cached = pending.catch(error => {
    cached = null;
    throw error;
  });
  return cached;
}
