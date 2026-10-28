// T27 integration: scale controls, physical positions, floating origin, date,
// camera, free flight, and PC/mobile layout in an isolated local Chromium.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const ROOT = path.resolve('dist');
const BASELINE = process.env.COSMOS_AUDIT_PREFIX || 'docs/baselines/2026-10-27-T27';
const CHROME = process.env.CHROME_EXE ||
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const profile = await mkdtemp(path.join(os.tmpdir(), 'cosmos-t27-'));
const report = {
  task: 'T27', started: new Date().toISOString(),
  environment: 'Local dist / isolated headless Chrome SwiftShader / emulated viewports',
  limitations: ['No physical Android/iOS touch or hardware GPU verification.'],
  checks: [], screenshots: [], errors: []
};
let server, chrome, page, chromeExit = null, stderr = '';
function check(name, pass, actual = null) {
  report.checks.push({ name, pass: Boolean(pass), actual });
  console.log((pass ? 'PASS ' : 'FAIL ') + name);
}
async function until(predicate, seconds = 16) {
  const end = Date.now() + seconds * 1000;
  while (Date.now() < end) {
    if (await predicate()) return true;
    await delay(140);
  }
  return false;
}
function typeOf(file) {
  return file.endsWith('.html') ? 'text/html; charset=utf-8' :
    file.endsWith('.js') ? 'text/javascript; charset=utf-8' :
    file.endsWith('.css') ? 'text/css; charset=utf-8' :
    file.endsWith('.json') ? 'application/json; charset=utf-8' :
    file.endsWith('.png') ? 'image/png' :
    file.endsWith('.jpg') ? 'image/jpeg' :
    file.endsWith('.svg') ? 'image/svg+xml' : 'application/octet-stream';
}
async function serve() {
  server = createServer(async (request, response) => {
    try {
      const relative = decodeURIComponent(new URL(request.url, 'http://localhost')
        .pathname).replace(/^\/+/, '') || 'index.html';
      const filename = path.resolve(ROOT, relative);
      if (!filename.startsWith(ROOT + path.sep)) {
        response.writeHead(403).end('Forbidden'); return;
      }
      const bytes = await readFile(filename);
      response.writeHead(200, {
        'Content-Type': typeOf(filename), 'Cache-Control': 'no-store'
      }).end(bytes);
    } catch {
      response.writeHead(404).end('Not found');
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return 'http://127.0.0.1:' + server.address().port + '/';
}
class CDP {
  constructor(socket) {
    this.socket = socket;
    this.next = 0;
    this.pending = new Map();
    socket.onmessage = event => {
      const message = JSON.parse(String(event.data));
      const entry = this.pending.get(message.id);
      if (!entry) return;
      clearTimeout(entry.timeout);
      this.pending.delete(message.id);
      if (message.error) entry.reject(Error(message.error.message));
      else entry.resolve(message.result || {});
    };
  }
  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.next;
      const timeout = setTimeout(() => {
        this.pending.delete(id); reject(Error('CDP timeout: ' + method));
      }, 20000);
      this.pending.set(id, { resolve, reject, timeout });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression, awaitPromise: true, returnByValue: true
    });
    if (result.exceptionDetails) {
      throw Error(result.exceptionDetails.exception?.description ||
        result.exceptionDetails.text);
    }
    return result.result?.value;
  }
  async click(selector) {
    let hit;
    for (let i = 0; i < 60; i++) {
      hit = await this.eval('(() => {const e=document.querySelector(' +
        JSON.stringify(selector) + ');if(!e)return null;' +
        'if(!e.closest("[inert],[hidden]"))e.scrollIntoView({block:"nearest"});' +
        'const r=e.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;' +
        'const top=document.elementFromPoint(x,y);return {x,y,ready:r.width>15&&' +
        'r.height>15&&!e.closest("[inert],[hidden]")&&' +
        '(top===e||e.contains(top))};})()');
      if (hit?.ready) break;
      await delay(120);
    }
    if (!hit?.ready) throw Error('Not clickable ' + selector + ': ' + JSON.stringify(hit));
    for (const type of ['mousePressed', 'mouseReleased']) {
      await this.send('Input.dispatchMouseEvent', {
        type, x: hit.x, y: hit.y, button: 'left',
        buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1
      });
    }
  }
  async value(selector, value) {
    return this.eval('(() => {const e=document.querySelector(' +
      JSON.stringify(selector) + ');e.value=' + JSON.stringify(value) +
      ';e.dispatchEvent(new Event("input",{bubbles:true}));return e.value;})()');
  }
  async viewport(width, height) {
    await this.send('Emulation.setDeviceMetricsOverride', {
      width, height, deviceScaleFactor: 1, mobile: width <= 900
    });
    await delay(450);
  }
  async screenshot(name) {
    const filename = BASELINE + '-' + name + '.png';
    const data = await this.send('Page.captureScreenshot', {
      format: 'png', captureBeyondViewport: false, fromSurface: true
    });
    await mkdir(path.dirname(filename), { recursive: true });
    await writeFile(filename, Buffer.from(data.data, 'base64'));
    report.screenshots.push(filename);
  }
}
const diag = () => page.eval('window.getCosmosScale?.()');
try {
  const base = await serve();
  chrome = spawn(CHROME, [
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-background-networking',
    '--enable-unsafe-swiftshader', '--use-angle=swiftshader',
    '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0',
    '--remote-allow-origins=*', '--user-data-dir=' + profile,
    '--window-size=1366,768', 'about:blank'
  ], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
  chrome.on('error', error => report.errors.push(error.message));
  chrome.on('exit', (code, signal) => { chromeExit = { code, signal }; });
  chrome.stderr?.on('data', value => { stderr = (stderr + String(value)).slice(-2000); });
  let port;
  for (let i = 0; i < 100; i++) {
    if (chromeExit) throw Error('Chrome exited ' + JSON.stringify(chromeExit) + stderr);
    try {
      port = Number((await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8'))
        .split(/\r?\n/)[0]);
      break;
    } catch { await delay(110); }
  }
  if (!port) throw Error('Chrome debugger port not found: ' + stderr);
  const tab = await fetch('http://127.0.0.1:' + port + '/json/new?' +
    encodeURIComponent(base), { method: 'PUT' }).then(response => response.json());
  const socket = new WebSocket(tab.webSocketDebuggerUrl);
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

  check('default enhanced mode initializes', await until(() =>
    page.eval('document.getElementById("loading-screen")?.classList.contains("is-loaded") && ' +
      'document.getElementById("app")?.dataset.scaleMode==="enhanced"'), 22));
  check('only one shared settings scale control exists', await page.eval(
    'document.querySelectorAll("#t27-scale-controls").length===1 && ' +
    'document.querySelectorAll("#t27-scale-controls [data-scale-mode]").length===2'));
  await page.click('#rail-settings-trigger');
  check('desktop buttons accessible in existing settings workspace', await page.eval(
    'document.getElementById("app").dataset.navPane==="settings" && ' +
    '!document.getElementById("t27-scale-controls").closest("[inert],[hidden]")'));
  await page.click('#t27-scale-physical');
  const physical = await diag();
  check('physical mode selected without changing scientific source', physical.mode === 'physical' &&
    physical.bodies.earth.radiusScene > .04 && physical.bodies.earth.radiusScene < .05 &&
    Object.keys(physical.bodies).length === 22, physical.mode);
  check('physical diameter and mean orbit km ratios', Math.abs(
    physical.bodies.earth.radiusScene / physical.bodies.sun.radiusScene -
    12742 / 1392000) < 1e-10 &&
    Math.abs(Math.hypot(...physical.bodies.earth.parentRelativeKm) /
      149597870.7 - 1) < .1);
  await page.click('#rail-objects-trigger');
  await page.click('.view-link[data-view="solar"]');
  check('solar overview scales to AU distances', await until(() =>
    page.eval('document.getElementById("app").dataset.view==="solar"'), 12));
  check('solar transition settles before choosing another body',
    await until(async () => {
      const state = await diag();
      return state.scene === 'solar' && !state.transitioning && !state.flying;
    }, 12));
  const overview = await diag();
  check('overview camera and positions remain finite', overview.cameraDistance > 10000 &&
    Math.hypot(...overview.bodies.earth.worldPosition) > 900 &&
    overview.bodies.earth.worldPosition.every(Number.isFinite));
  check('overview frustum tightens with camera distance',
    overview.cameraFar / overview.cameraNear < 20000,
    { near: overview.cameraNear, far: overview.cameraFar });
  check('physical mode hides mismatched demonstration orbit lines',
    await page.eval('document.getElementById("orbit-toggle").disabled && ' +
      '!document.getElementById("t31-orbit-hint").hidden'));

  await page.click('#rail-objects-trigger');
  await page.click('#planet-list .planet-item[data-id="earth"]');
  check('physical Earth focus and floating origin', await until(async () => {
    const info = await diag();
    return info.scene === 'planet' && info.focusedBody === 'earth' &&
      info.anchorId === 'earth' && info.cameraDistance < 2 &&
      Math.hypot(...info.bodies.earth.worldPosition) < .0001;
  }, 12), await diag());
  const earth = await diag();
  check('focused Earth camera does not intersect surface',
    earth.cameraDistance > earth.bodies.earth.radiusScene * 1.5 &&
      earth.cameraFar / earth.cameraNear < 10000000,
    { distance: earth.cameraDistance, near: earth.cameraNear, far: earth.cameraFar });
  await page.screenshot('earth-physical-desktop');

  await page.click('#rail-time-trigger');
  await page.value('#t26-utc-input', '2026-10-27T12:00');
  await page.click('#t26-apply');
  check('physical scale survives UTC ephemeris activation', await until(() =>
    page.eval('window.getCosmosEphemeris().enabled && ' +
      'document.getElementById("app").dataset.scaleMode==="physical"'), 20));
  const dated = await diag();
  check('date mode keeps physical radii and floating anchor', dated.anchorId === 'earth' &&
    dated.bodies.earth.radiusScene === earth.bodies.earth.radiusScene &&
    Math.hypot(...dated.bodies.earth.worldPosition) < .0001, dated.anchorId);
  await page.screenshot('date-physical-desktop');

  await page.click('#rail-settings-trigger');
  await page.click('#t27-scale-enhanced');
  const enhanced = await diag();
  check('switching to enhanced preserves km coordinates and UTC', enhanced.mode === 'enhanced' &&
    enhanced.bodies.earth.radiusScene > dated.bodies.earth.radiusScene &&
    JSON.stringify(enhanced.bodies.earth.absoluteKm) ===
      JSON.stringify(dated.bodies.earth.absoluteKm) &&
    await page.eval('window.getCosmosEphemeris().utcMs === Date.UTC(2026,9,27,12)'));
  check('ephemeris alone still disables demo orbit switch', await page.eval(
    'document.getElementById("orbit-toggle").disabled'));
  await page.click('#t27-scale-physical');
  if (!await page.eval('(() => {const e=document.querySelector("#detail-moon-list .moon-chip");' +
    'return Boolean(e&&!e.closest("[hidden],[inert]")&&e.getClientRects().length);})()')) {
    await page.click('#t31-rail-detail');
  }
  await page.click('#detail-moon-list .moon-chip');
  check('Moon focus rebases parent-relative coordinates', await until(async () => {
    const s = await diag();
    return s.scene === 'planet' && s.focusedBody === 'moon' &&
      s.anchorId === 'moon' && Math.hypot(...s.bodies.moon.worldPosition) < .0001 &&
      s.cameraDistance < 1;
  }, 12));

  await page.click('#rail-objects-trigger');
  await page.click('.view-link[data-view="free"]');
  check('free-flight scene remains operational at physical scale', await until(() =>
    page.eval('document.getElementById("app").dataset.view==="free"'), 12) &&
    (await diag()).cameraDistance > 0);
  await page.viewport(390, 844);
  await page.click('#mobile-menu-trigger');
  await page.click('#mobile-settings-action');
  check('mobile settings share the same scale control', await page.eval(
    'document.querySelectorAll("#t27-scale-controls").length===1 && ' +
    'document.getElementById("app").dataset.navPane==="settings"'));
  await page.click('#t27-scale-enhanced');
  await page.click('#t27-scale-physical');
  check('mobile scale controls fit viewport and remain clickable', await page.eval(
    '(() => {const b=[...document.querySelectorAll("#t27-scale-controls button")];' +
    'return b.length===2&&b.every(e=>{const r=e.getBoundingClientRect(),' +
    'hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);' +
    'return r.width>75&&r.height>=40&&r.left>=0&&r.right<=innerWidth&&' +
    'r.top>=0&&r.bottom<=innerHeight&&(hit===e||e.contains(hit));});})()'));
  check('mobile mode switching restores physical state', (await diag()).mode === 'physical');
  await page.screenshot('mobile-settings-physical');
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
  await mkdir(path.dirname(BASELINE), { recursive: true });
  await writeFile(BASELINE + '-browser-audit.json', JSON.stringify(report, null, 2) + '\n');
  page?.socket.close();
  chrome?.kill();
  if (server) await new Promise(resolve => server.close(resolve));
  await delay(200);
  await rm(profile, { force: true, recursive: true, maxRetries: 3 }).catch(() => {});
  console.log('T27 browser audit:', JSON.stringify(report.summary));
  if (report.summary.failed || report.summary.errors) process.exitCode = 1;
}
