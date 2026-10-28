// T31: responsive workspace state; existing business elements keep their IDs.
import { createWorkspaceRegistry } from './workspaceRegistry.js';
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
  onLayoutChange = () => {}, onDetailOpen = () => {},
  onOpenAtlas = () => {}
} = {}) {
  const root = get('app');
  const workspace = get('workspace-panel');
  const detail = get('detail-panel');
  const detailPeek = get('detail-peek-trigger');
  const dockToggle = get('planet-dock-toggle');
  const mobileScene = get('mobile-scene-trigger');
  const railActions = get('scene-rail').querySelector('.rail-actions');
  let uiMode = 'compact';
  let navigationPane = 'none';
  let inspectorOpen = false;
  let inspectorTab = 'overview';
  let lastActive = 'none';
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

  const offlineGroup = document.createElement('section');
  offlineGroup.className = 'settings-group offline-settings';
  offlineGroup.id = 'offline-settings';
  const offlineTitle = document.createElement('div');
  offlineTitle.className = 'settings-group-title';
  offlineTitle.textContent = '离线与存储';
  const offlineToggle = document.createElement('button');
  offlineToggle.className = 'option-toggle offline-toggle';
  offlineToggle.id = 'offline-toggle';
  offlineToggle.type = 'button';
  offlineToggle.setAttribute('aria-pressed', 'false');
  offlineToggle.setAttribute('aria-describedby', 'offline-status');
  const offlineSwitch = document.createElement('i');
  offlineSwitch.setAttribute('aria-hidden', 'true');
  offlineToggle.append(
    makeCopy('离线浏览', '按需缓存已访问的贴图，初次启用只下载基础页面'),
    offlineSwitch
  );
  const offlineStatus = document.createElement('p');
  offlineStatus.id = 'offline-status';
  offlineStatus.className = 'offline-status';
  offlineStatus.setAttribute('role', 'status');
  offlineStatus.setAttribute('aria-live', 'polite');
  offlineStatus.textContent = '默认关闭；启用后基础页面可离线打开';
  const clearTextures = document.createElement('button');
  clearTextures.id = 'offline-clear-textures';
  clearTextures.className = 'offline-clear-textures';
  clearTextures.type = 'button';
  clearTextures.textContent = '清理已缓存贴图';
  clearTextures.disabled = true;
  offlineGroup.append(offlineTitle, offlineToggle, offlineStatus, clearTextures);

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
  // Preserve the original guide's position and hit area. The optional
  // offline group follows the regular controls inside the scrollable drawer.
  settings.replaceChildren(settingsHeading, settingsGroup, help, offlineGroup, footer);
  const orbitHint = document.createElement('p');
  orbitHint.id = 't31-orbit-hint';
  orbitHint.className = 't31-science-note';
  orbitHint.hidden = true;
  orbitHint.textContent = 'UTC 星历模式隐藏演示轨道线；返回演示模式后可再次切换。';
  settingsGroup.append(orbitHint);
  get('orbit-toggle').setAttribute('aria-describedby', 't31-orbit-hint');

  // Mobile reuses the exact three existing controls. Only their order and
  // labels change; their listeners and the navigation data remain untouched.
  const capsule = get('time-capsule');
  capsule.append(get('capsule-dock-slot'), get('time-open-trigger'), get('capsule-info-slot'));
  get('time-open-trigger').querySelector('.dock-item-label').textContent = '时间';

  const timeNotice = document.createElement('p');
  timeNotice.id = 't31-time-notice';
  timeNotice.className = 't31-science-note';
  get('time-workspace-slot').prepend(timeNotice);

  const scienceStatus = document.createElement('div');
  scienceStatus.id = 't31-science-status';
  scienceStatus.className = 't31-science-status';
  scienceStatus.textContent = '科普演示 · 可切换 UTC 星历';
  scienceStatus.setAttribute('aria-label', '当前为演示模型；可以在时间面板使用日期星历');
  document.querySelector('.topbar').insertBefore(scienceStatus,
    document.querySelector('.topbar .top-actions'));

  const inspectorTabs = document.createElement('div');
  inspectorTabs.id = 't31-inspector-tabs';
  inspectorTabs.className = 't31-inspector-tabs';
  inspectorTabs.setAttribute('role', 'group');
  inspectorTabs.setAttribute('aria-label', '天体资料分类');
  for (const [id, title] of [
    ['overview', '概览'], ['metrics', '数据'], ['sources', '来源']
  ]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.inspectorTab = id;
    button.textContent = title;
    button.setAttribute('aria-pressed', String(id === 'overview'));
    button.addEventListener('click', () => {
      inspectorTab = id;
      sync();
    });
    inspectorTabs.append(button);
  }
  detail.querySelector('.detail-topline').after(inspectorTabs);
  const inspectorContext = document.createElement('p');
  inspectorContext.id = 't31-inspector-context';
  inspectorContext.className = 't31-inspector-context';
  inspectorContext.hidden = true;
  inspectorTabs.after(inspectorContext);
  const noMetrics = document.createElement('p');
  noMetrics.id = 't31-metrics-unavailable';
  noMetrics.className = 't31-science-note';
  noMetrics.textContent = '当前是场景概览，没有单一天体的物理参数。请选择具体天体查看数据。';
  noMetrics.hidden = true;
  inspectorContext.after(noMetrics);
  const missingSource = document.createElement('p');
  missingSource.id = 't31-source-unavailable';
  missingSource.className = 't31-science-note';
  missingSource.textContent = '该场景暂无可逐项核对的真实观测资料；目前为科普展示。';
  noMetrics.after(missingSource);

  const registry = createWorkspaceRegistry({ panel: workspace, rail: railActions, app: root });
  function registerWorkspace(definition) {
    const item = registry.register(definition);
    for (const button of item.buttons) {
      if (button.id.startsWith('t31-rail-')) {
        button.addEventListener('click', () => toggleDrawer(item.id));
      }
    }
    return item;
  }
  registerWorkspace({ id: 'objects', region: 'navigation', title: '探索',
    slotId: 'objects-workspace-slot', icon: '#ic-list', showOnRail: false,
    triggerIds: ['rail-objects-trigger', 'planet-dock-toggle'] });
  registerWorkspace({ id: 'flight', region: 'navigation', title: '航行',
    slotId: 'objects-workspace-slot', showOnRail: false });
  registerWorkspace({ id: 'time', region: 'navigation', title: '时间',
    slotId: 'time-workspace-slot', icon: '#ic-orbit', showOnRail: false,
    triggerIds: ['rail-time-trigger', 'time-open-trigger'] });
  registerWorkspace({ id: 'settings', region: 'navigation', title: '设置',
    slotId: 'settings-workspace-slot', icon: '#ic-settings', showOnRail: false,
    triggerIds: ['rail-settings-trigger', 'global-settings-trigger'] });
  registerWorkspace({ id: 'detail', region: 'inspector', title: '资料',
    slotId: 'detail-panel', icon: '#ic-info',
    triggerIds: ['detail-peek-trigger'] });
  // Routes are an ACTION, not an empty workspace and second confirmation
  // screen. Desktop uses one left-rail button, mobile uses one explorer action.
  const routesTrigger = document.createElement('button');
  routesTrigger.id = 't31-rail-routes';
  routesTrigger.className = 'rail-action t31-rail-action';
  routesTrigger.type = 'button';
  routesTrigger.setAttribute('aria-label', '打开主题导览与收藏');
  routesTrigger.title = '主题导览与收藏';
  routesTrigger.innerHTML = '<svg class="ui-icon" aria-hidden="true">' +
    '<use href="#ic-book"></use></svg><span>导览</span>';
  routesTrigger.addEventListener('click', () => onOpenAtlas(routesTrigger));
  const mobileRoutes = document.createElement('button');
  mobileRoutes.id = 't31-mobile-routes';
  mobileRoutes.className = 't31-mobile-routes t31-panel-action';
  mobileRoutes.type = 'button';
  mobileRoutes.textContent = '主题导览与收藏';
  mobileRoutes.addEventListener('click', () => onOpenAtlas(mobileRoutes));
  get('objects-workspace-slot').querySelector('.view-nav').after(mobileRoutes);
  railActions.replaceChildren(
    get('rail-objects-trigger'), get('rail-time-trigger'),
    get('t31-rail-detail'), routesTrigger, get('rail-settings-trigger')
  );

  const canUseTwoPanels = () =>
    window.matchMedia('(min-width: 1260px) and (min-height: 550px)').matches;
  const isPhone = () => window.matchMedia('(max-width: 900px)').matches;

  function openerFor(id) {
    return registry.get(id)?.buttons.find(button =>
      button.isConnected && button.getClientRects().length &&
      !button.closest('[inert], [hidden]')) || get('search-trigger');
  }

  function sync() {
    // Desktop camera controls live in the LEFT controller instead of
    // overlapping its buttons. Mobile uses the existing floating position.
    const cameraTools = document.querySelector('.camera-tools');
    const cameraParent = isPhone() ? root : get('scene-rail');
    if (cameraTools.parentElement !== cameraParent) cameraParent.append(cameraTools);
    const pure = uiMode === 'pure';
    const motionAvailable = scene === 'solar' || scene === 'planet';
    if (scene === 'planet' && !focusId) inspectorOpen = false;
    if (!canUseTwoPanels() && navigationPane !== 'none' && inspectorOpen) {
      if (lastActive === 'detail') navigationPane = 'none';
      else inspectorOpen = false;
    }
    const navOpen = navigationPane !== 'none' && !pure;
    const detailOpen = inspectorOpen && !pure;
    activeDrawer = lastActive === 'detail' && detailOpen ? 'detail' :
      navOpen ? navigationPane : detailOpen ? 'detail' : 'none';
    root.dataset.layout = 't15';
    root.dataset.workspaceVersion = 't31';
    root.dataset.uiMode = uiMode;
    root.dataset.activeDrawer = activeDrawer; // Existing T15 consumers.
    root.dataset.navPane = navOpen ? navigationPane : 'none';
    root.dataset.inspectorOpen = String(detailOpen);
    root.dataset.inspectorTab = inspectorTab;
    root.dataset.dock = ['objects', 'flight'].includes(navigationPane) && !pure
      ? 'open' : 'closed';
    workspace.inert = !navOpen;
    workspace.setAttribute('aria-hidden', String(!navOpen));
    const uniqueSlots = new Set(registry.list()
      .filter(item => item.region === 'navigation').map(item => item.slot));
    for (const slot of uniqueSlots) {
      const visible = navOpen && registry.get(navigationPane)?.slot === slot;
      slot.inert = !visible;
      slot.setAttribute('aria-hidden', String(!visible));
    }
    for (const item of registry.list()) {
      const expanded = !pure && (item.region === 'inspector'
        ? detailOpen : navigationPane === item.id ||
          item.id === 'objects' && navigationPane === 'flight');
      for (const button of item.buttons) button.setAttribute('aria-expanded', String(expanded));
    }
    detail.inert = !detailOpen;
    detail.setAttribute('aria-hidden', String(!detailOpen));
    detail.classList.toggle('is-visible', detailOpen);
    detailPeek.hidden = false;
    detailPeek.inert = pure;
    detailPeek.setAttribute('aria-controls', 'detail-panel');
    detailPeek.setAttribute('aria-expanded', String(detailOpen));
    detailPeek.removeAttribute('aria-haspopup');
    const infoTarget = scene === 'galaxy' ? '银河系' :
      scene === 'free' ? (sceneTargetName || '自由漫游') : '太阳系';
    detailPeek.setAttribute('aria-label', (detailOpen ? '收起' : '查看') +
      (scene === 'planet' ? get('detail-name').textContent : infoTarget) + '资料');
    get('detail-peek-name').textContent = '资料';
    inspectorContext.hidden = inspectorTab === 'overview';
    inspectorContext.textContent = get('detail-name').textContent +
      (inspectorTab === 'metrics' ? ' · 物理数据' : ' · 参考来源');
    noMetrics.hidden = inspectorTab !== 'metrics' || detail.dataset.detailKind === 'planet';
    inspectorTabs.querySelectorAll('button').forEach(button => {
      button.setAttribute('aria-pressed',
        String(button.dataset.inspectorTab === inspectorTab));
    });
    missingSource.hidden = inspectorTab !== 'sources' ||
      detail.dataset.detailKind === 'planet';
    get('time-open-trigger').hidden = false;
    get('time-open-trigger').inert = pure;
    get('time-open-trigger').setAttribute('aria-hidden', String(pure));
    get('time-open-trigger').setAttribute('aria-label',
      motionAvailable ? '打开天体运动与 UTC 日期工作区' : '查看 UTC 日期工作区');
    const simulation = get('time-workspace-slot').querySelector('.simulation-panel');
    simulation.hidden = !motionAvailable;
    simulation.inert = !motionAvailable || !navOpen || navigationPane !== 'time';
    timeNotice.hidden = motionAvailable;
    timeNotice.textContent = scene === 'free'
      ? '自由航行速度由探索面板控制；在下方可以切换 UTC 日期星历。'
      : '银河系为程序化演示；应用下方的 UTC 日期后会打开太阳系。';
    for (const id of ['search-trigger', 'global-settings-trigger', 'time-capsule', 'scene-rail']) {
      const element = get(id);
      if (element) element.inert = pure;
    }
    const readout = get('scene-readout');
    if (readout) {
      const covered = window.matchMedia('(max-width: 640px)').matches &&
        activeDrawer !== 'none';
      readout.inert = pure || covered;
      readout.setAttribute('aria-hidden', String(pure || covered));
    }
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
    if (next === 'scene') next = 'none';
    if (next !== 'none' && !registry.has(next)) return false;
    if (next === 'flight' && scene !== 'free') next = 'objects';
    if (next === 'objects' && scene === 'free') next = 'flight';
    if (next === 'detail' && scene === 'planet' && !focusId) return false;
    if (next !== 'none' && !registry.get(next).available({ scene, focusId })) return false;
    const wasFocusedInNav = workspace.contains(document.activeElement);
    const wasFocusedInDetail = detail.contains(document.activeElement);
    const previousNav = navigationPane;
    const previousDetail = inspectorOpen;
    if (next === 'none') {
      navigationPane = 'none';
      inspectorOpen = false;
      lastActive = 'none';
    } else if (next === 'detail') {
      inspectorOpen = true;
      if (!canUseTwoPanels()) navigationPane = 'none';
      lastActive = 'detail';
    } else {
      registry.activate(next);
      navigationPane = next;
      if (!canUseTwoPanels()) inspectorOpen = false;
      lastActive = next;
    }
    if (previousNav === navigationPane && previousDetail === inspectorOpen) return false;
    sync();
    // The old mobile detail sheet may still be in its "collapsed" state after
    // a guided tour. A newly opened research pane must reveal its real content
    // on desktop as well as mobile.
    if (next === 'detail' && !previousDetail) onDetailOpen();
    if (restoreFocus) {
      const removedNavFocus = wasFocusedInNav && previousNav !== navigationPane;
      const removedDetailFocus = wasFocusedInDetail && previousDetail && !inspectorOpen;
      if (removedNavFocus || removedDetailFocus) {
        const opener = openerFor(removedDetailFocus ? 'detail' : previousNav);
        requestAnimationFrame(() => {
          if (!focusVisible(opener)) focusVisible(get('search-trigger'));
        });
      }
    }
    onLayoutChange();
    return true;
  }

  function closePane(region, options = {}) {
    if (region === 'detail' && inspectorOpen) {
      const focusedWithinPane = detail.contains(document.activeElement);
      inspectorOpen = false;
      if (lastActive === 'detail') lastActive = navigationPane;
      sync();
      if (options.restoreFocus !== false && focusedWithinPane) {
        requestAnimationFrame(() => {
          // A later user action may already have moved focus to another
          // control. Never steal it back to a previously closed pane.
          if (detail.contains(document.activeElement) ||
              document.activeElement === document.body) {
            focusVisible(openerFor('detail'));
          }
        });
      }
      onLayoutChange();
      return true;
    }
    if (region === 'navigation' && navigationPane !== 'none') {
      const previous = navigationPane;
      const focusedWithinPane = workspace.contains(document.activeElement);
      navigationPane = 'none';
      if (lastActive !== 'detail') lastActive = inspectorOpen ? 'detail' : 'none';
      sync();
      if (options.restoreFocus !== false && focusedWithinPane) {
        requestAnimationFrame(() => {
          if (workspace.contains(document.activeElement) ||
              document.activeElement === document.body) {
            focusVisible(openerFor(previous));
          }
        });
      }
      onLayoutChange();
      return true;
    }
    return false;
  }

  function toggleDrawer(name) {
    const target = name === 'objects' && scene === 'free' ? 'flight' : name;
    if (target === 'detail' && inspectorOpen) return closePane('detail');
    if (target !== 'detail' && navigationPane === target) return closePane('navigation');
    return setDrawer(target);
  }

  function setScene(nextScene, nextFocusId, targetName, targetIndex) {
    const wasScene = scene;
    scene = nextScene;
    focusId = nextFocusId || null;
    sceneTargetName = targetName || null;
    if (navigationPane === 'flight' && scene !== 'free') navigationPane = 'objects';
    if (navigationPane === 'objects' && scene === 'free') navigationPane = 'flight';
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
  // Responsive emulation and device rotation can change the breakpoint before
  // the general resize handler settles. Reparent camera controls immediately
  // when the rail becomes hidden/visible, so controls never stay in an inert
  // desktop-only container on a phone.
  window.matchMedia('(max-width: 900px)').addEventListener('change', sync);
  detailPeek.addEventListener('click', () => {
    if (inspectorOpen) return closePane('detail');
    if (!setDrawer('detail')) return;
    if (isPhone()) requestAnimationFrame(() => focusVisible(get('detail-close')));
  });

  sync();
  return {
    get activeDrawer() { return activeDrawer; },
    get uiMode() { return uiMode; },
    get isObjectsOpen() { return navigationPane === 'objects' || navigationPane === 'flight'; },
    get navigationPane() { return navigationPane; },
    get inspectorOpen() { return inspectorOpen; },
    registerWorkspace, closePane, setDrawer, toggleDrawer, setScene, setUiMode, sync,
    snapshot: () => ({ navigationPane, inspectorOpen, inspectorTab }),
    restore(snapshot) {
      if (!snapshot) return;
      navigationPane = registry.has(snapshot.navigationPane) ? snapshot.navigationPane : 'none';
      if (navigationPane !== 'none') registry.activate(navigationPane);
      inspectorOpen = Boolean(snapshot.inspectorOpen);
      inspectorTab = ['overview', 'metrics', 'sources'].includes(snapshot.inspectorTab)
        ? snapshot.inspectorTab : 'overview';
      lastActive = inspectorOpen ? 'detail' : navigationPane;
      sync();
      onLayoutChange();
    },
    listWorkspaces: () => registry.list().map(item =>
      ({ id: item.id, title: item.title, region: item.region }))
  };
}
