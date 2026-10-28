// T29: the Gaia catalog lives in the existing T31 exploration workspace.
// It never adds another global navigation bar or silently mixes catalog
// points with the procedural Milky Way illustration.
import {
  GAIA_DISTANCE_LIMITS, GAIA_MAG_LIMITS, loadGaiaCatalog
} from '../data/science/gaiaCatalog.js';

const get = id => document.getElementById(id);
function node(tag, className, content) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (content !== undefined) element.textContent = content;
  return element;
}
function makeSelect(id, label, choices, initialValue) {
  const wrapper = node('label', 't29-filter');
  wrapper.textContent = label;
  const select = node('select');
  select.id = id;
  select.setAttribute('aria-label', label);
  for (const [value, text] of choices) {
    const option = node('option', '', text);
    option.value = String(value);
    select.append(option);
  }
  select.value = String(initialValue);
  wrapper.append(select);
  return { wrapper, select };
}

export function createGaiaControls({ universe, layoutController, toast = () => {} }) {
  const host = get('objects-workspace-slot');
  if (!host) throw Error('T29: missing T31 exploration workspace');
  const section = node('section', 't29-gaia-panel');
  section.id = 't29-gaia-controls';
  section.setAttribute('aria-label', 'Gaia DR3 真实恒星目录');
  section.append(node('span', 't29-kicker', 'GAIA DR3 · LOCAL STAR SAMPLE'));
  section.append(node('h3', '', '真实恒星目录'));
  section.append(node('p', 't29-lead',
    'ESA Gaia DR3 的可追溯小样本，按 J2016.0 ICRS 方向和高质量视差绘制局部恒星。'));
  const toggle = node('button', 't29-mode-button', '打开 Gaia 真实恒星层');
  toggle.id = 't29-gaia-toggle';
  toggle.type = 'button';
  toggle.setAttribute('aria-pressed', 'false');
  const status = node('p', 't29-status', '目录按需载入；原银河为结构示意。');
  status.id = 't29-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const filters = node('div', 't29-filters');
  const distance = makeSelect('t29-distance', '最大距离',
    GAIA_DISTANCE_LIMITS.map(value => [value, '≤ ' + value + ' pc']), 400);
  const magnitude = makeSelect('t29-magnitude', '可见亮度',
    GAIA_MAG_LIMITS.map(value => [value, 'G < ' + value]), 16);
  filters.append(distance.wrapper, magnitude.wrapper);
  const lookup = node('div', 't29-lookup');
  const searchLabel = node('label', '', '检索 Gaia DR3 源编号');
  searchLabel.htmlFor = 't29-source-search';
  const search = node('input');
  search.id = 't29-source-search';
  search.type = 'search';
  search.placeholder = '输入完整或部分 source_id';
  search.autocomplete = 'off';
  const loadAll = node('button', 't29-load-all', '读取全部距离分块');
  loadAll.id = 't29-load-all';
  loadAll.type = 'button';
  lookup.append(searchLabel, search, loadAll);
  const resultHeading = node('p', 't29-result-heading',
    '源记录（按 Gaia G 波段视星等排序）');
  const results = node('div', 't29-results');
  results.id = 't29-results';
  results.setAttribute('aria-label', 'Gaia 恒星检索结果');
  const detail = node('section', 't29-source-detail');
  detail.id = 't29-source-detail';
  detail.setAttribute('aria-label', 'Gaia 源记录详细数据');
  detail.hidden = true;
  const footnote = node('p', 't29-note',
    '这是筛选后的 1000 pc 内随机样本，并非完整银河系星表。位置为 J2016.0；' +
    '距离只对高信噪比正视差采用 1000/视差估算；点的颜色与大小是视觉编码，不代表实际星体尺寸。');
  const sourceLink = node('a', 't29-source-link', 'ESA Gaia DR3 官方档案');
  sourceLink.href = 'https://gea.esac.esa.int/archive/';
  sourceLink.target = '_blank';
  sourceLink.rel = 'noopener noreferrer';
  section.append(toggle, status, filters, lookup,
    resultHeading, results, detail, footnote, sourceLink);
  const planetDock = get('planet-dock');
  if (planetDock?.parentElement === host) planetDock.before(section);
  else host.append(section);
  let catalog = null;
  let busy = false;
  let activeSource = null;
  const chosenDistance = () => Number(distance.select.value);
  const chosenMagnitude = () => Number(magnitude.select.value);

  function showSource(row) {
    detail.replaceChildren();
    if (!row) {
      detail.hidden = true;
      return;
    }
    detail.hidden = false;
    const title = node('strong', '', row.designation);
    const explanation = node('p', '', 'J2016.0 · ICRS 坐标 · ESA Gaia DR3');
    const stats = node('dl');
    for (const [label, value] of [
      ['赤经 (°)', row.raDeg.toFixed(6)],
      ['赤纬 (°)', row.decDeg.toFixed(6)],
      ['视差 (mas)', row.parallaxMas.toFixed(3)],
      ['视差 SNR', row.parallaxOverError.toFixed(1)],
      ['估计距离 (pc)', row.distancePc?.toFixed(1) ?? '不可可靠估计'],
      ['G 视星等', row.gMag.toFixed(2)],
      ['BP−RP', row.bpRp.toFixed(2)]
    ]) {
      const pair = node('div');
      pair.append(node('dt', '', label), node('dd', '', value));
      stats.append(pair);
    }
    detail.append(title, explanation, stats);
  }

  function render(state = {}) {
    const active = universe.getGaiaInfo().active;
    const mode = state.mode || universe.mode;
    get('app').dataset.gaiaMode = active ? 'catalog' : 'illustration';
    toggle.textContent = active ? '返回银河结构示意' :
      mode === 'galaxy' ? '打开 Gaia 真实恒星层' : '前往 Gaia DR3 恒星层';
    toggle.setAttribute('aria-pressed', String(active));
    toggle.disabled = busy;
    distance.select.disabled = busy;
    magnitude.select.disabled = busy;
    loadAll.disabled = busy || Boolean(catalog?.isComplete());
    if (!busy) status.textContent = catalog
      ? '真实记录 ' + catalog.loadedCount().toLocaleString('zh-CN') +
        ' / ' + catalog.manifest.total.toLocaleString('zh-CN') + ' · ' +
        (active ? 'Gaia J2016.0 局部恒星层' : '当前为银河结构示意')
      : '首次进入时从本站静态资源读取 Gaia DR3 样本。';
    results.replaceChildren();
    if (!catalog) {
      results.append(node('p', 't29-empty', '载入目录后可按源编号检索与定位。'));
      return;
    }
    const list = catalog.search(search.value, {
      maxPc: chosenDistance(), maxMag: chosenMagnitude(), limit: 18
    });
    if (!list.length) {
      results.append(node('p', 't29-empty',
        '当前范围无结果。可放宽距离/视星等，或读取全部分块。'));
    }
    for (const row of list) {
      const button = node('button', 't29-result');
      button.type = 'button';
      button.dataset.sourceId = row.sourceId;
      button.setAttribute('aria-label', '定位 ' + row.designation);
      button.append(node('strong', '', row.designation),
        node('small', '', 'G ' + row.gMag.toFixed(2) + ' · ' +
          row.distancePc.toFixed(1) + ' pc · RA ' + row.raDeg.toFixed(2) +
          '° · Dec ' + row.decDeg.toFixed(2) + '°'));
      button.addEventListener('click', async () => {
        if (busy) return;
        if (!universe.gaiaActive) {
          const switched = await activate();
          if (!switched) return;
        }
        if (!universe.focusGaiaSource(row.sourceId)) {
          toast('目标暂时无法定位，请检查图层设置');
          return;
        }
        activeSource = row.sourceId;
        showSource(row);
      });
      results.append(button);
    }
    if (activeSource) showSource(catalog.getSource(activeSource));
  }

  async function ensureCatalog(upToPc) {
    if (!catalog) catalog = await loadGaiaCatalog();
    await catalog.ensureDistance(upToPc);
    universe.setGaiaCatalog(catalog);
    universe.setGaiaFilters({
      distancePc: chosenDistance(), magnitude: chosenMagnitude()
    });
    return catalog;
  }

  async function activate() {
    if (busy) return false;
    busy = true;
    status.textContent = '正在读取 Gaia DR3 位置与视差分块…';
    render();
    try {
      await ensureCatalog(chosenDistance());
      if (universe.mode !== 'galaxy') await universe.viewGalaxy();
      if (universe.transitioning || !universe.setGaiaActive(true)) {
        throw Error('场景仍在切换，无法打开 Gaia 图层');
      }
      layoutController.setDrawer('objects');
      return true;
    } catch (error) {
      console.warn('Gaia catalog unavailable:', error);
      toast('Gaia 目录暂不可用：' + error.message);
      return false;
    } finally {
      busy = false;
      render();
    }
  }

  toggle.addEventListener('click', async () => {
    if (busy) return;
    if (universe.gaiaActive) {
      universe.setGaiaActive(false);
      activeSource = null;
      showSource(null);
      render();
    } else await activate();
  });
  const updateFilters = async () => {
    if (busy) return;
    busy = true;
    status.textContent = '正在读取所选距离范围…';
    render();
    try {
      if (catalog) await ensureCatalog(chosenDistance());
    } catch (error) {
      console.warn('Gaia filter loading failed:', error);
      toast('恒星分块载入失败，可重新选择距离重试');
    } finally {
      busy = false;
      render();
    }
  };
  distance.select.addEventListener('change', updateFilters);
  magnitude.select.addEventListener('change', updateFilters);
  search.addEventListener('input', () => render());
  loadAll.addEventListener('click', async () => {
    distance.select.value = '1000';
    if (catalog) await updateFilters();
    else {
      busy = true;
      status.textContent = '正在读取全部 Gaia DR3 距离分块…';
      render();
      try {
        await ensureCatalog(1000);
      } catch (error) {
        console.warn('Gaia full sample unavailable:', error);
        toast('完整目录读取失败，可稍后重试');
      } finally {
        busy = false;
        render();
      }
    }
  });
  render();
  return { render, activate, getCatalog: () => catalog };
}
