// T28 browser check: real rendered interface, date observations, physical
// scale/floating origin, and a mobile time workspace in isolated Chromium.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const DIST = path.resolve('dist');
const PREFIX = process.env.COSMOS_AUDIT_PREFIX || 'docs/baselines/2026-10-28-T28';
const CHROME = process.env.CHROME_EXE ||
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const profile = await mkdtemp(path.join(os.tmpdir(), 'cosmos-t28-'));
const report = {
  task: 'T28', generatedAt: new Date().toISOString(),
  environment: 'Local dist, isolated headless Chrome/SwiftShader, desktop and emulated mobile viewport',
  limitations: ['No Android/iOS hardware, native GPU or screen reader verification.',
    'Simplified spin poles and geometry; eclipse predictions are not provided.'],
  checks: [], screenshots: [], errors: []
};
let server, chrome, page, chromeExit, stderr = '';
function check(name, pass, detail = null) {
  report.checks.push({ name, pass: Boolean(pass), detail });
  console.log((pass ? 'PASS ' : 'FAIL ') + name);
}
async function until(predicate, seconds = 16) {
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await delay(130);
  }
  return false;
}
function mime(filename) {
  return filename.endsWith('.html') ? 'text/html' : filename.endsWith('.js') ? 'text/javascript' :
    filename.endsWith('.css') ? 'text/css' : filename.endsWith('.json') ? 'application/json' :
      filename.endsWith('.png') ? 'image/png' : filename.endsWith('.jpg') ? 'image/jpeg' :
        'application/octet-stream';
}
async function serve() {
  server = createServer(async (req, res) => {
    try {
      const relative = decodeURIComponent(new URL(req.url, 'http://localhost')
        .pathname).replace(/^\/+/, '') || 'index.html';
      const filename = path.resolve(DIST, relative);
      if (!filename.startsWith(DIST + path.sep)) {
        res.writeHead(403).end('Forbidden'); return;
      }
      res.writeHead(200, {
        'Content-Type': mime(filename), 'Cache-Control': 'no-store'
      }).end(await readFile(filename));
    } catch { res.writeHead(404).end('Not found'); }
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
    this.sequence = 0;
    this.pending = new Map();
    socket.onmessage = event => {
      const result = JSON.parse(String(event.data));
      const pending = this.pending.get(result.id);
      if (!pending) return;
      clearTimeout(pending.timeout);
      this.pending.delete(result.id);
      if (result.error) pending.reject(Error(result.error.message));
      else pending.resolve(result.result || {});
    };
  }
  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(Error('CDP timeout ' + method));
      }, 20000);
      this.pending.set(id, { resolve, reject, timeout });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression, returnByValue: true, awaitPromise: true
    });
    if (result.exceptionDetails) throw Error(result.exceptionDetails.text);
    return result.result?.value;
  }
  async click(selector) {
    let hit;
    for (let i = 0; i < 75; i++) {
      hit = await this.eval('(() => {const e=document.querySelector(' +
        JSON.stringify(selector) + ');if(!e)return null;' +
        'if(!e.closest("[inert],[hidden]"))e.scrollIntoView({block:"center"});' +
        'const r=e.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;' +
        'const top=document.elementFromPoint(x,y);return {x,y,ready:r.width>10&&' +
        'r.height>10&&!e.closest("[inert],[hidden]")&&' +
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
    await delay(400);
  }
  async screenshot(label) {
    const filename = PREFIX + '-' + label + '.png';
    const result = await this.send('Page.captureScreenshot', {
      format: 'png', captureBeyondViewport: false, fromSurface: true
    });
    await mkdir(path.dirname(filename), { recursive: true });
    await writeFile(filename, Buffer.from(result.data, 'base64'));
    report.screenshots.push(filename);
  }
}
const observations = () => page.eval('window.getCosmosObservations?.()');
async function selectDate(date) {
  await page.value('#t26-utc-input', date);
  await page.click('#t26-apply');
  const ms = Date.parse(date + ':00Z');
  return until(() => page.eval('window.getCosmosObservations()?.utcMs===' + ms), 20);
}
try {
  const url = await serve();
  chrome = spawn(CHROME, [
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-background-networking',
    '--enable-unsafe-swiftshader', '--use-angle=swiftshader',
    '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0',
    '--remote-allow-origins=*', '--user-data-dir=' + profile,
    '--window-size=1366,768', 'about:blank'
  ], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
  chrome.on('error', e => report.errors.push(e.message));
  chrome.on('exit', (code, signal) => { chromeExit = { code, signal }; });
  chrome.stderr?.on('data', data => { stderr = (stderr + String(data)).slice(-2000); });
  let port;
  for (let i = 0; i < 100; i++) {
    if (chromeExit) throw Error('Chrome exited ' + JSON.stringify(chromeExit) + stderr);
    try {
      port = Number((await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8'))
        .split(/\r?\n/)[0]); break;
    } catch { await delay(110); }
  }
  if (!port) throw Error('Chrome debugger port missing: ' + stderr);
  const tab = await fetch('http://127.0.0.1:' + port + '/json/new?' +
    encodeURIComponent(url), { method: 'PUT' }).then(r => r.json());
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
  check('page initializes without a fatal WebGL error', await until(() =>
    page.eval('document.getElementById("loading-screen")?.classList.contains("is-loaded") && ' +
      '!document.getElementById("fallback-message")?.offsetParent'), 22));
  check('one T28 panel is mounted inside the existing time workspace',
    await page.eval('document.querySelectorAll("#t28-observations").length===1 && ' +
      'document.querySelector("#time-workspace-slot #t28-observations")!==null'));
  check('demonstration mode does not fabricate Moon phase',
    await page.eval('document.querySelector("#t28-observation-grid").hidden && ' +
      '!window.getCosmosObservations().enabled'));
  await page.click('#rail-time-trigger');
  check('UTC date opens from the existing time rail', await page.eval(
    'document.getElementById("app").dataset.navPane==="time"'));
  check('UTC observation activates after loading data', await selectDate('2026-06-21T12:00'));
  const june = await observations();
  check('Earth solar declination shows northern summer direction', june?.enabled &&
    june.earth.subsolarLatitudeDeg > 20 &&
    await page.eval('document.querySelector("#t28-subsolar-latitude").textContent.includes("北纬")'));
  check('Moon illumination and axial pose are numeric', june?.moon?.illuminatedFraction >= 0 &&
    june.moon.illuminatedFraction <= 1 &&
    june.earthOrientation.source === 'educational-j2000-approximation' &&
    june.earthOrientation.axisQuaternion.every(Number.isFinite));
  await page.screenshot('june-observation-desktop');
  check('new Moon UTC time produces a narrow illuminated disk',
    await selectDate('2026-03-19T00:00') &&
    (await observations()).moon.illuminatedFraction < .15);
  const newPhase = await observations();
  check('full Moon UTC time produces a bright disk',
    await selectDate('2026-04-02T00:00') &&
    (await observations()).moon.illuminatedFraction > .85);
  const fullPhase = await observations();
  check('phase and painted canvas respond to date change',
    fullPhase.moon.illuminatedFraction > newPhase.moon.illuminatedFraction + .7 &&
    await page.eval('(() => {const c=document.getElementById("t28-moon-phase");' +
      'const p=c.getContext("2d").getImageData(46,46,1,1).data;' +
      'return p[3]===255&&p[0]>100;})()'));
  await page.click('#rail-settings-trigger');
  await page.click('#t27-scale-physical');
  await page.click('#rail-objects-trigger');
  await page.click('#planet-list .planet-item[data-id="earth"]');
  check('physical Earth focus uses floating origin with matching solar light',
    await until(async () => {
      const s = await observations();
      const scale = await page.eval('window.getCosmosScale()');
      return scale.scene === 'planet' && scale.focusedBody === 'earth' &&
        scale.anchorId === 'earth' && Math.hypot(...s.sunWorld) > 900 &&
        Math.hypot(...s.sunWorld.map((n, i) => n - scale.floatingOrigin[i])) < 1e-8;
    }, 14));
  check('physical mode does not change Moon phase or its UTC timestamp',
    Math.abs((await observations()).moon.illuminatedFraction -
      fullPhase.moon.illuminatedFraction) < 1e-12 &&
    (await observations()).utcMs === fullPhase.utcMs);
  await page.screenshot('earth-physical-lighting');
  await page.viewport(390, 844);
  await page.click('#time-open-trigger');
  check('mobile time panel exposes the same Moon and Earth readout',
    await page.eval('(() => {const app=document.getElementById("app");' +
      'const e=document.getElementById("t28-observations");' +
      'const r=e.getBoundingClientRect();return app.dataset.navPane==="time"&&' +
      'r.width>200&&r.right<=innerWidth+1&&r.left>=-1&&!e.closest("[inert],[hidden]");})()'));
  await page.screenshot('mobile-observations');
  await page.click('#t26-demo');
  check('returning to demo clears phase values', await until(() =>
    page.eval('document.querySelector("#t28-observation-grid").hidden && ' +
      '!window.getCosmosObservations().enabled')));
} catch (error) {
  report.errors.push(String(error?.stack || error));
  console.error(error?.stack || error);
} finally {
  report.finished = new Date().toISOString();
  report.summary = {
    passed: report.checks.filter(c => c.pass).length,
    failed: report.checks.filter(c => !c.pass).length,
    errors: report.errors.length
  };
  await mkdir(path.dirname(PREFIX), { recursive: true });
  await writeFile(PREFIX + '-browser-audit.json', JSON.stringify(report, null, 2) + '\n');
  page?.socket.close();
  chrome?.kill();
  if (server) await new Promise(resolve => server.close(resolve));
  await delay(200);
  await rm(profile, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
  console.log('T28 browser audit:', JSON.stringify(report.summary));
  if (report.summary.failed || report.summary.errors) process.exitCode = 1;
}
