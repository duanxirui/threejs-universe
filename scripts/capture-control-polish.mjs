// Reproducible T31 visual capture (not an automated acceptance test).
// Records real rendered Chrome/SwiftShader UI screenshots and computed styles
// for desktop and mobile scrollbars/science dropdown popovers.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const DIST = path.resolve('dist');
const PREFIX = 'docs/baselines/2026-10-28-T31-control-polish';
const CHROME = process.env.CHROME_EXE ||
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const profile = await mkdtemp(path.join(os.tmpdir(), 'cosmos-controls-'));
const report = {
  topic: 'T31 controls visual preview',
  capturedOn: new Date().toISOString(),
  environment: 'Local build, isolated Chrome/SwiftShader, simulated mobile viewport',
  screenshots: [], styles: {}, notes: []
};
let server, browser, socket, devTools, browserExit;

class CDP {
  constructor(connection) {
    this.socket = connection;
    this.counter = 0;
    this.pending = new Map();
    connection.onmessage = event => {
      const result = JSON.parse(String(event.data));
      const item = this.pending.get(result.id);
      if (!item) return;
      this.pending.delete(result.id);
      clearTimeout(item.timeout);
      if (result.error) item.reject(Error(result.error.message));
      else item.resolve(result.result || {});
    };
  }
  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.counter;
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(Error('CDP timed out at ' + method));
      }, 18000);
      this.pending.set(id, { resolve, reject, timeout });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expression) {
    const output = await this.send('Runtime.evaluate', {
      expression, awaitPromise: true, returnByValue: true
    });
    if (output.exceptionDetails) throw Error(
      output.exceptionDetails.exception?.description || output.exceptionDetails.text);
    return output.result?.value;
  }
  async click(selector) {
    let point = null;
    for (let i = 0; i < 75; i++) {
      point = await this.eval('(() => {const e=document.querySelector(' +
        JSON.stringify(selector) + ');if(!e)return null;' +
        'e.scrollIntoView({block:"center",inline:"nearest"});' +
        'const r=e.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;' +
        'const top=document.elementFromPoint(x,y);return {x,y,' +
        'ready:r.width>10&&r.height>10&&!e.closest("[hidden],[inert]")&&' +
        '(top===e||e.contains(top))};})()');
      if (point?.ready) break;
      await delay(140);
    }
    if (!point?.ready) throw Error('Not reachable: ' + selector + ' ' + JSON.stringify(point));
    for (const type of ['mousePressed', 'mouseReleased']) {
      await this.send('Input.dispatchMouseEvent', {
        type, x: point.x, y: point.y, button: 'left',
        buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1
      });
    }
  }
  async screenshot(name) {
    const file = PREFIX + '-' + name + '.png';
    const result = await this.send('Page.captureScreenshot', {
      format: 'png', captureBeyondViewport: false, fromSurface: true
    });
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, Buffer.from(result.data, 'base64'));
    report.screenshots.push(file);
  }
}
async function waitFor(expression, maxMs = 16000) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    if (await devTools.eval(expression)) return;
    await delay(180);
  }
  throw Error('Preview UI did not reach state: ' + expression);
}
async function viewport(width, height) {
  await devTools.send('Emulation.setDeviceMetricsOverride', {
    width, height, deviceScaleFactor: 1, mobile: width <= 900
  });
  await delay(470);
}
async function inspect(label) {
  report.styles[label] = await devTools.eval('(() => {' +
    'const panel=document.querySelector(".workspace-panel");' +
    'const pop=document.querySelector(".science-select-popover:not([hidden])");' +
    'const select=pop?.id.replace("-popover","");' +
    'const native=select?document.getElementById(select):null;' +
    'const ps=getComputedStyle(panel);' +
    'const box=pop?.getBoundingClientRect();' +
    'return {scrollbarWidth:ps.scrollbarWidth,scrollbarColor:ps.scrollbarColor,' +
    'panelScrollHeight:panel.scrollHeight,panelClientHeight:panel.clientHeight,' +
    'activePopover:pop?.id||null,' +
    'nativeValue:native?.value||null,' +
    'visibleSelectValue:select?document.getElementById(select+"-value")?.textContent:null,' +
    'popoverRect:box?{left:box.left,top:box.top,right:box.right,bottom:box.bottom}:null,' +
    'viewport:{width:innerWidth,height:innerHeight}};})()');
}
try {
  server = createServer(async (request, response) => {
    try {
      const relative = decodeURIComponent(new URL(request.url, 'http://localhost')
        .pathname).replace(/^\/+/, '') || 'index.html';
      const file = path.resolve(DIST, relative);
      if (!file.startsWith(DIST + path.sep)) {
        response.writeHead(403).end(); return;
      }
      const ext = path.extname(file);
      const contentType = {
        '.html': 'text/html', '.css': 'text/css',
        '.js': 'text/javascript', '.json': 'application/json',
        '.png': 'image/png', '.jpg': 'image/jpeg'
      }[ext] || 'application/octet-stream';
      response.writeHead(200, { 'Content-Type': contentType,
        'Cache-Control': 'no-store' }).end(await readFile(file));
    } catch { response.writeHead(404).end(); }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const base = 'http://127.0.0.1:' + server.address().port + '/';
  browser = spawn(CHROME, [
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-background-networking',
    '--enable-unsafe-swiftshader', '--use-angle=swiftshader',
    '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0',
    '--remote-allow-origins=*', '--user-data-dir=' + profile,
    '--window-size=1366,768', 'about:blank'
  ], { stdio: ['ignore', 'ignore', 'ignore'], windowsHide: true });
  browser.on('exit', (code, signal) => { browserExit = { code, signal }; });
  let port;
  for (let i = 0; i < 100; i++) {
    if (browserExit) throw Error('Chrome closed: ' + JSON.stringify(browserExit));
    try {
      port = Number((await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8'))
        .split(/\r?\n/)[0]); break;
    } catch { await delay(120); }
  }
  if (!port) throw Error('Chrome debugger port unavailable');
  const tab = await fetch('http://127.0.0.1:' + port + '/json/new?' +
    encodeURIComponent(base), { method: 'PUT' }).then(response => response.json());
  socket = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  devTools = new CDP(socket);
  await devTools.send('Page.enable');
  await devTools.send('Runtime.enable');
  await devTools.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }]
  });
  await waitFor('document.getElementById("loading-screen")?.classList.contains("is-loaded")');
  await devTools.click('#rail-objects-trigger');
  await devTools.click('#t29-gaia-toggle');
  await waitFor('window.getCosmosGaia()?.active === true', 20000);
  await devTools.click('#t29-distance-trigger');
  await inspect('gaiaDesktop');
  await devTools.screenshot('gaia-desktop');
  await devTools.click('#t29-distance-trigger');
  await devTools.click('#t30-toggle');
  await waitFor('window.getCosmosDeepSky()?.active === true', 20000);
  await devTools.click('#t30-category-trigger');
  await inspect('deepSkyDesktop');
  await devTools.screenshot('deep-sky-desktop');
  await viewport(390, 844);
  await inspect('deepSkyMobile');
  await devTools.screenshot('deep-sky-mobile');
  await devTools.click('#t30-category-trigger');
  report.notes.push('Popovers captured with native browser pointer interactions.');
} finally {
  report.finishedAt = new Date().toISOString();
  await mkdir(path.dirname(PREFIX), { recursive: true });
  await writeFile(PREFIX + '-visual.json', JSON.stringify(report, null, 2) + '\n');
  socket?.close();
  browser?.kill();
  if (server) await new Promise(resolve => server.close(resolve));
  await delay(180);
  await rm(profile, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
  console.log('Control style preview:', report.screenshots.join(', '));
}
