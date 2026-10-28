// T07: repeatable Windows desktop performance baseline for the built site.
// Runs isolated Headless Chrome with its default GPU backend, not forced SwiftShader.
// Results are desktop screening evidence, not physical phone or GPU-memory measurements.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const ROOT = path.resolve('dist');
const QUICK = process.argv.includes('--quick');
const SECONDS = QUICK ? 4 : 30;
const MODES_SECONDS = QUICK ? 3 : 8;
const BASENAME = 'docs/baselines/2026-10-28-T07-desktop';
const REPORT_PATH = QUICK ? path.join(os.tmpdir(), 'cosmos-t07-quick.json') :
  BASENAME + '-audit.json';
const CHROME = process.env.CHROME_EXE ||
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const SCENES = [
  { id: 'galaxy', query: 'scene=galaxy', mode: 'galaxy' },
  { id: 'solar', query: 'scene=solar', mode: 'solar' },
  { id: 'earth', query: 'scene=planet&body=earth', mode: 'planet' },
  { id: 'jupiter', query: 'scene=planet&body=jupiter', mode: 'planet' },
  { id: 'free', query: 'scene=free', mode: 'free' }
];
const profile = await mkdtemp(path.join(os.tmpdir(), 'cosmos-t07-'));
const report = {
  task: 'T07',
  kind: 'desktop-browser-performance-baseline',
  started: new Date().toISOString(),
  methodology: {
    viewport: '1366x768 CSS pixels, deviceScaleFactor=1',
    qualityProfiles: 'auto for all 5 scenes; low/high for galaxy and earth',
    stableSecondsPerScene: SECONDS,
    stableSecondsPerManualProfile: MODES_SECONDS,
    fpsSampling: 'Read window.getCosmosPerformance().fps about every 1.5s after a 2s warmup; snapshots are app 1.3s telemetry windows',
    firstScreenTiming: 'Wall-clock time from CDP Page.navigate to loading overlay dismissed; not Core Web Vitals LCP',
    visibility: 'A controlled visibilitychange event simulation; not a physical background tab',
    goalFps: 60
  },
  limitations: [
    'Headless desktop measurements depend on the browser GPU backend, power policy and host load.',
    'CSS mobile emulation is not Android or iOS device performance evidence.',
    'WebGL texture counts and CPU heap are not GPU memory byte measurements.',
    'Single-run FPS is a screening baseline, not a cross-device performance guarantee.'
  ],
  environment: {},
  checks: [],
  observations: [],
  errors: []
};
let server, chrome, chromeExit, chromeStderr = '', page;

function check(name, pass, evidence = null) {
  report.checks.push({ name, pass: Boolean(pass), evidence });
  console.log((pass ? 'PASS ' : 'FAIL ') + name);
}
async function until(predicate, seconds = 30) {
  const untilAt = Date.now() + seconds * 1000;
  while (Date.now() < untilAt) {
    if (await predicate()) return true;
    await delay(145);
  }
  return false;
}
function mime(name) {
  if (name.endsWith('.html')) return 'text/html; charset=utf-8';
  if (name.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (name.endsWith('.css')) return 'text/css; charset=utf-8';
  if (name.endsWith('.json')) return 'application/json; charset=utf-8';
  if (name.endsWith('.jpg')) return 'image/jpeg';
  if (name.endsWith('.png')) return 'image/png';
  if (name.endsWith('.ktx2')) return 'image/ktx2';
  return 'application/octet-stream';
}
async function serve() {
  server = createServer(async (req, res) => {
    try {
      const relative = decodeURIComponent(new URL(req.url, 'http://localhost')
        .pathname).replace(/^\/+/, '') || 'index.html';
      const filename = path.resolve(ROOT, relative);
      if (filename !== ROOT && !filename.startsWith(ROOT + path.sep)) {
        res.writeHead(403).end('Forbidden');
        return;
      }
      res.writeHead(200, { 'Content-Type': mime(filename), 'Cache-Control': 'no-store' })
        .end(await readFile(filename));
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
    this.next = 0;
    this.pending = new Map();
    socket.onmessage = event => {
      const data = JSON.parse(String(event.data));
      const item = this.pending.get(data.id);
      if (!item) return;
      clearTimeout(item.timer);
      this.pending.delete(data.id);
      if (data.error) item.reject(Error(data.error.message));
      else item.resolve(data.result || {});
    };
    socket.onclose = () => {
      for (const item of this.pending.values()) item.reject(Error('CDP socket closed'));
      this.pending.clear();
    };
  }
  send(method, params = {}, maxMs = 25000) {
    return new Promise((resolve, reject) => {
      const id = ++this.next;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(Error('CDP timeout: ' + method));
      }, maxMs);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expression) {
    const result = await this.send('Runtime.evaluate',
      { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description ||
      result.exceptionDetails.text);
    return result.result?.value;
  }
  close() { this.socket.close(); }
}

const perf = () => page.eval('window.getCosmosPerformance?.()');
const average = values => values.reduce((sum, value) => sum + value, 0) / values.length;
async function sample(scene, qualityMode, seconds, firstScreenMs = null) {
  await page.eval('(() => {const s=document.getElementById("quality-select");' +
    's.value=' + JSON.stringify(qualityMode) + ';' +
    's.dispatchEvent(new Event("change",{bubbles:true}));return s.value;})()');
  await delay(2000);
  const readings = [];
  const started = Date.now();
  while (Date.now() - started < seconds * 1000) {
    await delay(Math.min(1550, Math.max(1, seconds * 1000 - (Date.now() - started))));
    const value = await perf();
    readings.push({ fps: value.fps, tier: value.qualityTier, dpr: value.dpr,
      drawCalls: value.drawCalls, triangles: value.triangles,
      samples: value.samples, contextLost: value.contextLost });
  }
  const end = await perf();
  const fps = readings.map(item => item.fps).filter(Number.isFinite);
  const sorted = [...fps].sort((a, b) => a - b);
  const observation = {
    scene, qualityMode, durationSeconds: Number(((Date.now() - started) / 1000).toFixed(2)),
    firstScreenMs, expectedScene: scene === 'earth' || scene === 'jupiter' ? 'planet' : scene,
    actualScene: end.mode, sampleCount: fps.length,
    fps: fps.length ? {
      mean: Number(average(fps).toFixed(1)),
      min: sorted[0], p10: sorted[Math.floor((sorted.length - 1) * .1)],
      max: sorted[sorted.length - 1], readings: fps
    } : null,
    qualityTiers: [...new Set(readings.map(item => item.tier))],
    dprRange: readings.length ? [
      Math.min(...readings.map(item => item.dpr)),
      Math.max(...readings.map(item => item.dpr))
    ] : null,
    drawCalls: end.drawCalls, triangles: end.triangles,
    geometries: end.geometries, textures: end.textures,
    gpuMemoryBytes: end.gpuMemoryBytes,
    contextLost: end.contextLost,
    target60FpsMet: fps.length ? average(fps) >= 60 : null
  };
  report.observations.push(observation);
  check(scene + ' / ' + qualityMode + ' has scene-specific FPS samples',
    end.mode === observation.expectedScene && fps.length >= 2 &&
    !end.contextLost && fps.every(v => v > 0 && v <= 240),
    { mode: end.mode, fpsMean: observation.fps?.mean, samples: fps.length });
  console.log('SAMPLE ' + scene + ' ' + qualityMode + ': ' +
    JSON.stringify({ meanFps: observation.fps?.mean, minFps: observation.fps?.min,
      dprRange: observation.dprRange, qualityTiers: observation.qualityTiers }));
  return observation;
}
async function screenshot(label) {
  const png = await page.send('Page.captureScreenshot',
    { format: 'png', captureBeyondViewport: false, fromSurface: true });
  const file = BASENAME + '-' + label + '.png';
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, Buffer.from(png.data, 'base64'));
  return file;
}

try {
  const base = await serve();
  chrome = spawn(CHROME, [
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-background-networking',
    '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0',
    '--remote-allow-origins=*', '--user-data-dir=' + profile,
    '--window-size=1366,768', 'about:blank'
  ], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
  chrome.on('error', e => report.errors.push('Chrome launch: ' + String(e)));
  chrome.on('exit', (code, signal) => { chromeExit = { code, signal }; });
  chrome.stderr?.on('data', chunk => { chromeStderr = (chromeStderr + String(chunk)).slice(-2000); });
  let port = 0;
  for (let i = 0; i < 100; i++) {
    if (chromeExit) throw Error('Chrome exited ' + JSON.stringify(chromeExit) + chromeStderr);
    try {
      port = Number((await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8'))
        .split(/\r?\n/)[0]);
      break;
    } catch { await delay(110); }
  }
  if (!port) throw Error('Chrome debugging endpoint unavailable: ' + chromeStderr);
  const version = await fetch('http://127.0.0.1:' + port + '/json/version')
    .then(response => response.json());
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
  await page.send('Emulation.setDeviceMetricsOverride',
    { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false });
  await page.send('Emulation.setEmulatedMedia',
    { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  const loaded = await until(() => page.eval(
    'document.getElementById("loading-screen")?.classList.contains("is-loaded") && ' +
    'typeof window.getCosmosPerformance==="function"'), 30);
  check('built page initializes with performance telemetry', loaded);
  if (!loaded) throw Error('Page did not initialize');
  report.environment = {
    ...await page.eval('(() => {const c=document.getElementById("universe-canvas");' +
      'const gl=c?.getContext("webgl2");const e=gl?.getExtension("WEBGL_debug_renderer_info");' +
      'return {userAgent:navigator.userAgent,platform:navigator.platform,' +
      'hardwareConcurrency:navigator.hardwareConcurrency,devicePixelRatio:devicePixelRatio,' +
      'viewport:{width:innerWidth,height:innerHeight},webgl2:!!gl,' +
      'renderer:gl?.getParameter(gl.RENDERER),vendor:gl?.getParameter(gl.VENDOR),' +
      'unmaskedRenderer:e?gl.getParameter(e.UNMASKED_RENDERER_WEBGL):null}})()'),
    browserVersion: version.Browser,
    chromiumProtocol: version['Protocol-Version']
  };
  check('WebGL2 renderer is available', report.environment.webgl2);
  report.environment.softwareRendererLikely =
    /swiftshader|llvmpipe|software/i.test(report.environment.unmaskedRenderer || '');
  if (report.environment.softwareRendererLikely) {
    report.limitations.push('The detected renderer appears software-backed; FPS cannot be attributed to native GPU hardware.');
  }
  const scenes = QUICK ? SCENES.slice(0, 2) : SCENES;
  for (const scene of scenes) {
    const started = Date.now();
    await page.send('Page.navigate', { url: base + '?' + scene.query });
    const initialized = await until(() => page.eval(
      'document.getElementById("loading-screen")?.classList.contains("is-loaded") && ' +
      'typeof window.getCosmosPerformance==="function"'), 30);
    check(scene.id + ' scene initializes', initialized);
    if (!initialized) throw Error(scene.id + ' did not initialize');
    const firstScreenMs = Date.now() - started;
    const stable = await until(async () => {
      const p = await perf();
      return p?.mode === scene.mode && !p.transitioning && !p.flying;
    }, 35);
    check(scene.id + ' reaches stable scene', stable);
    if (!stable) throw Error(scene.id + ' never became stable');
    await sample(scene.id, 'auto', SECONDS, firstScreenMs);
    if (!QUICK && (scene.id === 'galaxy' || scene.id === 'earth')) {
      await sample(scene.id, 'low', MODES_SECONDS);
      await sample(scene.id, 'high', MODES_SECONDS);
    }
    if (!QUICK && (scene.id === 'galaxy' || scene.id === 'earth'))
      (report.screenshots ||= []).push(await screenshot(scene.id));
  }
  // Controlled simulation only; this does not impersonate a real background tab.
  const before = await page.eval('(() => {const s=window.getCosmosPerformance().samples;' +
    'window.__t07Hidden=true;Object.defineProperty(document,"hidden",' +
    '{configurable:true,get:()=>window.__t07Hidden});' +
    'document.dispatchEvent(new Event("visibilitychange"));return s;})()');
  await delay(2250);
  const hidden = await page.eval('window.getCosmosPerformance().samples');
  await page.eval('(() => {window.__t07Hidden=false;' +
    'document.dispatchEvent(new Event("visibilitychange"));' +
    'delete document.hidden;return true;})()');
  await delay(2450);
  const resumed = await page.eval('window.getCosmosPerformance().samples');
  check('controlled visibilitychange pauses telemetry and resumes rendering',
    hidden === before && resumed > hidden, { before, hidden, resumed });
  report.visibilitySimulation = { before, hidden, resumed, kind: 'synthetic-event' };
} catch (error) {
  report.errors.push(String(error?.stack || error));
  console.error(error?.stack || error);
} finally {
  report.finished = new Date().toISOString();
  report.summary = {
    passed: report.checks.filter(item => item.pass).length,
    failed: report.checks.filter(item => !item.pass).length,
    errors: report.errors.length,
    observations: report.observations.length,
    desktopTargetPasses: report.observations.filter(item =>
      item.qualityMode === 'auto' && item.target60FpsMet).length,
    desktopTargetTotal: report.observations.filter(item =>
      item.qualityMode === 'auto').length
  };
  const reportOutput = report.summary.failed || report.summary.errors
    ? REPORT_PATH.replace(/\.json$/, '-failed.json') : REPORT_PATH;
  await mkdir(path.dirname(reportOutput), { recursive: true });
  await writeFile(reportOutput, JSON.stringify(report, null, 2) + '\n');
  page?.close();
  chrome?.kill();
  await new Promise(resolve => server?.close(resolve) || resolve());
  await delay(300);
  await rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 250 })
    .catch(() => {});
  console.log('T07 desktop performance:', JSON.stringify(report.summary),
    'report:', reportOutput);
  if (report.summary.failed || report.summary.errors) process.exitCode = 1;
}
