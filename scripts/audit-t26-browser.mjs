// T26 browser integration: actual scene motion from JPL vectors, date controls,
// missing/offline fallback, responsive placement and inherited V3 UI. Uses
// built dist files and a temporary local server/Chrome profile.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const ROOT = path.resolve('dist');
const BASELINE = process.env.COSMOS_AUDIT_PREFIX || 'docs/baselines/2026-10-27-T26';
const chromeExe = process.env.CHROME_EXE ||
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const profile = await mkdtemp(path.join(os.tmpdir(), 'cosmos-t26-'));
const report = {
  started: new Date().toISOString(),
  environment: 'Local Vite dist / isolated headless Chrome with SwiftShader / viewport emulation',
  limitations: [
    'Viewport emulation is not a physical Android/iOS touch or GPU benchmark.',
    'Software/browser testing checks navigation and source-data integration, not independent scientific certification.'
  ],
  checks: [], requests: [], screenshots: [], errors: []
};
let server, chrome, page, chromeExit = null, stderr = '';
const check = (name, pass, actual = null) => {
  report.checks.push({ name, pass: Boolean(pass), actual });
  console.log((pass ? 'PASS ' : 'FAIL ') + name);
};
async function until(predicate, timeoutSeconds = 15) {
  const expiry = Date.now() + timeoutSeconds * 1000;
  while (Date.now() < expiry) {
    if (await predicate()) return true;
    await delay(130);
  }
  return false;
}
function contentType(filename) {
  return filename.endsWith('.html') ? 'text/html; charset=utf-8' :
    filename.endsWith('.js') ? 'text/javascript; charset=utf-8' :
    filename.endsWith('.css') ? 'text/css; charset=utf-8' :
    filename.endsWith('.json') ? 'application/json; charset=utf-8' :
    filename.endsWith('.jpg') ? 'image/jpeg' :
    filename.endsWith('.png') ? 'image/png' :
    filename.endsWith('.svg') ? 'image/svg+xml' :
    'application/octet-stream';
}
async function serve() {
  server = createServer(async (req, res) => {
    try {
      const relative = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
        .replace(/^\/+/, '') || 'index.html';
      const filename = path.resolve(ROOT, relative);
      if (!filename.startsWith(ROOT + path.sep)) {
        res.writeHead(403).end('Forbidden'); return;
      }
      const bytes = await readFile(filename);
      res.writeHead(200, {
        'Content-Type': contentType(filename),
        'Cache-Control': 'no-store'
      }).end(bytes);
    } catch {
      res.writeHead(404).end('Not found');
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
    this.nextId = 1;
    this.waiting = new Map();
    socket.onmessage = event => {
      const result = JSON.parse(String(event.data));
      if (result.method === 'Network.requestWillBeSent' &&
        result.params.request.url.includes('/data/science/v1/')) {
        report.requests.push(result.params.request.url);
      }
      const pending = this.waiting.get(result.id);
      if (!pending) return;
      this.waiting.delete(result.id);
      clearTimeout(pending.timeout);
      if (result.error) pending.reject(Error(result.error.message));
      else pending.resolve(result.result || {});
    };
  }
  send(method, params = {}, timeoutMs = 20000) {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timeout = setTimeout(() => {
        this.waiting.delete(id);
        reject(Error('CDP timeout: ' + method));
      }, timeoutMs);
      this.waiting.set(id, { resolve, reject, timeout });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expression) {
    const response = await this.send('Runtime.evaluate', {
      expression, awaitPromise: true, returnByValue: true
    });
    if (response.exceptionDetails) {
      throw Error(response.exceptionDetails.exception?.description ||
        response.exceptionDetails.text);
    }
    return response.result?.value;
  }
  async click(selector) {
    let hit;
    for (let i = 0; i < 60; i++) {
      hit = await this.eval('(() => {' +
        'const e=document.querySelector(' + JSON.stringify(selector) + ');' +
        'if(!e)return null;' +
        'if(!e.closest("[inert],[hidden]"))e.scrollIntoView({block:"nearest",inline:"nearest"});' +
        'const r=e.getBoundingClientRect();' +
        'const x=r.left+r.width/2,y=r.top+r.height/2;' +
        'const top=document.elementFromPoint(x,y);' +
        'return {x,y,ready:r.width>15&&r.height>15&&' +
        '!e.closest("[inert],[hidden]")&&(top===e||e.contains(top))};})()');
      if (hit?.ready) break;
      await delay(120);
    }
    if (!hit?.ready) throw Error('Not clickable ' + selector + ': ' + JSON.stringify(hit));
    for (const type of ['mousePressed', 'mouseReleased']) {
      await this.send('Input.dispatchMouseEvent',
        { type, x: hit.x, y: hit.y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 });
    }
  }
  async value(selector, value) {
    return this.eval('(() => {const e=document.querySelector(' +
      JSON.stringify(selector) + ');e.value=' + JSON.stringify(value) + ';' +
      'e.dispatchEvent(new Event("input",{bubbles:true}));return e.value})()');
  }
  async viewport(width, height) {
    await this.send('Emulation.setDeviceMetricsOverride', {
      width, height, deviceScaleFactor: 1, mobile: width <= 900
    });
    await delay(500);
  }
  async screenshot(name) {
    const filename = BASELINE + '-' + name + '.png';
    const response = await this.send('Page.captureScreenshot',
      { format: 'png', captureBeyondViewport: false, fromSurface: true });
    await mkdir(path.dirname(filename), { recursive: true });
    await writeFile(filename, Buffer.from(response.data, 'base64'));
    report.screenshots.push(filename);
  }
}
async function getDebuggerPort() {
  for (let i = 0; i < 100; i++) {
    if (chromeExit) throw Error('Chrome exited ' + JSON.stringify(chromeExit) + stderr);
    try {
      return Number((await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8'))
        .split(/\r?\n/)[0]);
    } catch { await delay(110); }
  }
  throw Error('Chrome debugger port missing: ' + stderr);
}
const diag = () => page.eval('window.getCosmosEphemeris?.()');
try {
  const base = await serve();
  chrome = spawn(chromeExe, [
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-background-networking',
    '--enable-unsafe-swiftshader', '--use-angle=swiftshader',
    '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0',
    '--remote-allow-origins=*', '--user-data-dir=' + profile,
    '--window-size=1366,768', 'about:blank'
  ], { stdio: ['ignore','ignore','pipe'], windowsHide: true });
  chrome.on('error', error => report.errors.push(error.message));
  chrome.on('exit', (code, signal) => { chromeExit = { code, signal }; });
  chrome.stderr?.on('data', data => { stderr = (stderr + String(data)).slice(-3000); });
  const port = await getDebuggerPort();
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
  await page.send('Network.enable');
  await page.send('Network.setCacheDisabled', { cacheDisabled: true });
  await page.send('Emulation.setEmulatedMedia',
    { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });

  check('page starts in demonstration mode', await until(() =>
    page.eval('document.getElementById("app")?.dataset.ephemerisMode==="demo" && ' +
      'document.getElementById("loading-screen")?.classList.contains("is-loaded")'), 20));
  check('single global state and working demo orbit controls', await page.eval(
    '!document.getElementById("t31-science-strip") && ' +
    '!document.getElementById("orbit-toggle").disabled && ' +
    'document.getElementById("t31-orbit-hint").hidden'));
  check('no Horizons files fetched before date activation',
    report.requests.length === 0, { requests: report.requests.length });

  await page.click('#rail-time-trigger');
  check('desktop UTC date control present in T31 workspace', await page.eval(
    'document.getElementById("app").dataset.navPane==="time" && ' +
    'document.getElementById("t26-utc-input").type==="datetime-local" && ' +
    '!document.getElementById("t26-date-panel").closest("[inert],[hidden]")'));
  await page.screenshot('desktop-date-demo');
  await page.value('#t26-utc-input', '2026-02-30T12:00');
  await page.click('#t26-apply');
  check('invalid calendar entry is rejected before loading data', await page.eval(
    'document.getElementById("app").dataset.ephemerisMode==="demo" && ' +
    'document.getElementById("t26-status").dataset.state==="error"'));
  check('invalid date caused no file requests', report.requests.length === 0);

  await page.value('#t26-utc-input', '2026-10-27T12:00');
  await page.click('#t26-apply');
  check('valid UTC date loads JPL vectors and opens solar system', await until(() =>
    page.eval('document.getElementById("app").dataset.ephemerisMode==="date" && ' +
      'document.getElementById("app").dataset.view==="solar"'), 20));
  const initial = await diag();
  check('four bodies mapped into ecliptic scene, old demo orbits hidden',
    initial.enabled && initial.utcMs === Date.UTC(2026, 9, 27, 12) &&
    initial.displayPositions.sun.every(value => value === 0) &&
    Math.hypot(...initial.displayPositions.earth) > 13 &&
    Math.hypot(...initial.displayPositions.earth) < 15 &&
    Math.hypot(...initial.displayPositions.moon) > 1.5 &&
    Math.hypot(...initial.displayPositions.moon) < 2.1 &&
    !initial.orbitsVisible && initial.paused, initial);
  check('date data files were fetched on demand', ['manifest.json', '2026.json', '2027.json']
    .every(file => report.requests.some(url => url.endsWith('/' + file))),
    { requests: report.requests.length });
  check('date mode disables demo orbit switch and explains time progression',
    await page.eval('(() => {const b=document.getElementById("orbit-toggle");' +
      'return b.disabled && b.getAttribute("aria-pressed")==="false" && ' +
      '!document.getElementById("t31-orbit-hint").hidden && ' +
      'document.querySelector(".speed-readout span").textContent.includes("1 天/秒") && ' +
      'document.getElementById("t31-science-status").textContent.includes("DE441");})()'));
  await page.screenshot('desktop-date-active');

  await page.value('#t26-utc-input', '2026-11-03T12:00');
  await page.click('#t26-apply');
  const jumped = await diag();
  check('date jump changes Earth and Mars positions without changing mode',
    jumped.enabled && jumped.utcMs === Date.UTC(2026, 10, 3, 12) &&
    Math.hypot(...jumped.displayPositions.earth.map(
      (value,index) => value - initial.displayPositions.earth[index])) > .05 &&
    Math.hypot(...jumped.displayPositions.mars.map(
      (value,index) => value - initial.displayPositions.mars[index])) > .02, jumped.utcMs);

  await page.click('#play-pause');
  const beforePlay = (await diag()).utcMs;
  await delay(700);
  const afterPlay = await diag();
  check('existing play and speed controls advance UTC date', !afterPlay.paused &&
    afterPlay.utcMs - beforePlay > 1000000 &&
    afterPlay.utcMs - beforePlay < 4 * 86400000,
    { beforePlay, afterPlay: afterPlay.utcMs });
  await page.click('#play-pause');
  const paused = await diag();
  await delay(350);
  check('pause stops UTC date playback',
    paused.paused && (await diag()).utcMs === paused.utcMs);

  await page.value('#t26-utc-input', '2027-12-31T23:00');
  await page.click('#t26-apply');
  await page.click('#play-pause');
  check('playback stops at last sample without extrapolating',
    await until(async () => {
      const d = await diag();
      return d.paused && d.utcMs === Date.UTC(2028, 0, 1);
    }, 5), await diag());

  await page.click('#t26-demo');
  check('returning to educational mode restores demonstration orbits', await page.eval(
    'document.getElementById("app").dataset.ephemerisMode==="demo" && ' +
      'window.getCosmosEphemeris().orbitsVisible'));
  check('returning to demo re-enables orbit control and demo speed label',
    await page.eval('!document.getElementById("orbit-toggle").disabled && ' +
      'document.getElementById("t31-orbit-hint").hidden && ' +
      'document.querySelector(".speed-readout span").textContent==="运动倍速"'));

  await page.value('#t26-utc-input', '2025-10-27T12:00');
  await page.click('#t26-apply');
  check('unsupported date shows range error without switching scene data',
    await page.eval('document.getElementById("app").dataset.ephemerisMode==="demo" && ' +
      'document.getElementById("t26-status").textContent.includes("超出数据范围")'));

  await page.viewport(390, 844);
  // A responsive breakpoint change keeps the already-open T31 workspace.
  // Only click the bottom trigger when it is actually closed.
  if (await page.eval('document.getElementById("app").dataset.navPane!=="time"')) {
    await page.click('#time-open-trigger');
  }
  check('mobile bottom UTC date panel remains visible and bounded',
    await page.eval('(() => {const e=document.getElementById("t26-date-panel");' +
      'const r=e.getBoundingClientRect();return ' +
      'document.getElementById("app").dataset.navPane==="time" && ' +
      '!e.closest("[inert],[hidden]") && r.width>245 && r.right<=window.innerWidth;})()'));
  await page.screenshot('mobile-date');

  // Reload with all ephemeris resources blocked: the original 3D demo must
  // remain available instead of showing a fabricated date or a blank scene.
  await page.send('Network.setBlockedURLs', { urls: ['*data/science/v1/*'] });
  await page.send('Page.navigate', { url: base + '?scene=solar' });
  check('page reinitializes under blocked ephemeris requests', await until(() =>
    page.eval('document.getElementById("app")?.dataset.ephemerisMode==="demo" && ' +
      'document.getElementById("loading-screen")?.classList.contains("is-loaded")'), 20));
  await page.click('#time-open-trigger');
  await page.value('#t26-utc-input', '2026-10-27T00:00');
  await page.click('#t26-apply');
  check('missing ephemeris data retains demonstration mode and error guidance',
    await until(() => page.eval('document.getElementById("t26-status")?.dataset.state==="error"'), 6) &&
    await page.eval('document.getElementById("app").dataset.ephemerisMode==="demo"'), null);
  await page.screenshot('mobile-data-unavailable');
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
  await writeFile(BASELINE + '-browser-audit.json', JSON.stringify(report, null, 2));
  page?.socket.close();
  chrome?.kill();
  if (server) await new Promise(resolve => server.close(resolve));
  await delay(200);
  await rm(profile, { force: true, recursive: true, maxRetries: 3 }).catch(() => {});
  console.log('T26 browser audit:', JSON.stringify(report.summary));
  if (report.summary.failed || report.summary.errors) process.exitCode = 1;
}
