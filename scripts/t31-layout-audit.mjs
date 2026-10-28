// T31: isolated browser audit for the extensible PC and mobile workspace.
// Screenshots and structured results are stored under docs/baselines/.
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const url = process.env.COSMOS_URL || 'http://127.0.0.1:5173/';
const chromePath = process.env.CHROME_EXE ||
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const prefix = process.env.COSMOS_AUDIT_PREFIX || 'docs/baselines/2026-10-26-T31';
const profile = await mkdtemp(path.join(os.tmpdir(), 'cosmos-t31-'));
const report = {
  started: new Date().toISOString(), previewUrl: url,
  environment: 'Isolated Headless Chrome / SwiftShader / emulated viewport sizes',
  limitations: ['Viewport emulation does not establish physical mobile touch, GPU performance or read-screen behavior.'],
  checks: [], screenshots: [], errors: []
};
let browser, page, chromeExit, chromeStderr = '';

function check(name, pass, actual = null) {
  report.checks.push({ name, pass: Boolean(pass), actual });
  console.log((pass ? 'PASS ' : 'FAIL ') + name);
}
async function until(predicate, timeout = 15) {
  const end = Date.now() + timeout * 1000;
  while (Date.now() < end) {
    if (await predicate()) return true;
    await delay(130);
  }
  return false;
}
class CDP {
  constructor(socket) {
    this.socket = socket;
    this.pending = new Map();
    this.id = 1;
    socket.onmessage = event => {
      const response = JSON.parse(String(event.data));
      const waiting = this.pending.get(response.id);
      if (!waiting) return;
      this.pending.delete(response.id);
      clearTimeout(waiting.timer);
      if (response.error) waiting.reject(Error(response.error.message));
      else waiting.resolve(response.result || {});
    };
  }
  send(method, params = {}, timeoutMs = 20000) {
    return new Promise((resolve, reject) => {
      const id = this.id++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(Error(method + ' timed out'));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expression) {
    const result = await this.send('Runtime.evaluate',
      { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) {
      throw Error(result.exceptionDetails.exception?.description ||
        result.exceptionDetails.text);
    }
    return result.result?.value;
  }
  async click(selector) {
    let box;
    for (let i = 0; i < 48; i++) {
      box = await this.eval('(() => {const e=document.querySelector(' +
        JSON.stringify(selector) + ');if(!e)return null;' +
        'e.scrollIntoView({block:"nearest",inline:"nearest"});' +
        'const r=e.getBoundingClientRect();const x=r.left+r.width/2,y=r.top+r.height/2;' +
        'const hit=document.elementFromPoint(x,y);' +
        'return {x,y,visible:r.width>=20&&r.height>=20&&' +
        '!e.closest("[inert],[hidden]")&&' +
        '(hit===e||e.contains(hit))};})()');
      if (box?.visible) break;
      await delay(100);
    }
    if (!box?.visible) throw Error('Not clickable: ' + selector + JSON.stringify(box));
    for (const type of ['mousePressed', 'mouseReleased']) {
      await this.send('Input.dispatchMouseEvent', {
        type, x: box.x, y: box.y, button: 'left',
        buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1
      });
    }
  }
  async viewport(width, height) {
    await this.send('Emulation.setDeviceMetricsOverride', {
      width, height, deviceScaleFactor: 1, mobile: width <= 900
    });
    await delay(500);
  }
  async screenshot(name) {
    const filename = prefix + '-' + name + '.png';
    const result = await this.send('Page.captureScreenshot',
      { format: 'png', captureBeyondViewport: false, fromSurface: true });
    await mkdir(path.dirname(filename), { recursive: true });
    await writeFile(filename, Buffer.from(result.data, 'base64'));
    report.screenshots.push(filename);
    return filename;
  }
}
async function debuggerPort() {
  for (let i = 0; i < 100; i++) {
    if (chromeExit) throw Error('Chrome exited: ' +
      JSON.stringify(chromeExit) + chromeStderr);
    try {
      return Number((await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8'))
        .split(/\r?\n/)[0]);
    } catch { await delay(100); }
  }
  throw Error('Chrome DevTools port unavailable: ' + chromeStderr);
}
const state = () => page.eval('(() => {' +
  'const a=document.getElementById("app");' +
  'const rect=id=>{const r=document.getElementById(id)?.getBoundingClientRect();' +
    'return r?{left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}:null};' +
  'const btn=id=>{const e=document.getElementById(id);const r=e?.getBoundingClientRect();' +
    'return {id,width:r?.width,height:r?.height,expanded:e?.getAttribute("aria-expanded")}};' +
  'return {view:window.innerWidth+"x"+window.innerHeight,' +
    'drawer:a.dataset.activeDrawer,nav:a.dataset.navPane,detail:a.dataset.inspectorOpen,' +
    'version:a.dataset.workspaceVersion,' +
    'scrollWidth:document.documentElement.scrollWidth,' +
    'rail:rect("scene-rail"),workspace:rect("workspace-panel"),' +
    'inspector:rect("detail-panel"),bottom:rect("time-capsule"),' +
    'controls:["planet-dock-toggle","time-open-trigger","detail-peek-trigger"].map(btn),' +
    'railStyle:getComputedStyle(document.getElementById("scene-rail")).display,' +
    'bottomStyle:getComputedStyle(document.querySelector(".bottom-interface")).display,' +
    'science:document.getElementById("t31-science-status")?.textContent,' +
    'workInert:document.getElementById("workspace-panel").inert,' +
    'detailInert:document.getElementById("detail-panel").inert};})()');

try {
  const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw Error('Preview HTTP ' + response.status);
  browser = spawn(chromePath, [
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-background-networking',
    '--enable-unsafe-swiftshader', '--use-angle=swiftshader',
    '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0',
    '--remote-allow-origins=*', '--user-data-dir=' + profile,
    '--window-size=1366,768', 'about:blank'
  ], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
  browser.on('error', error => report.errors.push(error.message));
  browser.on('exit', (code, signal) => { chromeExit = { code, signal }; });
  browser.stderr?.on('data', chunk => {
    chromeStderr = (chromeStderr + String(chunk)).slice(-2000);
  });
  const port = await debuggerPort();
  const target = await fetch('http://127.0.0.1:' + port + '/json/new?' +
    encodeURIComponent(url), { method: 'PUT' }).then(res => res.json());
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  page = new CDP(socket);
  await page.send('Page.enable');
  await page.send('Runtime.enable');
  await page.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }]
  });
  check('app initializes with T31 registry', await until(() =>
    page.eval('document.getElementById("app")?.dataset.workspaceVersion==="t31" && ' +
      'document.getElementById("loading-screen")?.classList.contains("is-loaded")'), 20));
  const initial = await state();
  check('desktop left rail, 3D stage and demo disclosure',
    initial.railStyle !== 'none' && initial.rail.left < 100 &&
    initial.bottomStyle === 'none' && initial.science.includes('演示') &&
    initial.scrollWidth <= 1367, initial);
  check('desktop has one settings and one guide entry',
    await page.eval('getComputedStyle(document.getElementById("global-settings-trigger")).display==="none" && ' +
      'getComputedStyle(document.getElementById("atlas-trigger")).display==="none" && ' +
      '!!document.getElementById("t31-rail-routes") && ' +
      '!!document.getElementById("rail-settings-trigger")'));
  await page.screenshot('desktop-idle');

  await page.click('#rail-objects-trigger');
  check('desktop explorer opens on left', await page.eval(
    'document.getElementById("app").dataset.navPane==="objects" && ' +
    '!document.getElementById("objects-workspace-slot").inert'));
  await page.click('#t31-rail-detail');
  const twoPane = await state();
  const central = twoPane.inspector.left - twoPane.workspace.right;
  check('desktop explorer and research panels coexist, stage >= 540px',
    twoPane.nav === 'objects' && twoPane.detail === 'true' &&
    !twoPane.detailInert && central >= 540, { central, twoPane });
  await page.screenshot('desktop-dual');

  await page.click('#t31-inspector-tabs [data-inspector-tab="metrics"]');
  check('research tabs switch to data', await page.eval(
    'document.getElementById("app").dataset.inspectorTab==="metrics" && ' +
    'document.querySelector("#t31-inspector-tabs [data-inspector-tab=metrics]")?.getAttribute("aria-pressed")==="true"'));
  check('data tab hides overview and source duplicates', await page.eval(
    'getComputedStyle(document.getElementById("detail-name")).display==="none" && ' +
      'getComputedStyle(document.getElementById("atlas-source-block")).display==="none" && ' +
      '!!document.getElementById("t31-inspector-context").textContent && ' +
      '!document.getElementById("t31-metrics-unavailable").hidden'));
  await page.click('#t31-inspector-tabs [data-inspector-tab="sources"]');
  check('research sources remain labeled as educational', await page.eval(
    'document.getElementById("app").dataset.inspectorTab==="sources" && ' +
    'document.getElementById("t31-source-unavailable")?.getClientRects().length>0'));
  check('source tab hides numeric table and repeated hero title', await page.eval(
    'getComputedStyle(document.querySelector(".detail-stats")).display==="none" && ' +
    'getComputedStyle(document.getElementById("detail-name")).display==="none" && ' +
    '!document.getElementById("t31-inspector-context").hidden'));

  await page.click('#t31-rail-routes');
  check('desktop tour opens directly without a redundant workspace',
    await page.eval('document.getElementById("atlas-overlay").classList.contains("is-open")'));
  check('no unused routes or layers intermediate workspaces',
    await page.eval('!document.getElementById("routes-workspace-slot") && ' +
      '!document.getElementById("layers-workspace-slot") && ' +
      '!document.getElementById("t31-rail-layers")'));
  check('V3 guided tour modal opens from left controller', await page.eval(
    'document.getElementById("atlas-overlay").classList.contains("is-open")'));
  await page.click('#atlas-close');
  check('closing modal restores both desktop workspaces', await page.eval(
    'document.getElementById("app").dataset.navPane==="objects" && ' +
    'document.getElementById("app").dataset.inspectorOpen==="true"'));

  await page.click('#rail-time-trigger');
  check('time explanation works in illustrative galaxy', await page.eval(
    'document.getElementById("app").dataset.navPane==="time" && ' +
    '!document.getElementById("t31-time-notice").hidden && ' +
    'document.getElementById("time-workspace-slot").querySelector(".simulation-panel").hidden'));
  await page.screenshot('desktop-time');

  await page.click('#rail-settings-trigger');
  check('quality and offline controls remain reachable', await page.eval(
    '!document.getElementById("quality-select").closest("[inert],[hidden]") && ' +
    '!document.getElementById("offline-toggle").closest("[inert],[hidden]")'));
  await page.click('#rail-objects-trigger');
  await page.click('#objects-workspace-slot .view-link[data-view="solar"]');
  check('scene navigation retains functional solar motion', await until(() =>
    page.eval('document.getElementById("app").dataset.view==="solar" && ' +
      '!document.getElementById("loading-screen").classList.contains("is-visible")'), 14));
  await page.click('#rail-time-trigger');
  check('solar motion remains active in time workspace', await page.eval(
    '!document.getElementById("time-workspace-slot").querySelector(".simulation-panel").hidden && ' +
    '!document.getElementById("play-pause").closest("[inert],[hidden]")'));
  await page.screenshot('desktop-solar-time');

  const registry = await page.eval('(() => {' +
    'window.CosmosWorkspaces.register({id:"t31-proof",title:"扩展样板",icon:"#ic-star",' +
    'mount(slot){slot.textContent="注册工作区已渲染"}});' +
    'window.CosmosWorkspaces.open("t31-proof");' +
    'return {items:window.CosmosWorkspaces.list().length,' +
    'label:document.getElementById("t31-proof-workspace-slot")?.textContent,' +
    'trigger:!!document.getElementById("t31-rail-t31-proof"),' +
    'active:window.CosmosWorkspaces.state().navigationPane};})()');
  check('future workspace registers without modifying fixed drawer branches',
    registry.items >= 6 && registry.label === '注册工作区已渲染' &&
    registry.trigger && registry.active === 't31-proof', registry);
  await page.click('#t31-rail-t31-proof');

  for (const [width, height] of [[390, 844], [360, 740]]) {
    await page.viewport(width, height);
    check('mobile top only exposes Search and More ' + width,
      await page.eval('(() => {const ids=[...document.querySelectorAll(".topbar .top-actions .icon-button")]' +
        '.filter(e=>getComputedStyle(e).display!=="none").map(e=>e.id);' +
        'return ids.length===2&&ids.includes("search-trigger")&&ids.includes("mobile-menu-trigger");})()'));
    const mobile = await state();
    const controlWidths = mobile.controls.every(control =>
      control.width >= 44 && control.height >= 44);
    check('mobile bottom three controls ' + width + 'x' + height,
      mobile.railStyle === 'none' && mobile.bottomStyle !== 'none' &&
      controlWidths && mobile.bottom.bottom <= height + 1 &&
      mobile.scrollWidth <= width + 1, mobile);
    await page.screenshot('mobile-' + width + '-idle');
    await page.click('#planet-dock-toggle');
    const explore = await state();
    check('mobile explorer sheet bounded ' + width + 'x' + height,
      explore.nav === 'objects' && explore.detail === 'false' &&
      explore.workspace.width <= width &&
      explore.workspace.height <= height * .6 + 1, explore);
    await page.screenshot('mobile-' + width + '-explore');
    if (width === 390) {
      await page.click('#t31-mobile-routes');
      check('mobile Explore opens guided tours directly', await page.eval(
        'document.getElementById("atlas-overlay").classList.contains("is-open")'));
      await page.click('#atlas-close');
    }
    await page.click('#time-open-trigger');
    const motion = await state();
    check('mobile time replaces explorer ' + width + 'x' + height,
      motion.nav === 'time' && motion.detail === 'false' && motion.workInert === false, motion);
    if (width === 390) {
      // Reproduce T15's time -> close -> settings sequence exactly, rather
      // than switching directly from the time workspace into settings.
      await page.click('#time-open-trigger');
      await page.click('#mobile-menu-trigger');
      await page.click('#mobile-settings-action');
      await page.click('#quality-select-trigger');
      const qualityState = await page.eval('(() => {' +
        'const p=document.getElementById("quality-select-popover");' +
        'return {drawer:document.getElementById("app").dataset.activeDrawer,' +
        'nav:document.getElementById("app").dataset.navPane,' +
        'hidden:p.hidden,expanded:document.getElementById("quality-select-trigger")' +
        '.getAttribute("aria-expanded"),' +
        'slotInert:document.getElementById("settings-workspace-slot").inert};})()');
      check('mobile quality menu stays open in settings', qualityState.drawer === 'settings' &&
        !qualityState.hidden && qualityState.expanded === 'true', qualityState);
      if (!qualityState.hidden) await page.click('#quality-select-option-1');
      await page.click('#mobile-menu-trigger');
      await page.click('#mobile-menu-trigger');
    }
    await page.click('#detail-peek-trigger');
    const research = await state();
    check('mobile research replaces time ' + width + 'x' + height,
      research.nav === 'none' && research.detail === 'true' &&
      research.inspector.width <= width &&
      research.inspector.height <= height * .6 + 1, research);
    await page.screenshot('mobile-' + width + '-research');
    await page.click('#detail-close');
  }
  await page.viewport(844, 390);
  const landscape = await state();
  check('landscape controller relocates to right', landscape.railStyle === 'none' &&
    landscape.bottom.right <= 844 && landscape.bottom.left > 700 &&
    landscape.scrollWidth <= 845, landscape);
  await page.click('#planet-dock-toggle');
  const landscapePane = await state();
  check('landscape side sheet clears controller',
    landscapePane.nav === 'objects' &&
    landscapePane.workspace.right <= landscapePane.bottom.left + 1 &&
    landscapePane.workspace.top >= 45, landscapePane);
  await page.screenshot('landscape-explore');
  await page.click('#planet-dock-toggle');

  await page.viewport(1024, 768);
  await page.click('#rail-objects-trigger');
  await page.click('#t31-rail-detail');
  check('intermediate desktop allows only one expanded panel', await page.eval(
    'document.getElementById("app").dataset.navPane==="none" && ' +
    'document.getElementById("app").dataset.inspectorOpen==="true"'));
  await page.screenshot('tablet-research');

} catch (error) {
  report.errors.push(String(error?.stack || error));
  console.error(error?.stack || error);
} finally {
  report.finished = new Date().toISOString();
  report.summary = {
    passed: report.checks.filter(item => item.pass).length,
    failed: report.checks.filter(item => !item.pass).length,
    errors: report.errors.length
  };
  await mkdir(path.dirname(prefix), { recursive: true });
  await writeFile(prefix + '-audit.json', JSON.stringify(report, null, 2), 'utf8');
  page?.socket.close();
  browser?.kill();
  await delay(200);
  await rm(profile, { force: true, recursive: true, maxRetries: 3 }).catch(() => {});
  console.log('T31 audit:', JSON.stringify(report.summary), prefix + '-audit.json');
  if (report.summary.failed || report.summary.errors) process.exitCode = 1;
}
