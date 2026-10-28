// T03 browser network audit against the built local site.
// Uses an isolated Chrome profile and a controlled local HTTP server.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const dist = path.resolve('dist');
const reportFile = 'docs/baselines/2026-10-26-T03-network-audit.json';
const chromePath = process.env.CHROME_EXE ||
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const profile = await mkdtemp(path.join(os.tmpdir(), 'cosmos-t03-audit-'));
const report = {
  started: new Date().toISOString(),
  environment: 'Local built site / isolated Headless Chrome / SwiftShader',
  limitations: [
    'Headless SwiftShader does not verify physical GPU memory release or Android/iOS behavior.',
    'The HTTP server observes transport aborts; it cannot measure GPU resource bytes.'
  ],
  checks: [],
  requests: [],
  errors: []
};
const held = new Set();
let responseMode = 'hold';
let server, chrome, page, chromeExit, chromeErrors = '';

function check(name, passed, actual = null) {
  report.checks.push({ name, passed: Boolean(passed), actual });
  console.log((passed ? 'PASS ' : 'FAIL ') + name);
}

async function waitFor(predicate, seconds = 10) {
  const end = Date.now() + seconds * 1000;
  while (Date.now() < end) {
    if (await predicate()) return true;
    await delay(120);
  }
  return false;
}

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.ktx2': 'image/ktx2',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json'
};

async function startServer() {
  server = createServer(async (req, res) => {
    let record;
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      const relative = pathname.slice(1) || 'index.html';
      const filename = path.resolve(dist, relative);
      if (!filename.startsWith(dist + path.sep)) {
        res.writeHead(403).end('Outside dist');
        return;
      }
      if (relative.startsWith('textures/')) {
        record = {
          resource: relative,
          phase: responseMode,
          status: null,
          completed: false,
          connectionClosedBeforeResponse: false
        };
        report.requests.push(record);
        res.on('close', () => {
          if (!record.completed) record.connectionClosedBeforeResponse = true;
          held.delete(res);
        });
        if (responseMode === 'hold') {
          held.add(res);
          return;
        }
        if (responseMode === 'broken' &&
            /(?:^|\/)earth\.(?:jpg|ktx2)$/.test(relative)) {
          record.status = 404;
          record.completed = true;
          res.writeHead(404, { 'Cache-Control': 'no-store' }).end('Not found');
          return;
        }
      }
      const body = await readFile(filename);
      if (record) {
        record.status = 200;
        record.completed = true;
      }
      res.writeHead(200, {
        'Content-Type': types[path.extname(filename)] || 'application/octet-stream',
        'Cache-Control': 'no-store'
      }).end(body);
    } catch (error) {
      if (record) {
        record.status = 404;
        record.completed = true;
      }
      if (!res.headersSent) res.writeHead(404);
      res.end('Not found');
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return 'http://127.0.0.1:' + server.address().port + '/';
}

function releaseHeld() {
  for (const res of held) {
    if (!res.writableEnded) res.writeHead(503).end('Released by audit');
  }
  held.clear();
}

class CDP {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    socket.onmessage = event => {
      const result = JSON.parse(String(event.data));
      const pending = this.pending.get(result.id);
      if (!pending) return;
      this.pending.delete(result.id);
      clearTimeout(pending.timer);
      if (result.error) pending.reject(Error(result.error.message));
      else pending.resolve(result.result || {});
    };
  }
  send(method, params = {}, timeout = 20000) {
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
  until(expression, seconds = 15) {
    return waitFor(() => this.eval(expression), seconds);
  }
  async navigate(url) {
    await this.send('Page.navigate', { url });
    return this.until('document.getElementById("app")?.dataset.layout==="t15" && ' +
      'document.getElementById("loading-screen")?.classList.contains("is-loaded")', 20);
  }
  async nav(mode) {
    await this.eval('document.querySelector(' +
      JSON.stringify('.view-link[data-view="' + mode + '"]') + ').click()');
    return this.until('window.getCosmosPerformance?.()?.mode===' +
      JSON.stringify(mode) + ' && !window.getCosmosPerformance?.()?.transitioning', 12);
  }
}

async function chromePort() {
  for (let i = 0; i < 100; i++) {
    if (chromeExit) throw Error('Chrome exited: ' + JSON.stringify(chromeExit) + chromeErrors);
    try {
      return Number((await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8'))
        .split(/\r?\n/)[0]);
    } catch { await delay(100); }
  }
  throw Error('Chrome debug port unavailable: ' + chromeErrors);
}

try {
  const url = await startServer();
  chrome = spawn(chromePath, [
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-background-networking',
    '--enable-unsafe-swiftshader', '--use-angle=swiftshader',
    '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0',
    '--remote-allow-origins=*', '--user-data-dir=' + profile,
    '--window-size=1366,768', 'about:blank'
  ], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
  chrome.on('error', error => report.errors.push(error.message));
  chrome.on('exit', (code, signal) => { chromeExit = { code, signal }; });
  chrome.stderr?.on('data', data => { chromeErrors = (chromeErrors + String(data)).slice(-3000); });

  const port = await chromePort();
  const info = await fetch('http://127.0.0.1:' + port + '/json/new?' +
    encodeURIComponent(url), { method: 'PUT' }).then(res => res.json());
  const socket = new WebSocket(info.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  page = new CDP(socket);
  await page.send('Page.enable');
  await page.send('Runtime.enable');
  await page.send('Network.enable');
  await page.send('Network.setCacheDisabled', { cacheDisabled: true });
  await page.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }]
  });

  check('site initializes in galaxy', await page.navigate(url));
  await delay(350);
  check('galaxy does not prefetch solar textures', report.requests.length === 0,
    report.requests.length);

  check('solar scene opens with delayed texture requests', await page.nav('solar') &&
    await waitFor(() => report.requests.some(item => item.phase === 'hold'), 8));
  const heldAtExit = report.requests.filter(item => item.phase === 'hold').length;
  check('galaxy reopens during slow downloads', await page.nav('galaxy'));
  const aborted = await waitFor(() => held.size === 0, 8);
  check('in-flight texture HTTP transfers abort on scene exit',
    aborted && heldAtExit > 0 &&
    report.requests.filter(item => item.phase === 'hold' &&
      item.connectionClosedBeforeResponse).length === heldAtExit,
    { heldAtExit, abortedCount: report.requests.filter(item =>
      item.phase === 'hold' && item.connectionClosedBeforeResponse).length });
  responseMode = 'normal';
  releaseHeld();

  check('solar scene reopens after abort', await page.nav('solar'));
  const loaded = await waitFor(() => ['sun', 'earth'].every(key =>
    report.requests.some(item => item.phase === 'normal' &&
      new RegExp('(?:/|^)' + key + '\\.(?:jpg|ktx2)$').test(item.resource) &&
      item.status === 200)), 18);
  check('aborted key can be requested again and served successfully', loaded,
    report.requests.filter(item => item.phase === 'normal')
      .map(item => ({ resource: item.resource, status: item.status })));
  await delay(1800);
  const completedCounts = Object.fromEntries(['sun', 'earth'].map(key => [
    key, report.requests.filter(item => item.phase === 'normal' &&
      new RegExp('(?:/|^)' + key + '\\.(?:jpg|ktx2)$').test(item.resource)).length
  ]));
  const beforeRepeat = await page.eval('window.getCosmosPerformance?.()');
  check('galaxy opens after successful loads', await page.nav('galaxy'));
  check('solar scene returns using cached textures', await page.nav('solar'));
  await delay(1300);
  const repeatedCounts = Object.fromEntries(['sun', 'earth'].map(key => [
    key, report.requests.filter(item => item.phase === 'normal' &&
      new RegExp('(?:/|^)' + key + '\\.(?:jpg|ktx2)$').test(item.resource)).length
  ]));
  check('completed sun and earth textures are not downloaded twice',
    loaded && ['sun', 'earth'].every(key => completedCounts[key] === repeatedCounts[key]),
    { completedCounts, repeatedCounts });

  responseMode = 'broken';
  check('new page initializes for 404 fallback', await page.navigate(url + '?t03=fallback'));
  check('solar scene opens with earth texture unavailable', await page.nav('solar'));
  const missingEarth = await waitFor(() => report.requests.some(item =>
    item.phase === 'broken' && /(?:^|\/)earth\.jpg$/.test(item.resource) &&
    item.status === 404), 18);
  check('missing earth JPG returns 404', missingEarth);
  const fallbackState = await page.eval('({ ' +
    'performance:window.getCosmosPerformance?.(), ' +
    'fatal:!document.getElementById("fallback-message").hidden })');
  check('procedural fallback keeps WebGL scene interactive',
    !fallbackState.fatal && fallbackState.performance?.mode === 'solar' &&
    fallbackState.performance?.contextLost === false,
    fallbackState);
  check('galaxy remains reachable after failed texture', await page.nav('galaxy'));
  report.metrics = { beforeRepeat, completedCounts, repeatedCounts };
} catch (error) {
  report.errors.push(String(error?.stack || error));
  console.error(error?.stack || error);
} finally {
  releaseHeld();
  report.finished = new Date().toISOString();
  report.summary = {
    passed: report.checks.filter(item => item.passed).length,
    failed: report.checks.filter(item => !item.passed).length,
    errors: report.errors.length
  };
  await mkdir(path.dirname(reportFile), { recursive: true });
  await writeFile(reportFile, JSON.stringify(report, null, 2), 'utf8');
  page?.socket.close();
  chrome?.kill();
  if (server) await new Promise(resolve => server.close(resolve));
  await delay(250);
  await rm(profile, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
  console.log('T03 network audit:', JSON.stringify(report.summary), reportFile);
  if (report.summary.failed || report.summary.errors) process.exitCode = 1;
}
