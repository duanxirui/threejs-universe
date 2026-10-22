// T15 stage 1: one owner for the responsive workspaces and their focus state.
// Existing elements are moved, not copied, so their handlers and IDs survive.
const DRAWERS = new Set(['none', 'scene', 'objects', 'time', 'detail', 'flight', 'settings']);
const get = id => document.getElementById(id);

function move(id, slot) {
  const element = get(id);
  const destination = get(slot);
  if (!element || !destination) throw new Error('Missing layout element: ' + id + ' / ' + slot);
  destination.append(element);
  return element;
}

function focusVisible(element) {
  if (element?.isConnected && !element.closest('[inert], [hidden]') &&
      element.getClientRects().length) {
    element.focus({ preventScroll: true });
    return true;
  }
  return false;
}

export function createLayoutController({
  onLayoutChange = () => {}, onDetailOpen = () => {}
} = {}) {
  const root = get('app');
  const workspace = get('workspace-panel');
  const detail = get('detail-panel');
  const detailPeek = get('detail-peek-trigger');
  const dockToggle = get('planet-dock-toggle');
  const mobileScene = get('mobile-scene-trigger');
  const drawers = {
    objects: get('objects-workspace-slot'),
    flight: get('objects-workspace-slot'),
    time: get('time-workspace-slot'),
    settings: get('settings-workspace-slot')
  };
  const triggers = {
    objects: [dockToggle, get('rail-objects-trigger')],
    flight: [dockToggle, get('rail-objects-trigger')],
    time: [get('time-open-trigger'), get('rail-time-trigger')],
    detail: [detailPeek],
    settings: [get('rail-settings-trigger'), get('global-settings-trigger')]
  };
  let uiMode = 'compact';
  let activeDrawer = 'none';
  let scene = 'galaxy';
  let focusId = null;
  let sceneTargetName = null;

  // Reference-inspired layout: brand at top-left, controls at top-right,
  // context status at bottom-left and three actions at bottom-right.
  document.querySelector('.topbar').prepend(get('brand-home'));
  get('objects-workspace-slot').prepend(document.querySelector('.view-nav'));
  move('detail-peek-trigger', 'capsule-info-slot');
  move('planet-dock-toggle', 'capsule-dock-slot');
  move('planet-dock', 'objects-workspace-slot');
  get('time-workspace-slot').append(document.querySelector('.simulation-panel'));
  // Zoom and reset must remain reachable without opening the motion drawer.
  root.append(document.querySelector('.camera-tools'));
  // Keep the two native selects side by side in one visible flight panel.
  move('flight-speed-control', 'flight-speed-slot');
  move('flight-quick-stop', 'flight-safety');
  // Reparent the original controls; never create duplicate inputs or handlers.
  get('settings-workspace-slot').prepend(document.querySelector('.quality-control'));
  move('orbit-toggle', 'settings-workspace-slot');
  move('label-toggle', 'settings-workspace-slot');
  move('help-trigger', 'settings-workspace-slot');
  get('settings-workspace-slot').append(document.querySelector('.render-status'));

  // Compose the existing setting inputs into one compact, readable workspace.
  // These controls retain their original IDs, nodes and event listeners.
  const settings = get('settings-workspace-slot');
  const settingsHeading = document.createElement('div');
  settingsHeading.className = 'settings-heading';
  settingsHeading.innerHTML = '<span>DISPLAY SETTINGS</span>' +
    '<h2>观测设置</h2><p>调整画质、轨道与天体标记</p>';

  const settingsGroup = document.createElement('section');
  settingsGroup.className = 'settings-group';
  const groupTitle = document.createElement('div');
  groupTitle.className = 'settings-group-title';
  groupTitle.textContent = '画面与显示';
  const settingsRows = document.createElement('div');
  settingsRows.className = 'settings-rows';
  settingsGroup.append(groupTitle, settingsRows);

  const makeCopy = (title, description) => {
    const copy = document.createElement('span');
    copy.className = 'settings-row-copy';
    const strong = document.createElement('strong');
    strong.textContent = title;
    const small = document.createElement('small');
    small.textContent = description;
    copy.append(strong, small);
    return copy;
  };
  const quality = document.querySelector('.quality-control');
  quality.removeAttribute('title');
  quality.replaceChildren(
    makeCopy('渲染画质', '自动平衡画面精细度与性能'),
    get('quality-select')
  );
  settingsRows.append(quality);
  for (const [id, title, description] of [
    ['orbit-toggle', '轨道线', '显示行星和卫星的运动路径'],
    ['label-toggle', '天体标签', '显示画面中的天体名称']
  ]) {
    const button = get(id);
    const toggle = button.querySelector('i');
    button.replaceChildren(makeCopy(title, description), toggle);
    settingsRows.append(button);
  }

  const help = get('help-trigger');
  help.classList.add('settings-guide-link');
  help.setAttribute('aria-label', '打开探索指南');
  help.title = '打开探索指南';
  const helpIcon = help.querySelector('.ui-icon');
  const helpArrow = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  helpArrow.classList.add('ui-icon', 'settings-guide-arrow');
  helpArrow.setAttribute('aria-hidden', 'true');
  const helpArrowUse = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  helpArrowUse.setAttribute('href', '#ic-arrow-up-right');
  helpArrow.append(helpArrowUse);
  help.replaceChildren(helpIcon,
    makeCopy('探索指南', '查看视角、航行与快捷键说明'), helpArrow);
  const footer = document.createElement('div');
  footer.className = 'settings-footer';
  const statusLabel = document.createElement('span');
  statusLabel.textContent = '实时渲染状态';
  footer.append(statusLabel, document.querySelector('.render-status'));
  settings.replaceChildren(settingsHeading, settingsGroup, help, footer);

  function openerFor(drawer) {
    return triggers[drawer]?.find(button =>
      button?.isConnected && button.getClientRects().length &&
      !button.closest('[inert], [hidden]')) || get('search-trigger');
  }

  function sync() {
    const detailAvailable = scene !== 'planet' || Boolean(focusId);
    const isDetailOpen = activeDrawer === 'detail' && detailAvailable;
    const workDrawer = drawers[activeDrawer];
    const pure = uiMode === 'pure';
    const motionAvailable = scene === 'solar' || scene === 'planet';
    root.dataset.layout = 't15';
    root.dataset.uiMode = uiMode;
    root.dataset.activeDrawer = activeDrawer;
    root.dataset.dock = (activeDrawer === 'objects' || activeDrawer === 'flight') ? 'open' : 'closed';
    workspace.inert = !workDrawer || pure;
    workspace.setAttribute('aria-hidden', String(!workDrawer || pure));
    for (const slot of new Set(Object.values(drawers))) {
      const visible = slot === workDrawer && !pure;
      slot.inert = !visible;
      slot.setAttribute('aria-hidden', String(!visible));
    }
    detail.inert = !isDetailOpen || pure;
    detail.setAttribute('aria-hidden', String(!isDetailOpen || pure));
    detail.classList.toggle('is-visible', isDetailOpen);
    detailPeek.hidden = false;
    detailPeek.setAttribute('aria-controls', 'detail-panel');
    detailPeek.setAttribute('aria-expanded', String(isDetailOpen));
    detailPeek.removeAttribute('aria-haspopup');
    const infoTarget = scene === 'galaxy' ? '银河系' :
      scene === 'free' ? (sceneTargetName || '自由漫游') : '太阳系';
    detailPeek.setAttribute('aria-label', (isDetailOpen ? '收起' : '查看') +
      (scene === 'planet' ? get('detail-name').textContent : infoTarget) + '资料');
    const drawerExpanded = activeDrawer === 'objects' || activeDrawer === 'flight';
    dockToggle.setAttribute('aria-expanded', String(drawerExpanded));
    get('rail-objects-trigger').setAttribute('aria-expanded', String(drawerExpanded));
    for (const name of ['time', 'settings']) {
      for (const trigger of triggers[name]) trigger?.setAttribute('aria-expanded', String(activeDrawer === name));
    }
    get('detail-peek-name').textContent = '天体资料';
    // The brand remains interactive; the scene readout is hidden in pure mode.
    for (const id of ['search-trigger', 'global-settings-trigger', 'time-capsule']) {
      const el = get(id);
      if (el) el.inert = pure;
    }
    const readout = get('scene-readout');
    if (readout) {
      const covered = window.matchMedia('(max-width: 640px)').matches &&
        activeDrawer !== 'none';
      readout.inert = pure || covered;
      readout.setAttribute('aria-hidden', String(pure || covered));
    }
    detailPeek.inert = pure;
    const timeTrigger = get('time-open-trigger');
    timeTrigger.hidden = !motionAvailable;
    timeTrigger.inert = !motionAvailable || pure;
    timeTrigger.setAttribute('aria-hidden', String(!motionAvailable || pure));
    get('rail-time-trigger').inert = !motionAvailable || pure;
    const cameraTools = document.querySelector('.camera-tools');
    cameraTools.inert = pure;
    cameraTools.setAttribute('aria-hidden', String(pure));
    const pureTrigger = get('pure-mode-trigger');
    if (pureTrigger) {
      pureTrigger.setAttribute('aria-pressed', String(pure));
      pureTrigger.setAttribute('aria-label', pure ? '退出纯净观赏模式' : '进入纯净观赏模式');
      pureTrigger.title = (pure ? '退出' : '进入') + '纯净观赏 (H)';
    }
  }

  function setDrawer(next, { restoreFocus = true } = {}) {
    if (!DRAWERS.has(next)) return false;
    if (next === 'scene') next = 'none'; // scene is controlled by the global scene navigation
    if (next === 'time' && scene !== 'solar' && scene !== 'planet') return false;
    if (next === 'detail' && scene === 'planet' && !focusId) next = 'none';
    if (next === 'flight' && scene !== 'free') next = 'objects';
    if (next === 'objects' && scene === 'free') next = 'flight';
    const previous = activeDrawer;
    if (previous === next) return false;
    const focusedWasInside = previous === 'detail'
      ? detail.contains(document.activeElement)
      : Boolean(drawers[previous]?.contains(document.activeElement));
    activeDrawer = next;
    sync();
    if (restoreFocus && focusedWasInside) {
      const opener = openerFor(previous);
      requestAnimationFrame(() => {
        if (!focusVisible(opener)) focusVisible(get('search-trigger'));
      });
    }
    onLayoutChange();
    return true;
  }

  function toggleDrawer(name) {
    const realName = name === 'objects' && scene === 'free' ? 'flight' : name;
    return setDrawer(activeDrawer === realName ? 'none' : realName);
  }

  function setScene(nextScene, nextFocusId, targetName, targetIndex) {
    const wasScene = scene;
    scene = nextScene;
    focusId = nextFocusId || null;
    sceneTargetName = targetName || null;
    if (activeDrawer === 'flight' && scene !== 'free') activeDrawer = 'none';
    if (activeDrawer === 'objects' && scene === 'free') activeDrawer = 'flight';
    if (activeDrawer === 'time' && scene !== 'solar' && scene !== 'planet') activeDrawer = 'none';
    const name = scene === 'planet' ? '太阳系' :
      scene === 'galaxy' ? '宇宙全景' : scene === 'solar' ? '太阳系' : '自由漫游';
    mobileScene.firstChild.textContent = name + ' ';
    const number = scene === 'planet' ? (targetIndex || '02') :
      scene === 'galaxy' ? '01' : scene === 'solar' ? '02' : '03';
    get('scene-readout-label').textContent = scene === 'planet' ? '当前天体' : '当前场景';
    get('scene-readout-number').textContent = number;
    get('scene-readout-name').textContent = scene === 'planet' ? (targetName || '星球近景') : name;
    get('header-scene-status').textContent = (scene === 'planet' ? targetName || '星球近景' : name) + ' / ' + number;
    sync();
    if (wasScene !== scene) onLayoutChange();
  }

  function setUiMode(next) {
    if (!['compact', 'pure'].includes(next) || uiMode === next) return;
    uiMode = next;
    if (next === 'pure') setDrawer('none', { restoreFocus: false });
    sync();
    // H can be pressed while keyboard focus is inside a drawer that becomes
    // hidden. Give focus a visible destination rather than leaving it inert.
    if (next === 'pure') focusVisible(get('pure-mode-trigger'));
    onLayoutChange();
  }

  get('rail-objects-trigger').addEventListener('click', () => toggleDrawer('objects'));
  get('rail-time-trigger').addEventListener('click', () => toggleDrawer('time'));
  get('rail-settings-trigger').addEventListener('click', () => toggleDrawer('settings'));
  get('global-settings-trigger').addEventListener('click', () => toggleDrawer('settings'));
  get('time-open-trigger').addEventListener('click', () => toggleDrawer('time'));
  detailPeek.addEventListener('click', () => {
    if (activeDrawer === 'detail') {
      setDrawer('none');
      return;
    }
    setDrawer('detail');
    onDetailOpen();
    requestAnimationFrame(() => {
      if (activeDrawer === 'detail') focusVisible(get('detail-close'));
    });
  });

  sync();
  return {
    get activeDrawer() { return activeDrawer; },
    get uiMode() { return uiMode; },
    get isObjectsOpen() { return activeDrawer === 'objects' || activeDrawer === 'flight'; },
    setDrawer, toggleDrawer, setScene, setUiMode, sync
  };
}
