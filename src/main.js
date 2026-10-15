import './styles.css';
import './v2.css';
import { UniverseApp } from './core/UniverseApp.js';
import { CELESTIALS, ALL_BODIES, ALL_BY_ID, SATELLITES_BY_PARENT } from './data/celestials.js';

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
  detail: get('detail-panel'),
  detailOrb: get('detail-orb'),
  detailMoons: get('detail-moons'),
  detailMoonList: get('detail-moon-list'),
  detailParent: get('detail-parent'),
  sheetHandle: get('detail-sheet-handle'),
  playPause: get('play-pause'),
  speed: get('speed-range'),
  speedValue: get('speed-value'),
  simDate: get('sim-date'),
  qualitySelect: get('quality-select'),
  flightSpeed: get('flight-speed'),
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
    description: '沿着椭圆轨道从水星抵达海王星，继续走近月球、木卫二与土卫六。每一个世界，都有自己的故事。',
    primary: '探索地球',
    secondary: '返回银河系',
    metrics: ['太阳系年龄', '约 46 亿年', '探索天体', '8 行星 · 7 卫星']
  },
  free: {
    eyebrow: 'YOU ARE THE EXPLORER',
    title: '你的航线，<br /><em>由你决定。</em>',
    description: '使用 W A S D 飞越星际空间，空格上升，Shift 下降；拖动鼠标改变观察方向，靠近你感兴趣的天体。',
    primary: '探索木星',
    secondary: '返回太阳系',
    metrics: ['导航模式', '自由漫游', '飞行控制', 'W / A / S / D']
  }
};

let universe;
let currentState = { mode: 'galaxy' };
let toastTimer;
const SPEED_STEPS = [0, .25, 1, 3, 10, 25, 50];
let sheetState = 'half';

function setSheetState(next) {
  sheetState = next;
  get('app').dataset.sheet = next;
  elements.sheetHandle.setAttribute('aria-expanded', String(next !== 'collapsed'));
  elements.sheetHandle.setAttribute('aria-label',
    next === 'collapsed' ? '展开天体资料' : next === 'expanded' ? '收起天体资料' : '展开更多天体资料');
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => elements.toast.classList.remove('is-visible'), 3200);
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
    button.addEventListener('click', () => universe.focusBody(body.id));
    list.appendChild(button);
  }
}

function updateDetail(id) {
  const body = ALL_BY_ID[id];
  if (!body) return;
  get('detail-number').textContent = '/ ' + body.index;
  get('detail-category').textContent = body.category;
  get('detail-name').textContent = body.name;
  get('detail-en').textContent = body.en;
  get('detail-description').textContent = body.description;
  get('detail-distance-label').textContent = body.parentId ? '距' + ALL_BY_ID[body.parentId].name :
    id === 'sun' ? '日心距离' : '距太阳';
  get('detail-distance').textContent = body.distance;
  get('detail-diameter').textContent = body.diameter;
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
    button.innerHTML = '<span aria-hidden="true">◌</span>';
    button.append(document.createTextNode(' ' + satellite.name));
    button.title = satellite.short;
    button.addEventListener('click', () => universe.focusBody(satellite.id));
    elements.detailMoonList.appendChild(button);
  }
  elements.detailParent.hidden = !body.parentId;
  if (body.parentId) {
    elements.detailParent.textContent = '↶ 返回' + ALL_BY_ID[body.parentId].name;
    elements.detailParent.onclick = () => universe.focusBody(body.parentId);
  }
}

function updateInterface(state) {
  const previousMode = currentState.mode;
  const previousFocusId = currentState.focusId;
  currentState = state;
  get('app').dataset.view = state.mode;
  const showingDetail = state.mode === 'planet' && Boolean(state.focusId);
  if (showingDetail && previousMode !== 'planet') setSheetState('half');
  elements.hero.classList.toggle('is-hidden', showingDetail);
  elements.detail.classList.toggle('is-visible', showingDetail);
  elements.detail.setAttribute('aria-hidden', String(!showingDetail));
  elements.hero.inert = showingDetail;
  elements.detail.inert = !showingDetail;
  if (showingDetail) {
    updateDetail(state.focusId);
    if (previousFocusId !== state.focusId) elements.detail.scrollTop = 0;
  }

  const displayMode = state.mode === 'planet' ? 'solar' : state.mode;
  const copy = heroCopy[displayMode] || heroCopy.galaxy;
  elements.eyebrow.textContent = copy.eyebrow;
  elements.heroTitle.innerHTML = copy.title;
  elements.heroDescription.textContent = copy.description;
  elements.primary.innerHTML = copy.primary + ' <span aria-hidden="true">↗</span>';
  elements.secondary.innerHTML = copy.secondary + ' <span aria-hidden="true">→</span>';
  elements.metricALabel.textContent = copy.metrics[0];
  elements.metricAValue.textContent = copy.metrics[1];
  elements.metricBLabel.textContent = copy.metrics[2];
  elements.metricBValue.textContent = copy.metrics[3];

  document.querySelectorAll('.view-link[data-view]').forEach(button => {
    const active = button.dataset.view === displayMode;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-current', active ? 'page' : 'false');
  });
  document.querySelectorAll('.planet-item').forEach(button => {
    button.classList.toggle('is-selected', button.dataset.id === state.focusId);
    button.setAttribute('aria-pressed', String(button.dataset.id === state.focusId));
  });

  elements.playPause.textContent = state.paused ? '▶' : 'Ⅱ';
  elements.playPause.setAttribute('aria-label', state.paused ? '继续时间' : '暂停时间');
  const speedStep = SPEED_STEPS.reduce((best, speed, index) =>
    Math.abs(speed - state.timeScale) < Math.abs(SPEED_STEPS[best] - state.timeScale) ? index : best, 0);
  elements.speed.value = String(speedStep);
  elements.speed.style.setProperty('--fill', speedStep / 6 * 100 + '%');
  elements.speedValue.textContent = (Number.isInteger(state.timeScale) ? state.timeScale.toFixed(0) : state.timeScale.toFixed(2).replace(/0$/, '')) + '×';
  elements.qualitySelect.value = state.qualityMode;
  elements.flightSpeed.value = String(state.flightSpeed);
  get('flight-speed-control').hidden = state.mode !== 'free';

  for (const [element, isOn] of [[elements.orbitToggle, state.showOrbits], [elements.labelToggle, state.showLabels]]) {
    element.classList.toggle('is-on', isOn);
    element.setAttribute('aria-pressed', String(isOn));
  }
}

function openModal(name) {
  const overlay = name === 'search' ? elements.searchOverlay :
    name === 'compare' ? elements.compareOverlay : elements.helpOverlay;
  overlay.classList.add('is-open');
  overlay.setAttribute('aria-hidden', 'false');
  if (name === 'search') {
    elements.searchInput.value = '';
    renderSearchResults('');
    requestAnimationFrame(() => elements.searchInput.focus());
  }
  if (name === 'compare') {
    const focus = currentState.focusId || 'earth';
    elements.compareLeft.value = focus;
    elements.compareRight.value = focus === 'mars' ? 'jupiter' : 'mars';
    renderComparison();
  }
}

function closeModals() {
  for (const overlay of [elements.searchOverlay, elements.helpOverlay, elements.compareOverlay]) {
    overlay.classList.remove('is-open');
    overlay.setAttribute('aria-hidden', 'true');
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

function renderComparison() {
  const left = ALL_BY_ID[elements.compareLeft.value];
  const right = ALL_BY_ID[elements.compareRight.value];
  if (!left || !right) return;
  const rows = [
    ['类型', left.type, right.type],
    ['直径', left.diameter, right.diameter],
    ['距离', left.distance, right.distance],
    ['自转周期', left.day, right.day],
    ['公转周期', left.year, right.year],
    ['特征', left.short, right.short]
  ];
  elements.compareTable.replaceChildren();
  for (const [label, a, b] of rows) {
    const row = document.createElement('div');
    row.className = 'compare-row';
    for (const [value, className] of [[label, 'compare-key'], [a, 'compare-value'], [b, 'compare-value']]) {
      const cell = document.createElement('span');
      cell.className = className;
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
  elements.searchResults.replaceChildren();
  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'search-empty';
    empty.textContent = '没有找到对应天体，请尝试其他名称。';
    elements.searchResults.appendChild(empty);
    return;
  }
  for (const body of items) {
    const button = document.createElement('button');
    button.className = 'search-result';
    button.type = 'button';
    const dot = document.createElement('span');
    dot.className = 'result-dot';
    dot.style.setProperty('--orb-a', body.accent);
    dot.style.setProperty('--orb-b', body.secondary);
    const name = document.createElement('strong');
    name.textContent = body.name + ' · ' + body.short;
    const latin = document.createElement('small');
    latin.textContent = body.parentId ? ALL_BY_ID[body.parentId].name + '的卫星' : body.en;
    button.append(dot, name, latin);
    button.addEventListener('click', () => {
      closeModals();
      universe.focusBody(body.id);
    });
    elements.searchResults.appendChild(button);
  }
}

function bindInterface() {
  get('brand-home').addEventListener('click', () => universe.viewGalaxy());
  document.querySelectorAll('.view-link[data-view]').forEach(button => {
    button.addEventListener('click', () => {
      if (button.dataset.view === 'galaxy') universe.viewGalaxy();
      if (button.dataset.view === 'solar') universe.viewSolar();
      if (button.dataset.view === 'free') universe.activateFree();
    });
  });
  elements.primary.addEventListener('click', () => {
    if (currentState.mode === 'galaxy') universe.viewSolar();
    else if (currentState.mode === 'free') universe.focusBody('jupiter');
    else universe.focusBody('earth');
  });
  elements.secondary.addEventListener('click', () => {
    if (currentState.mode === 'galaxy') universe.focusBody('earth');
    else if (currentState.mode === 'free') universe.viewSolar();
    else universe.viewGalaxy();
  });
  get('detail-back').addEventListener('click', () => universe.viewSolar());
  get('detail-close').addEventListener('click', () => universe.viewSolar());
  get('detail-prev').addEventListener('click', () => {
    const current = ALL_BY_ID[currentState.focusId];
    const index = CELESTIALS.findIndex(body => body.id === (current?.parentId || current?.id));
    universe.focusBody(CELESTIALS[(index + CELESTIALS.length - 1) % CELESTIALS.length].id);
  });
  get('detail-next').addEventListener('click', () => {
    const current = ALL_BY_ID[currentState.focusId];
    const index = CELESTIALS.findIndex(body => body.id === (current?.parentId || current?.id));
    universe.focusBody(CELESTIALS[(index + 1) % CELESTIALS.length].id);
  });
  get('detail-compare-trigger').addEventListener('click', () => openModal('compare'));
  elements.playPause.addEventListener('click', () => universe.togglePaused());
  elements.speed.addEventListener('input', event => universe.setTimeScale(SPEED_STEPS[Number(event.target.value)]));
  elements.qualitySelect.addEventListener('change', event => universe.setQuality(event.target.value));
  elements.flightSpeed.addEventListener('change', event => universe.setFlightSpeed(event.target.value));
  elements.orbitToggle.addEventListener('click', () => universe.toggleOrbits());
  elements.labelToggle.addEventListener('click', () => universe.toggleLabels());
  get('zoom-in').addEventListener('click', () => universe.zoom(.76));
  get('zoom-out').addEventListener('click', () => universe.zoom(1.3));
  get('search-trigger').addEventListener('click', () => openModal('search'));
  get('help-trigger').addEventListener('click', () => openModal('help'));
  get('search-close').addEventListener('click', closeModals);
  get('help-close').addEventListener('click', closeModals);
  get('compare-close').addEventListener('click', closeModals);
  elements.searchInput.addEventListener('input', event => renderSearchResults(event.target.value));
  for (const overlay of [elements.searchOverlay, elements.helpOverlay, elements.compareOverlay]) {
    overlay.addEventListener('click', event => {
      if (event.target === overlay) closeModals();
    });
  }
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      if (document.querySelector('.modal-overlay.is-open')) closeModals();
      else if (currentState.mode === 'planet') universe.viewSolar();
    }
    if (event.key === '/' && !(event.target instanceof HTMLInputElement)) {
      event.preventDefault();
      openModal('search');
    }
  });

  let sheetPointer = null;
  elements.sheetHandle.addEventListener('pointerdown', event => {
    sheetPointer = event.clientY;
    elements.sheetHandle.setPointerCapture(event.pointerId);
  });
  elements.sheetHandle.addEventListener('pointerup', event => {
    if (sheetPointer === null) return;
    const delta = event.clientY - sheetPointer;
    sheetPointer = null;
    if (delta < -24) setSheetState('expanded');
    else if (delta > 24) setSheetState('collapsed');
    else setSheetState(sheetState === 'collapsed' ? 'half' : sheetState === 'half' ? 'expanded' : 'half');
  });
  elements.sheetHandle.addEventListener('pointercancel', () => { sheetPointer = null; });
}

createPlanetDock();
setupComparison();
bindInterface();

try {
  universe = new UniverseApp(get('universe-canvas'), {
    labelsLayer: get('labels-layer'),
    transitionElement: get('scene-transition'),
    onStateChange: updateInterface,
    onToast: showToast,
    onTelemetry: ({ fps, simulatedDays }) => {
      get('fps-value').textContent = fps + ' FPS';
      const date = new Date(Date.UTC(2026, 0, 1) + simulatedDays * 86400000);
      elements.simDate.textContent = '演示时间 · ' + date.toISOString().slice(0, 10).replace(/-/g, '.');
    },
    onCameraUpdate: distance => {
      get('camera-distance').textContent = 'CAM / ' + distance.toFixed(1);
    }
  });

  // Allow the first 3D frame to render before dismissing the cover.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      get('loading-screen').classList.add('is-loaded');
    });
  });
} catch (error) {
  console.error('Universe initialization failed:', error);
  get('loading-screen').classList.add('is-loaded');
  get('fallback-message').hidden = false;
}
