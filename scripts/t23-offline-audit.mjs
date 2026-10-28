// T23 standalone browser audit: serves the Pages build and tests offline reload.
// Node built-ins and an installed Chrome/Chromium are the only requirements.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, stat, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const base = '/threejs-universe/';
const dist = path.resolve('dist');
const chromePath = process.env.CHROME_EXE ||
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const reportFile = 'docs/baselines/2026-10-23-T23-offline-audit.json';
const profile = await mkdtemp(path.join(tmpdir(), 'cosmos-offline-audit-'));
const report = {
  started: new Date().toISOString(),
  environment: 'Local Pages-path HTTP server / Headless Chrome / SwiftShader',
  checks: [], errors: [],
  limitations: ['Not a physical Android/iOS device or a real GPU performance test.']
};
let browser = null, devtools = null, server = null;
let chromeExit = null, chromeErrors = '';
let serveUpgrade = false;

function check(name, result, data = null) {
  report.checks.push({ name, passed: Boolean(result), actual: data });
  console.log((result ? 'PASS ' : 'FAIL ') + name);
}

const typeByExtension = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.ktx2': 'image/ktx2',
  '.md': 'text/plain; charset=utf-8'
};

function startServer() {
  server = createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      if (!pathname.startsWith(base)) {
        res.writeHead(404).end('Unknown scope');
        return;
      }
      const relative = pathname.slice(base.length) || 'index.html';
      const file = path.resolve(dist, relative);
      if (!file.startsWith(dist + path.sep) || !(await stat(file)).isFile()) {
        res.writeHead(404).end('Not found');
        return;
      }
      res.writeHead(200, {
        'Content-Type': typeByExtension[path.extname(file)] || 'application/octet-stream',
        'Cache-Control': 'no-store'
      });
      if (serveUpgrade && relative === 'service-worker.js') {
        // Simulate an upgraded deployment without changing tracked source or
        // the built assets. Activation must remove the previous cache version.
        res.end((await readFile(file, 'utf8'))
          .replace(/v3-[0-9a-f]{14}/, 'v3-upgrade-audit'));
      } else res.end(await readFile(file));
    } catch {
      res.writeHead(404).end('Not found');
    }
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

class CDP {
  constructor(ws) {
    this.socket = ws;
    this.pending = new Map();
    this.nextId = 1;
    ws.onmessage = event => {
      const message = JSON.parse(String(event.data));
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(Error(message.error.message));
      else pending.resolve(message.result || {});
    };
  }
  async send(method, params = {}, timeout = 18000) {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(Error(method + ' timed out'));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expression) {
    const result = await this.send('Runtime.evaluate',
      { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) {
      throw Error(result.exceptionDetails.exception?.description ||
        result.exceptionDetails.text);
    }
    return result.result?.value;
  }
  async until(expression, seconds = 15) {
    const stop = Date.now() + seconds * 1000;
    while (Date.now() < stop) {
      if (await this.eval(expression)) return true;
      await delay(120);
    }
    return false;
  }
  async navigate(url) {
    await this.send('Page.navigate', { url });
    return this.until('document.getElementById("app")?.dataset.layout==="t15" && ' +
      'document.getElementById("loading-screen")?.classList.contains("is-loaded")', 20);
  }
}

async function chromePort() {
  for (let i = 0; i < 100; i++) {
    if (chromeExit) throw Error('Chrome quit: ' + JSON.stringify(chromeExit) + chromeErrors);
    try {
      return Number((await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8'))
        .split(/\r?\n/)[0]);
    } catch { await delay(100); }
  }
  throw Error('Could not start Chrome debugging port: ' + chromeErrors);
}

try {
  // This audit targets a built project site, not Vite's development server.
  const workerText = await readFile(path.join(dist, 'service-worker.js'), 'utf8');
  const manifest = JSON.parse(await readFile(path.join(dist, 'manifest.webmanifest'), 'utf8'));
  const assets = (await readdir(path.join(dist, 'assets')))
    .filter(file => /\.(?:js|css)$/.test(file));
  check('versioned worker includes built shell and correct base',
    workerText.includes("BASE_URL = '/threejs-universe/'") &&
    workerText.includes('cosmos-atlas-shell-') &&
    assets.every(file => workerText.includes(file)) &&
    manifest.scope === './');

  const port = await startServer();
  const url = 'http://127.0.0.1:' + port + base;
  browser = spawn(chromePath, [
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-background-networking',
    '--enable-unsafe-swiftshader', '--use-angle=swiftshader',
    '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0',
    '--remote-allow-origins=*', '--user-data-dir=' + profile,
    '--window-size=1366,768', 'about:blank'
  ], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
  browser.on('exit', (code, signal) => { chromeExit = { code, signal }; });
  browser.on('error', error => report.errors.push(error.message));
  browser.stderr?.on('data', chunk => {
    chromeErrors = (chromeErrors + String(chunk)).slice(-3000);
  });

  const chromeDebugPort = await chromePort();
  const pageInfo = await fetch('http://127.0.0.1:' + chromeDebugPort +
    '/json/new?' + encodeURIComponent(url), { method: 'PUT' })
    .then(response => response.json());
  devtools = new CDP(new WebSocket(pageInfo.webSocketDebuggerUrl));
  await new Promise((resolve, reject) => {
    devtools.socket.addEventListener('open', resolve, { once: true });
    devtools.socket.addEventListener('error', reject, { once: true });
  });
  await devtools.send('Page.enable');
  await devtools.send('Runtime.enable');
  await devtools.send('Network.enable');
  check('Pages site initializes online', await devtools.navigate(url));
  check('offline feature is opt-in and initially disabled',
    await devtools.eval('document.getElementById("offline-toggle").getAttribute("aria-pressed")==="false"'));

  await devtools.eval('document.getElementById("offline-toggle").click()');
  check('opt-in downloads and activates application shell',
    await devtools.until('document.getElementById("offline-toggle").getAttribute("aria-pressed")==="true" && ' +
      'document.getElementById("offline-status").textContent.includes("基础页面已缓存")', 22));
  const status = await devtools.eval('(async()=>({controller:!!navigator.serviceWorker.controller,' +
    'registration:!!(await navigator.serviceWorker.getRegistration()),' +
    'caches:await caches.keys()}))()');
  check('registered versioned shell cache', status.registration &&
    status.caches.some(name => name.startsWith('cosmos-atlas-shell-')), status);
  check('new page is under worker control',
    await devtools.until('!!navigator.serviceWorker.controller', 10));

  await devtools.eval('caches.open("cosmos-atlas-shell-obsolete")');
  serveUpgrade = true;
  await devtools.eval('(async()=>{const registration=' +
    'await navigator.serviceWorker.getRegistration();' +
    'await registration.update();return true})()');
  const updated = await devtools.until('(async()=>{' +
    'const names=(await caches.keys()).filter(n=>n.startsWith("cosmos-atlas-shell-"));' +
    'return names.length===1&&names[0]==="cosmos-atlas-shell-v3-upgrade-audit";})()', 20);
  check('a version upgrade activates new shell and removes old caches', updated);

  const textureFetched = await devtools.eval('(async()=>{' +
    'const response=await fetch("' + base + 'textures/earth.jpg");return response.status;})()');
  check('visited texture downloads online', textureFetched === 200, textureFetched);
  const textureSaved = await devtools.until('(async()=>{' +
    'const names=(await caches.keys()).filter(n=>n.startsWith("cosmos-atlas-textures-"));' +
    'return names.length>0&&(await caches.open(names[0])).keys().then(x=>x.length>0);})()', 10);
  check('visited texture is cached on demand', textureSaved);

  await devtools.send('Network.emulateNetworkConditions', {
    offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0
  });
  const visitedOffline = await devtools.eval('(async()=>{' +
    'try{return (await fetch("' + base + 'textures/earth.jpg")).status}catch{return 0}})()');
  check('previously visited texture loads offline', visitedOffline === 200, visitedOffline);
  check('deep link and 3D page reopen offline',
    await devtools.navigate(url + '?scene=planet&body=earth') &&
    await devtools.until('window.getCosmosPerformance()?.mode==="planet"', 20));

  await devtools.eval('document.getElementById("offline-clear-textures").click()');
  check('texture cache can be cleared without removing shell',
    await devtools.until('(async()=>{const keys=await caches.keys();return ' +
      '!keys.some(n=>n.startsWith("cosmos-atlas-textures-")) && ' +
      'keys.some(n=>n.startsWith("cosmos-atlas-shell-"));})()', 10));
  await devtools.eval('document.getElementById("offline-toggle").click()');
  check('opt-out unregisters worker and clears app caches',
    await devtools.until('(async()=>!' +
      '(await navigator.serviceWorker.getRegistration()) && ' +
      '!(await caches.keys()).some(n=>n.startsWith("cosmos-atlas-")))()', 12));
} catch (error) {
  report.errors.push(String(error.stack || error));
  console.error(error.stack || error);
} finally {
  report.finished = new Date().toISOString();
  report.summary = {
    passed: report.checks.filter(check => check.passed).length,
    failed: report.checks.filter(check => !check.passed).length,
    errors: report.errors.length
  };
  await mkdir(path.dirname(reportFile), { recursive: true });
  await writeFile(reportFile, JSON.stringify(report, null, 2), 'utf8');
  devtools?.socket.close();
  browser?.kill();
  if (server) await new Promise(resolve => server.close(resolve));
  await rm(profile, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
  console.log('T23 offline audit:', JSON.stringify(report.summary), reportFile);
  if (report.summary.failed || report.summary.errors) process.exitCode = 1;
}
