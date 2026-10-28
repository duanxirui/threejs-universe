// T26 date-driven interface. Reuses the existing T31 time workspace.
// Dates are explicitly UTC; opening the page does not download ephemeris data.
import {
  formatUtcDisplay, formatUtcInput, loadEphemerisStore, parseUtcDateTime
} from '../data/science/ephemeris.js';

const get = id => document.getElementById(id);
function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

export function createEphemerisControls({ universe, toast = () => {} }) {
  const host = get('time-workspace-slot');
  const section = node('section', 't26-date-panel');
  section.id = 't26-date-panel';
  section.setAttribute('aria-label', '日期驱动太阳系');
  const header = node('div', 't26-date-heading');
  const title = node('h2', '', 'UTC 日期星历');
  const badge = node('span', 't26-mode-badge', '演示模式');
  badge.id = 't26-mode-badge';
  header.append(title, badge);
  const hint = node('p', 't26-date-hint',
    '支持太阳、地球、月球、火星。日期位置来自 NASA/JPL Horizons DE441；其他天体继续使用演示轨道。');
  const label = node('label', 't26-date-label', '选择日期与时间（UTC）');
  label.htmlFor = 't26-utc-input';
  const input = node('input', 't26-utc-input');
  input.id = 't26-utc-input';
  input.type = 'datetime-local';
  input.step = '3600';
  input.min = '2026-01-01T00:00';
  input.max = '2028-01-01T00:00';
  const first = Date.UTC(2026, 0, 1);
  const last = Date.UTC(2028, 0, 1);
  input.value = formatUtcInput(Math.min(last, Math.max(first, Date.now())));
  const buttons = node('div', 't26-date-actions');
  const apply = node('button', 't26-apply', '载入并应用日期');
  apply.id = 't26-apply';
  apply.type = 'button';
  const demo = node('button', 't26-demo', '返回演示模式');
  demo.id = 't26-demo';
  demo.type = 'button';
  demo.hidden = true;
  buttons.append(apply, demo);
  const status = node('p', 't26-date-status',
    '2026–2027 年每日采样 · 首次应用时按需读取本地星历数据');
  status.id = 't26-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const footnote = node('p', 't26-date-footnote',
    '地月间距和球体大小为视觉增强；日期模式隐藏原演示轨道线。当前数据为静态快照，不自动联网更新。');
  section.append(header, hint, label, input, buttons, status, footnote);
  host.prepend(section);
  const app = get('app');
  const banner = get('t31-science-status');
  let busy = false;
  let edited = false;
  let lastMinute = null;
  let lastMode = null;

  function render(info = universe.getEphemerisInfo()) {
    const enabled = Boolean(info?.enabled);
    const shown = enabled ? formatUtcDisplay(info.utcMs) : null;
    const minute = enabled ? Math.floor(info.utcMs / 60000) : null;
    if (!edited && enabled && (lastMinute !== minute || lastMode !== enabled)) {
      input.value = formatUtcInput(info.utcMs);
    }
    lastMinute = minute;
    lastMode = enabled;
    app.dataset.ephemerisMode = enabled ? 'date' : 'demo';
    const physical = universe.getScaleInfo().mode === 'physical';
    badge.textContent = enabled ? 'DE441 星历' : '演示模式';
    demo.hidden = !enabled;
    apply.textContent = enabled ? '跳转到所选 UTC 日期' : '载入并应用日期';
    if (!busy && status.dataset.state !== 'error') {
      status.textContent = enabled
        ? shown + ' · 仅四个天体使用日期星历，其余为演示位置'
        : '科普演示模式 · 选择 UTC 日期可载入星历快照';
    }
    if (enabled) {
      banner.textContent = 'DE441 星历 · ' + shown + (physical ? ' · 实距' : '');
      banner.setAttribute('aria-label',
        '使用 JPL DE441 日期星历：' + shown + '；仅四个天体使用日期位置');
    } else {
      banner.textContent = '科普演示 · 可切换 UTC 星历' + (physical ? ' · 实距' : '');
      banner.setAttribute('aria-label', '目前为演示轨道，可以在时间面板启用 UTC 日期星历');
    }
    footnote.textContent = physical
      ? '当前统一真实比例：太阳系总览中的天体非常小，可通过探索列表聚焦。只有四天体有日期星历，其他天体使用演示角度。'
      : '地月间距和球体大小为视觉增强；日期模式隐藏原演示轨道线。当前数据为静态快照，不自动联网更新。';
  }
  function error(message) {
    status.textContent = message;
    status.dataset.state = 'error';
    toast(message);
  }
  input.addEventListener('input', () => {
    edited = true;
    status.dataset.state = 'ready';
    status.textContent = '选择完毕后点击应用；日期按 UTC 解释';
  });
  apply.addEventListener('click', async () => {
    if (busy) return;
    const utcMs = parseUtcDateTime(input.value);
    if (utcMs === null) return error('日期格式无效，请选择正确的 UTC 时间');
    busy = true;
    apply.disabled = true;
    status.dataset.state = 'loading';
    status.textContent = '正在载入本地 NASA/JPL 星历快照…';
    try {
      const store = await loadEphemerisStore();
      input.min = formatUtcInput(store.startMs);
      input.max = formatUtcInput(store.endMs);
      if (!store.hasUtc(utcMs)) {
        return error('日期超出数据范围：' +
          formatUtcInput(store.startMs) + ' 至 ' + formatUtcInput(store.endMs) + ' UTC');
      }
      if (universe.transitioning) return error('正在切换场景，请稍后应用日期');
      const active = universe.getEphemerisInfo().enabled;
      const applied = active
        ? universe.seekEphemerisUtc(utcMs)
        : universe.enableEphemeris(store, utcMs);
      if (!applied) return error('该日期的数据不可用，请改选支持的日期');
      edited = false;
      status.dataset.state = 'ready';
      toast('已应用 ' + formatUtcDisplay(utcMs) + ' · 四天体星历');
      // In the galaxy landing view, reveal the solar system after applying.
      if (universe.mode === 'galaxy') await universe.viewSolar();
    } catch (cause) {
      console.warn('T26 ephemeris unavailable:', cause);
      return error('无法载入日期星历，仍保留原演示位置；可稍后重试');
    } finally {
      busy = false;
      apply.disabled = false;
      render();
    }
  });
  demo.addEventListener('click', () => {
    if (busy) return;
    if (universe.disableEphemeris()) {
      edited = false;
      status.dataset.state = 'ready';
      toast('已返回科普演示轨道');
      render();
    }
  });
  render();
  return { render, getInput: () => input.value };
}
