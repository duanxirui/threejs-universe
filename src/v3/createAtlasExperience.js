import { ALL_BY_ID } from '../data/celestials.js';
import { PHYSICAL_KEYS, getPhysicalEntry, getPhysicalQuantity } from '../data/science/physicalCatalog.js';
import { getOfficialObservation, OBSERVATION_DOCUMENTS } from '../data/science/sourceObservations.js';
import { ATLAS_CONTENT, ATLAS_ROUTES, diameterRatio, getAtlasFacts } from './atlasData.js';
import { buildAtlasLink, createLocalAtlas, parseAtlasLink } from './localAtlas.js';

const get = id => document.getElementById(id);
const element = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

export function createAtlasExperience({
  getUniverse, getState, closeModal, openModal, toast
}) {
  let tour = null;
  let lastVisit = null;
  let orbitOpen = false;
  let selectedTab = 'routes';
  const local = createLocalAtlas(() => {
    renderPersonal();
    updateFavoriteButton();
  });

  function updateFavoriteButton() {
    const id = getState().focusId;
    const active = Boolean(id && local.isFavorite(id));
    const button = get('atlas-favorite');
    button.disabled = !id;
    button.setAttribute('aria-pressed', String(active));
    button.textContent = active ? '★ 已收藏' : '☆ 收藏天体';
  }

  function renderPersonal() {
    const { favorites, recents, available } = local.snapshot();
    for (const [listId, ids, fallback] of [
      ['atlas-favorites', favorites, '还没有收藏天体。'],
      ['atlas-recents', recents, '还没有最近浏览记录。']
    ]) {
      const list = get(listId);
      list.replaceChildren();
      if (!ids.length) {
        list.append(element('p', 'atlas-empty', fallback));
        continue;
      }
      for (const id of ids) {
        const body = ALL_BY_ID[id];
        const button = element('button', 'atlas-body-link');
        button.type = 'button';
        button.append(element('strong', '', body.name), element('small', '', body.short));
        button.addEventListener('click', () => {
          closeModal();
          endTour(false);
          getUniverse().focusBody(id);
        });
        list.append(button);
      }
    }
    get('atlas-local-note').textContent = available
      ? '收藏和最近浏览只存于本机浏览器，可以随时清除。'
      : '当前浏览器限制本地存储，本次会话中仍可使用收藏。';
  }

  function setTab(name) {
    selectedTab = name;
    for (const tab of ['routes', 'personal']) {
      const active = tab === selectedTab;
      get('atlas-tab-' + tab).setAttribute('aria-selected', String(active));
      get('atlas-panel-' + tab).hidden = !active;
    }
    if (name === 'personal') renderPersonal();
  }

  function renderRoutes() {
    const list = get('atlas-route-list');
    list.replaceChildren();
    for (const route of ATLAS_ROUTES) {
      const card = element('div', 'atlas-route-card');
      card.append(
        element('strong', '', route.title),
        element('p', '', route.subtitle),
        element('small', '', route.steps.length + ' 站 · 可随时退出')
      );
      const button = element('button', 'atlas-primary', '开始路线');
      button.type = 'button';
      button.dataset.route = route.id;
      button.addEventListener('click', () => startTour(route.id));
      card.append(button);
      list.append(card);
    }
  }

  function updateTourPanel() {
    const panel = get('atlas-tour-panel');
    panel.hidden = !tour;
    if (!tour) return;
    const step = tour.route.steps[tour.index];
    get('atlas-tour-progress').textContent =
      tour.route.title + ' · ' + (tour.index + 1) + ' / ' + tour.route.steps.length;
    get('atlas-tour-title').textContent = step.title + ' · ' + ALL_BY_ID[step.bodyId].name;
    get('atlas-tour-text').textContent = step.note;
    get('atlas-tour-prev').disabled = tour.index === 0 || tour.busy;
    get('atlas-tour-next').disabled = tour.busy;
    get('atlas-tour-next').textContent = tour.index === tour.route.steps.length - 1
      ? '完成路线' : '下一站';
    get('atlas-tour-status').textContent = tour.busy
      ? '镜头正在前往' + ALL_BY_ID[step.bodyId].name
      : '当前站点：' + ALL_BY_ID[step.bodyId].name;
  }

  function endTour(message = true) {
    if (!tour) return;
    tour = null;
    getUniverse().interruptFocusCamera();
    updateTourPanel();
    if (message) toast('已结束主题导览，可以自由探索');
  }

  async function navigateTourStep() {
    if (!tour || tour.busy) return;
    if (getUniverse().transitioning) {
      toast('场景正在切换，请稍候');
      return;
    }
    const thisTour = tour;
    const step = thisTour.route.steps[thisTour.index];
    thisTour.busy = true;
    updateTourPanel();
    try {
      const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? .01 : 1.5;
      await getUniverse().focusBody(step.bodyId, duration, () => tour === thisTour);
    } catch (error) {
      console.error('Guided navigation failed:', error);
      if (tour === thisTour) toast('本次镜头导航失败，请重试');
    } finally {
      if (tour === thisTour) {
        thisTour.busy = false;
        updateTourPanel();
      }
    }
  }

  function startTour(id) {
    const route = ATLAS_ROUTES.find(item => item.id === id);
    if (!route) return;
    closeModal();
    endTour(false);
    tour = { route, index: 0, busy: false };
    updateTourPanel();
    navigateTourStep();
    get('atlas-tour-exit').focus({ preventScroll: true });
  }

  function moveTour(delta) {
    if (!tour || tour.busy) return;
    const target = tour.index + delta;
    if (target >= tour.route.steps.length) {
      const name = tour.route.title;
      endTour(false);
      toast('已完成「' + name + '」主题路线');
      return;
    }
    if (target < 0) return;
    tour.index = target;
    updateTourPanel();
    navigateTourStep();
  }

  function handleManualNavigation() {
    if (!tour) return;
    endTour(false);
  }

  function renderOrbit(id) {
    const facts = getAtlasFacts(id);
    const panel = get('atlas-orbit-panel');
    const button = get('atlas-orbit-toggle');
    panel.hidden = !orbitOpen || !facts;
    button.setAttribute('aria-expanded', String(!panel.hidden));
    if (!facts) return;
    get('atlas-orbit-reference').textContent = facts.reference?.name || '太阳系中心天体';
    get('atlas-orbit-distance').textContent = Number.isFinite(facts.physical.distanceKm)
      ? '约 ' + facts.physical.distanceKm.toLocaleString('zh-CN') + ' km' : '不适用';
    get('atlas-orbit-period').textContent = Number.isFinite(facts.physical.orbitalPeriodDays)
      ? '约 ' + Number(facts.physical.orbitalPeriodDays.toPrecision(5)).toLocaleString('zh-CN') + ' 天'
      : '不适用';
    get('atlas-orbit-inclination').textContent =
      '约 ' + facts.modelInclinationDegrees.toFixed(1) + '°（示意模型）';
    get('atlas-orbit-diagram-label').textContent =
      facts.reference ? facts.reference.name + ' → ' + facts.body.name : '太阳';
  }

  const physicalLabels = Object.freeze({
    diameterKm: '平均直径', massKg: '质量',
    rotationHours: '恒星自转周期', orbitalPeriodDays: '公转周期',
    distanceKm: '平均轨道距离'
  });
  function compactScienceNumber(value, unit, isDuration = false) {
    if (value === null) return '不适用';
    const absolute = isDuration ? Math.abs(value) : value;
    const number = unit === 'kg'
      ? absolute.toExponential(4) : Number(absolute.toPrecision(8)).toLocaleString('zh-CN');
    return number + ' ' + unit + (isDuration && value < 0 ? '（逆行）' : '');
  }
  function renderPhysicalProvenance(id) {
    let details = get('t25-source-compare');
    if (!details) {
      details = element('details', 't25-source-compare');
      details.id = 't25-source-compare';
      details.append(
        element('summary', '', '展开 5 项物理量与参考来源'),
        element('div', 't25-source-list'),
        element('p', 't25-source-caution',
          '数据用于科普参考，数值可能经过取整或使用不同定义，' +
          '不代表实时天体位置；自转方向、半径与同步旋转口径请结合来源说明理解。')
      );
      get('atlas-source-block').append(details);
    }
    if (details.dataset.bodyId === id) return;
    details.open = false;
    details.dataset.bodyId = id;
    const list = details.querySelector('.t25-source-list');
    list.replaceChildren();
    const current = getPhysicalEntry(id);
    for (const key of PHYSICAL_KEYS) {
      const local = getPhysicalQuantity(id, key);
      const official = getOfficialObservation(id, key);
      const row = element('div', 't25-source-item');
      const title = element('strong', '', physicalLabels[key]);
      row.append(title);
      if (!official) {
        row.append(element('p', '', '本项不适用。'));
        list.append(row);
        continue;
      }
      const source = OBSERVATION_DOCUMENTS[official.sourceId];
      const oldNumber = compactScienceNumber(local.scientificValue, local.unit);
      const isRotation = key === 'rotationHours' &&
        current.rotationSense === 'retrograde';
      const sourceNumber = compactScienceNumber(official.observedValue, official.unit,
        isRotation);
      row.append(
        element('p', '', '现有科普近似值：' + oldNumber),
        element('p', '', '官方资料表格值：' + sourceNumber)
      );
      const anchor = element('a', '', source.title + ' / ' + official.recordLocator);
      anchor.href = official.url;
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
      row.append(anchor);
      const note = official.notes ? ' · ' + official.notes : '';
      row.append(element('small', '',
        '源表版本：' + official.sourceRevision + ' · 整理日期：' +
        official.observedOn + note));
      list.append(row);
    }

  }
  function updateBodyContent(id) {
    const data = ATLAS_CONTENT[id];
    const source = get('atlas-source-link');
    if (data) {
      source.textContent = data.source.title;
      source.href = data.source.url;
      get('atlas-source-intro').textContent = data.highlight + ' · ' + data.accuracy;
      get('atlas-source-reviewed').textContent = '参考资料整理：' + data.sourceIndexedOn + ' · 数值供科普使用，位置及比例包含演示性近似';
      renderPhysicalProvenance(id);
    }
    updateFavoriteButton();
    renderOrbit(id);
  }

  function renderComparisonScale(leftId, rightId) {
    const target = get('atlas-scale-visual');
    const data = diameterRatio(leftId, rightId);
    target.replaceChildren();
    if (!data) {
      target.append(element('p', 'atlas-empty', '这组天体暂缺可比的直径数据。'));
      return;
    }
    const larger = Math.max(data.left, data.right);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 520 190');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', '两颗天体按照真实直径比例显示的圆形面积图');
    for (const [id, diameter, x] of [
      [leftId, data.left, 130], [rightId, data.right, 390]
    ]) {
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', String(x));
      circle.setAttribute('cy', '85');
      circle.setAttribute('r', String(68 * diameter / larger));
      circle.setAttribute('fill', ALL_BY_ID[id].accent);
      circle.setAttribute('fill-opacity', '.76');
      circle.setAttribute('stroke', ALL_BY_ID[id].accent);
      circle.setAttribute('stroke-width', '.8');
      const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      title.textContent = ALL_BY_ID[id].name + '，直径 ' + diameter.toLocaleString('zh-CN') + ' km';
      circle.append(title);
      svg.append(circle);
      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('x', String(x));
      label.setAttribute('y', '180');
      label.setAttribute('fill', '#d7e6f5');
      label.setAttribute('font-size', '14');
      label.setAttribute('text-anchor', 'middle');
      label.textContent = ALL_BY_ID[id].name;
      svg.append(label);
    }
    const ratio = Math.max(data.ratio, 1 / data.ratio);
    const biggerName = data.left >= data.right ? ALL_BY_ID[leftId].name : ALL_BY_ID[rightId].name;
    const smallerName = data.left >= data.right ? ALL_BY_ID[rightId].name : ALL_BY_ID[leftId].name;
    target.append(svg, element('p', 'atlas-scale-caption',
      biggerName + '直径约为' + smallerName + '的 ' +
      Number(ratio.toPrecision(4)).toLocaleString('zh-CN') + ' 倍。' +
      (ratio > 40 ? '较小圆可能几乎不可见，圆形半径未被人为放大。' : '')));
  }

  async function copyCurrentLink() {
    const state = getState();
    const link = buildAtlasLink(window.location.href, state.mode, state.focusId);
    try {
      await navigator.clipboard.writeText(link);
      toast('天体直达链接已复制');
    } catch {
      get('copy-link-input').value = link;
      openModal('copy');
    }
  }

  async function saveCurrentSnapshot() {
    const id = getState().focusId;
    const title = id ? ALL_BY_ID[id].name : 'COSMOS ATLAS';
    const button = get('atlas-snapshot');
    button.disabled = true;
    try {
      const blob = await getUniverse().captureScene(title);
      if (!blob) throw new Error('PNG export returned no image');
      const filename = 'cosmos-atlas-' + (id || getState().mode) + '.png';
      const file = new File([blob], filename, { type: 'image/png' });
      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: title + ' · COSMOS ATLAS' });
          return;
        } catch (error) {
          if (error.name === 'AbortError') return;
        }
      }
      const url = URL.createObjectURL(blob);
      const link = element('a');
      link.href = url;
      link.download = filename;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast('场景图片已生成');
    } catch (error) {
      console.error('Scene export failed:', error);
      toast('当前设备无法导出画面，请尝试复制分享链接');
    } finally {
      button.disabled = false;
    }
  }

  function onStateChange(state) {
    if (state.mode === 'planet' && state.focusId) {
      if (lastVisit !== state.focusId) {
        lastVisit = state.focusId;
        local.recordVisit(state.focusId);
      }
    }
    if (tour && ((state.mode === 'planet' && state.focusId &&
      state.focusId !== tour.route.steps[tour.index].bodyId) ||
      (!tour.busy && state.mode !== 'planet'))) {
      endTour(false);
    }
    updateFavoriteButton();
    if (state.focusId) updateBodyContent(state.focusId);
  }

  async function applyLocationLink() {
    const target = parseAtlasLink(window.location.href);
    if (!target) return;
    if (target.invalid) {
      const url = new URL(window.location.href);
      url.searchParams.delete('scene');
      url.searchParams.delete('body');
      history.replaceState(history.state, '', url);
      toast('分享链接无效，已返回默认场景');
      await getUniverse().viewGalaxy();
      return;
    }
    if (target.scene === 'planet') await getUniverse().focusBody(target.body);
    else if (target.scene === 'solar') await getUniverse().viewSolar();
    else if (target.scene === 'free') await getUniverse().activateFree();
    else await getUniverse().viewGalaxy();
  }

  renderRoutes();
  renderPersonal();
  get('atlas-tab-routes').addEventListener('click', () => setTab('routes'));
  get('atlas-tab-personal').addEventListener('click', () => setTab('personal'));
  get('atlas-tour-prev').addEventListener('click', () => moveTour(-1));
  get('atlas-tour-next').addEventListener('click', () => moveTour(1));
  get('atlas-tour-exit').addEventListener('click', () => endTour());
  get('atlas-clear-favorites').addEventListener('click', () => local.clearFavorites());
  get('atlas-clear-recents').addEventListener('click', () => local.clearRecents());
  get('atlas-favorite').addEventListener('click', () => {
    const id = getState().focusId;
    if (!id) return;
    const isFavorite = local.toggleFavorite(id);
    toast(isFavorite ? '已收藏' + ALL_BY_ID[id].name : '已取消收藏');
  });
  get('atlas-orbit-toggle').addEventListener('click', () => {
    orbitOpen = !orbitOpen;
    renderOrbit(getState().focusId);
  });
  get('atlas-copy-link').addEventListener('click', copyCurrentLink);
  get('atlas-snapshot').addEventListener('click', saveCurrentSnapshot);
  get('atlas-hub-copy').addEventListener('click', copyCurrentLink);
  get('atlas-hub-snapshot').addEventListener('click', saveCurrentSnapshot);
  get('universe-canvas').addEventListener('pointerdown', handleManualNavigation);
  window.addEventListener('popstate', () => {
    endTour(false);
    applyLocationLink();
  });
  setTab('routes');
  updateFavoriteButton();

  return {
    onStateChange,
    onHubOpened: () => { setTab(selectedTab); renderPersonal(); },
    onManualNavigation: handleManualNavigation,
    endTour,
    hasActiveTour: () => Boolean(tour),
    renderComparisonScale,
    applyLocationLink,
    copyCurrentLink,
    saveCurrentSnapshot
  };
}
