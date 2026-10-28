// T04: inspect the shipped KTX2 payloads and exercise ETC2 uploads/fallbacks
// in an isolated browser. Run with --software for SwiftShader coverage.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { zstdDecompressSync } from 'node:zlib';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import {
  read as readKtx,
  VK_FORMAT_ETC2_R8G8B8_SRGB_BLOCK,
  KHR_SUPERCOMPRESSION_ZSTD
} from 'three/addons/libs/ktx-parse.module.js';

const software = process.argv.includes('--software');
const backend = software ? 'swiftshader' : 'default';
const dist = path.resolve('dist');
const baseReport = 'docs/baselines/2026-10-26-T04-' + backend;
const reportPath = baseReport + '-audit.json';
const chromePath = process.env.CHROME_EXE ||
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const profile = await mkdtemp(path.join(os.tmpdir(), 'cosmos-t04-audit-'));
const bodies = [
  { id: 'uranus', file: 'uranus' },
  { id: 'neptune', file: 'neptune' },
  { id: 'callisto', file: 'satellites/callisto' }
];
const report = {
  started: new Date().toISOString(),
  environment: 'Local built site / isolated Headless Chrome / ' + backend,
  limitations: [
    'WebGL upload observations do not establish GPU physical memory usage or mobile compatibility.',
    'The browser backend and GL renderer strings determine whether upload evidence is hardware or software.',
    'Images are visual evidence for manual orientation and seam review, not pixel-perfect proofs.'
  ],
  checks: [], requests: [], assets: [], scenarios: [], errors: []
};
let server, chrome, page, chromeExit, chromeStderr = '', phase = 'normal';

function check(name, pass, actual = null) {
  report.checks.push({ name, status: pass ? 'passed' : 'failed', actual });
  console.log((pass ? 'PASS ' : 'FAIL ') + name);
}
function skip(name, reason) {
  report.checks.push({ name, status: 'skipped', reason });
  console.log('SKIP ' + name + ': ' + reason);
}
async function until(predicate, seconds = 15) {
  const end = Date.now() + seconds * 1000;
  while (Date.now() < end) {
    if (await predicate()) return true;
    await delay(125);
  }
  return false;
}
function suffix(file) {
  return file.endsWith('.ktx2') ? 'image/ktx2' :
    file.endsWith('.jpg') ? 'image/jpeg' :
    file.endsWith('.js') ? 'text/javascript; charset=utf-8' :
    file.endsWith('.css') ? 'text/css; charset=utf-8' :
    file.endsWith('.html') ? 'text/html; charset=utf-8' :
    file.endsWith('.json') ? 'application/json; charset=utf-8' :
    file.endsWith('.svg') ? 'image/svg+xml' :
    file.endsWith('.webmanifest') ? 'application/manifest+json' :
    'application/octet-stream';
}
function resource(needle) {
  return report.requests.filter(item => item.phase === phase && item.resource === needle);
}
async function inspectAssets() {
  for (const body of bodies) {
    const ktx2 = await readFile(path.resolve('public/textures/ktx2', body.file + '.ktx2'));
    const jpg = await readFile(path.resolve('public/textures', body.file + '.jpg'));
    const container = readKtx(new Uint8Array(ktx2));
    const levels = container.levels.map((level, index) => {
      const width = Math.max(1, container.pixelWidth >> index);
      const height = Math.max(1, container.pixelHeight >> index);
      const expected = Math.ceil(width / 4) * Math.ceil(height / 4) * 8;
      const decoded = zstdDecompressSync(level.levelData);
      return { width, height, expected, decoded: decoded.byteLength };
    });
    const item = {
      id: body.id,
      jpgBytes: jpg.byteLength,
      ktx2Bytes: ktx2.byteLength,
      width: container.pixelWidth,
      height: container.pixelHeight,
      vkFormat: container.vkFormat,
      supercompression: container.supercompressionScheme,
      levels
    };
    report.assets.push(item);
    check(body.id + ' KTX2 structure and Zstd mip lengths',
      item.vkFormat === VK_FORMAT_ETC2_R8G8B8_SRGB_BLOCK &&
      item.supercompression === KHR_SUPERCOMPRESSION_ZSTD &&
      levels.every(level => level.expected === level.decoded), {
        size: [item.width, item.height], mipLevels: levels.length,
        jpgBytes: item.jpgBytes, ktx2Bytes: item.ktx2Bytes
      });
  }
}
async function startServer() {
  server = createServer(async (req, res) => {
    let item;
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      const relative = pathname.slice(1) || 'index.html';
      const filename = path.resolve(dist, relative);
      if (!filename.startsWith(dist + path.sep)) {
        res.writeHead(403).end('Outside dist');
        return;
      }
      if (relative.startsWith('textures/')) {
        item = { phase, resource: relative, status: null, bytes: 0 };
        report.requests.push(item);
        if (phase === 'missing' && relative === 'textures/ktx2/neptune.ktx2') {
          item.status = 404;
          res.writeHead(404).end('missing compressed resource');
          return;
        }
        if (phase === 'corrupt' && relative === 'textures/ktx2/satellites/callisto.ktx2') {
          const damaged = Buffer.from('invalid KTX2 container');
          item.status = 200;
          item.bytes = damaged.length;
          res.writeHead(200, { 'Content-Type': 'image/ktx2' }).end(damaged);
          return;
        }
      }
      const contents = await readFile(filename);
      if (item) {
        item.status = 200;
        item.bytes = contents.byteLength;
      }
      res.writeHead(200, {
        'Content-Type': suffix(relative),
        'Cache-Control': 'no-store'
      }).end(contents);
    } catch {
      if (item) item.status = 404;
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

// This function is serialized into each page before app scripts execute.
function installProbe() {
  const testCase = new URLSearchParams(location.search).get('t04case');
  const state = { compressed: [], blockedEtcRequests: 0, installed: 0 };
  Object.defineProperty(window, '__t04', { value: state });
  for (const name of ['WebGLRenderingContext', 'WebGL2RenderingContext']) {
    const proto = window[name]?.prototype;
    if (!proto) continue;
    const originalGetExtension = proto.getExtension;
    proto.getExtension = function(extension) {
      if (testCase === 'noetc' && extension.toLowerCase() === 'webgl_compressed_texture_etc') {
        state.blockedEtcRequests++;
        return null;
      }
      return originalGetExtension.call(this, extension);
    };
    for (const [method, formatIndex, widthIndex, heightIndex] of [
      ['compressedTexImage2D', 2, 3, 4],
      ['compressedTexSubImage2D', 6, 4, 5]
    ]) {
      const originalUpload = proto[method];
      if (!originalUpload) continue;
      proto[method] = function(...args) {
        const result = originalUpload.apply(this, args);
        const error = this.getError();
        if (state.compressed.length < 300) {
          state.compressed.push({
            method, internalformat: args[formatIndex],
            width: args[widthIndex], height: args[heightIndex], error
          });
        }
        return result;
      };
    }
    state.installed++;
  }
}

class CDP {
  constructor(socket) {
    this.socket = socket;
    this.pending = new Map();
    this.id = 1;
    socket.onmessage = event => {
      const result = JSON.parse(String(event.data));
      const pending = this.pending.get(result.id);
      if (!pending) return;
      this.pending.delete(result.id);
      clearTimeout(pending.timeout);
      if (result.error) pending.reject(Error(result.error.message));
      else pending.resolve(result.result || {});
    };
  }
  send(method, params = {}, timeoutMs = 20000) {
    return new Promise((resolve, reject) => {
      const id = this.id++;
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(Error('Timed out: ' + method));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timeout });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expression) {
    const response = await this.send('Runtime.evaluate',
      { expression, awaitPromise: true, returnByValue: true });
    if (response.exceptionDetails) {
      throw Error(response.exceptionDetails.exception?.description ||
        response.exceptionDetails.text);
    }
    return response.result?.value;
  }
  async navigate(url) {
    await this.send('Page.navigate', { url });
    return until(() => this.eval('document.getElementById("app")?.dataset.layout==="t15" && ' +
      'document.getElementById("loading-screen")?.classList.contains("is-loaded")'), 20);
  }
  async screenshot(filename) {
    const result = await this.send('Page.captureScreenshot',
      { format: 'png', captureBeyondViewport: false, fromSurface: true });
    await writeFile(filename, Buffer.from(result.data, 'base64'));
  }
}
async function chromePort() {
  for (let i = 0; i < 100; i++) {
    if (chromeExit) throw Error('Chrome exited: ' + JSON.stringify(chromeExit) + chromeStderr);
    try {
      return Number((await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8'))
        .split(/\r?\n/)[0]);
    } catch { await delay(100); }
  }
  throw Error('Chrome debugger port missing: ' + chromeStderr);
}

async function captureState() {
  return page.eval('(() => {' +
    'const c=document.getElementById("universe-canvas");' +
    'const gl=c?.getContext("webgl2");' +
    'const ext=gl?.getExtension("WEBGL_debug_renderer_info");' +
    'const p=window.getCosmosPerformance?.();' +
    'return {mode:p?.mode,contextLost:p?.contextLost,drawCalls:p?.drawCalls,' +
    'textureCount:p?.textures,gpuMemoryBytes:p?.gpuMemoryBytes,' +
    'renderer:gl?.getParameter(gl.RENDERER),vendor:gl?.getParameter(gl.VENDOR),' +
    'unmaskedRenderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):null,' +
    'etcExtension:!!gl?.getExtension("WEBGL_compressed_texture_etc"),' +
    'supportedExtensions:gl?.getSupportedExtensions()?.includes("WEBGL_compressed_texture_etc"),' +
    'probe:window.__t04}})()');
}
async function visit(base, body, testCase, expectedResource) {
  phase = testCase;
  const ready = await page.navigate(base + '?scene=planet&body=' + body +
    '&t04case=' + testCase);
  const focused = ready && await until(() =>
    page.eval('window.getCosmosPerformance?.()?.mode==="planet" && ' +
      '!window.getCosmosPerformance?.()?.transitioning'), 20);
  const requested = focused && await until(() =>
    report.requests.some(item => item.phase === testCase &&
      item.resource === expectedResource), 16);
  if (focused) await until(() =>
    page.eval('window.getCosmosPerformance?.()?.flying === false'), 12);
  if (testCase === 'normal' && focused) {
    const hasEtc = await page.eval('(() => {' +
      'const gl=document.getElementById("universe-canvas")?.getContext("webgl2");' +
      'return !!gl?.getExtension("WEBGL_compressed_texture_etc")})()');
    if (hasEtc) await until(() =>
      page.eval('window.__t04?.compressed?.length > 0'), 8);
  }
  await delay(550);
  const state = await captureState();
  report.scenarios.push({ body, testCase, ready, focused, requested, state });
  return { ready, focused, requested, state };
}

try {
  await inspectAssets();
  const base = await startServer();
  const args = [
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-background-networking',
    '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0',
    '--remote-allow-origins=*', '--user-data-dir=' + profile,
    '--window-size=1366,768', 'about:blank'
  ];
  if (software) args.unshift('--enable-unsafe-swiftshader', '--use-angle=swiftshader');
  chrome = spawn(chromePath, args,
    { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
  chrome.on('error', error => report.errors.push(error.message));
  chrome.on('exit', (code, signal) => { chromeExit = { code, signal }; });
  chrome.stderr?.on('data', data => {
    chromeStderr = (chromeStderr + String(data)).slice(-3000);
  });
  const port = await chromePort();
  const info = await fetch('http://127.0.0.1:' + port + '/json/new?' +
    encodeURIComponent('about:blank'), { method: 'PUT' }).then(res => res.json());
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
  await page.send('Page.addScriptToEvaluateOnNewDocument',
    { source: '(' + installProbe.toString() + ')()' });

  let etcAvailable;
  for (const body of bodies) {
    const wanted = 'textures/ktx2/' + body.file + '.ktx2';
    const result = await visit(base, body.id, 'normal', wanted);
    if (etcAvailable === undefined) {
      etcAvailable = Boolean(result.state.etcExtension);
      report.webgl = {
        etcAvailable,
        renderer: result.state.renderer,
        vendor: result.state.vendor,
        unmaskedRenderer: result.state.unmaskedRenderer
      };
    }
    check(body.id + ' scene remains interactive', result.ready && result.focused &&
      !result.state.contextLost && result.state.mode === 'planet', result.state.mode);
    if (!etcAvailable) {
      skip(body.id + ' ETC2 upload', 'WEBGL_compressed_texture_etc unavailable');
      continue;
    }
    const jpg = resource('textures/' + body.file + '.jpg');
    const compressed = result.state.probe?.compressed || [];
    const asset = report.assets.find(item => item.id === body.id);
    const successes = compressed.filter(call => call.error === 0 &&
      (call.internalformat === 0x9274 || call.internalformat === 0x9275));
    const mip0Count = successes.filter(call =>
      call.width === asset.width && call.height === asset.height).length;
    const dimensionsSeen = new Set(successes.map(call =>
      call.width + 'x' + call.height));
    const allMipDimensionsSeen = asset.levels.every(level =>
      dimensionsSeen.has(level.width + 'x' + level.height));
    check(body.id + ' requests KTX2 and avoids JPG fallback',
      result.requested && resource(wanted).some(item => item.status === 200) &&
      jpg.length === 0, { ktx2: resource(wanted).length, jpg: jpg.length });
    check(body.id + ' ETC2 mipmaps upload without GL error',
      mip0Count >= (body.id === 'neptune' ? 2 : 1) &&
      allMipDimensionsSeen && compressed.every(call => call.error === 0),
      { uploadCount: compressed.length, successfulEtc2: successes.length,
        mip0Count, allMipDimensionsSeen,
        errors: compressed.filter(call => call.error !== 0) });
    if (successes.length > 0) {
      await mkdir(path.dirname(baseReport), { recursive: true });
      await page.screenshot(baseReport + '-' + body.id + '-ktx2.png');
    }
  }

  const noetc = await visit(base, 'uranus', 'noetc', 'textures/uranus.jpg');
  check('no ETC extension loads JPG without requesting KTX2',
    noetc.requested && noetc.state.probe?.blockedEtcRequests > 0 &&
    resource('textures/uranus.jpg').some(item => item.status === 200) &&
    resource('textures/ktx2/uranus.ktx2').length === 0 &&
    !noetc.state.contextLost, {
      jpg: resource('textures/uranus.jpg').length,
      ktx2: resource('textures/ktx2/uranus.ktx2').length,
      blockedExtensionRequests: noetc.state.probe?.blockedEtcRequests
    });
  if (noetc.focused && !noetc.state.contextLost) {
    await page.screenshot(baseReport + '-uranus-jpg.png');
  }

  if (etcAvailable) {
    const missing = await visit(base, 'neptune', 'missing', 'textures/neptune.jpg');
    check('missing Neptune KTX2 (404) falls back to JPG',
      missing.requested &&
      resource('textures/ktx2/neptune.ktx2').some(item => item.status === 404) &&
      resource('textures/neptune.jpg').some(item => item.status === 200) &&
      !missing.state.contextLost, {
        ktx2: resource('textures/ktx2/neptune.ktx2'),
        jpg: resource('textures/neptune.jpg')
      });
    if (missing.focused && !missing.state.contextLost) {
      await page.screenshot(baseReport + '-neptune-jpg.png');
    }
    const corrupt = await visit(base, 'callisto', 'corrupt',
      'textures/satellites/callisto.jpg');
    check('corrupt Callisto KTX2 parse falls back to JPG',
      corrupt.requested &&
      resource('textures/ktx2/satellites/callisto.ktx2').some(item => item.status === 200) &&
      resource('textures/satellites/callisto.jpg').some(item => item.status === 200) &&
      !corrupt.state.contextLost, {
        ktx2: resource('textures/ktx2/satellites/callisto.ktx2'),
        jpg: resource('textures/satellites/callisto.jpg')
      });
    if (corrupt.focused && !corrupt.state.contextLost) {
      await page.screenshot(baseReport + '-callisto-jpg.png');
    }
  } else {
    skip('404 KTX2 fallback', 'compressed path cannot be entered without ETC extension');
    skip('corrupt KTX2 fallback', 'compressed path cannot be entered without ETC extension');
  }
} catch (error) {
  report.errors.push(String(error?.stack || error));
  console.error(error?.stack || error);
} finally {
  report.finished = new Date().toISOString();
  report.summary = {
    passed: report.checks.filter(c => c.status === 'passed').length,
    failed: report.checks.filter(c => c.status === 'failed').length,
    skipped: report.checks.filter(c => c.status === 'skipped').length,
    errors: report.errors.length
  };
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');
  page?.socket.close();
  chrome?.kill();
  if (server) await new Promise(resolve => server.close(resolve));
  await delay(300);
  await rm(profile, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
  console.log('T04 audit:', JSON.stringify(report.summary), reportPath);
  if (report.summary.failed || report.summary.errors) process.exitCode = 1;
}
