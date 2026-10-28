// T29: Gaia catalog and procedural galaxy are tested as separate visual modes
// in an isolated local Chrome/SwiftShader instance with real mouse input.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const ROOT = path.resolve('dist');
const BASELINE = process.env.COSMOS_AUDIT_PREFIX || 'docs/baselines/2026-10-28-T29';
const CHROME = process.env.CHROME_EXE ||
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const profile = await mkdtemp(path.join(os.tmpdir(), 'cosmos-t29-'));
const report = {
  task: 'T29', started: new Date().toISOString(),
  environment: 'Local dist / isolated headless Chrome SwiftShader / desktop and emulated mobile',
  limitations: ['No hardware GPU or actual Android/iOS touch verification.',
    'A Gaia DR3 random-index subset is not a census of the Milky Way.'],
  checks: [], screenshots: [], errors: []
};
let server, chrome, page, chromeExit, stderr = '';
function check(name, pass, data = null) {
  report.checks.push({ name, pass: Boolean(pass), data });
  console.log((pass ? 'PASS ' : 'FAIL ') + name);
}
async function until(predicate, seconds = 18) {
  const end = Date.now() + seconds * 1000;
  while (Date.now() < end) {
    if (await predicate()) return true;
    await delay(160);
  }
  return false;
}
function mime(filename) {
  if (filename.endsWith('.html')) return 'text/html; charset=utf-8';
  if (filename.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (filename.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filename.endsWith('.json')) return 'application/json; charset=utf-8';
  if (filename.endsWith('.png')) return 'image/png';
  if (filename.endsWith('.jpg')) return 'image/jpeg';
  return 'application/octet-stream';
}
async function serve() {
  server = createServer(async (request, response) => {
    try {
      const relative = decodeURIComponent(new URL(request.url, 'http://localhost')
        .pathname).replace(/^\/+/, '') || 'index.html';
      const file = path.resolve(ROOT, relative);
      if (!file.startsWith(ROOT + path.sep)) {
        response.writeHead(403).end('Forbidden'); return;
      }
      response.writeHead(200, {
        'Content-Type': mime(file), 'Cache-Control': 'no-store'
      }).end(await readFile(file));
    } catch { response.writeHead(404).end('Not found'); }
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
      const item = this.pending.get(message.id);
      if (!item) return;
      clearTimeout(item.timeout);
      this.pending.delete(message.id);
      if (message.error) item.reject(Error(message.error.message));
      else item.resolve(message.result || {});
    };
  }
  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.next;
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(Error('CDP timeout: ' + method));
      }, 20000);
      this.pending.set(id, { resolve, reject, timeout });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression, awaitPromise: true, returnByValue: true
    });
    if (result.exceptionDetails) throw Error(result.exceptionDetails.text);
    return result.result?.value;
  }
  async click(selector) {
    let hit;
    for (let i = 0; i < 70; i++) {
      hit = await this.eval('(() => {const e=document.querySelector(' +
        JSON.stringify(selector) + ');if(!e)return null;' +
        'if(!e.closest("[inert],[hidden]"))e.scrollIntoView({block:"center"});' +
        'const r=e.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;' +
        'const top=document.elementFromPoint(x,y);return {x,y,ready:r.width>12&&' +
        'r.height>12&&!e.closest("[inert],[hidden]")&&' +
        '(top===e||e.contains(top))};})()');
      if (hit?.ready) break;
      await delay(130);
    }
    if (!hit?.ready) throw Error('Not clickable ' + selector + ': ' + JSON.stringify(hit));
    for (const type of ['mousePressed', 'mouseReleased']) {
      await this.send('Input.dispatchMouseEvent', {
        type, x: hit.x, y: hit.y, button: 'left',
        buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1
      });
    }
  }
  async value(selector, value, event = 'input') {
    return this.eval('(() => {const e=document.querySelector(' +
      JSON.stringify(selector) + ');e.value=' + JSON.stringify(value) +
      ';e.dispatchEvent(new Event(' + JSON.stringify(event) +
      ',{bubbles:true}));return e.value;})()');
  }
  async viewport(width, height) {
    await this.send('Emulation.setDeviceMetricsOverride', {
      width, height, deviceScaleFactor: 1, mobile: width <= 900
    });
    await delay(460);
  }
  async screenshot(label) {
    const filename = BASELINE + '-' + label + '.png';
    const result = await this.send('Page.captureScreenshot', {
      format: 'png', captureBeyondViewport: false, fromSurface: true
    });
    await mkdir(path.dirname(filename), { recursive: true });
    await writeFile(filename, Buffer.from(result.data, 'base64'));
    report.screenshots.push(filename);
  }
}
const diag = () => page.eval('window.getCosmosGaia?.()');
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
  chrome.on('error', error => report.errors.push(error.message));
  chrome.on('exit', (code, signal) => { chromeExit = { code, signal }; });
  chrome.stderr?.on('data', value => { stderr = (stderr + String(value)).slice(-2000); });
  let port;
  for (let i = 0; i < 100; i++) {
    if (chromeExit) throw Error('Chrome exited ' + JSON.stringify(chromeExit) + stderr);
    try {
      port = Number((await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8'))
        .split(/\r?\n/)[0]); break;
    } catch { await delay(110); }
  }
  if (!port) throw Error('Chrome debugger port unavailable: ' + stderr);
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
  check('application and WebGL initialize', await until(() =>
    page.eval('document.getElementById("loading-screen")?.classList.contains("is-loaded")')));
  check('Gaia has one explorer controller', await page.eval(
    'document.querySelectorAll("#objects-workspace-slot #t29-gaia-controls").length===1'));
  check('initial view is procedural with no Gaia network requests', await page.eval(
    '(() => {const s=window.getCosmosGaia();return !s.active&&s.loaded===0&&' +
    's.illustrationVisible&&!s.visible&&!performance.getEntriesByType("resource")' +
    '.some(r=>r.name.includes("/gaia-dr3/"));})()'));
  await page.click('#rail-objects-trigger');
  await page.click('#t29-gaia-toggle');
  check('Gaia sample loads lazily and activates independently', await until(async () => {
    const s = await diag();
    return s.active && s.loaded === 383 &&
      JSON.stringify(s.loadedBands) === JSON.stringify(['near', 'mid']) &&
      !s.illustrationVisible && !s.backgroundStarsVisible;
  }, 22), await diag());
  check('Gaia source IDs and reference epoch remain exact', await page.eval(
    '(() => {const s=window.getCosmosGaia();return s.referenceEpoch===2016&&' +
    's.sourcesSample.every(x=>/^\\d{15,20}$/.test(x.sourceId)&&' +
    'x.distancePc>0&&Number.isFinite(x.gMag));})()'));
  check('near and mid distance layers actually draw', (await diag()).drawn > 300);
  await page.screenshot('desktop-near-mid');
  await page.value('#t29-distance', '1000', 'change');
  check('far chunk loads on demand', await until(async () => {
    const s = await diag();
    return s.loaded === 2057 && s.loadedBands.length === 3 && s.drawn > 1800;
  }, 20), await diag());
  const allCount = (await diag()).drawn;
  await page.value('#t29-magnitude', '12', 'change');
  check('magnitude filter reduces rendered draw count', await until(async () => {
    const s = await diag();
    return s.drawn < allCount && s.drawn > 0;
  }), { all: allCount, limited: (await diag()).drawn });
  await page.value('#t29-magnitude', '16', 'change');
  check('magnitude filter restores all available sources', await until(async () =>
    (await diag()).drawn === allCount));
  const firstId = (await diag()).sourcesSample[0].sourceId;
  await page.value('#t29-source-search', firstId);
  check('full source ID search isolates correct result', await page.eval(
    'document.querySelectorAll("#t29-results .t29-result").length===1 && ' +
    'document.querySelector("#t29-results .t29-result").dataset.sourceId===' +
    JSON.stringify(firstId)));
  await page.click('#t29-results .t29-result');
  check('selected Gaia source focuses camera and opens provenance', await until(async () =>
    (await diag()).selectedId === firstId && await page.eval(
      '!document.getElementById("t29-source-detail").hidden && ' +
      'document.getElementById("t29-source-detail").textContent.includes(' +
      JSON.stringify(firstId) + ')')));
  await page.screenshot('desktop-source-focused');
  await page.viewport(390, 844);
  check('mobile Gaia explorer controls fit available width', await page.eval(
    '(() => {const p=document.getElementById("t29-gaia-controls");' +
    'const r=p.getBoundingClientRect();return r.width>245 &&r.left>=0&&' +
    'r.right<=innerWidth+1&&!p.closest("[inert],[hidden]");})()'));
  await page.screenshot('mobile-gaia-panel');
  await page.click('#t29-gaia-toggle');
  check('returning to illustration hides all Gaia points', await until(async () => {
    const s = await diag();
    return !s.active && s.illustrationVisible && s.backgroundStarsVisible && !s.visible;
  }));
  await page.viewport(1366, 768);
  await page.click('.view-link[data-view="solar"]');
  check('solar navigation remains independent of Gaia star map',
    await until(() => page.eval('document.getElementById("app").dataset.view==="solar"')) &&
    !(await diag()).active);
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
  await mkdir(path.dirname(BASELINE), { recursive: true });
  await writeFile(BASELINE + '-browser-audit.json', JSON.stringify(report, null, 2) + '\n');
  page?.socket.close();
  chrome?.kill();
  if (server) await new Promise(resolve => server.close(resolve));
  await delay(200);
  await rm(profile, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
  console.log('T29 browser audit:', JSON.stringify(report.summary));
  if (report.summary.failed || report.summary.errors) process.exitCode = 1;
}
