// T23: opt-in offline shell, visited-texture cache, and explicit cleanup.
const PREFERENCE_KEY = 'cosmos-atlas-offline-v1';
const CACHE_PREFIX = 'cosmos-atlas-';
const TEXTURE_PREFIX = 'cosmos-atlas-textures-';
const get = id => document.getElementById(id);

function readPreference() {
  try { return localStorage.getItem(PREFERENCE_KEY) === 'enabled'; }
  catch { return false; }
}

function savePreference(enabled) {
  try {
    if (enabled) localStorage.setItem(PREFERENCE_KEY, 'enabled');
    else localStorage.removeItem(PREFERENCE_KEY);
    return true;
  } catch {
    return false; // Browsers may block storage; session controls still work.
  }
}

export function createOfflineManager({ toast = () => {} } = {}) {
  const toggle = get('offline-toggle');
  const clearButton = get('offline-clear-textures');
  const status = get('offline-status');
  const scope = import.meta.env.BASE_URL;
  const supported = import.meta.env.PROD && window.isSecureContext &&
    'serviceWorker' in navigator && 'caches' in window;
  let enabled = false;
  let busy = false;

  function render(message) {
    toggle.classList.toggle('is-on', enabled);
    toggle.setAttribute('aria-pressed', String(enabled));
    toggle.disabled = busy || !supported;
    clearButton.disabled = busy || !enabled || !supported;
    if (message) status.textContent = message;
  }

  async function clearCaches(prefix = CACHE_PREFIX) {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith(prefix))
      .map(name => caches.delete(name)));
  }

  async function enable() {
    if (!supported || busy) return;
    busy = true;
    render('正在准备离线页面资源…');
    try {
      const existing = await navigator.serviceWorker.getRegistration(scope);
      const registration = existing?.active ? existing :
        await navigator.serviceWorker.register(scope + 'service-worker.js', {
          scope, updateViaCache: 'none'
        });
      // The install precaches the entire shell before it becomes active.
      await navigator.serviceWorker.ready;
      if (!registration.active) throw new Error('Offline worker is not active');
      enabled = true;
      const persisted = savePreference(true);
      render(persisted
        ? '基础页面已缓存；访问的贴图最多保留 12 张、合计约 8 MB。'
        : '基础页面已缓存；浏览器禁止保存偏好，下次访问需重新开启。');
      toast('离线浏览已开启，基础页面可以离线访问');
    } catch (error) {
      console.warn('Offline setup failed:', error);
      enabled = false;
      render('离线缓存准备失败，请联网后重试');
      toast('无法启用离线浏览，请检查浏览器设置和网络');
    } finally {
      busy = false;
      render();
    }
  }

  async function disable() {
    if (busy) return;
    busy = true;
    render('正在关闭离线浏览并清理缓存…');
    try {
      navigator.serviceWorker.controller?.postMessage({ type: 'COSMOS_DISABLE' });
      const registration = await navigator.serviceWorker.getRegistration(scope);
      if (registration) await registration.unregister();
      await clearCaches();
      enabled = false;
      savePreference(false);
      render('已关闭并清除离线资源；当前页面关闭后退出离线控制。');
      toast('离线浏览已关闭，缓存已清理');
    } catch (error) {
      console.warn('Offline cleanup failed:', error);
      render('部分离线缓存清理失败，可重试关闭操作');
      toast('清理离线数据失败，请重试');
    } finally {
      busy = false;
      render();
    }
  }

  toggle.addEventListener('click', () => {
    if (enabled) void disable();
    else void enable();
  });

  clearButton.addEventListener('click', async () => {
    if (!enabled || busy) return;
    busy = true;
    render('正在清理此前访问过的贴图…');
    try {
      await clearCaches(TEXTURE_PREFIX);
      render('已清理贴图缓存；基础页面仍可离线访问。');
      toast('离线贴图缓存已清理');
    } catch (error) {
      console.warn('Offline texture cleanup failed:', error);
      render('贴图缓存清理失败，请重试');
    } finally {
      busy = false;
      render();
    }
  });

  if (!supported) {
    render(import.meta.env.DEV
      ? '离线浏览可在生产预览或正式站点中开启'
      : '当前环境无法使用离线浏览，请使用安全连接的现代浏览器');
  } else {
    render('默认关闭；开启后缓存页面基础文件，贴图按访问保存。');
    // Restore an explicit prior choice. This also checks for a new worker
    // version on ordinary online visits.
    if (readPreference()) void enable();
  }

  return { isEnabled: () => enabled };
}
