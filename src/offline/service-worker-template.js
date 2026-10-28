// Generated at build time. This worker is registered only after an explicit
// opt-in. The shell is precached; planetary textures are cached as they are used.
const BASE_URL = '__COSMOS_BASE__';
const VERSION = '__COSMOS_VERSION__';
const SHELL_PATHS = /* __COSMOS_SHELL__ */ [];
const SHELL_CACHE = 'cosmos-atlas-shell-' + VERSION;
const TEXTURE_CACHE = 'cosmos-atlas-textures-' + VERSION;
const CACHE_PREFIX = 'cosmos-atlas-';
const MAX_TEXTURE_ENTRIES = 12;
const MAX_TEXTURE_BYTES = 8 * 1024 * 1024;
const shellURLs = SHELL_PATHS.map(path => new URL(path, self.location.origin + BASE_URL).href);
const shellURLSet = new Set(shellURLs);
const indexURL = new URL('index.html', self.location.origin + BASE_URL).href;
let cachingEnabled = true;

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // An installation only becomes active once every required app asset
    // is available, so offline navigation cannot get a partial JS bundle.
    await cache.addAll(shellURLs.map(url => new Request(url, { cache: 'reload' })));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name =>
      name.startsWith(CACHE_PREFIX) && name !== SHELL_CACHE && name !== TEXTURE_CACHE
    ).map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

async function trimTextures(cache) {
  const entries = await cache.keys();
  const sizes = [];
  let total = 0;
  for (const request of entries) {
    const response = await cache.match(request);
    if (!response) continue;
    const bytes = (await response.blob()).size;
    sizes.push({ request, bytes });
    total += bytes;
  }
  while (sizes.length > MAX_TEXTURE_ENTRIES || total > MAX_TEXTURE_BYTES) {
    const oldest = sizes.shift();
    total -= oldest.bytes;
    await cache.delete(oldest.request);
  }
}

async function storeTexture(request, response) {
  if (!cachingEnabled || response.type === 'opaque' || !response.ok) return;
  const size = (await response.clone().blob()).size;
  if (size > MAX_TEXTURE_BYTES || !cachingEnabled) return;
  const cache = await caches.open(TEXTURE_CACHE);
  await cache.put(request, response);
  await trimTextures(cache);
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (!cachingEnabled || request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(BASE_URL)) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        return await fetch(request); // Preserve live navigation and deep links.
      } catch {
        const cached = await caches.match(indexURL);
        return cached || Response.error();
      }
    })());
    return;
  }

  if (shellURLSet.has(url.href)) {
    event.respondWith((async () => {
      const cache = await caches.open(SHELL_CACHE);
      return (await cache.match(request, { ignoreSearch: true })) || fetch(request);
    })());
    return;
  }

  const relative = url.pathname.slice(BASE_URL.length);
  if (/^textures\/.+\.(?:jpg|jpeg|ktx2)$/i.test(relative)) {
    event.respondWith((async () => {
      const cache = await caches.open(TEXTURE_CACHE);
      const saved = await cache.match(request);
      if (saved) return saved;
      try {
        const response = await fetch(request);
        if (response.ok) event.waitUntil(storeTexture(request, response.clone()));
        return response;
      } catch {
        return new Response('Texture unavailable offline', {
          status: 503, statusText: 'Offline'
        });
      }
    })());
  }
});

self.addEventListener('message', event => {
  if (event.data?.type === 'COSMOS_DISABLE') cachingEnabled = false;
  if (event.data?.type === 'COSMOS_CLEAR_TEXTURES') {
    event.waitUntil((async () => {
      await caches.delete(TEXTURE_CACHE);
      event.ports[0]?.postMessage({ type: 'COSMOS_CLEARED' });
    })());
  }
});
