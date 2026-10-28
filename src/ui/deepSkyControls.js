// T30: catalog and three educational routes in the existing T31 Explore pane.
// Directions come from OpenNGC J2000; distances are displayed as NASA's
// published approximate classroom estimates, not scene depth.
import { DEEP_SKY_CATEGORIES, loadDeepSkyCatalog }
  from '../data/science/deepSkyCatalog.js';

const get = id => document.getElementById(id);
const LABELS = {
  all: '全部类型',
  nebula: '星云与遗迹',
  cluster: '恒星星团',
  galaxy: '外部星系'
};
const element = (tag, className, content) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content !== undefined) node.textContent = content;
  return node;
};
const formatLightYears = n => '约 ' + Math.round(n).toLocaleString('zh-CN') + ' 光年';

export function createDeepSkyControls({ universe, layoutController, toast = () => {} }) {
  const host = get('objects-workspace-slot');
  if (!host) throw Error('T30: T31 探索工作区不存在');
  const panel = element('section', 't30-deep-sky-panel');
  panel.id = 't30-deep-sky-controls';
  panel.setAttribute('aria-label', 'OpenNGC 深空天体图鉴与科普路线');
  panel.append(element('span', 't30-kicker', 'OPENNGC · DEEP SKY ATLAS'));
  panel.append(element('h3', '', '深空天体图鉴'));
  panel.append(element('p', 't30-lead',
    '以 J2000 天球方向探索星云、星团与星系；课堂距离为参考估计，不控制 3D 图标的远近。'));
  const toggle = element('button', 't30-toggle', '打开深空方向图');
  toggle.id = 't30-toggle';
  toggle.type = 'button';
  toggle.setAttribute('aria-pressed', 'false');
  const status = element('p', 't30-status', '首次开启时读取本站静态深空目录。');
  status.id = 't30-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');

  const filters = element('div', 't30-filters');
  const categoryLabel = element('label', '', '类别筛选');
  categoryLabel.htmlFor = 't30-category';
  const category = element('select');
  category.id = 't30-category';
  for (const key of ['all', ...DEEP_SKY_CATEGORIES]) {
    const option = element('option', '', LABELS[key]);
    option.value = key;
    category.append(option);
  }
  categoryLabel.append(category);
  const queryLabel = element('label', '', '名称 / M / NGC 编号');
  queryLabel.htmlFor = 't30-search';
  const query = element('input');
  query.id = 't30-search';
  query.type = 'search';
  query.autocomplete = 'off';
  query.placeholder = '如 M42、NGC1976、猎户座';
  queryLabel.append(query);
  filters.append(categoryLabel, queryLabel);
  const matchesHeading = element('p', 't30-results-title', '代表性深空天体');
  const matches = element('div', 't30-results');
  matches.id = 't30-results';
  matches.setAttribute('aria-label', '深空天体检索结果');
  const detail = element('section', 't30-detail');
  detail.id = 't30-detail';
  detail.hidden = true;
  detail.setAttribute('aria-label', '深空天体资料与参考来源');
  const guideHeading = element('h4', 't30-routes-heading', '主题科普路线');
  const guides = element('div', 't30-routes');
  guides.id = 't30-routes';
  const lessonPanel = element('section', 't30-lesson');
  lessonPanel.id = 't30-lesson';
  lessonPanel.hidden = true;
  lessonPanel.setAttribute('aria-label', '当前科普课程');
  const lessonTitle = element('h4', '', '');
  lessonTitle.id = 't30-lesson-title';
  const lessonProgress = element('p', 't30-lesson-progress', '');
  lessonProgress.id = 't30-lesson-progress';
  const lessonStep = element('strong', 't30-lesson-step', '');
  lessonStep.id = 't30-lesson-step';
  const lessonPrompt = element('p', 't30-lesson-prompt', '');
  lessonPrompt.id = 't30-lesson-prompt';
  const lessonActions = element('div', 't30-lesson-actions');
  const previous = element('button', '', '上一站');
  previous.id = 't30-prev';
  previous.type = 'button';
  const next = element('button', '', '下一站');
  next.id = 't30-next';
  next.type = 'button';
  const stop = element('button', '', '结束课程');
  stop.id = 't30-stop';
  stop.type = 'button';
  lessonActions.append(previous, next, stop);
  lessonPanel.append(lessonTitle, lessonProgress, lessonStep,
    lessonPrompt, lessonActions);
  const note = element('p', 't30-note',
    'OpenNGC 位置为 J2000 赤经/赤纬（CC BY-SA 4.0），天球标记只是方向投影；' +
    '课程是主题顺序，没有真实星际航行距离。页面使用原创建的示意光点，真实哈勃影像和逐图版权信息见 NASA 链接。');
  const source = element('a', 't30-source', 'OpenNGC 原始目录与许可');
  source.href = 'https://github.com/mattiaverga/OpenNGC';
  source.target = '_blank';
  source.rel = 'noopener noreferrer';
  panel.append(toggle, status, filters, matchesHeading, matches, detail,
    guideHeading, guides, lessonPanel, note, source);
  const gaia = get('t29-gaia-controls');
  if (gaia?.parentElement === host) gaia.after(panel);
  else host.append(panel);

  let catalog = null;
  let loading = false;
  let selectedId = null;
  let lesson = null;

  function showObject(object) {
    detail.replaceChildren();
    detail.hidden = !object;
    if (!object) return;
    const title = element('h4', '', object.id + ' · ' + object.nameZh);
    title.id = 't30-detail-title';
    const english = element('p', 't30-detail-en',
      object.nameEn + ' · ' + object.catalogId + ' · ' + object.subtype);
    const description = element('p', '', object.intro);
    const stats = element('dl');
    const fields = [
      ['类型', LABELS[object.category] + ' / ' + object.subtype],
      ['J2000 赤经', object.position.raDeg.toFixed(5) + '°'],
      ['J2000 赤纬', object.position.decDeg.toFixed(5) + '°'],
      ['参考距离', formatLightYears(object.distance.approximateLightYears)],
      ['主要角径', object.angularSizeArcmin.major === null ? '未提供' :
        object.angularSizeArcmin.major + ' 角分'],
      ['亮度', object.magnitude === null ? '未提供' :
        object.magnitude.band + ' 波段 ' + object.magnitude.value + ' 等']
    ];
    for (const [term, value] of fields) {
      const line = element('div');
      line.append(element('dt', '', term), element('dd', '', value));
      stats.append(line);
    }
    const caution = element('p', 't30-detail-caution',
      '距离是 NASA 参考的近似值，不确定度随对象和测量方法变化；' +
      '画面中的 3D 光点不代表真实大小、实际深度或空间间距。');
    const nasaLink = element('a', 't30-nasa-link', 'NASA 距离资料与观测照片（含图片署名）');
    nasaLink.href = object.imagery.observedPhotoGalleryUrl;
    nasaLink.target = '_blank';
    nasaLink.rel = 'noopener noreferrer';
    const sourceLink = element('a', 't30-openngc-link', 'OpenNGC 坐标原始目录');
    sourceLink.href = object.sources.catalogUrl;
    sourceLink.target = '_blank';
    sourceLink.rel = 'noopener noreferrer';
    detail.append(title, english, description, stats, caution, nasaLink, sourceLink);
  }

  function renderLesson() {
    lessonPanel.hidden = !lesson;
    if (!lesson) return;
    const { route, index, completed } = lesson;
    lessonTitle.textContent = route.title;
    lessonProgress.textContent = completed
      ? '路线已完成 · ' + route.steps.length + ' / ' + route.steps.length
      : '站点 ' + (index + 1) + ' / ' + route.steps.length;
    const step = route.steps[index];
    lessonStep.textContent = step.title + ' · ' + step.objectId;
    lessonPrompt.textContent = completed
      ? '已完成本条教学路线；可选择另一条路线或结束课程。'
      : step.prompt;
    previous.disabled = completed || index === 0;
    next.disabled = completed;
    next.textContent = index === route.steps.length - 1 ? '完成课程' : '下一站';
  }

  function render(state = {}) {
    const active = universe.getDeepSkyInfo().active;
    const mode = state.mode || universe.mode;
    get('app').dataset.deepSkyMode = active ? 'catalog' : 'illustration';
    toggle.textContent = active ? '返回银河结构示意' :
      mode === 'galaxy' ? '打开深空方向图' : '前往深空方向图';
    toggle.setAttribute('aria-pressed', String(active));
    toggle.disabled = loading;
    category.disabled = loading;
    if (!loading) {
      status.textContent = catalog
        ? 'OpenNGC ' + catalog.objects.length + ' 个对象 · ' +
          catalog.routes.length + ' 条课程 · ' +
          (active ? 'J2000 天球方向模式' : '当前为原银河结构示意')
        : '点击打开，加载本站 OpenNGC 代表性深空对象。';
    }
    matches.replaceChildren();
    guides.replaceChildren();
    if (!catalog) {
      matches.append(element('p', 't30-empty', '尚未读取目录，首次进入后可检索对象与课程。'));
      guides.append(element('p', 't30-empty', '读取目录后显示三条可操作的课程。'));
      renderLesson();
      return;
    }
    const items = catalog.search(query.value, { category: category.value, limit: 24 });
    if (!items.length) matches.append(element('p', 't30-empty',
      '当前条件没有对象，请尝试其他编号或类别。'));
    for (const object of items) {
      const button = element('button', 't30-object');
      button.type = 'button';
      button.dataset.objectId = object.id;
      button.setAttribute('aria-label', '观察 ' + object.id + ' ' + object.nameZh);
      button.append(element('strong', '', object.id + ' · ' + object.nameZh),
        element('small', '', LABELS[object.category] + ' · ' +
          formatLightYears(object.distance.approximateLightYears)));
      button.addEventListener('click', async () => {
        if (loading) return;
        if (!universe.deepSkyActive && !await activate()) return;
        category.value = 'all';
        universe.setDeepSkyCategory('all');
        if (!universe.focusDeepSkyObject(object.id)) {
          toast('当前深空对象暂时无法聚焦');
          return;
        }
        selectedId = object.id;
        showObject(object);
      });
      matches.append(button);
    }
    for (const route of catalog.routes) {
      const card = element('button', 't30-route');
      card.type = 'button';
      card.dataset.routeId = route.id;
      card.append(element('strong', '', route.title),
        element('small', '', route.subtitle + ' · ' + route.steps.length + ' 站'));
      card.addEventListener('click', () => startLesson(route.id));
      guides.append(card);
    }
    if (selectedId) showObject(catalog.get(selectedId));
    renderLesson();
  }

  async function activate() {
    if (loading) return false;
    loading = true;
    status.textContent = '正在读取 OpenNGC 对象目录与教学路线…';
    render();
    try {
      if (!catalog) catalog = await loadDeepSkyCatalog();
      universe.setDeepSkyCatalog(catalog);
      if (universe.mode !== 'galaxy') await universe.viewGalaxy();
      if (universe.transitioning || !universe.setDeepSkyActive(true)) {
        throw Error('当前场景还在切换，无法打开深空方向图');
      }
      layoutController.setDrawer('objects');
      return true;
    } catch (error) {
      console.warn('T30 deep sky unavailable:', error);
      toast('深空目录暂不可用：' + error.message);
      return false;
    } finally {
      loading = false;
      render();
    }
  }

  async function showLessonStep(index) {
    if (!lesson || index < 0 || index >= lesson.route.steps.length) return false;
    if (!universe.deepSkyActive && !await activate()) return false;
    category.value = 'all';
    universe.setDeepSkyCategory('all');
    const step = lesson.route.steps[index];
    const object = catalog.get(step.objectId);
    if (!object || !universe.focusDeepSkyObject(step.objectId)) return false;
    lesson.index = index;
    lesson.completed = false;
    selectedId = object.id;
    showObject(object);
    renderLesson();
    return true;
  }

  async function startLesson(routeId) {
    if (loading) return;
    if (!catalog && !await activate()) return;
    const route = catalog.getRoute(routeId);
    if (!route) return;
    lesson = { route, index: 0, completed: false };
    if (!await showLessonStep(0)) {
      lesson = null;
      toast('当前无法进入路线的第一站');
    }
    renderLesson();
  }
  previous.addEventListener('click', async () => {
    if (lesson && !lesson.completed) await showLessonStep(lesson.index - 1);
  });
  next.addEventListener('click', async () => {
    if (!lesson || lesson.completed) return;
    if (lesson.index === lesson.route.steps.length - 1) {
      lesson.completed = true;
      renderLesson();
      return;
    }
    await showLessonStep(lesson.index + 1);
  });
  stop.addEventListener('click', () => {
    lesson = null;
    renderLesson();
  });
  toggle.addEventListener('click', async () => {
    if (loading) return;
    if (universe.deepSkyActive) {
      universe.setDeepSkyActive(false);
      selectedId = null;
      lesson = null;
      showObject(null);
      render();
    } else await activate();
  });
  category.addEventListener('change', () => {
    universe.setDeepSkyCategory(category.value);
    render();
  });
  query.addEventListener('input', () => render());
  render();
  return {
    render, activate, getCatalog: () => catalog,
    getLessonState: () => lesson ? {
      routeId: lesson.route.id, index: lesson.index,
      count: lesson.route.steps.length, completed: lesson.completed
    } : null
  };
}
