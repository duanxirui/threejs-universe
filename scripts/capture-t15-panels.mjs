// Capture the actual search, settings and guide surfaces for visual review.
// Uses isolated Chrome/CDP and Node built-ins; never edits the running app.
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const browserExe = process.env.CHROME_EXE ||
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const siteUrl = process.env.COSMOS_URL || 'http://127.0.0.1:5173/';
const outputDir = 'docs/baselines';
const profile = await mkdtemp(path.join(os.tmpdir(), 'cosmos-ui-preview-'));
let chrome, socket;
const pending = new Map();
let messageId = 0;

async function command(method, params = {}) {
  const id = ++messageId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(Error(method + ' timed out'));
    }, 20000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const result = await command('Runtime.evaluate', {
    expression, awaitPromise: true, returnByValue: true
  });
  if (result.exceptionDetails) throw Error(
    result.exceptionDetails.exception?.description || result.exceptionDetails.text
  );
  return result.result?.value;
}

async function until(expression, timeoutMs = 20000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await evaluate(expression)) return;
    await delay(180);
  }
  throw Error('Preview did not initialize');
}

async function capture(name) {
  await delay(320);
  const { data } = await command('Page.captureScreenshot', {
    format: 'png', captureBeyondViewport: false, fromSurface: true
  });
  const output = path.join(outputDir, '2026-10-21-T15-' + name + '.png');
  await writeFile(output, Buffer.from(data, 'base64'));
  console.log('Captured ' + output);
}

async function setViewport(width, height) {
  await command('Emulation.setDeviceMetricsOverride', {
    width, height, deviceScaleFactor: 1, mobile: width < 641
  });
  await delay(240);
}

async function showPanels(suffix) {
  await evaluate('document.getElementById("search-trigger").click()');
  await capture('search-' + suffix);
  await evaluate('document.getElementById("search-close").click()');

  await evaluate('document.getElementById("global-settings-trigger").click()');
  await capture('settings-' + suffix);
  await evaluate('document.getElementById("quality-select-trigger").click()');
  const opened = await evaluate('({expanded:document.getElementById("quality-select-trigger").getAttribute("aria-expanded"),' +
    'options:document.querySelectorAll("#quality-select-listbox [role=option]").length,' +
    'value:document.getElementById("quality-select").value,' +
    'rect:(()=>{const r=document.getElementById("quality-select-popover").getBoundingClientRect();' +
    'return {left:r.left,top:r.top,right:r.right,bottom:r.bottom}})(),' +
    'viewport:{width:innerWidth,height:innerHeight}})');
  if (opened.expanded !== 'true' || opened.options !== 3 ||
      opened.rect.left < 0 || opened.rect.top < 0 ||
      opened.rect.right > opened.viewport.width + 1 ||
      opened.rect.bottom > opened.viewport.height + 1) {
    throw Error('Quality dropdown geometry/semantics failed: ' + JSON.stringify(opened));
  }
  await capture('quality-expanded-' + suffix);
  await evaluate('document.getElementById("quality-select-option-2").click()');
  const selected = await evaluate('({nativeValue:document.getElementById("quality-select").value,' +
    'display:document.getElementById("quality-select-value").textContent,' +
    'drawer:document.getElementById("app").dataset.activeDrawer})');
  if (selected.nativeValue !== 'high' || selected.display !== '极致' ||
      selected.drawer !== 'settings') {
    throw Error('Quality selection did not reach the original select: ' +
      JSON.stringify(selected));
  }
  await evaluate('document.getElementById("quality-select-trigger").click()');
  await evaluate('document.getElementById("quality-select-option-0").click()');
  console.log('Quality options verified: auto -> high -> auto, ' + suffix);
  // The real help button lives inside the settings drawer.
  await evaluate('document.getElementById("help-trigger").click()');
  await capture('guide-' + suffix);
  await evaluate('document.getElementById("help-close").click()');
  // Closing help restores the previously open settings workspace. Close it
  // before switching viewports, so the next gear click opens settings again.
  await evaluate('document.getElementById("global-settings-trigger").click()');
}

try {
  chrome = spawn(browserExe, [
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-background-networking',
    '--enable-unsafe-swiftshader', '--use-angle=swiftshader',
    '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0',
    '--remote-allow-origins=*', '--user-data-dir=' + profile,
    '--window-size=1366,768', 'about:blank'
  ], { stdio: 'ignore', windowsHide: true });
  let port;
  for (let i = 0; i < 90; i++) {
    try {
      const file = await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8');
      port = Number(file.split(/\r?\n/)[0]);
      break;
    } catch { await delay(100); }
  }
  if (!port) throw Error('Isolated Chrome did not start');
  const page = await fetch('http://127.0.0.1:' + port + '/json/new?' +
    encodeURIComponent(siteUrl), { method: 'PUT' }).then(r => r.json());
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = () => reject(Error('Unable to connect to Chrome'));
  });
  socket.onmessage = event => {
    const message = JSON.parse(String(event.data));
    const job = pending.get(message.id);
    if (!job) return;
    pending.delete(message.id);
    clearTimeout(job.timer);
    if (message.error) job.reject(Error(message.error.message));
    else job.resolve(message.result || {});
  };
  await command('Page.enable');
  await command('Runtime.enable');
  await until('document.getElementById("app")?.dataset.layout==="t15" && ' +
    'document.getElementById("loading-screen")?.classList.contains("is-loaded")');
  await mkdir(outputDir, { recursive: true });
  await setViewport(1366, 768);
  await showPanels('desktop');
  await setViewport(390, 844);
  await showPanels('mobile-390');
} finally {
  socket?.close();
  chrome?.kill();
  await delay(350);
  await rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 250 })
    .catch(() => {});
}
