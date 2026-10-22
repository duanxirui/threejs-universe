import { UniverseApp } from './core/UniverseApp.js';
import { createLayoutController } from './ui/layoutController.js';
import { createFlightDropdowns } from './ui/flightDropdown.js';
import {
  CELESTIALS, ALL_BODIES, ALL_BY_ID, SATELLITES_BY_PARENT,
  COMPARISON_FACTS, formatMassKg, getOrbitReferenceId
} from './data/celestials.js';

const get = id => document.getElementById(id);
const elements = {
  hero: get('hero-panel'),
  eyebrow: get('hero-eyebrow'),
  heroTitle: get('hero-title'),
  heroDescription: get('hero-description'),
  primary: get('primary-action'),
  secondary: get('secondary-action'),
  metricALabel: get('metric-a-label'),
  metricAValue: get('metric-a-value'),
  metricBLabel: get('metric-b-label'),
  metricBValue: get('metric-b-value'),
  bottomInterface: document.querySelector('.bottom-interface'),
  detail: get('detail-panel'),
  detailClose: get('detail-close'),
  detailSummary: get('detail-sheet-summary'),
  detailOrb: get('detail-orb'),
  detailMoons: get('detail-moons'),
  detailMoonList: get('detail-moon-list'),
  detailParent: get('detail-parent'),
  sheetHandle: get('detail-sheet-handle'),
  playPause: get('play-pause'),
  speed: get('speed-range'),
  speedValue: get('speed-value'),
  qualitySelect: get('quality-select'),
  flightSpeed: get('flight-speed'),
  resetView: get('reset-view'),
  flightSpeedControl: get('flight-speed-control'),
  flightQuickStop: get('flight-quick-stop'),
  freeFlightDock: get('free-flight-dock'),
  freeTargetSelect: get('free-target-select'),
  freeFlightGo: get('free-flight-go'),
  freeFlightUnlock: get('free-flight-unlock'),
  freeFlightStatus: get('free-flight-status'),
  dockHeading: get('dock-heading'),
  dockSubtitle: get('dock-subtitle'),
  dockHint: get('dock-hint'),
  searchFootnote: get('search-footnote'),
  mobileQuality: get('mobile-quality-select'),
  mobileMenu: get('mobile-menu'),
  mobileMenuTrigger: get('mobile-menu-trigger'),
  dockToggle: get('planet-dock-toggle'),
  summaryName: get('detail-summary-name'),
  summaryStat: get('detail-summary-stat'),
  orbitToggle: get('orbit-toggle'),
  labelToggle: get('label-toggle'),
  searchOverlay: get('search-overlay'),
  searchInput: get('search-input'),
  searchResults: get('search-results'),
  helpOverlay: get('help-overlay'),
  compareOverlay: get('compare-overlay'),
  compareLeft: get('compare-left'),
  compareRight: get('compare-right'),
  compareTable: get('compare-table'),
  compareReferenceNote: get('compare-reference-note'),
  searchResultCount: get('search-result-count'),
  sceneAnnouncement: get('scene-announcement'),
  planetDock: get('planet-dock'),
  contextRecovery: get('webgl-context-recovery'),
  contextReload: get('webgl-reload'),
  toast: get('toast')
};

const heroCopy = {
  galaxy: {
    eyebrow: 'AN INFINITE JOURNEY',
    title: '宇宙，不止<br /><em>于仰望。</em>',
    description: '从亿万星辰汇成的银河，到太阳系里每一颗独特的行星。现在，开启属于你的星际旅程。',
    primary: '进入太阳系',
    secondary: '聚焦地球',
    metrics: ['银河直径', '约 10 万光年', '恒星数量', '约 1000–4000 亿']
  },
  solar: {
    eyebrow: 'OUR CELESTIAL NEIGHBORHOOD',
    title: '一颗恒星，<br /><em>八颗行星。</em>',
    description: '沿着椭圆轨道从水星抵达海王星，继续走近月球、木卫二，以及土星的土卫二与土卫六。每一个世界，都有自己的故事。',
    primary: '探索地球',
    secondary: '返回银河系',
    metrics: ['太阳系年龄', '约 46 亿年', '探索天体',
      (CELESTIALS.length - 1) + ' 行星 · ' + (ALL_BODIES.length - CELESTIALS.length) + ' 卫星']
  },
  free: {
    eyebrow: 'YOU ARE THE EXPLORER',
    title: '你的航线，<br /><em>由你决定。</em>',
    description: '在航行导航中选择目标，点击“飞往目标”即可自动接近、减速并安全停靠；也可以使用 W A S D、空格与 Shift 自由飞行。',
    primary: '探索木星',
    secondary: '返回太阳系',
    metrics: ['导航模式', '自由漫游', '飞行控制', 'W / A / S / D']
  }
};

let universe;
let layoutController;
let flightDropdowns;
let currentState = { mode: 'galaxy' };
let toastTimer;
const SPEED_STEPS = [0, .25, 1, 3, 10, 25, 50];
let sheetState = 'half';
let savedDetailScroll = 0;
let dockOpen = false;
let layoutFrame = 0;
let dialogReturnFocus = null;
let dialogReturnDrawer = 'none';
let activeModalOverlay = null;
let contextReturnFocus = null;
const modalOverlays = [elements.searchOverlay, elements.helpOverlay, elements.compareOverlay];
const inertBeforeDialog = new Map();
const compactQuery = window.matchMedia('(max-width: 640px), (max-width: 900px) and (max-height: 480px)');
const isCompact = () => compactQuery.matches;
const usesNavigationMenu = () => window.matchMedia('(max-width: 900px)').matches;

function setBackgroundInert(activeSurface) {
  for (const child of get('app').children) {
    if (child === activeSurface) continue;
    if (!inertBeforeDialog.has(child)) inertBeforeDialog.set(child, child.inert);
    child.inert = true;
  }
}

function restoreBackgroundInert() {
  for (const [child, previous] of inertBeforeDialog) child.inert = previous;
  inertBeforeDialog.clear();
}

function getDialogFocusables(dialog) {
  return Array.from(dialog.querySelectorAll(
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), ' +
    'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  )).filter(element => !element.closest('[inert], [hidden]') &&
    element.getClientRects().length > 0);
}

function focusIfAvailable(element) {
  const target = element?.isConnected && !element.closest('[inert], [hidden]') &&
    element.getClientRects().length ? element :
      layoutController?.uiMode === 'pure' ? get('pure-mode-trigger') : get('search-trigger');
  if (target?.getClientRects().length) target.focus({ preventScroll: true });
  else {
    const fallback = layoutController?.uiMode === 'pure'
      ? get('pure-mode-trigger') : get('brand-home');
    fallback?.focus({ preventScroll: true });
  }
}

function syncFullscreen() {
  const full = document.fullscreenElement === get('app');
  get('app').dataset.fullscreen = String(full);
  const trigger = get('fullscreen-trigger');
  trigger.setAttribute('aria-pressed', String(full));
  trigger.setAttribute('aria-label', full ? '退出浏览器全屏' : '进入浏览器全屏');
  trigger.title = full ? '退出全屏 (F)' : '全屏显示 (F)';
  requestAnimationFrame(() => {
    universe?.handleResize?.();
    universe?.reframeFocusedBody();
    scheduleLayoutMeasure();
  });
}

function toggleFullscreen() {
  const app = get('app');
  if (document.fullscreenElement === app) {
    document.exitFullscreen().catch(() => showToast('退出全屏失败，请按 Esc 重试'));
  } else if (!document.fullscreenEnabled || typeof app.requestFullscreen !== 'function') {
    showToast('当前浏览器不支持网页全屏，可以使用纯净观赏模式');
  } else {
    app.requestFullscreen().catch(() => showToast('浏览器未能进入全屏，请检查全屏权限'));
  }
}

function measureMobileLayout() {
  layoutFrame = 0;
  if (!isCompact()) return;
  const viewport = window.visualViewport;
  const sideToolbar = get('app').dataset.layout === 't15' &&
    window.matchMedia('(max-height: 480px) and (max-width: 900px) and (orientation: landscape)').matches;
  const footerTop = sideToolbar ? window.innerHeight :
    elements.bottomInterface.getBoundingClientRect().top;
  const headerBottom = document.querySelector('.topbar').getBoundingClientRect().bottom;
  const app = get('app');
  app.style.setProperty('--visible-viewport-height', Math.floor(viewport?.height ?? window.innerHeight) + 'px');
  app.style.setProperty('--visible-viewport-top', Math.floor(viewport?.offsetTop ?? 0) + 'px');
  app.style.setProperty('--mobile-footer-height', Math.ceil(window.innerHeight - footerTop) + 'px');
  app.style.setProperty('--mobile-detail-limit', Math.max(92, Math.floor(footerTop - headerBottom - 16)) + 'px');
}

function scheduleLayoutMeasure() {
  if (!layoutFrame) layoutFrame = requestAnimationFrame(measureMobileLayout);
}

function setDockOpen(open) {
  const wasOpen = layoutController?.isObjectsOpen ?? dockOpen;
  if (layoutController) {
    if (open) layoutController.setDrawer(currentState.mode === 'free' ? 'flight' : 'objects');
    else if (wasOpen) layoutController.setDrawer('none');
    dockOpen = layoutController.isObjectsOpen;
  } else dockOpen = Boolean(open && isCompact());
  get('app').dataset.dock = dockOpen ? 'open' : 'closed';
  elements.dockToggle.setAttribute('aria-expanded', String(dockOpen));
  const dockName = currentState.mode === 'free' ? '航行导航' : '天体导航';
  elements.dockToggle.setAttribute('aria-label', (dockOpen ? '收起' : '展开') + dockName);
  if (layoutController) layoutController.sync();
  else {
    const detailVisible = currentState.mode === 'planet' && Boolean(currentState.focusId);
    elements.detail.inert = !detailVisible || dockOpen;
    elements.detail.setAttribute('aria-hidden', String(!detailVisible || dockOpen));
    elements.planetDock.inert = isCompact() && !dockOpen;
    elements.planetDock.setAttribute('aria-hidden', String(isCompact() && !dockOpen));
  }
  scheduleLayoutMeasure();
}

function setMobileMenuOpen(open) {
  const closingFocusedMenu = !open && !elements.mobileMenu.hidden &&
    elements.mobileMenu.contains(document.activeElement);
  if (open && layoutController?.activeDrawer !== 'none') layoutController.setDrawer('none');
  elements.mobileMenu.hidden = !open;
  elements.mobileMenuTrigger.setAttribute('aria-expanded', String(open));
  elements.mobileMenuTrigger.setAttribute('aria-label', open ? '关闭更多选项' : '打开更多选项');
  get('mobile-scene-trigger').setAttribute('aria-expanded', String(open));
  if (closingFocusedMenu) focusIfAvailable(usesNavigationMenu()
    ? get('mobile-scene-trigger') : elements.mobileMenuTrigger);
}

function setSheetState(next) {
  if (sheetState === next && get('app').dataset.sheet === next) return;
  // Capture the current scroll before any visible state change, but preserve
  // the saved value while the collapsed sheet hides its scrollable content.
  if (sheetState !== 'collapsed') savedDetailScroll = elements.detail.scrollTop;
  sheetState = next;
  if (layoutController) {
    if (next === 'collapsed' && layoutController.activeDrawer === 'detail') {
      layoutController.setDrawer('none');
    } else if (next !== 'collapsed' && currentState.mode === 'planet') {
      layoutController.setDrawer('detail');
    }
  }
  get('app').dataset.sheet = next;
  elements.sheetHandle.setAttribute('aria-expanded', String(next !== 'collapsed'));
  elements.detailSummary.setAttribute('aria-expanded', String(next !== 'collapsed'));
  elements.sheetHandle.setAttribute('aria-label',
    next === 'collapsed' ? '展开天体资料' : next === 'expanded' ? '收起天体资料' : '展开更多天体资料');
  scheduleLayoutMeasure();
  if (next !== 'collapsed') {
    requestAnimationFrame(() => { elements.detail.scrollTop = savedDetailScroll; });
  }
  requestAnimationFrame(() => universe?.reframeFocusedBody());
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => elements.toast.classList.remove('is-visible'), 3200);
}

function navigateToScene(destination) {
  if (universe.transitioning) {
    showToast('场景正在切换，请稍候');
    return;
  }
  setMobileMenuOpen(false);
  layoutController?.setDrawer('none');
  if (destination === 'galaxy') universe.viewGalaxy();
  else if (destination === 'solar') universe.viewSolar();
  else if (destination === 'free') universe.activateFree();
}

function focusBodyWhenReady(id) {
  if (universe.transitioning) {
    showToast('场景正在切换，请稍候，再选择天体');
    return false;
  }
  universe.focusBody(id);
  return true;
}

function createUiIcon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'ui-icon');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', '#ic-' + name);
  svg.append(use);
  return svg;
}

function createPlanetDock() {
  const list = get('planet-list');
  for (const body of CELESTIALS) {
    const button = document.createElement('button');
    button.className = 'planet-item';
    button.dataset.id = body.id;
    button.type = 'button';
    button.title = body.name + ' · ' + body.short;
    button.setAttribute('aria-label', '探索' + body.name);
    button.style.setProperty('--orb-a', body.accent);
    button.style.setProperty('--orb-b', body.secondary);

    const image = document.createElement('span');
    image.className = 'planet-thumbnail';
    image.setAttribute('aria-hidden', 'true');
    const name = document.createElement('span');
    name.className = 'planet-item-name';
    name.textContent = body.name;
    button.append(image, name);
    button.addEventListener('click', () => {
      if (currentState.mode === 'free') universe.setFreeTarget(body.id);
      else if (universe.transitioning) showToast('场景正在切换，请稍候');
      else {
        layoutController?.setDrawer('none');
        focusBodyWhenReady(body.id);
      }
    });
    list.appendChild(button);
  }
}

function createFreeFlightTargets() {
  const groups = new Map();
  for (const body of ALL_BODIES) {
    const groupId = body.parentId || 'primary';
    if (!groups.has(groupId)) {
      const group = document.createElement('optgroup');
      group.label = body.parentId ? ALL_BY_ID[body.parentId].name + '的卫星' : '太阳与行星';
      elements.freeTargetSelect.appendChild(group);
      groups.set(groupId, group);
    }
    const option = document.createElement('option');
    option.value = body.id;
    option.textContent = body.name;
    groups.get(groupId).appendChild(option);
  }
}

function updateDetail(id) {
  const body = ALL_BY_ID[id];
  if (!body) return;
  elements.detail.dataset.detailKind = 'planet';
  get('detail-scene-headline').hidden = true;
  get('detail-scene-extra').hidden = true;
  get('detail-scene-members').hidden = true;
  get('detail-scene-actions').hidden = true;
  for (const item of elements.detail.querySelectorAll('.detail-stats > div')) item.hidden = false;
  get('detail-diameter-label').textContent = '直径';
  get('detail-day-label').textContent = '自转周期';
  get('detail-year-label').textContent = '公转周期';
  get('detail-mass-label').textContent = '质量';
  elements.summaryName.textContent = body.name + ' · ' + body.en;
  elements.summaryStat.textContent = '直径 ' + body.diameter;
  elements.detailSummary.setAttribute('aria-label', '展开' + body.name + '介绍');
  get('detail-number').textContent = '/ ' + body.index;
  get('detail-category').textContent = body.category;
  get('detail-name').textContent = body.name;
  get('detail-en').textContent = body.en;
  get('detail-description').textContent = body.description;
  get('detail-distance-label').textContent = body.parentId ? '距' + ALL_BY_ID[body.parentId].name :
    id === 'sun' ? '日心距离' : '距太阳';
  get('detail-distance').textContent = body.distance;
  get('detail-diameter').textContent = body.diameter;
  get('detail-mass').textContent = formatMassKg(body.massKg);
  get('detail-day').textContent = body.day;
  get('detail-year').textContent = body.year;
  elements.detailOrb.style.setProperty('--orb-light', body.accent);
  elements.detailOrb.style.setProperty('--orb-dark', body.secondary);
  elements.detailOrb.classList.toggle('has-rings', id === 'saturn');
  elements.detailOrb.classList.toggle('is-sun', id === 'sun');

  const satellites = SATELLITES_BY_PARENT[id] || [];
  elements.detailMoons.hidden = satellites.length === 0;
  elements.detailMoonList.replaceChildren();
  for (const satellite of satellites) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'moon-chip';
    button.append(createUiIcon('orbit'), document.createTextNode(' ' + satellite.name));
    button.title = satellite.short;
    button.addEventListener('click', () => focusBodyWhenReady(satellite.id));
    elements.detailMoonList.appendChild(button);
  }
  elements.detailParent.hidden = !body.parentId;
  if (body.parentId) {
    get('detail-parent-label').textContent = '返回' + ALL_BY_ID[body.parentId].name;
    elements.detailParent.onclick = () => focusBodyWhenReady(body.parentId);
  }
}

// Reuse the existing planet detail card for every mode. Its previous sidebar
// copy is still the single source for scene headlines, descriptions and metrics.
function updateSceneDetail(state) {
  const mode = state.mode;
  const copy = heroCopy[mode] || heroCopy.solar;
  const target = mode === 'free' ? ALL_BY_ID[state.freeTargetId] : null;
  const satelliteCount = ALL_BODIES.length - CELESTIALS.length;
  const galaxy = mode === 'galaxy';
  const free = mode === 'free';
  const title = galaxy ? '银河系' : free ? '自由漫游' : '太阳系';
  const number = galaxy ? '01' : free ? '03' : '02';
  const facts = target ? [
    ['锁定目标', target.name],
    ['直径', target.diameter],
    ['质量', formatMassKg(target.massKg)],
    [target.parentId ? '距' + ALL_BY_ID[target.parentId].name : '距太阳', target.distance],
    ['自转周期', target.day]
  ] : galaxy ? [
    [copy.metrics[0], copy.metrics[1]],
    [copy.metrics[2], copy.metrics[3]],
    ['星系类型', '棒旋星系'],
    ['代表性行星系统', '太阳系']
  ] : free ? [
    [copy.metrics[0], copy.metrics[1]],
    [copy.metrics[2], copy.metrics[3]],
    ['可探索天体', ALL_BODIES.length + ' 个'],
    ['当前目标', '尚未锁定']
  ] : [
    [copy.metrics[0], copy.metrics[1]],
    ['中心恒星', '太阳'],
    ['行星数量', (CELESTIALS.length - 1) + ' 颗'],
    ['代表性卫星', satelliteCount + ' 颗'],
    ['天体总计', ALL_BODIES.length + ' 个']
  ];
  const membersTitle = target ? '当前航行目标 · ' + target.name :
    galaxy ? '银河系中的太阳系' : free ? '航行探索' : '太阳与八大行星';
  const members = target ? target.description :
    galaxy ? '太阳系是银河系中的行星系统，拥有一颗中心恒星、八大行星和众多天然卫星。' :
    free ? '可在天体列表中锁定太阳、行星或卫星，并近距离观察它们的特征。' :
    CELESTIALS.map(body => body.name).join(' · ');
  const extra = galaxy ?
    '银河系是太阳系所在的棒旋星系，由大量恒星、星际气体和尘埃构成。当前星系画面是科普示意，非精确三维星图。' :
    free ? '航行空间与目标距离已进行展示性缩放；已锁定目标后可在本页查看其物理参数。' :
    '太阳系约形成于 46 亿年前，行星绕太阳公转。本项目收录了多颗代表性卫星，可逐一探索。';
  elements.detail.dataset.detailKind = galaxy ? 'galaxy' : free ? 'free' : 'scene';
  get('detail-number').textContent = '/ ' + number;
  get('detail-category').textContent = copy.eyebrow;
  get('detail-name').textContent = title;
  get('detail-en').textContent = galaxy ? 'MILKY WAY' : free ? 'FREE EXPLORATION' : 'SOLAR SYSTEM';
  const headline = get('detail-scene-headline');
  headline.innerHTML = copy.title; // Trusted static copy previously shown on the left.
  headline.hidden = false;
  get('detail-description').textContent = copy.description;
  get('detail-scene-extra').textContent = extra;
  get('detail-scene-extra').hidden = false;
  get('detail-scene-members-title').textContent = membersTitle;
  get('detail-scene-members-text').textContent = members;
  get('detail-scene-members').hidden = false;
  elements.summaryName.textContent = title;
  elements.summaryStat.textContent = facts[0][1];
  get('detail-scene-primary').replaceChildren(document.createTextNode(copy.primary), createUiIcon('arrow-up-right'));
  get('detail-scene-secondary').replaceChildren(document.createTextNode(copy.secondary), createUiIcon('arrow-up-right'));
  get('detail-scene-actions').hidden = false;
  elements.detailOrb.style.setProperty('--orb-light', galaxy ? '#89b2dd' : free ? '#8ab8d8' : '#ffbf72');
  elements.detailOrb.style.setProperty('--orb-dark', galaxy ? '#1b2b55' : free ? '#1b3452' : '#ba612e');
  elements.detailOrb.classList.toggle('is-sun', !galaxy && !free);
  elements.detailOrb.classList.remove('has-rings');
  const statItems = Array.from(elements.detail.querySelectorAll('.detail-stats > div'));
  const statLabels = [
    get('detail-distance-label'), get('detail-diameter-label'),
    get('detail-day-label'), get('detail-year-label'), get('detail-mass-label')
  ];
  const statValues = [
    get('detail-distance'), get('detail-diameter'), get('detail-day'),
    get('detail-year'), get('detail-mass')
  ];
  for (let index = 0; index < statItems.length; index++) {
    const fact = facts[index];
    statItems[index].hidden = !fact;
    if (fact) {
      statLabels[index].textContent = fact[0];
      statValues[index].textContent = fact[1];
    }
  }
}

function updateInterface(state) {
  const previousMode = currentState.mode;
  const previousFocusId = currentState.focusId;
  const previousFreeTargetId = currentState.freeTargetId;
  currentState = state;
  get('app').dataset.view = state.mode;
  const showingDetail = state.mode === 'planet' && Boolean(state.focusId);
  const focusWasInHero = showingDetail && elements.hero.contains(document.activeElement);
  const focusWasInDetail = !showingDetail && layoutController?.activeDrawer !== 'detail' &&
    elements.detail.contains(document.activeElement);
  const focusWasInChangingDetail = showingDetail && previousFocusId !== state.focusId &&
    elements.detail.contains(document.activeElement);
  if (showingDetail && previousMode !== 'planet') setSheetState('collapsed');
  if (showingDetail && dockOpen) setDockOpen(false);
  elements.hero.classList.toggle('is-hidden', showingDetail);
  elements.hero.setAttribute('aria-hidden', 'true');
  const detailOpen = layoutController?.activeDrawer === 'detail';
  elements.detail.classList.toggle('is-visible', showingDetail || detailOpen);
  elements.detail.setAttribute('aria-hidden', String(!detailOpen));
  elements.hero.inert = true;
  elements.detail.inert = !detailOpen;
  if (focusWasInHero) {
    requestAnimationFrame(() => {
      const target = layoutController ? get('detail-peek-trigger') :
        (isCompact() ? elements.detailSummary : elements.detailClose);
      focusIfAvailable(target);
    });
  } else if (focusWasInDetail) {
    requestAnimationFrame(() => focusIfAvailable(usesNavigationMenu()
      ? get('mobile-scene-trigger') : get('brand-home')));
  }
  if (showingDetail) {
    if (previousMode !== 'planet' || previousFocusId !== state.focusId) {
      updateDetail(state.focusId);
    }
    if (previousFocusId !== state.focusId) {
      savedDetailScroll = 0;
      elements.detail.scrollTop = 0;
    }
  } else if (previousMode !== state.mode ||
      (state.mode === 'free' && previousFreeTargetId !== state.freeTargetId) ||
      !elements.detail.dataset.detailKind) {
    updateSceneDetail(state);
    elements.detail.scrollTop = 0;
  }
  if (focusWasInChangingDetail) {
    requestAnimationFrame(() => {
      if (currentState.focusId !== state.focusId || elements.detail.inert) return;
      const heading = get('detail-name');
      focusIfAvailable(heading.getClientRects().length ? heading : elements.detailSummary);
    });
  }
  if (previousMode !== state.mode || previousFocusId !== state.focusId) {
    const name = ALL_BY_ID[state.focusId]?.name;
    elements.sceneAnnouncement.textContent = name ? '已聚焦' + name + '，可以查看天体资料' :
      state.mode === 'galaxy' ? '当前场景：宇宙全景' :
      state.mode === 'free' ? '当前场景：自由漫游' : '当前场景：太阳系';
  }

  const displayMode = state.mode === 'planet' ? 'solar' : state.mode;
  const copy = heroCopy[displayMode] || heroCopy.galaxy;
  elements.eyebrow.textContent = copy.eyebrow;
  elements.heroTitle.innerHTML = copy.title;
  elements.heroDescription.textContent = copy.description;
  elements.primary.replaceChildren(document.createTextNode(copy.primary), createUiIcon('arrow-up-right'));
  elements.secondary.replaceChildren(document.createTextNode(copy.secondary), createUiIcon('arrow-up-right'));
  elements.metricALabel.textContent = copy.metrics[0];
  elements.metricAValue.textContent = copy.metrics[1];
  elements.metricBLabel.textContent = copy.metrics[2];
  elements.metricBValue.textContent = copy.metrics[3];

  document.querySelectorAll('.view-link[data-view]').forEach(button => {
    const active = button.dataset.view === displayMode;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-current', active ? 'page' : 'false');
  });
  document.querySelectorAll('.mobile-view-link[data-view]').forEach(button => {
    const active = button.dataset.view === displayMode;
    button.setAttribute('aria-current', active ? 'page' : 'false');
  });
  document.querySelectorAll('.planet-item').forEach(button => {
    button.classList.toggle('is-selected', button.dataset.id === state.focusId);
    button.setAttribute('aria-pressed', String(button.dataset.id === state.focusId));
  });

  elements.playPause.querySelector('use').setAttribute('href', state.paused ? '#ic-play' : '#ic-pause');
  elements.playPause.setAttribute('aria-label', state.paused ? '继续天体运动' : '暂停天体运动');
  const speedStep = SPEED_STEPS.reduce((best, speed, index) =>
    Math.abs(speed - state.timeScale) < Math.abs(SPEED_STEPS[best] - state.timeScale) ? index : best, 0);
  elements.speed.value = String(speedStep);
  elements.speed.style.setProperty('--fill', speedStep / 6 * 100 + '%');
  elements.speedValue.textContent = (Number.isInteger(state.timeScale) ? state.timeScale.toFixed(0) : state.timeScale.toFixed(2).replace(/0$/, '')) + '×';
  get('capsule-speed').textContent = elements.speedValue.textContent;
  get('time-open-trigger').setAttribute('aria-label',
    '天体运动控制，当前 ' + elements.speedValue.textContent +
    (state.paused ? '，已暂停' : '，运行中'));
  elements.qualitySelect.value = state.qualityMode;
  elements.mobileQuality.value = state.qualityMode;
  elements.flightSpeed.value = String(state.flightSpeed);
  const freeMode = state.mode === 'free';
  elements.flightSpeedControl.hidden = !freeMode;
  elements.freeFlightDock.hidden = !freeMode;
  elements.dockHeading.textContent = freeMode ? 'FLIGHT NAVIGATION' : 'SOLAR SYSTEM';
  elements.dockSubtitle.textContent = freeMode ? '航行目标' : '天体导航';
  elements.dockHint.hidden = freeMode;
  get('dock-toggle-label').textContent = freeMode ? '航行导航' : '天体列表';
  elements.dockToggle.setAttribute('aria-label',
    (dockOpen ? '收起' : '展开') + (freeMode ? '航行导航' : '天体导航'));
  elements.freeTargetSelect.value = state.freeTargetId || '';
  elements.freeFlightGo.disabled = !state.freeTargetId || state.freeArrived;
  get('free-flight-go-label').textContent = state.freeAutopilot ? '停止航行' : state.freeArrived ? '已抵达' : '飞往目标';
  elements.freeFlightGo.querySelector('use').setAttribute('href',
    state.freeAutopilot ? '#ic-stop' : '#ic-navigation');
  elements.freeFlightUnlock.disabled = !state.freeTargetId;
  elements.flightQuickStop.hidden = !freeMode || !state.freeAutopilot;
  const targetName = ALL_BY_ID[state.freeTargetId]?.name;
  elements.freeFlightStatus.textContent = !targetName ? '选择一个天体作为航行目标' :
    targetName + ' · ' + (state.freeAutopilot ? '自动接近中' : state.freeArrived ? '安全抵达，持续跟随' : '已锁定');

  for (const [element, isOn] of [[elements.orbitToggle, state.showOrbits], [elements.labelToggle, state.showLabels]]) {
    element.classList.toggle('is-on', isOn);
    element.setAttribute('aria-pressed', String(isOn));
  }
  elements.orbitToggle.setAttribute('aria-label', state.showOrbits ? '隐藏轨道线' : '显示轨道线');
  elements.labelToggle.setAttribute('aria-label', state.showLabels ? '隐藏天体标签' : '显示天体标签');
  const infoTargetId = state.mode === 'free' ? state.freeTargetId : state.focusId;
  layoutController?.setScene(state.mode, state.focusId,
    ALL_BY_ID[infoTargetId]?.name, ALL_BY_ID[infoTargetId]?.index);
  if (layoutController) {
    dockOpen = layoutController.isObjectsOpen;
    layoutController.sync();
  }
  flightDropdowns?.sync();
  if (previousMode !== state.mode || previousFocusId !== state.focusId) scheduleLayoutMeasure();
}

function openModal(name) {
  if (!elements.contextRecovery.hidden) return;
  if (activeModalOverlay) closeModals();
  dialogReturnFocus = elements.mobileMenu.contains(document.activeElement)
    ? (usesNavigationMenu() ? get('mobile-scene-trigger') : elements.mobileMenuTrigger) : document.activeElement;
  dialogReturnDrawer = layoutController?.activeDrawer || 'none';
  setMobileMenuOpen(false);
  layoutController?.setDrawer('none', { restoreFocus: false });
  setDockOpen(false);
  const overlay = name === 'search' ? elements.searchOverlay :
    name === 'compare' ? elements.compareOverlay : elements.helpOverlay;
  activeModalOverlay = overlay;
  overlay.inert = false;
  overlay.classList.add('is-open');
  overlay.setAttribute('aria-hidden', 'false');
  setBackgroundInert(overlay);
  get('mobile-intro').textContent = (heroCopy[currentState.mode === 'planet' ? 'solar' : currentState.mode] || heroCopy.galaxy).description;
  if (name === 'search') {
    elements.searchInput.value = '';
    get('search-footnote-copy').textContent = currentState.mode === 'free'
      ? '选择天体会锁定航行目标；之后在航行导航中点击“飞往目标”。'
      : '选择天体后，镜头会自动飞往目标。';
    renderSearchResults('');
  }
  if (name === 'compare') {
    const focus = currentState.focusId || 'earth';
    elements.compareLeft.value = focus;
    elements.compareRight.value = focus === 'mars' ? 'jupiter' : 'mars';
    renderComparison();
  }
  requestAnimationFrame(() => {
    if (activeModalOverlay !== overlay) return;
    const preferred = name === 'search' ? elements.searchInput :
      name === 'compare' ? elements.compareLeft : get('help-close');
    (preferred || overlay.querySelector('[role="dialog"]')).focus();
  });
}

function closeModals() {
  if (!activeModalOverlay) return;
  for (const overlay of modalOverlays) {
    overlay.classList.remove('is-open');
    overlay.setAttribute('aria-hidden', 'true');
    overlay.inert = true;
  }
  activeModalOverlay = null;
  restoreBackgroundInert();
  if (dialogReturnDrawer !== 'none' && layoutController?.uiMode !== 'pure') {
    layoutController?.setDrawer(dialogReturnDrawer, { restoreFocus: false });
  }
  dialogReturnDrawer = 'none';
  focusIfAvailable(dialogReturnFocus || get('search-trigger'));
  dialogReturnFocus = null;
}

function updateWebGLStatus(state) {
  if (state === 'lost') {
    if (!elements.contextRecovery.hidden) return;
    contextReturnFocus = activeModalOverlay ? dialogReturnFocus : document.activeElement;
    if (activeModalOverlay) closeModals();
    elements.contextRecovery.hidden = false;
    elements.contextRecovery.inert = false;
    get('webgl-recovery-description').textContent =
      '图形设备连接已中断，正在等待浏览器恢复。无法自动恢复时，可以重新加载场景。';
    setBackgroundInert(elements.contextRecovery);
    elements.contextReload.focus({ preventScroll: true });
  } else if (state === 'failed') {
    if (elements.contextRecovery.hidden) updateWebGLStatus('lost');
    get('webgl-recovery-description').textContent =
      '浏览器未能恢复 3D 渲染。请点击“重新加载场景”；若问题持续，请检查浏览器硬件加速。';
  } else if (state === 'restored' && !elements.contextRecovery.hidden) {
    elements.contextRecovery.hidden = true;
    restoreBackgroundInert();
    focusIfAvailable(contextReturnFocus);
    contextReturnFocus = null;
    showToast('3D 图形渲染已恢复');
  }
}

function setupComparison() {
  for (const select of [elements.compareLeft, elements.compareRight]) {
    for (const body of ALL_BODIES) {
      const option = document.createElement('option');
      option.value = body.id;
      option.textContent = body.name + (body.parentId ? ' · ' + ALL_BY_ID[body.parentId].name + '卫星' : '');
      select.appendChild(option);
    }
    select.addEventListener('change', renderComparison);
  }
}

function formatComparisonNumber(value, significantDigits = 4) {
  if (!Number.isFinite(value)) return '—';
  return Number(value.toPrecision(significantDigits)).toLocaleString('zh-CN', {
    maximumFractionDigits: 2
  });
}

function formatComparisonDistance(body) {
  const referenceId = getOrbitReferenceId(body);
  if (!referenceId) return '不适用（中心天体）';
  const distance = COMPARISON_FACTS[body.id]?.distanceKm;
  if (!Number.isFinite(distance)) return '—';
  return '距' + ALL_BY_ID[referenceId].name + ' ≈ ' +
    formatComparisonNumber(distance);
}

function updateComparisonReferenceNote(left, right) {
  const leftRef = getOrbitReferenceId(left);
  const rightRef = getOrbitReferenceId(right);
  if (!leftRef || !rightRef) {
    elements.compareReferenceNote.textContent =
      '太阳是中心天体，不适用绕太阳公转的轨道距离或公转周期；其他天体按各自中心计算。';
  } else if (leftRef !== rightRef) {
    elements.compareReferenceNote.textContent =
      '参考中心不同：' + left.name + '距' + ALL_BY_ID[leftRef].name +
      '，' + right.name + '距' + ALL_BY_ID[rightRef].name +
      '。这两个轨道距离不能解释为两天体之间的距离。';
  } else {
    elements.compareReferenceNote.textContent =
      '两者均以' + ALL_BY_ID[leftRef].name +
      '为参考中心；表中为各自的近似平均轨道距离，并非两天体之间的距离。';
  }
}

function renderComparison() {
  const left = ALL_BY_ID[elements.compareLeft.value];
  const right = ALL_BY_ID[elements.compareRight.value];
  if (!left || !right) return;
  const leftFacts = COMPARISON_FACTS[left.id];
  const rightFacts = COMPARISON_FACTS[right.id];
  const rows = [
    ['类型', left.type, right.type],
    ['直径（km）',
      formatComparisonNumber(leftFacts?.diameterKm, 8),
      formatComparisonNumber(rightFacts?.diameterKm, 8)],
    ['质量', formatMassKg(left.massKg), formatMassKg(right.massKg)],
    ['平均轨道距离（km）', formatComparisonDistance(left), formatComparisonDistance(right)],
    ['自转周期（小时）',
      formatComparisonNumber(leftFacts?.rotationHours),
      formatComparisonNumber(rightFacts?.rotationHours)],
    ['公转周期（天）',
      left.id === 'sun' ? '不适用' : formatComparisonNumber(leftFacts?.orbitalPeriodDays),
      right.id === 'sun' ? '不适用' : formatComparisonNumber(rightFacts?.orbitalPeriodDays)],
    ['特征', left.short, right.short]
  ];
  updateComparisonReferenceNote(left, right);
  const header = document.createElement('div');
  header.className = 'compare-row compare-header';
  header.setAttribute('role', 'row');
  for (const heading of ['参数', left.name, right.name]) {
    const cell = document.createElement('span');
    cell.setAttribute('role', 'columnheader');
    cell.textContent = heading;
    header.appendChild(cell);
  }
  elements.compareTable.replaceChildren(header);
  for (const [label, a, b] of rows) {
    const row = document.createElement('div');
    row.className = 'compare-row';
    row.setAttribute('role', 'row');
    for (const [value, className] of [[label, 'compare-key'], [a, 'compare-value'], [b, 'compare-value']]) {
      const cell = document.createElement('span');
      cell.className = className;
      cell.setAttribute('role', className === 'compare-key' ? 'rowheader' : 'cell');
      cell.textContent = value;
      row.appendChild(cell);
    }
    elements.compareTable.appendChild(row);
  }
}

function renderSearchResults(query) {
  const normalized = query.trim().toLowerCase();
  const items = ALL_BODIES.filter(body =>
    !normalized ||
    body.name.includes(normalized) ||
    body.en.toLowerCase().includes(normalized) ||
    body.type.includes(normalized) ||
    body.short.includes(normalized)
  );
  elements.searchResultCount.textContent = '找到 ' + items.length + ' 个天体';
  get('search-visible-count').textContent = normalized
    ? items.length + ' 个结果' : '全部 ' + items.length + ' 个';
  elements.searchResults.replaceChildren();
  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'search-empty';
    empty.append(createUiIcon('search'));
    const copy = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = '暂未找到对应天体';
    const hint = document.createElement('span');
    hint.textContent = '换一个名称或特征再试试';
    copy.append(title, hint);
    empty.append(copy);
    elements.searchResults.appendChild(empty);
    return;
  }
  const groups = new Map();
  for (const body of items) {
    const parentId = body.parentId || 'primary';
    if (!groups.has(parentId)) {
      const section = document.createElement('section');
      section.className = 'search-result-group';
      const heading = document.createElement('div');
      heading.className = 'search-result-group-title';
      heading.textContent = body.parentId ? ALL_BY_ID[body.parentId].name + '的卫星' : '太阳与行星';
      const list = document.createElement('div');
      list.className = 'search-result-group-list';
      section.append(heading, list);
      elements.searchResults.append(section);
      groups.set(parentId, list);
    }
    const button = document.createElement('button');
    button.className = 'search-result';
    button.type = 'button';
    button.setAttribute('aria-label', (currentState.mode === 'free' ? '锁定' : '探索') + body.name);
    const dot = document.createElement('span');
    dot.className = 'result-dot';
    dot.style.setProperty('--orb-a', body.accent);
    dot.style.setProperty('--orb-b', body.secondary);
    const details = document.createElement('span');
    details.className = 'search-result-copy';
    const name = document.createElement('strong');
    name.textContent = body.name;
    const subtitle = document.createElement('span');
    subtitle.textContent = body.short;
    const latin = document.createElement('small');
    latin.textContent = body.parentId ? ALL_BY_ID[body.parentId].name + '的卫星' : body.en;
    details.append(name, subtitle);
    const go = createUiIcon('chevron-right');
    go.classList.add('search-result-arrow');
    button.append(dot, details, latin, go);
    button.addEventListener('click', () => {
      if (universe.transitioning) {
        showToast('场景正在切换，请稍候');
        return;
      }
      closeModals();
      if (currentState.mode === 'free') universe.setFreeTarget(body.id);
      else focusBodyWhenReady(body.id);
    });
    groups.get(parentId).appendChild(button);
  }
}

function bindInterface() {
  get('pure-mode-trigger').addEventListener('click', () => {
    layoutController?.setUiMode(layoutController.uiMode === 'pure' ? 'compact' : 'pure');
    focusIfAvailable(get('pure-mode-trigger'));
  });
  get('fullscreen-trigger').addEventListener('click', toggleFullscreen);
  document.addEventListener('fullscreenchange', syncFullscreen);
  document.addEventListener('fullscreenerror', () => showToast('当前浏览器无法切换全屏'));
  get('mobile-scene-trigger').addEventListener('click', () => {
    setMobileMenuOpen(elements.mobileMenu.hidden);
  });
  elements.mobileMenuTrigger.addEventListener('click', () => {
    setDockOpen(false);
    setMobileMenuOpen(elements.mobileMenu.hidden);
  });
  get('mobile-help-trigger').addEventListener('click', () => openModal('help'));
  document.querySelectorAll('.mobile-view-link[data-view]').forEach(button => {
    button.addEventListener('click', () => navigateToScene(button.dataset.view));
  });
  elements.mobileQuality.addEventListener('change', event => universe.setQuality(event.target.value));
  elements.dockToggle.addEventListener('click', () => {
    setMobileMenuOpen(false);
    setDockOpen(!dockOpen);
  });
  elements.detailSummary.addEventListener('click', () => {
    setSheetState('half');
    elements.detailClose.focus({ preventScroll: true });
  });
  document.addEventListener('pointerdown', event => {
    if (!elements.mobileMenu.hidden &&
      !elements.mobileMenu.contains(event.target) && !elements.mobileMenuTrigger.contains(event.target) &&
      !get('mobile-scene-trigger').contains(event.target)) {
      setMobileMenuOpen(false);
    }
    if (layoutController?.activeDrawer !== 'none') {
      const inside = get('workspace-panel').contains(event.target) ||
        get('scene-rail').contains(event.target) ||
        elements.bottomInterface.contains(event.target) ||
        get('global-settings-trigger').contains(event.target) ||
        get('detail-peek-trigger').contains(event.target) ||
        elements.detail.contains(event.target);
      if (!inside) layoutController.setDrawer('none');
    } else if (dockOpen && !elements.bottomInterface.contains(event.target)) setDockOpen(false);
  });
  get('brand-home').addEventListener('click', () => navigateToScene('galaxy'));
  document.querySelectorAll('.view-link[data-view]').forEach(button => {
    button.addEventListener('click', () => navigateToScene(button.dataset.view));
  });
  const runPrimarySceneAction = () => {
    if (universe.transitioning) return showToast('场景正在切换，请稍候');
    if (currentState.mode === 'galaxy') universe.viewSolar();
    else if (currentState.mode === 'free') focusBodyWhenReady('jupiter');
    else focusBodyWhenReady('earth');
  };
  const runSecondarySceneAction = () => {
    if (universe.transitioning) return showToast('场景正在切换，请稍候');
    if (currentState.mode === 'galaxy') focusBodyWhenReady('earth');
    else if (currentState.mode === 'free') universe.viewSolar();
    else universe.viewGalaxy();
  };
  elements.primary.addEventListener('click', runPrimarySceneAction);
  elements.secondary.addEventListener('click', runSecondarySceneAction);
  get('detail-scene-primary').addEventListener('click', () => {
    layoutController?.setDrawer('none');
    runPrimarySceneAction();
  });
  get('detail-scene-secondary').addEventListener('click', () => {
    layoutController?.setDrawer('none');
    runSecondarySceneAction();
  });
  get('detail-back').addEventListener('click', () => universe.viewSolar());
  elements.detailClose.addEventListener('click', () => {
    setSheetState('collapsed');
    focusIfAvailable(layoutController ? get('detail-peek-trigger') : elements.detailSummary);
  });
  get('detail-prev').addEventListener('click', () => {
    const current = ALL_BY_ID[currentState.focusId];
    const index = CELESTIALS.findIndex(body => body.id === (current?.parentId || current?.id));
    focusBodyWhenReady(CELESTIALS[(index + CELESTIALS.length - 1) % CELESTIALS.length].id);
  });
  get('detail-next').addEventListener('click', () => {
    const current = ALL_BY_ID[currentState.focusId];
    const index = CELESTIALS.findIndex(body => body.id === (current?.parentId || current?.id));
    focusBodyWhenReady(CELESTIALS[(index + 1) % CELESTIALS.length].id);
  });
  get('detail-compare-trigger').addEventListener('click', () => openModal('compare'));
  elements.playPause.addEventListener('click', () => universe.togglePaused());
  elements.speed.addEventListener('input', event => universe.setTimeScale(SPEED_STEPS[Number(event.target.value)]));
  elements.qualitySelect.addEventListener('change', event => universe.setQuality(event.target.value));
  elements.flightSpeed.addEventListener('change', event => universe.setFlightSpeed(event.target.value));
  elements.freeTargetSelect.addEventListener('change', event => {
    if (event.target.value) universe.setFreeTarget(event.target.value);
    else universe.unlockFreeTarget();
  });
  elements.freeFlightGo.addEventListener('click', () => {
    if (currentState.freeAutopilot) universe.stopFreeAutopilot();
    else if (universe.startFreeAutopilot()) setDockOpen(false);
  });
  elements.freeFlightUnlock.addEventListener('click', () => universe.unlockFreeTarget());
  elements.flightQuickStop.addEventListener('click', () => universe.stopFreeAutopilot());
  elements.orbitToggle.addEventListener('click', () => universe.toggleOrbits());
  elements.labelToggle.addEventListener('click', () => universe.toggleLabels());
  get('zoom-in').addEventListener('click', () => {
    if (!universe.zoom(.76)) showToast('场景正在切换，请稍候');
  });
  get('zoom-out').addEventListener('click', () => {
    if (!universe.zoom(1.3)) showToast('场景正在切换，请稍候');
  });
  elements.resetView.addEventListener('click', () => universe.resetView());
  get('search-trigger').addEventListener('click', () => openModal('search'));
  get('help-trigger').addEventListener('click', () => openModal('help'));
  get('search-close').addEventListener('click', closeModals);
  get('help-close').addEventListener('click', closeModals);
  get('compare-close').addEventListener('click', closeModals);
  elements.contextReload.addEventListener('click', () => window.location.reload());
  elements.searchInput.addEventListener('input', event => renderSearchResults(event.target.value));
  for (const overlay of modalOverlays) {
    overlay.addEventListener('click', event => {
      if (event.target === overlay) closeModals();
    });
  }
  document.addEventListener('keydown', event => {
    if (!elements.contextRecovery.hidden) {
      if (event.key === 'Tab') {
        event.preventDefault();
        elements.contextReload.focus();
      } else if (event.key === 'Escape') event.preventDefault();
      return;
    }
    const openDialog = activeModalOverlay?.querySelector('[role="dialog"]');
    if (event.key === 'Tab' && openDialog) {
      const available = getDialogFocusables(openDialog);
      if (available.length) {
        const first = available[0];
        const last = available[available.length - 1];
        if (event.shiftKey && (document.activeElement === first || !openDialog.contains(document.activeElement))) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && (document.activeElement === last || !openDialog.contains(document.activeElement))) {
          event.preventDefault();
          first.focus();
        }
      } else {
        event.preventDefault();
        openDialog.focus();
      }
    }
    if (event.key === 'Escape') {
      // Explicitly leave Fullscreen API first. This also works when a browser
      // forwards Esc to the page without applying its native exit shortcut.
      if (document.fullscreenElement) {
        event.preventDefault();
        document.exitFullscreen().catch(() => showToast('退出全屏失败，请使用全屏按钮重试'));
        return;
      }
      if (activeModalOverlay) {
        event.preventDefault();
        closeModals();
        return;
      }
      if (!elements.mobileMenu.hidden) {
        setMobileMenuOpen(false);
        focusIfAvailable(get('mobile-scene-trigger'));
      }
      else if (layoutController?.activeDrawer !== 'none') {
        event.preventDefault();
        layoutController.setDrawer('none');
      }
      else if (dockOpen) setDockOpen(false);
      else if (layoutController?.uiMode === 'pure') {
        event.preventDefault();
        layoutController.setUiMode('compact');
      }
      else if (currentState.mode === 'free' && currentState.freeAutopilot) universe.stopFreeAutopilot();
      else if (currentState.mode === 'free' && currentState.freeTargetId) universe.unlockFreeTarget();
      else if (currentState.mode === 'planet') universe.viewSolar();
    }
    const shortcutAllowed = !event.repeat && !event.isComposing &&
      !event.ctrlKey && !event.metaKey && !event.altKey &&
      !activeModalOverlay && elements.contextRecovery.hidden &&
      !(event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable="true"]'));
    if (shortcutAllowed && event.code === 'KeyH') {
      event.preventDefault();
      layoutController?.setUiMode(layoutController.uiMode === 'pure' ? 'compact' : 'pure');
    }
    if (shortcutAllowed && event.code === 'KeyF') {
      event.preventDefault();
      toggleFullscreen();
    }
    if (event.code === 'KeyR' && !event.repeat && !event.isComposing &&
      !event.ctrlKey && !event.metaKey && !event.altKey &&
      !activeModalOverlay && elements.contextRecovery.hidden &&
      !(event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable="true"]'))) {
      event.preventDefault();
      universe.resetView();
    }
    if (event.key === '/' && !activeModalOverlay && elements.contextRecovery.hidden &&
      !(event.target instanceof Element &&
      event.target.closest('input, textarea, select, [contenteditable="true"]'))) {
      event.preventDefault();
      openModal('search');
    }
  });
  document.addEventListener('focusin', event => {
    const openDialog = activeModalOverlay?.querySelector('[role="dialog"]');
    const focusSurface = !elements.contextRecovery.hidden
      ? elements.contextRecovery : openDialog;
    if (focusSurface && !focusSurface.contains(event.target)) {
      const fallback = focusSurface === elements.contextRecovery
        ? elements.contextReload : getDialogFocusables(openDialog)[0] || openDialog;
      fallback.focus({ preventScroll: true });
    }
  });

  let sheetPointer = null;
  elements.sheetHandle.addEventListener('pointerdown', event => {
    if (!event.isPrimary || sheetPointer) return;
    sheetPointer = { id: event.pointerId, startY: event.clientY, lastY: event.clientY };
    elements.sheetHandle.setPointerCapture(event.pointerId);
  });
  elements.sheetHandle.addEventListener('pointermove', event => {
    if (!sheetPointer || sheetPointer.id !== event.pointerId) return;
    sheetPointer.lastY = event.clientY;
    const delta = event.clientY - sheetPointer.startY;
    if (Math.abs(delta) < 5) return;
    const app = get('app');
    app.dataset.sheetDragging = 'true';
    app.style.setProperty('--sheet-drag-y', Math.max(-76, Math.min(76, delta)) + 'px');
  });
  elements.sheetHandle.addEventListener('pointerup', event => {
    if (!sheetPointer || sheetPointer.id !== event.pointerId) return;
    const delta = event.clientY - sheetPointer.startY;
    sheetPointer = null;
    delete get('app').dataset.sheetDragging;
    get('app').style.removeProperty('--sheet-drag-y');
    if (delta < -24) setSheetState(sheetState === 'collapsed' ? 'half' : 'expanded');
    else if (delta > 24) setSheetState(sheetState === 'expanded' ? 'half' : 'collapsed');
    else setSheetState(sheetState === 'collapsed' ? 'half' : sheetState === 'half' ? 'expanded' : 'half');
  });
  const cancelSheetDrag = () => {
    sheetPointer = null;
    delete get('app').dataset.sheetDragging;
    get('app').style.removeProperty('--sheet-drag-y');
  };
  elements.sheetHandle.addEventListener('pointercancel', cancelSheetDrag);
  elements.sheetHandle.addEventListener('lostpointercapture', cancelSheetDrag);
  elements.sheetHandle.addEventListener('click', event => {
    if (event.detail === 0) setSheetState(sheetState === 'collapsed' ? 'half' : sheetState === 'half' ? 'expanded' : 'collapsed');
  });

  window.addEventListener('resize', () => {
    if (layoutController) {
      setMobileMenuOpen(false);
      layoutController.sync();
    } else if (!isCompact()) {
      setMobileMenuOpen(false);
      setDockOpen(false);
    } else setDockOpen(dockOpen);
    scheduleLayoutMeasure();
    requestAnimationFrame(() => universe?.reframeFocusedBody());
  });
  window.visualViewport?.addEventListener('resize', scheduleLayoutMeasure);
  window.visualViewport?.addEventListener('scroll', scheduleLayoutMeasure);
  if (typeof ResizeObserver !== 'undefined') {
    const observer = new ResizeObserver(scheduleLayoutMeasure);
    for (const element of [elements.bottomInterface, elements.detail,
      document.querySelector('.topbar'), get('workspace-panel')]) {
      if (element) observer.observe(element);
    }
  }
  setDockOpen(false);
  setMobileMenuOpen(false);
  for (const overlay of modalOverlays) overlay.inert = true;
}

try {
  createPlanetDock();
  createFreeFlightTargets();
  setupComparison();
  layoutController = createLayoutController({
    onLayoutChange: () => {
      dockOpen = layoutController?.isObjectsOpen ?? false;
      flightDropdowns?.sync();
      scheduleLayoutMeasure();
      requestAnimationFrame(() => universe?.reframeFocusedBody());
    },
    onDetailOpen: () => setSheetState('half')
  });
  syncFullscreen();
  bindInterface();
  flightDropdowns = createFlightDropdowns({
    accentFor: id => ALL_BY_ID[id]?.accent
  });
  universe = new UniverseApp(get('universe-canvas'), {
    labelsLayer: get('labels-layer'),
    transitionElement: get('scene-transition'),
    onStateChange: updateInterface,
    onContextStatus: updateWebGLStatus,
    onToast: showToast,
    onTelemetry: ({ fps, dpr, qualityTier, drawCalls }) => {
      get('fps-value').textContent = fps + ' FPS';
      get('fps-value').title = '渲染倍率 ' + dpr + ' · ' + qualityTier + ' · ' + drawCalls + ' 次绘制';
    },
    onCameraUpdate: distance => {
      get('camera-distance').textContent = 'CAM / ' + distance.toFixed(1);
    }
  });
  // Read-only diagnostics for repeatable local browser/device benchmarks.
  window.getCosmosPerformance = () => universe.getPerformanceSnapshot();

  // Allow the first 3D frame to render before dismissing the cover.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      get('loading-screen').classList.add('is-loaded');
    });
  });
} catch (error) {
  console.error('Universe initialization failed:', error);
  get('loading-screen').classList.add('is-loaded');
  const fallback = get('fallback-message');
  fallback.textContent = '宇宙场景初始化失败，请刷新页面重试。详细错误可查看浏览器控制台。';
  fallback.hidden = false;
}
