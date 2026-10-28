// Isolated Chrome/CDP audit using Node built-ins; no external dependencies.
// Runs in a fresh headless Chrome profile and leaves the user's browser untouched.
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const chromePath = process.env.CHROME_EXE ||
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const previewUrl = process.env.COSMOS_URL || 'http://127.0.0.1:5173/';
const reportPath = process.env.COSMOS_AUDIT_REPORT ||
  'docs/baselines/2026-10-21-T15-browser-audit.json';
const t31Mode = process.env.COSMOS_AUDIT_T31 === '1';
const artifactPrefix = process.env.COSMOS_AUDIT_PREFIX || '';
const artifactPath = filename => artifactPrefix
  ? filename.replace(/^docs\/baselines\/2026-10-21-T15-/, artifactPrefix + '-')
  : filename;
const profile = await mkdtemp(path.join(os.tmpdir(), 'cosmos-t15-audit-'));
const report = { previewUrl, tool: 'Headless Chrome via native CDP',
  started: new Date().toISOString(),
  limitations: ['Headless software WebGL performance is not physical GPU/mobile performance.'],
  checks: [], errors: [] };
let chrome, page;
let chromeExit = null;
let chromeStderr = '';

function check(name, pass, actual, detail = '') {
  report.checks.push({ name, pass: Boolean(pass), actual, detail });
  console.log((pass ? 'PASS ' : 'FAIL ') + name + (detail ? ' — ' + detail : ''));
}

async function portFromProfile() {
  for (let tries = 0; tries < 70; tries++) {
    if (chromeExit) throw Error('Chrome exited before opening DevTools: ' +
      JSON.stringify(chromeExit) + '\n' + chromeStderr.slice(-1500));
    try {
      const content = await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8');
      return Number(content.split(/\r?\n/)[0]);
    } catch { await delay(100); }
  }
  throw Error('Chrome did not create DevToolsActivePort. ' +
    (chromeStderr.slice(-1500) || 'No Chrome stderr output.'));
}

class CDP {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    socket.onmessage = event => {
      const msg = JSON.parse(String(event.data));
      const entry = this.pending.get(msg.id);
      if (!entry) return;
      this.pending.delete(msg.id);
      clearTimeout(entry.timer);
      if (msg.error) entry.reject(Error(entry.method + ': ' + msg.error.message));
      else entry.resolve(msg.result || {});
    };
    socket.onclose = () => {
      for (const entry of this.pending.values()) {
        clearTimeout(entry.timer);
        entry.reject(Error('CDP socket closed'));
      }
      this.pending.clear();
    };
  }
  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      socket.onopen = resolve;
      socket.onerror = () => reject(Error('CDP connection failed'));
    });
    return new CDP(socket);
  }
  async send(method, params = {}, timeoutMs = 20000) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(Error(method + ' timed out'));
      }, timeoutMs);
      this.pending.set(id, { method, resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expression, userGesture = false) {
    const output = await this.send('Runtime.evaluate', {
      expression, awaitPromise: true, returnByValue: true, userGesture
    });
    if (output.exceptionDetails) throw Error(
      'Runtime JS: ' + (output.exceptionDetails.text ||
        output.exceptionDetails.exception?.description));
    return output.result?.value;
  }
  async click(selector) {
    if (t31Mode && await this.eval(
      'document.getElementById("app")?.dataset.workspaceVersion==="t31"')) {
      const desktop = await this.eval('window.innerWidth>900');
      if (desktop) {
        if (selector === '#planet-dock-toggle') selector = '#rail-objects-trigger';
        else if (selector === '#time-open-trigger') selector = '#rail-time-trigger';
        else if (selector === '#detail-peek-trigger') selector = '#t31-rail-detail';
        else if (selector === '#global-settings-trigger') selector = '#rail-settings-trigger';
      } else if (selector === '#pure-mode-trigger' ||
                 selector === '#fullscreen-trigger') {
        if (await this.eval('document.getElementById("mobile-menu").hidden')) {
          await this.click('#mobile-menu-trigger');
        }
        selector = selector === '#pure-mode-trigger'
          ? '#mobile-pure-action' : '#mobile-fullscreen-action';
      } else if (selector === '#global-settings-trigger') {
        const settingsOpen = await this.eval(
          'document.getElementById("app").dataset.navPane==="settings"');
        await this.click('#mobile-menu-trigger');
        if (settingsOpen) {
          await this.click('#mobile-menu-trigger'); // close More after dismissing Settings
          return;
        }
        selector = '#mobile-settings-action';
      }
    }
    const expression = '(() => {const el=document.querySelector(' +
      JSON.stringify(selector) + ');if(!el)return null;' +
      'if(!el.closest("[inert],[hidden]"))el.scrollIntoView({block:"center",inline:"nearest"});' +
      'const r=el.getBoundingClientRect();' +
      'const x=r.x+r.width/2,y=r.y+r.height/2,hit=document.elementFromPoint(x,y);' +
      'const style=getComputedStyle(el);' +
      'return {x:r.x+r.width/2,y:r.y+r.height/2,' +
      'visible:r.width>0&&r.height>0&&!el.closest("[inert],[hidden]")&&' +
      'style.visibility!=="hidden"&&style.pointerEvents!=="none",' +
      'hit:Boolean(hit&&(hit===el||el.contains(hit)))};})()';
    let box;
    for (let attempt = 0; attempt < 55; attempt++) {
      box = await this.eval(expression);
      if (box?.visible && box.hit) break;
      await delay(60);
    }
    if (!box?.visible || !box.hit) throw Error('Not clickable: ' +
      selector + ' ' + JSON.stringify(box));
    for (const type of ['mousePressed', 'mouseReleased']) {
      await this.send('Input.dispatchMouseEvent', {
        type, x: box.x, y: box.y, button: 'left',
        buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1
      });
    }
  }
  async key(key, code = key, windowsVirtualKeyCode = 0) {
    await this.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode });
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode });
  }
  async until(expression, seconds = 12) {
    const start = Date.now();
    while (Date.now() - start < seconds * 1000) {
      if (await this.eval(expression)) return true;
      await delay(160);
    }
    return false;
  }
  close() { this.socket.close(); }
}

try {
  // A preview connectivity failure should not be misreported as an app or
  // WebGL regression after Chrome opens its built-in network error page.
  try {
    const response = await fetch(previewUrl, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw Error('HTTP ' + response.status);
  } catch (error) {
    throw Error('COSMOS preview unavailable at ' + previewUrl +
      '. Start the local Vite server and verify browser/network permissions. ' +
      String(error?.message || error));
  }
  chrome = spawn(chromePath, [
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-background-networking',
    '--enable-unsafe-swiftshader', '--use-angle=swiftshader',
    '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0',
    '--remote-allow-origins=*', '--user-data-dir=' + profile,
    '--window-size=1366,768', '--hide-scrollbars', 'about:blank'
  ], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
  chrome.on('error', error => { report.errors.push(error.message); });
  chrome.on('exit', (code, signal) => { chromeExit = { code, signal }; });
  chrome.stderr?.on('data', bytes => {
    chromeStderr = (chromeStderr + String(bytes)).slice(-4000);
  });
  const port = await portFromProfile();
  const opened = await fetch('http://127.0.0.1:' + port + '/json/new?' +
    encodeURIComponent(previewUrl), { method: 'PUT' }).then(r => r.json());
  if (!opened.webSocketDebuggerUrl) throw Error('No page WebSocket URL');
  page = await CDP.connect(opened.webSocketDebuggerUrl);
  await page.send('Page.enable');
  await page.send('Runtime.enable');
  check('page initialized', await page.until(
    'document.getElementById("app")?.dataset.layout === "t15" && ' +
    'document.getElementById("loading-screen")?.classList.contains("is-loaded")', 20),
    await page.eval('document.getElementById("app")?.dataset.layout'));
  const initial = await page.eval('({browser:navigator.userAgent,width:innerWidth,' +
    'height:innerHeight,fullscreenEnabled:document.fullscreenEnabled,' +
    'hasPerf:typeof window.getCosmosPerformance==="function",' +
    'webgl:Boolean(document.getElementById("universe-canvas")?.getContext("webgl2"))})');
  report.browser = initial;
  check('WebGL initialized', initial.webgl, initial);
  const iconFamily = await page.eval('(() => ({' +
    'symbols:document.querySelectorAll(".ui-icon-defs symbol").length,' +
    'headerIcons:document.querySelectorAll(".top-actions .ui-icon").length,' +
    'zoomIcon:document.querySelector("#zoom-in use")?.getAttribute("href"),' +
    'dockIcon:document.querySelector("#detail-peek-trigger use")?.getAttribute("href"),' +
    'pseudo:getComputedStyle(document.getElementById("detail-peek-trigger"),"::before").content' +
    '}))()');
  check('unified local SVG interface icons', iconFamily.symbols >= 20 &&
    iconFamily.headerIcons >= 4 && iconFamily.zoomIcon === '#ic-plus' &&
    iconFamily.dockIcon === '#ic-info' &&
    ['none', 'normal', '""'].includes(iconFamily.pseudo), iconFamily);
  const galaxyControls = await page.eval('({motionHidden:document.getElementById("time-open-trigger").hidden,' +
    'cameraVisible:getComputedStyle(document.querySelector(".camera-tools")).display!=="none",' +
    'dateRemoved:!document.getElementById("timeline-date")&&!document.getElementById("timeline-range")})');
  check('galaxy shows camera without orbital playback or date',
    (t31Mode ? !galaxyControls.motionHidden : galaxyControls.motionHidden) &&
    galaxyControls.cameraVisible && galaxyControls.dateRemoved,
    galaxyControls);

  await page.click('#fullscreen-trigger');
  await delay(400);
  const full = await page.eval('({full:document.fullscreenElement?.id||null,' +
    'pressed:document.getElementById("fullscreen-trigger").getAttribute("aria-pressed"),' +
    'mode:document.getElementById("app").dataset.uiMode,' +
    'toast:document.getElementById("toast")?.textContent})');
  check('fullscreen entry', full.full === 'app' && full.pressed === 'true', full,
    full.full ? 'Fullscreen API entered' : 'Browser denied or unsupported');

  await page.click('#pure-mode-trigger');
  const both = await page.eval('({full:document.fullscreenElement?.id||null,' +
    'mode:document.getElementById("app").dataset.uiMode,' +
    'brandVisible:document.getElementById("brand-home").getClientRects().length>0,' +
    'labelsVisible:getComputedStyle(document.getElementById("labels-layer")).display!=="none",' +
    'cameraHidden:getComputedStyle(document.querySelector(".camera-tools")).display==="none",' +
    'readoutHidden:getComputedStyle(document.getElementById("scene-readout")).display==="none"})');
  check('pure mode preserves brand and labels',
    both.mode === 'pure' && both.brandVisible && both.labelsVisible &&
    both.cameraHidden && both.readoutHidden, both);
  if (both.full === 'app') {
    await page.click('#fullscreen-trigger');
    await delay(250);
    check('fullscreen exit preserves pure mode', await page.eval(
      '!document.fullscreenElement && document.getElementById("app").dataset.uiMode === "pure"'), {});
  }
  await page.click('#pure-mode-trigger');
  check('pure mode exit', await page.eval(
    'document.getElementById("app").dataset.uiMode === "compact"'), {});

  await page.key('f', 'KeyF', 70);
  // The native fullscreen transition and fullscreenchange ARIA sync happen
  // asynchronously; observe their settled state, not the first intermediate frame.
  await page.until('document.fullscreenElement?.id==="app" && ' +
    'document.getElementById("fullscreen-trigger").getAttribute("aria-pressed")==="true"', 5);
  const shortcutFull = await page.eval('({full:document.fullscreenElement?.id||null,' +
    'pressed:document.getElementById("fullscreen-trigger").getAttribute("aria-pressed")})');
  check('F shortcut enters fullscreen',
    shortcutFull.full === 'app' && shortcutFull.pressed === 'true', shortcutFull);
  if (shortcutFull.full === 'app') {
    await page.key('h', 'KeyH', 72);
    check('H shortcut preserves fullscreen', await page.eval(
      'document.fullscreenElement?.id === "app" && ' +
      'document.getElementById("app").dataset.uiMode === "pure"'), {});
    await page.key('Escape', 'Escape', 27);
    await delay(180);
    const escapeState = await page.eval('({full:document.fullscreenElement?.id||null,' +
      'mode:document.getElementById("app").dataset.uiMode})');
    check('Escape exits native fullscreen before pure mode', !escapeState.full &&
      escapeState.mode === 'pure', escapeState);
    if (escapeState.full) await page.eval('document.exitFullscreen()');
    await page.key('h', 'KeyH', 72);
    check('H shortcut exits pure mode', await page.eval(
      'document.getElementById("app").dataset.uiMode === "compact"'), {});
  }

  await page.click('#planet-dock-toggle');
  check('celestial drawer opens', await page.eval(
    'document.getElementById("app").dataset.activeDrawer === "objects"'), {});
  await page.click('#objects-workspace-slot .view-link[data-view="solar"]');
  const solarReady = await page.until(
    'window.getCosmosPerformance?.().mode === "solar" && ' +
    '!window.getCosmosPerformance?.().transitioning && ' +
    '!window.getCosmosPerformance?.().flying', 18);
  check('solar scene navigation for contextual motion', solarReady, {});
  if (!solarReady) throw Error('Solar scene did not finish transitioning');
  const solarControls = await page.eval('({motionVisible:!document.getElementById("time-open-trigger").hidden,' +
    'triggerLabel:document.getElementById("time-open-trigger").getAttribute("aria-label"),' +
    'dateRemoved:!document.getElementById("timeline-date"),cameraParent:document.querySelector(".camera-tools").parentElement.id})');
  check('solar motion is contextual and camera is global',
    solarControls.motionVisible && solarControls.triggerLabel.includes('天体运动') &&
    solarControls.dateRemoved &&
    (t31Mode ? solarControls.cameraParent === 'scene-rail' :
      solarControls.cameraParent === 'app'), solarControls);
  await page.click('#time-open-trigger');
  check('time drawer replaces celestial drawer', await page.eval(
    'document.getElementById("app").dataset.activeDrawer === "time" && ' +
    'document.getElementById("objects-workspace-slot").inert'), {});
  const motionRate = await page.eval('(() => {const slider=document.getElementById("speed-range");' +
    'slider.value="5";slider.dispatchEvent(new Event("input",{bubbles:true}));' +
    'return {speed:document.getElementById("speed-value").textContent,' +
    'capsule:document.getElementById("capsule-speed").textContent};})()');
  check('solar orbital rate adjusts independently', motionRate.speed === '25×' &&
    motionRate.capsule === '25×', motionRate);
  await page.click('#play-pause');
  check('orbital playback can pause', await page.eval(
    'document.getElementById("play-pause").getAttribute("aria-label")==="继续天体运动"'), {});
  await page.click('#play-pause');
  await page.eval('(() => {const slider=document.getElementById("speed-range");' +
    'slider.value="2";slider.dispatchEvent(new Event("input",{bubbles:true}));})()');
  await page.click('#global-settings-trigger');
  check('settings drawer replaces time drawer', await page.eval(
    'document.getElementById("app").dataset.activeDrawer === "settings" && ' +
    'document.getElementById("time-workspace-slot").inert'), {});
  const settingsRows = await page.eval('(() => {' +
    'const slot=document.getElementById("settings-workspace-slot");' +
    'return {rows:slot.querySelectorAll(".settings-rows > *").length,' +
    'qualityRole:document.getElementById("quality-select-trigger")?.getAttribute("role"),' +
    'native:document.getElementById("quality-select").tagName,' +
    'guide:!!slot.querySelector(".settings-guide-link"),' +
    'status:!!slot.querySelector(".settings-footer .render-status")};})()');
  check('settings groups native controls and enhanced quality',
    settingsRows.rows === 3 && settingsRows.qualityRole === 'combobox' &&
    settingsRows.native === 'SELECT' && settingsRows.guide && settingsRows.status,
    settingsRows);
  await page.click('#quality-select-trigger');
  const qualityOpen = await page.eval('(() => {' +
    'const p=document.getElementById("quality-select-popover"),r=p.getBoundingClientRect();' +
    'return {shown:!p.hidden,count:p.querySelectorAll("[role=option]").length,' +
    'selected:p.querySelectorAll("[aria-selected=true]").length,' +
    'fits:r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight};})()');
  check('quality dropdown options fit the desktop viewport',
    qualityOpen.shown && qualityOpen.count === 3 &&
    qualityOpen.selected === 1 && qualityOpen.fits, qualityOpen);
  await page.click('#quality-select-option-2');
  const highQuality = await page.eval('({value:document.getElementById("quality-select").value,' +
    'label:document.getElementById("quality-select-value").textContent,' +
    'runtime:window.getCosmosPerformance().qualityMode,' +
    'closed:document.getElementById("quality-select-popover").hidden})');
  check('quality popup selects high in renderer and native select',
    highQuality.value === 'high' && highQuality.label === '极致' &&
    highQuality.runtime === 'high' && highQuality.closed, highQuality);
  await page.click('#quality-select-trigger');
  await page.key('Escape', 'Escape', 27);
  check('quality Escape only closes its dropdown', await page.eval(
    'document.getElementById("quality-select-popover").hidden && ' +
    'document.getElementById("app").dataset.activeDrawer === "settings"'), {});
  await page.click('#quality-select-trigger');
  await page.click('#quality-select-option-0');
  check('quality returns to automatic', await page.eval(
    'document.getElementById("quality-select").value === "auto" && ' +
    'window.getCosmosPerformance().qualityMode === "auto"'), {});
  await page.click('#help-trigger');
  const guideGroups = await page.eval('(() => {' +
    'const p=document.getElementById("help-overlay");return {' +
    'open:p.classList.contains("is-open"),' +
    'sections:p.querySelectorAll(".help-topic").length,' +
    'entries:p.querySelectorAll(".help-grid > div").length,' +
    'backgroundInert:document.querySelector(".bottom-interface").inert};})()');
  check('exploration guide has three accessible instruction groups',
    guideGroups.open && guideGroups.sections === 3 &&
    guideGroups.entries >= 14 && guideGroups.backgroundInert, guideGroups);
  await page.click('#help-close');
  check('guide close restores settings drawer', await page.eval(
    '!document.getElementById("help-overlay").classList.contains("is-open") && ' +
    'document.getElementById("app").dataset.activeDrawer === "settings"'), {});
  await page.key('Escape', 'Escape', 27);
  check('Escape closes workspace', await page.eval(
    'document.getElementById("app").dataset.activeDrawer === "none"'), {});
  const cameraBefore = await page.eval('window.getCosmosPerformance().cameraDistance');
  await page.click('#zoom-in');
  // Read camera state directly: the visible telemetry text updates in batches
  // and can show an earlier stage of the scene transition.
  const cameraAfterZoom = await page.eval('window.getCosmosPerformance().cameraDistance');
  check('quick zoom works with drawers closed', cameraAfterZoom < cameraBefore,
    { before: cameraBefore, after: cameraAfterZoom });
  await page.click('#zoom-out');
  const cameraAfterZoomOut = await page.eval('window.getCosmosPerformance().cameraDistance');
  check('quick zoom-out works with drawers closed', cameraAfterZoomOut > cameraAfterZoom,
    { before: cameraAfterZoom, after: cameraAfterZoomOut });
  await page.click('#reset-view');
  check('quick reset is reachable', await page.eval(
    'document.getElementById("toast").textContent.includes("已恢复当前场景默认视角")'), {});
  const resetDistance = await page.eval('window.getCosmosPerformance().cameraDistance');
  await page.click('#zoom-in');
  const interruptDistance = await page.eval('window.getCosmosPerformance().cameraDistance');
  check('quick zoom takes over reset animation', interruptDistance < resetDistance,
    { before: resetDistance, after: interruptDistance });

  await page.click('#search-trigger');
  const search = await page.eval('({open:document.getElementById("search-overlay").classList.contains("is-open"),' +
    'focus:document.activeElement.id,backgroundInert:document.querySelector(".bottom-interface").inert})');
  check('search dialog isolates background', search.open && search.backgroundInert, search);
  const searchGroups = await page.eval('(() => {' +
    'const root=document.getElementById("search-results"),first=root.querySelector(".search-result-group-list");' +
    'return {groups:root.querySelectorAll(".search-result-group").length,' +
    'cards:root.querySelectorAll(".search-result").length,' +
    'columns:first?getComputedStyle(first).gridTemplateColumns.split(" ").length:0};})()');
  check('search results use grouped desktop cards',
    searchGroups.groups >= 4 && searchGroups.cards >= 22 &&
    searchGroups.columns === 2, searchGroups);
  const filteredSearch = await page.eval('(() => {' +
    'const input=document.getElementById("search-input");input.value="土卫二";' +
    'input.dispatchEvent(new Event("input",{bubbles:true}));return {' +
    'cards:document.querySelectorAll("#search-results .search-result").length,' +
    'name:document.querySelector("#search-results .search-result-copy strong")?.textContent,' +
    'count:document.getElementById("search-visible-count").textContent};})()');
  check('search filters grouped celestial results',
    filteredSearch.cards === 1 && filteredSearch.name === '土卫二' &&
    filteredSearch.count.includes('1'), filteredSearch);
  await page.eval('(() => {const input=document.getElementById("search-input");' +
    'input.value="";input.dispatchEvent(new Event("input",{bubbles:true}));})()');
  await page.key('Escape', 'Escape', 27);
  const focusImmediatelyAfterEscape = await page.eval('({open:document.getElementById("search-overlay").classList.contains("is-open"),' +
    'focus:document.activeElement?.id||"",tag:document.activeElement?.tagName||"",fullscreen:!!document.fullscreenElement})');
  const restoredFocus = await page.until(
    '!document.getElementById("search-overlay").classList.contains("is-open") && ' +
    'document.activeElement.id === "search-trigger"', 2);
  check('Escape closes modal and returns focus', restoredFocus,
    { immediate: focusImmediatelyAfterEscape,
      settled: await page.eval('({open:document.getElementById("search-overlay").classList.contains("is-open"),' +
        'focus:document.activeElement?.id||"",tag:document.activeElement?.tagName||"",' +
        'searchRect:document.getElementById("search-trigger").getBoundingClientRect().toJSON(),' +
        'searchInert:!!document.getElementById("search-trigger").closest("[inert],[hidden]"),' +
        'searchDisabled:document.getElementById("search-trigger").disabled,' +
        'activeDrawer:document.getElementById("app").dataset.activeDrawer})') });

  for (const [width,height] of [[1707,842],[1366,768],[390,844],[360,740],[844,390]]) {
    await page.send('Emulation.setDeviceMetricsOverride',
      { width, height, deviceScaleFactor: 1, mobile: width < 900 });
    await delay(120);
    if (t31Mode) {
      // The responsive workspace moves a single existing camera controller
      // across DOM containers at the 900px breakpoint. Observe settled
      // visibility after emulation instead of a transient reparenting frame.
      await page.until('(() => {const r=document.querySelector(".camera-tools")?.' +
        'getBoundingClientRect();return r?.width>0&&r?.height>0;' +
        '})()', 4);
    }
    const snap = await page.eval('(() => {const app=document.getElementById("app");' +
      'const top=document.querySelector(".topbar").getBoundingClientRect();' +
      'const foot=document.querySelector(".bottom-interface").getBoundingClientRect();' +
      'return {width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,' +
      'topHeight:Math.round(top.height),footerHeight:Math.round(foot.height),' +
      'layout:app.dataset.layout,ui:app.dataset.uiMode};})()');
    check('responsive ' + width + 'x' + height, snap.width === width &&
      snap.height === height && snap.scrollWidth <= width &&
      snap.footerHeight <= (t31Mode && height < 481 ? 190 : 66), snap);
    const rail = await page.eval('(() => {const group=document.querySelector(".camera-tools");' +
      'const r=group.getBoundingClientRect();const controls=["zoom-in","zoom-out","reset-view"].map(id=>{' +
      'const e=document.getElementById(id),b=e.getBoundingClientRect();' +
      'return {id,w:b.width,h:b.height,visible:!!e.getClientRects().length}});' +
      'return {rail:{left:r.left,top:r.top,right:r.right,bottom:r.bottom},controls};})()');
    check('camera quick rail ' + width + 'x' + height,
      rail.rail.left >= 0 && rail.rail.right <= width && rail.rail.top >= 0 &&
      rail.rail.bottom <= height && rail.controls.every(item =>
        item.visible && item.w >= 43 && item.h >= 43), rail);
    if (width === 390 || width === 360 || width === 844) {
      if (width === 390) {
        await page.click('#time-open-trigger');
        const motionPanel = await page.eval('({drawer:document.getElementById("app").dataset.activeDrawer,' +
          'title:document.querySelector("#time-workspace-slot .section-caption").textContent.trim(),' +
          'datePresent:!!document.getElementById("timeline-date")})');
        check('solar mobile has compact orbital controls', motionPanel.drawer === 'time' &&
          motionPanel.title.includes('天体运动') && !motionPanel.datePresent, motionPanel);
        await page.eval('document.getElementById("toast").classList.remove("is-visible")');
        const solarScreenshot = await page.send('Page.captureScreenshot',
          { format: 'png', captureBeyondViewport: false, fromSurface: true });
        const solarScreenshotPath = artifactPath('docs/baselines/2026-10-21-T15-motion-mobile-390.png');
        await writeFile(solarScreenshotPath, Buffer.from(solarScreenshot.data, 'base64'));
        report.solarScreenshot = solarScreenshotPath;
        await page.click('#time-open-trigger');
        await page.click('#global-settings-trigger');
        await page.click('#quality-select-trigger');
        const qualityMobile = await page.eval('(() => {' +
          'const p=document.getElementById("quality-select-popover"),r=p.getBoundingClientRect();' +
          'return {open:!p.hidden,options:p.querySelectorAll("[role=option]").length,' +
          'fits:r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight};})()');
        check('mobile quality popover remains within the screen',
          qualityMobile.open && qualityMobile.options === 3 &&
          qualityMobile.fits, qualityMobile);
        await page.click('#quality-select-option-1');
        check('mobile low quality updates renderer', await page.eval(
          'document.getElementById("quality-select").value === "low" && ' +
          'window.getCosmosPerformance().qualityMode === "low"'), {});
        await page.click('#quality-select-trigger');
        await page.click('#quality-select-option-0');
        await page.click('#global-settings-trigger');
        await page.click('#search-trigger');
        const mobileSearch = await page.eval('(() => {' +
          'const g=document.querySelector(".search-result-group-list");' +
          'return {columns:g?getComputedStyle(g).gridTemplateColumns.split(" ").length:0,' +
          'overflow:document.documentElement.scrollWidth>innerWidth};})()');
        check('mobile grouped search is single column with no overflow',
          mobileSearch.columns === 1 && !mobileSearch.overflow, mobileSearch);
        await page.click('#search-close');
      }
      await page.click('#detail-peek-trigger');
      const open = await page.eval('({drawer:document.getElementById("app").dataset.activeDrawer,' +
        'readoutHidden:getComputedStyle(document.getElementById("scene-readout")).display==="none",' +
        'readoutAriaHidden:document.getElementById("scene-readout").getAttribute("aria-hidden"),' +
        'detailVisible:document.getElementById("detail-panel").getClientRects().length>0})');
      const shouldHide = width <= 640;
      check('scene readout vs detail sheet ' + width + 'x' + height,
        open.drawer === 'detail' && open.detailVisible &&
        open.readoutHidden === shouldHide &&
        open.readoutAriaHidden === String(shouldHide), open);
      const railClearance = await page.eval('(() => {' +
        'const a=document.querySelector(".camera-tools").getBoundingClientRect(),' +
        'b=document.getElementById("detail-panel").getBoundingClientRect();' +
        'const overlaps=a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;' +
        'const reachable=["zoom-in","zoom-out","reset-view"].every(id=>{' +
        'const button=document.getElementById(id),r=button.getBoundingClientRect(),' +
        'hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);' +
        'return hit===button||button.contains(hit);});' +
        'return {overlaps,reachable,camera:{top:a.top,bottom:a.bottom},detail:{top:b.top,bottom:b.bottom}};})()');
      check('camera tools clear open detail ' + width + 'x' + height,
        !railClearance.overlaps && railClearance.reachable, railClearance);
      await page.click('#detail-close');
      const closed = await page.eval('({drawer:document.getElementById("app").dataset.activeDrawer,' +
        'readoutVisible:getComputedStyle(document.getElementById("scene-readout")).display!=="none",' +
        'aria:document.getElementById("scene-readout").getAttribute("aria-hidden")})');
      check('scene readout restored ' + width + 'x' + height,
        closed.drawer === 'none' && closed.readoutVisible && closed.aria === 'false', closed);
    }
  }
  await page.send('Emulation.clearDeviceMetricsOverride');

  await page.click('#planet-dock-toggle');
  await page.click('#planet-list .planet-item[data-id="earth"]');
  const planetContext = await page.eval('({view:document.getElementById("app").dataset.view,' +
    'motionVisible:!document.getElementById("time-open-trigger").hidden,' +
    'cameraVisible:document.querySelector(".camera-tools").getClientRects().length>0})');
  check('planet close-up retains contextual motion and quick camera',
    planetContext.view === 'planet' && planetContext.motionVisible &&
    planetContext.cameraVisible, planetContext);
  await page.click('#planet-dock-toggle');
  await page.click('#objects-workspace-slot .view-link[data-view="free"]');
  const freeReady = await page.until(
    'document.getElementById("app").dataset.view === "free"', 18);
  check('free-flight scene navigation', freeReady, await page.eval(
    '({view:document.getElementById("app").dataset.view,' +
    'drawer:document.getElementById("app").dataset.activeDrawer})'));
  if (freeReady) {
    await delay(1250);
    const flightContext = await page.eval('({motionHidden:document.getElementById("time-open-trigger").hidden,' +
      'flightSpeedVisible:!document.getElementById("flight-speed-control").hidden,' +
      'cameraVisible:getComputedStyle(document.querySelector(".camera-tools")).display!=="none"})');
    check('free flight has separate speed and quick camera',
      (t31Mode ? !flightContext.motionHidden : flightContext.motionHidden) &&
      flightContext.flightSpeedVisible && flightContext.cameraVisible, flightContext);
    await page.click('#planet-dock-toggle');
    const flightLayout = await page.eval('(() => {' +
      'const a=document.getElementById("free-target-select"),b=document.getElementById("flight-speed");' +
      'const panel=document.getElementById("flight-pickers");' +
      'return {drawer:document.getElementById("app").dataset.activeDrawer,' +
      'targetCount:a.options.length,groups:a.querySelectorAll("optgroup").length,' +
      'native:a.tagName==="SELECT"&&b.tagName==="SELECT",' +
      'samePanel:panel.contains(a)&&panel.contains(b),' +
      'oldTilesHidden:getComputedStyle(document.getElementById("planet-list")).display==="none",' +
      'speedVisible:document.getElementById("flight-speed-trigger").getClientRects().length>0,' +
      'customTriggers:[...document.querySelectorAll(".flight-select-trigger")].every(e=>e.getAttribute("role")==="combobox"),' +
      'arrow:document.querySelector("#flight-speed-slot .select-chevron use").getAttribute("href")};})()');
    check('flight target and speed share a visible native selector panel',
      flightLayout.drawer === 'flight' && flightLayout.targetCount === 23 &&
      flightLayout.groups >= 2 && flightLayout.native && flightLayout.samePanel &&
      flightLayout.oldTilesHidden &&
      flightLayout.speedVisible && flightLayout.customTriggers &&
      flightLayout.arrow === '#ic-chevron-down', flightLayout);
    await page.click('#free-target-select-trigger');
    const targetExpanded = await page.eval('(() => {const popup=document.getElementById("free-target-select-popover"),' +
      'trigger=document.getElementById("free-target-select-trigger"),' +
      'list=document.getElementById("free-target-select-listbox"),r=popup.getBoundingClientRect();' +
      'return {shown:!popup.hidden,expanded:trigger.getAttribute("aria-expanded"),' +
      'role:trigger.getAttribute("role"),active:trigger.getAttribute("aria-activedescendant"),' +
      'count:list.querySelectorAll("[role=option]").length,groups:list.querySelectorAll("[role=group]").length,' +
      'height:r.height,scroll:list.scrollHeight>list.clientHeight,' +
      'withinScreen:r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth,' +
      'drawer:document.getElementById("app").dataset.activeDrawer};})()');
    check('target dropdown expands as grouped scrollable themed list',
      targetExpanded.shown && targetExpanded.expanded === 'true' &&
      targetExpanded.role === 'combobox' && Boolean(targetExpanded.active) &&
      targetExpanded.count === 23 && targetExpanded.groups >= 3 &&
      targetExpanded.scroll && targetExpanded.withinScreen &&
      targetExpanded.drawer === 'flight', targetExpanded);
    const targetExpandedScreenshot = await page.send('Page.captureScreenshot',
      {format:'png', captureBeyondViewport:false, fromSurface:true});
    report.flightTargetExpandedDesktop = artifactPath('docs/baselines/2026-10-21-T15-flight-target-expanded-desktop.png');
    await writeFile(report.flightTargetExpandedDesktop, Buffer.from(targetExpandedScreenshot.data,'base64'));
    await page.eval('document.querySelector("#free-target-select-listbox [data-value=\\"saturn\\"]")' +
      '.scrollIntoView({block:"center"})');
    await page.click('#free-target-select-listbox [data-value="saturn"]');
    const targetChosen = await page.eval('({value:document.getElementById("free-target-select").value,' +
      'trigger:document.getElementById("free-target-select-value").textContent,' +
      'closed:document.getElementById("free-target-select-popover").hidden,' +
      'drawer:document.getElementById("app").dataset.activeDrawer})');
    check('themed target selection locks planet and leaves drawer available',
      targetChosen.value === 'saturn' && targetChosen.trigger === '土星' &&
      targetChosen.closed && targetChosen.drawer === 'flight', targetChosen);
    await page.click('#flight-speed-trigger');
    const speedExpanded = await page.eval('(() => {const p=document.getElementById("flight-speed-popover"),' +
      'r=p.getBoundingClientRect();return {visible:!p.hidden,' +
      'options:p.querySelectorAll("[role=option]").length,' +
      'selected:p.querySelectorAll("[aria-selected=true]").length,' +
      'withinScreen:r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth};})()');
    check('speed dropdown expands with four custom options',
      speedExpanded.visible && speedExpanded.options === 4 &&
      speedExpanded.selected === 1 && speedExpanded.withinScreen, speedExpanded);
    await page.key('ArrowDown','ArrowDown',40);
    await page.key('Enter','Enter',13);
    const speedKeyboard = await page.eval('({value:document.getElementById("flight-speed").value,' +
      'label:document.getElementById("flight-speed-value").textContent,' +
      'closed:document.getElementById("flight-speed-popover").hidden,' +
      'focus:document.activeElement.id})');
    check('speed dropdown supports arrow and Enter keyboard selection',
      speedKeyboard.value === '2' && speedKeyboard.label.includes('2×') &&
      speedKeyboard.closed && speedKeyboard.focus === 'flight-speed-trigger', speedKeyboard);
    await page.click('#free-target-select-trigger');
    await page.click('#flight-speed-trigger');
    check('opening a second dropdown dismisses the first', await page.eval(
      'document.getElementById("free-target-select-popover").hidden && ' +
      '!document.getElementById("flight-speed-popover").hidden'), {});
    await page.key('Escape','Escape',27);
    check('Escape dismisses dropdown without closing flight workspace', await page.eval(
      'document.getElementById("flight-speed-popover").hidden && ' +
      'document.getElementById("app").dataset.activeDrawer === "flight"'), {});
    const flightTarget = await page.eval('(() => {const s=document.getElementById("free-target-select");' +
      's.value="saturn";s.dispatchEvent(new Event("change",{bubbles:true}));' +
      'return {value:s.value,status:document.getElementById("free-flight-status").textContent,' +
      'goDisabled:document.getElementById("free-flight-go").disabled};})()');
    check('styled native flight target preserves locking', flightTarget.value === 'saturn' &&
      !flightTarget.goDisabled && flightTarget.status.includes('土星'), flightTarget);
    const flightRate = await page.eval('(() => {const selector=document.getElementById("flight-speed");' +
      'selector.value="4";selector.dispatchEvent(new Event("change",{bubbles:true}));' +
      'return {flight:selector.value,orbital:document.getElementById("speed-value").textContent};})()');
    check('flight speed does not change orbital playback setting',
      flightRate.flight === '4' && flightRate.orbital === '1×', flightRate);
    const desktopFlightImage = await page.send('Page.captureScreenshot',
      {format:'png',captureBeyondViewport:false,fromSurface:true});
    report.flightDesktopScreenshot = artifactPath('docs/baselines/2026-10-21-T15-flight-select-desktop.png');
    await writeFile(report.flightDesktopScreenshot, Buffer.from(desktopFlightImage.data,'base64'));
    await page.click('#planet-dock-toggle');
    await page.send('Emulation.setDeviceMetricsOverride',
      { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await page.click('#planet-dock-toggle');
    const mobileFlightLayout = await page.eval('(() => {' +
      'const a=document.getElementById("free-target-select-trigger").getBoundingClientRect(),' +
      'b=document.getElementById("flight-speed-trigger").getBoundingClientRect(),' +
      'p=document.getElementById("flight-pickers").getBoundingClientRect();' +
      'return {width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth,' +
      'target:{top:a.top,left:a.left,width:a.width,height:a.height},' +
      'speed:{top:b.top,left:b.left,width:b.width,height:b.height},' +
      'panel:{left:p.left,right:p.right},speedHidden:document.getElementById("flight-speed-control").hidden};})()');
    check('mobile flight selectors stack without overflow',
      !mobileFlightLayout.overflow && !mobileFlightLayout.speedHidden &&
      mobileFlightLayout.target.width >= 230 && mobileFlightLayout.speed.width >= 230 &&
      mobileFlightLayout.speed.top > mobileFlightLayout.target.top &&
      mobileFlightLayout.panel.left >= 0 && mobileFlightLayout.panel.right <= 390,
      mobileFlightLayout);
    await page.click('#free-target-select-trigger');
    const targetMobilePopup = await page.eval('(() => {' +
      'const p=document.getElementById("free-target-select-popover"),' +
      'l=document.getElementById("free-target-select-listbox"),r=p.getBoundingClientRect();' +
      'return {open:!p.hidden,above:p.dataset.placement,"viewport":[innerWidth,innerHeight],' +
      'rect:{top:r.top,bottom:r.bottom,left:r.left,right:r.right,height:r.height},' +
      'scrollable:l.scrollHeight>l.clientHeight,role:l.getAttribute("role")};})()');
    check('mobile target popup fits viewport and scrolls',
      targetMobilePopup.open && targetMobilePopup.rect.top >= 0 &&
      targetMobilePopup.rect.bottom <= 844 &&
      targetMobilePopup.rect.left >= 0 && targetMobilePopup.rect.right <= 390 &&
      targetMobilePopup.scrollable && targetMobilePopup.role === 'listbox', targetMobilePopup);
    const mobileTargetExpanded = await page.send('Page.captureScreenshot',
      {format:'png',captureBeyondViewport:false,fromSurface:true});
    report.flightTargetExpandedMobile = artifactPath('docs/baselines/2026-10-21-T15-flight-target-expanded-mobile-390.png');
    await writeFile(report.flightTargetExpandedMobile, Buffer.from(mobileTargetExpanded.data,'base64'));
    await page.key('Escape','Escape',27);
    await page.click('#flight-speed-trigger');
    const mobileSpeedExpanded = await page.send('Page.captureScreenshot',
      {format:'png',captureBeyondViewport:false,fromSurface:true});
    report.flightSpeedExpandedMobile = artifactPath('docs/baselines/2026-10-21-T15-flight-speed-expanded-mobile-390.png');
    await writeFile(report.flightSpeedExpandedMobile, Buffer.from(mobileSpeedExpanded.data,'base64'));
    await page.key('Escape','Escape',27);
    const mobileFlightImage = await page.send('Page.captureScreenshot',
      {format:'png',captureBeyondViewport:false,fromSurface:true});
    report.flightMobileScreenshot = artifactPath('docs/baselines/2026-10-21-T15-flight-select-mobile-390.png');
    await writeFile(report.flightMobileScreenshot, Buffer.from(mobileFlightImage.data,'base64'));
    await page.click('#planet-dock-toggle');
    await page.click('#detail-peek-trigger');
    const mobileFree = await page.eval('({drawer:document.getElementById("app").dataset.activeDrawer,' +
      'title:document.getElementById("detail-name").textContent,' +
      'peekLabel:document.getElementById("detail-peek-trigger").getAttribute("aria-label"),' +
      'readoutHidden:getComputedStyle(document.getElementById("scene-readout")).display==="none",' +
      'detailAria:document.getElementById("detail-panel").getAttribute("aria-hidden")})');
    check('free-flight mobile archive sheet', mobileFree.drawer === 'detail' &&
      mobileFree.title === '自由漫游' && mobileFree.readoutHidden &&
      mobileFree.detailAria === 'false' &&
      mobileFree.peekLabel === '收起土星资料', mobileFree);
    const toastPlacement = await page.eval('(() => {const toast=document.getElementById("toast");' +
      'toast.textContent="已进入自由漫游";toast.classList.add("is-visible");' +
      'const a=toast.getBoundingClientRect(),b=document.getElementById("detail-panel").getBoundingClientRect();' +
      'return {toast:{top:a.top,bottom:a.bottom},detail:{top:b.top,bottom:b.bottom},' +
      'overlap:a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top};})()');
    check('mobile toast clears the archive sheet', !toastPlacement.overlap, toastPlacement);
    const screenshot = await page.send('Page.captureScreenshot',
      { format: 'png', captureBeyondViewport: false, fromSurface: true });
    const screenshotPath = artifactPath('docs/baselines/2026-10-21-T15-free-mobile-390.png');
    await writeFile(screenshotPath, Buffer.from(screenshot.data, 'base64'));
    report.screenshot = screenshotPath;
    await page.eval('document.getElementById("toast").classList.remove("is-visible")');
    await page.click('#detail-close');
    await page.send('Emulation.clearDeviceMetricsOverride');
  }

  const extension = await page.eval('(() => {const gl=document.getElementById("universe-canvas")?.getContext("webgl2");' +
    'window.__cosmosAuditLoseContext = gl?.getExtension("WEBGL_lose_context");' +
    'return Boolean(window.__cosmosAuditLoseContext);})()');
  report.webglLoseExtensionAvailable = extension;
  if (extension) {
    await page.eval('window.__cosmosAuditLoseContext.loseContext()');
    const lost = await page.until('!document.getElementById("webgl-context-recovery").hidden', 5);
    check('WebGL loss shows recovery UI', lost, await page.eval(
      '({visible:!document.getElementById("webgl-context-recovery").hidden,focus:document.activeElement.id})'));
    await page.eval('window.__cosmosAuditLoseContext.restoreContext()');
    const restored = await page.until('document.getElementById("webgl-context-recovery").hidden', 10);
    check('WebGL restores without reload', restored, await page.eval(
      '({visible:!document.getElementById("webgl-context-recovery").hidden,' +
      'contextLost:window.getCosmosPerformance?.().contextLost})'));
  } else check('WebGL loss extension available', false, {available:false},
    'This browser does not expose WEBGL_lose_context');
  if (initial.hasPerf) {
    await delay(1500);
    report.performance = await page.eval('window.getCosmosPerformance()');
    check('performance diagnostics accessible',
      Number.isFinite(report.performance?.dpr) && report.performance?.contextLost === false,
      report.performance);
  }
} catch (error) {
  report.errors.push(String(error?.stack || error));
  console.error(error?.stack || error);
} finally {
  report.finished = new Date().toISOString();
  report.summary = { passed: report.checks.filter(x => x.pass).length,
    failed: report.checks.filter(x => !x.pass).length,
    errors: report.errors.length };
  await mkdir(path.dirname(reportPath), {recursive:true});
  // Preserve the previous successful machine report when a run fails or
  // cannot start. Store the latest failure at a separate stable path.
  const destination = report.summary.failed || report.summary.errors
    ? (reportPath.endsWith('.json')
      ? reportPath.replace(/\.json$/, '-failed.json')
      : reportPath + '.failed.json')
    : reportPath;
  await writeFile(destination, JSON.stringify(report,null,2), 'utf8');
  page?.close();
  chrome?.kill();
  await delay(300);
  await rm(profile, {recursive:true,force:true,maxRetries:3,retryDelay:250}).catch(()=>{});
  console.log('T15 audit:', JSON.stringify(report.summary), 'report:', destination);
  if (report.summary.failed || report.summary.errors) process.exitCode=1;
}
