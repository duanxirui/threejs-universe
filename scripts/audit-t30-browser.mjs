// T30: independent deep-sky layer, search, lesson navigation, PC/mobile
// layout and solar scene regression in isolated local Chrome/SwiftShader.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const ROOT = path.resolve('dist');
const BASELINE = process.env.COSMOS_AUDIT_PREFIX || 'docs/baselines/2026-10-28-T30';
const CHROME = process.env.CHROME_EXE ||
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const profile = await mkdtemp(path.join(os.tmpdir(), 'cosmos-t30-'));
const report = {
  task: 'T30', started: new Date().toISOString(),
  environment: 'Local dist / isolated headless Chrome SwiftShader / desktop and emulated mobile',
  limitations: [
    'No physical Android/iOS touch, native GPU measurements, screen reader or live Pages release test.',
    'Sky marker distance is arbitrary; observed NASA photographic images are not embedded.'
  ],
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
    await delay(140);
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
  server = createServer(async (req, res) => {
    try {
      const relative = decodeURIComponent(new URL(req.url, 'http://localhost')
        .pathname).replace(/^\/+/, '') || 'index.html';
      const file = path.resolve(ROOT, relative);
      if (!file.startsWith(ROOT + path.sep)) {
        res.writeHead(403).end('Forbidden'); return;
      }
      res.writeHead(200, { 'Content-Type': mime(file),
        'Cache-Control': 'no-store' }).end(await readFile(file));
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
    if (result.exceptionDetails) throw Error(
      result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result?.value;
  }
  async click(selector) {
    let hit;
    for (let i = 0; i < 75; i++) {
      hit = await this.eval('(() => {const e=document.querySelector(' +
        JSON.stringify(selector) + ');if(!e)return null;' +
        'if(!e.closest("[inert],[hidden]"))e.scrollIntoView({block:"center"});' +
        'const r=e.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;' +
        'const top=document.elementFromPoint(x,y);return {x,y,ready:r.width>12&&' +
        'r.height>12&&!e.closest("[inert],[hidden]")&&' +
        '(top===e||e.contains(top))};})()');
      if (hit?.ready) break;
      await delay(125);
    }
    if (!hit?.ready) throw Error('Not clickable ' + selector + ': ' + JSON.stringify(hit));
    for (const type of ['mousePressed', 'mouseReleased']) {
      await this.send('Input.dispatchMouseEvent', {
        type, x: hit.x, y: hit.y, button: 'left',
        buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1
      });
    }
  }
  async value(selector, value, eventName = 'input') {
    return this.eval('(() => {const e=document.querySelector(' +
      JSON.stringify(selector) + ');e.value=' + JSON.stringify(value) +
      ';e.dispatchEvent(new Event(' + JSON.stringify(eventName) +
      ',{bubbles:true}));return e.value;})()');
  }
  async viewport(width, height) {
    await this.send('Emulation.setDeviceMetricsOverride', {
      width, height, deviceScaleFactor: 1, mobile: width <= 900
    });
    await delay(440);
  }
  async screenshot(label) {
    const filename = BASELINE + '-' + label + '.png';
    const output = await this.send('Page.captureScreenshot', {
      format: 'png', captureBeyondViewport: false, fromSurface: true
    });
    await mkdir(path.dirname(filename), { recursive: true });
    await writeFile(filename, Buffer.from(output.data, 'base64'));
    report.screenshots.push(filename);
  }
}
const diag = () => page.eval('window.getCosmosDeepSky?.()');
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
        .split(/\r?\n/)[0]); break;
    } catch { await delay(110); }
  }
  if (!port) throw Error('Chrome debugger port unavailable: ' + stderr);
  const tab = await fetch('http://127.0.0.1:' + port + '/json/new?' +
    encodeURIComponent(base), { method: 'PUT' }).then(r => r.json());
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
  check('app initializes with WebGL and an independent T30 panel',
    await until(() => page.eval(
      'document.getElementById("loading-screen")?.classList.contains("is-loaded") && ' +
      'document.querySelectorAll("#objects-workspace-slot #t30-deep-sky-controls").length===1'), 22));
  check('no deep-sky data fetched before choosing the feature', await page.eval(
    '(() => {const s=window.getCosmosDeepSky();return !s.active &&s.loaded===0&&' +
    's.illustrationVisible&&s.starsVisible&&!performance.getEntriesByType("resource")' +
    '.some(r=>r.name.includes("/data/science/deep-sky/"));})()'));
  await page.click('#rail-objects-trigger');
  await page.click('#t30-toggle');
  check('15 OpenNGC objects and 3 lessons loaded on demand', await until(async () => {
    const s = await diag();
    return s.active && s.loaded === 15 && s.count === 15 && s.routes === 3 &&
      s.referenceFrame === 'ICRS J2000.0';
  }, 22), await diag());
  check('observational sky directions and procedural galaxy separated', await page.eval(
    '(() => {const s=window.getCosmosDeepSky();return s.visible&&!s.illustrationVisible&&' +
    '!s.gaiaVisible&&!s.starsVisible&&s.sample.every(o=>o.id.startsWith("M")&&' +
    'Number.isFinite(o.raDeg)&&Number.isFinite(o.decDeg)&&' +
    'Math.abs(Math.hypot(...o.markerPosition)-160)<1e-6);})()'));
  check('three route cards present in existing exploration workspace', await page.eval(
    'document.querySelectorAll("#t30-routes button[data-route-id]").length===3'));
  await page.screenshot('desktop-catalog');
  await page.value('#t30-category', 'galaxy', 'change');
  check('galaxy category filters 6 actual markers and results', await until(async () =>
    (await diag()).markersVisible === 6 && page.eval(
      'document.querySelectorAll("#t30-results button[data-object-id]").length===6')));
  await page.value('#t30-category', 'cluster', 'change');
  check('cluster category filters 3 sources', await until(async () =>
    (await diag()).markersVisible === 3 && page.eval(
      'document.querySelectorAll("#t30-results button[data-object-id]").length===3')));
  await page.value('#t30-category', 'nebula', 'change');
  check('nebula category filters 6 sources', await until(async () =>
    (await diag()).markersVisible === 6 && page.eval(
      'document.querySelectorAll("#t30-results button[data-object-id]").length===6')));
  await page.value('#t30-category', 'all', 'change');
  await page.value('#t30-search', 'NGC0224');
  check('NGC cross-ID search identifies M31', await page.eval(
    'document.querySelectorAll("#t30-results button").length===1 && ' +
    'document.querySelector("#t30-results button").dataset.objectId==="M31"'));
  await page.click('#t30-results button[data-object-id="M31"]');
  check('selected M31 opens NASA image/source and accurate reference values',
    await until(async () => {
      const state = await diag();
      return state.selectedId === 'M31' && await page.eval(
        '(() => {const p=document.getElementById("t30-detail");' +
        'return !p.hidden&&p.textContent.includes("2,500,000")&&' +
        'p.querySelector(".t30-nasa-link")?.href.includes("messier-31");})()');
    }, 15));
  await page.screenshot('desktop-andromeda');
  await page.value('#t30-search', '');
  await page.click('#t30-routes button[data-route-id="stellar-cycle"]');
  check('stellar-cycle lesson starts at M42', await until(async () => {
    const s = await diag();
    return s.lesson?.routeId === 'stellar-cycle' &&
      s.lesson.index === 0 && s.lesson.count === 4 && s.selectedId === 'M42';
  }));
  await page.click('#t30-next');
  check('lesson moves to next real source', await until(async () =>
    (await diag()).lesson?.index === 1 && (await diag()).selectedId === 'M8'));
  await page.click('#t30-prev');
  check('lesson previous step returns to prior source', await until(async () =>
    (await diag()).lesson?.index === 0 && (await diag()).selectedId === 'M42'));
  for (let i = 1; i < 4; i++) await page.click('#t30-next');
  check('four-stage stellar lesson reaches M1', await until(async () =>
    (await diag()).lesson?.index === 3 && (await diag()).selectedId === 'M1'));
  await page.click('#t30-next');
  check('lesson records completion and disables next button', await page.eval(
    'window.getCosmosDeepSky().lesson.completed && document.getElementById("t30-next").disabled'));
  await page.click('#t30-routes button[data-route-id="star-groups"]');
  check('five-stage star-cluster lesson is independently selectable', await until(async () => {
    const s = await diag();
    return s.lesson?.routeId === 'star-groups' && s.lesson.count === 5 &&
      s.selectedId === 'M44';
  }));
  await page.click('#t30-routes button[data-route-id="galaxy-forms"]');
  check('six-stage galaxy morphology lesson starts at M31', await until(async () => {
    const s = await diag();
    return s.lesson?.routeId === 'galaxy-forms' && s.lesson.count === 6 &&
      s.selectedId === 'M31';
  }));
  await page.screenshot('desktop-lesson');
  await page.viewport(390, 844);
  check('mobile Explore panel fits viewport without horizontal overflow',
    await page.eval('(() => {const p=document.getElementById("t30-deep-sky-controls");' +
      'const r=p.getBoundingClientRect();return !p.closest("[inert],[hidden]")&&' +
      'r.width>200&&r.right<=innerWidth+1&&r.left>=-1&&' +
      'p.scrollWidth<=p.clientWidth+3;})()'));
  await page.screenshot('mobile-lesson');
  await page.click('#t30-toggle');
  check('returning to procedural galaxy hides T30 markers', await until(async () => {
    const s = await diag();
    return !s.active && !s.visible && s.illustrationVisible && s.starsVisible &&
      s.lesson === null;
  }));
  await page.viewport(1366, 768);
  await page.click('#t30-toggle');
  check('catalog can reopen without duplicate controls or resources', await until(async () => {
    const s = await diag();
    return s.active && s.loaded === 15 && page.eval(
      'document.querySelectorAll("#t30-deep-sky-controls").length===1');
  }));
  await page.click('.view-link[data-view="solar"]');
  check('solar system navigation exits T30 sky mode cleanly', await until(async () => {
    const s = await diag();
    return s.mode === 'solar' && !s.active && !s.visible;
  }, 15));
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
  console.log('T30 browser audit:', JSON.stringify(report.summary));
  if (report.summary.failed || report.summary.errors) process.exitCode = 1;
}
