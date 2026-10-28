// V3 feature audit in a separate Chrome profile; Node built-ins only.
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const chromePath = process.env.CHROME_EXE ||
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const previewUrl = process.env.COSMOS_URL || 'http://127.0.0.1:5173/';
const reportPath = process.env.COSMOS_AUDIT_REPORT ||
  'docs/baselines/2026-10-23-V3-browser-audit.json';
const artifactPrefix = process.env.COSMOS_AUDIT_PREFIX || '';
const t25Mode = process.env.COSMOS_AUDIT_T25 === '1';
const profile = await mkdtemp(path.join(os.tmpdir(), 'cosmos-v3-audit-'));
const report = { started: new Date().toISOString(), previewUrl,
  environment: 'Isolated Headless Chrome/SwiftShader and CSS mobile emulation',
  limitations: ['Not physical Android/iOS touch, GPU memory or FPS evidence.'],
  checks: [], errors: [] };
let chrome, page, chromeExit, stderr = '';

function check(name, passed, actual = null) {
  report.checks.push({ name, passed: Boolean(passed), actual });
  console.log((passed ? 'PASS ' : 'FAIL ') + name);
}

class CDP {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    socket.onmessage = event => {
      const response = JSON.parse(String(event.data));
      const pending = this.pending.get(response.id);
      if (!pending) return;
      this.pending.delete(response.id);
      clearTimeout(pending.timer);
      if (response.error) pending.reject(Error(response.error.message));
      else pending.resolve(response.result || {});
    };
    socket.onclose = () => {
      for (const pending of this.pending.values()) pending.reject(Error('CDP closed'));
      this.pending.clear();
    };
  }
  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      socket.onopen = resolve;
      socket.onerror = () => reject(Error('Chrome debugger socket failed'));
    });
    return new CDP(socket);
  }
  async send(method, params = {}, timeout = 20000) {
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
    const output = await this.send('Runtime.evaluate',
      { expression, awaitPromise: true, returnByValue: true });
    if (output.exceptionDetails) throw Error(output.exceptionDetails.exception?.description ||
      output.exceptionDetails.text);
    return output.result?.value;
  }
  async click(selector) {
    if (selector === '#detail-peek-trigger' && await this.eval(
      'window.innerWidth>900 && document.getElementById("app")?.dataset.workspaceVersion==="t31"')) {
      selector = '#t31-rail-detail';
    }
    if (selector === '#atlas-trigger' && await this.eval(
      'document.getElementById("app")?.dataset.workspaceVersion==="t31"')) {
      if (await this.eval('window.innerWidth>900')) {
        selector = '#t31-rail-routes';
      } else {
        if (await this.eval('!["objects","flight"].includes(document.getElementById("app").dataset.navPane)')) {
          await this.click('#planet-dock-toggle');
        }
        selector = '#t31-mobile-routes';
      }
    }
    let box;
    for (let i = 0; i < 60; i++) {
      box = await this.eval('(() => {const el=document.querySelector(' +
        JSON.stringify(selector) + ');if(!el)return null;' +
        'if(!el.closest("[inert],[hidden]"))el.scrollIntoView({behavior:"instant",block:"center",inline:"nearest"});' +
        'const r=el.getBoundingClientRect();' +
        'const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);' +
        'return {x:r.x+r.width/2,y:r.y+r.height/2,ready:r.width>0&&r.height>0&&' +
        '!el.closest("[inert],[hidden]")&&(hit===el||el.contains(hit))};})()');
      if (box?.ready) break;
      await delay(100);
    }
    if (!box?.ready) throw Error('Element not clickable: ' + selector + ' ' + JSON.stringify(box));
    for (const type of ['mousePressed','mouseReleased']) {
      await this.send('Input.dispatchMouseEvent',
        { type, x: box.x, y: box.y, button:'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount:1 });
    }
  }
  async until(expression, seconds = 15) {
    const end = Date.now() + seconds * 1000;
    while (Date.now() < end) {
      if (await this.eval(expression)) return true;
      await delay(140);
    }
    return false;
  }
  async navigate(url) {
    await this.send('Page.navigate', { url });
    return this.until('document.getElementById("app")?.dataset.layout==="t15" && ' +
      'document.getElementById("loading-screen")?.classList.contains("is-loaded")', 20);
  }
  close() { this.socket.close(); }
}

async function devtoolsPort() {
  for (let i = 0; i < 80; i++) {
    if (chromeExit) throw Error('Chrome exited: ' + JSON.stringify(chromeExit) + stderr);
    try {
      return Number((await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split(/\r?\n/)[0]);
    } catch { await delay(100); }
  }
  throw Error('DevToolsActivePort not created: ' + stderr);
}

async function screenshot(filename) {
  if (artifactPrefix) {
    filename = filename.replace(/^docs\/baselines\/2026-10-23-/, artifactPrefix + '-');
  }
  const shot = await page.send('Page.captureScreenshot',
    { format:'png', captureBeyondViewport:false, fromSurface:true });
  await mkdir(path.dirname(filename), { recursive:true });
  await writeFile(filename, Buffer.from(shot.data, 'base64'));
  return filename;
}

try {
  const preview = await fetch(previewUrl, { signal: AbortSignal.timeout(5000) });
  if (!preview.ok) throw Error('Preview HTTP ' + preview.status);
  chrome = spawn(chromePath, [
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-background-networking',
    '--enable-unsafe-swiftshader', '--use-angle=swiftshader',
    '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0',
    '--remote-allow-origins=*', '--user-data-dir=' + profile,
    '--window-size=1366,768', '--hide-scrollbars', 'about:blank'
  ], { stdio:['ignore','ignore','pipe'], windowsHide:true });
  chrome.on('error', error => report.errors.push(error.message));
  chrome.on('exit', (code, signal) => { chromeExit = { code, signal }; });
  chrome.stderr?.on('data', chunk => { stderr = (stderr + String(chunk)).slice(-3000); });
  const port = await devtoolsPort();
  const result = await fetch('http://127.0.0.1:' + port + '/json/new?' +
    encodeURIComponent(previewUrl), { method:'PUT' }).then(response => response.json());
  page = await CDP.connect(result.webSocketDebuggerUrl);
  await page.send('Page.enable');
  await page.send('Runtime.enable');
  check('V3 page initialized', await page.until(
    'document.getElementById("atlas-trigger") && document.getElementById("atlas-route-list")?.children.length===3'));

  const theme = await page.eval('(() => {const nodes=[...document.querySelectorAll(".cosmos-dialog")];' +
    'const distinct=fn=>[...new Set(nodes.map(el=>fn(getComputedStyle(el))))];' +
    'return {count:nodes.length,radii:distinct(s=>s.borderRadius),' +
    'backgrounds:distinct(s=>s.backgroundImage),' +
    'headers:[...new Set(nodes.map(el=>getComputedStyle(el.querySelector(".modal-heading")).backgroundImage))],' +
    'closeHeights:[...new Set(nodes.map(el=>getComputedStyle(el.querySelector(".modal-close")).height))]};})()');
  check('all five dialogs share surface, heading and close styles',
    theme.count === 5 && theme.radii.length === 1 &&
    theme.backgrounds.length === 1 && theme.headers.length === 1 &&
    theme.closeHeights.length === 1, theme);

  for (const [name, trigger] of [
    ['search', '#search-trigger'], ['help', '#help-trigger'],
    ['compare', '#detail-compare-trigger'], ['atlas', '#atlas-trigger']
  ]) {
    await page.eval('document.querySelector(' + JSON.stringify(trigger) + ').click()');
    const bounds = await page.eval('(() => {const el=document.querySelector(' +
      JSON.stringify('#' + name + '-overlay .cosmos-dialog') +
      '),r=el.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,' +
      'bottom:r.bottom,width:r.width,height:r.height,viewport:innerWidth,viewportHeight:innerHeight};})()');
    check(name + ' dialog fits desktop viewport',
      bounds.width > 300 && bounds.left >= 0 && bounds.right <= bounds.viewport &&
      bounds.top >= 0 && bounds.bottom <= bounds.viewportHeight, bounds);
    await screenshot('docs/baselines/2026-10-23-T24-' + name + '-desktop.png');
    await page.click('#' + name + '-close');
  }

  // Exercise the clipboard-denied path: it must show a styled in-app dialog,
  // never a browser-native prompt with unrelated appearance.
  await page.eval('Object.defineProperty(navigator,"clipboard",' +
    '{configurable:true,value:{writeText:()=>Promise.reject(Error("denied"))}})');
  await page.click('#atlas-trigger');
  await page.click('#atlas-hub-copy');
  const copyFallback = await page.until(
    'document.getElementById("copy-overlay").classList.contains("is-open") && ' +
    'document.getElementById("copy-link-input").value.includes("scene=")', 5);
  check('clipboard denied opens shared link dialog', copyFallback);
  if (copyFallback) {
    await screenshot('docs/baselines/2026-10-23-T24-copy-desktop.png');
    await page.click('#copy-link-select');
    check('link can be selected without a native prompt', await page.eval(
      '(() => {const el=document.getElementById("copy-link-input");' +
      'return el.selectionEnd-el.selectionStart===el.value.length;})()'));
    await page.click('#copy-link-done');
    check('link dialog closes and restores focus', await page.until(
      '!document.getElementById("copy-overlay").classList.contains("is-open") && ' +
      'document.activeElement?.id==="t31-rail-routes"', 3));
  }

  await page.click('#atlas-trigger');
  const hub = await page.eval('({open:document.getElementById("atlas-overlay").classList.contains("is-open"),' +
    'inert:document.querySelector(".bottom-interface").inert,' +
    'routeCount:document.querySelectorAll(".atlas-route-card").length})');
  check('V3 hub opens and isolates background', hub.open && hub.inert && hub.routeCount === 3, hub);
  report.desktopScreenshot = await screenshot('docs/baselines/2026-10-23-V3-atlas-desktop.png');
  await page.click('.atlas-route-card:first-child button');
  check('guided route starts', await page.until(
    '!document.getElementById("atlas-tour-panel").hidden && ' +
    'document.getElementById("atlas-tour-progress").textContent.includes("1 / 6")'));
  check('guided arrival at Sun', await page.until(
    'window.getCosmosPerformance()?.mode==="planet" && ' +
    'document.getElementById("detail-name").textContent==="太阳"', 18));
  await page.click('#atlas-tour-next');
  check('guided next step', await page.until(
    'document.getElementById("atlas-tour-progress").textContent.includes("2 / 6") && ' +
    'document.getElementById("detail-name").textContent==="水星"', 8));
  await page.click('#atlas-tour-prev');
  check('guided previous step', await page.until(
    'document.getElementById("atlas-tour-progress").textContent.includes("1 / 6") && ' +
    'document.getElementById("detail-name").textContent==="太阳"', 8));
  await page.click('#atlas-tour-next');
  check('guided next step remains available after going backward', await page.until(
    'document.getElementById("atlas-tour-progress").textContent.includes("2 / 6")', 8));
  await page.click('#atlas-tour-exit');
  check('guided tour exits', await page.eval(
    'document.getElementById("atlas-tour-panel").hidden'));

  await page.click('#detail-peek-trigger');
  const source = await page.eval('({href:document.getElementById("atlas-source-link").href,' +
    'note:document.getElementById("atlas-source-intro").textContent})');
  check('celestial source and scale disclosure',
    source.href.startsWith('https://nssdc.gsfc.nasa.gov/') && source.note.includes('缩放'), source);
  if (t25Mode) {
    await page.click('#t31-inspector-tabs [data-inspector-tab="sources"]');
    const sourceState = await page.eval('(() => {' +
      'const p=document.getElementById("t25-source-compare");' +
      'return {present:!!p,open:p?.open,body:p?.dataset.bodyId,items:p?.querySelectorAll(".t25-source-item").length,' +
      'caution:p?.querySelector(".t25-source-caution")?.textContent};})()');
    check('T25 per-body provenance includes educational data-use disclosure',
      sourceState.present && sourceState.items === 5 &&
      sourceState.caution.includes('不代表实时天体位置'), sourceState);
    // Avoid accidentally collapsing a details element already opened by a
    // retained UI state. Exercise a genuine closed -> open interaction.
    if (sourceState.open) {
      await page.click('#t25-source-compare summary');
      await page.until('!document.getElementById("t25-source-compare").open', 2);
    }
    await page.click('#t25-source-compare summary');
    const sourceExpanded = await page.until(
      'document.getElementById("t25-source-compare").open', 3);
    const evidenceState = await page.eval('(() => {' +
      'const d=document.getElementById("t25-source-compare");' +
      'const anchors=[...d.querySelectorAll(".t25-source-item a")];' +
      'return {open:d.open,links:anchors.length,' +
      'httpsOnly:anchors.every(a=>a.href.startsWith("https://")),' +
      'sourceRows:d.querySelectorAll(".t25-source-item").length,' +
      'mentionsEvidence:d.textContent.includes("官方资料表格值")};})()');
    check('T25 official table rows and URLs are individually accessible',
      sourceExpanded && evidenceState.open && evidenceState.links >= 4 &&
      evidenceState.httpsOnly && evidenceState.sourceRows === 5 &&
      evidenceState.mentionsEvidence, evidenceState);
    await screenshot('docs/baselines/2026-10-23-T25-field-sources-desktop.png');
    await page.click('#t25-source-compare summary');
    await page.click('#t31-inspector-tabs [data-inspector-tab="overview"]');
  }
  await page.click('#atlas-favorite');
  check('favorite toggles', await page.eval(
    'document.getElementById("atlas-favorite").getAttribute("aria-pressed")==="true"'));
  await page.click('#atlas-orbit-toggle');
  await page.until('!document.getElementById("atlas-orbit-panel").hidden', 2);
  const orbit = await page.eval('({visible:!document.getElementById("atlas-orbit-panel").hidden,' +
    'reference:document.getElementById("atlas-orbit-reference").textContent,' +
    'period:document.getElementById("atlas-orbit-period").textContent})');
  check('orbit explanation layer', orbit.visible && orbit.reference === '太阳' && orbit.period.includes('天'), orbit);

  // Capture the actual exported Blob; the app still uses its normal download path.
  await page.eval('(() => {window.__atlasBlob=null;window.__atlasErrors=[];' +
    'Object.defineProperty(navigator,"canShare",{configurable:true,value:()=>false});' +
    'const originalError=console.error.bind(console);' +
    'console.error=function(...args){window.__atlasErrors.push(args.map(String).join(" "));originalError(...args);};' +
    'const previous=URL.createObjectURL.bind(URL);' +
    'URL.createObjectURL=function(blob){if(blob.type==="image/png")' +
    'window.__atlasBlob={size:blob.size,type:blob.type};return previous(blob);};})()');
  await page.click('#atlas-snapshot');
  const imageReady = await page.until('window.__atlasBlob?.size>1000', 15);
  check('PNG snapshot exported', imageReady,
    await page.eval('({blob:window.__atlasBlob,errors:window.__atlasErrors,' +
      'toast:document.getElementById("toast").textContent,' +
      'buttonDisabled:document.getElementById("atlas-snapshot").disabled,' +
      'shareAvailable:typeof navigator.share})'));

  await page.click('#atlas-trigger');
  await page.click('#atlas-tab-personal');
  const saved = await page.eval('({favorites:document.querySelectorAll("#atlas-favorites button").length,' +
    'recents:document.querySelectorAll("#atlas-recents button").length})');
  check('favorites and recent history visible', saved.favorites >= 1 && saved.recents >= 1, saved);
  await page.click('#atlas-close');
  if (await page.eval('document.getElementById("detail-panel").inert')) {
    await page.click('#detail-peek-trigger');
  }

  const compareReach = await page.eval('(() => {const el=document.getElementById("detail-compare-trigger"),' +
    'panel=document.getElementById("detail-panel");' +
    'el.scrollIntoView({behavior:"instant",block:"center"});' +
    'const r=el.getBoundingClientRect(),p=panel.getBoundingClientRect();' +
    'return {target:{top:r.top,bottom:r.bottom},panel:{top:p.top,bottom:p.bottom,' +
    'scrollTop:panel.scrollTop,scrollHeight:panel.scrollHeight,clientHeight:panel.clientHeight},' +
    'hitNode:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.outerHTML.slice(0,250),' +
    'visibility:getComputedStyle(el).visibility,pointerEvents:getComputedStyle(el).pointerEvents,' +
    'hit:Boolean(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest("#detail-compare-trigger"))};})()');
  check('compare trigger reachable through scrolling',
    compareReach.hit && compareReach.target.top >= 0 &&
    compareReach.target.bottom <= 768, compareReach);
  if (compareReach.hit) await page.click('#detail-compare-trigger');
  else await page.eval('document.getElementById("detail-compare-trigger").click()');
  const scale = await page.eval('({circles:document.querySelectorAll("#atlas-scale-visual circle").length,' +
    'caption:document.querySelector("#atlas-scale-visual p")?.textContent})');
  check('same scale diameter comparison', scale.circles === 2 && scale.caption.includes('倍'), scale);
  await page.eval('(() => {const a=document.getElementById("compare-left"),' +
    'b=document.getElementById("compare-right");a.value="sun";b.value="moon";' +
    'b.dispatchEvent(new Event("change",{bubbles:true}));})()');
  const extreme = await page.eval('(() => {const r=[...document.querySelectorAll("#atlas-scale-visual circle")]' +
    '.map(c=>Number(c.getAttribute("r")));return {radii:r,caption:document.querySelector("#atlas-scale-visual p").textContent};})()');
  check('extreme diameter ratio remains proportional',
    extreme.radii.length === 2 && extreme.radii[0]/extreme.radii[1] > 350 && extreme.caption.includes('不可见'), extreme);
  await page.click('#compare-close');

  check('planet deep link restores scene', await page.navigate(
    new URL('?scene=planet&body=earth', previewUrl).href) && await page.until(
      'document.getElementById("detail-name").textContent==="地球" && ' +
      'window.getCosmosPerformance()?.mode==="planet"', 18));
  const afterRefresh = await page.eval('JSON.parse(localStorage.getItem("cosmos-atlas-v3-personal-v1")||"{}")');
  check('favorites persist across reload', afterRefresh.favorites?.includes('mercury'), afterRefresh);
  check('invalid deep link safely falls back', await page.navigate(
    new URL('?scene=planet&body=unknown-id', previewUrl).href) && await page.until(
      'window.getCosmosPerformance()?.mode==="galaxy" && !location.search.includes("body=")', 12));
  check('prototype-key deep link is rejected', await page.navigate(
    new URL('?scene=planet&body=__proto__', previewUrl).href) && await page.until(
      'window.getCosmosPerformance()?.mode==="galaxy" && !location.search.includes("body=")', 12));

  await page.click('#atlas-trigger');
  await page.click('.atlas-route-card:nth-child(2) button');
  check('second theme route navigates to Moon', await page.until(
    'document.getElementById("atlas-tour-title").textContent.includes("月球") && ' +
    'window.getCosmosPerformance()?.mode==="planet"', 18));
  await page.eval('document.getElementById("universe-canvas").dispatchEvent(' +
    'new PointerEvent("pointerdown",{bubbles:true,pointerId:91,pointerType:"mouse"}))');
  check('manual camera interaction ends guide', await page.until(
    'document.getElementById("atlas-tour-panel").hidden && ' +
    '!window.getCosmosPerformance()?.flying', 5));
  await page.click('#atlas-trigger');
  await page.click('.atlas-route-card:nth-child(3) button');
  check('third theme route starts', await page.until(
    'document.getElementById("atlas-tour-progress").textContent.includes("1 / 6")', 8));
  for (let step = 2; step <= 6; step++) {
    await page.click('#atlas-tour-next');
    check('third route advances to station ' + step, await page.until(
      'document.getElementById("atlas-tour-progress").textContent.includes("' + step + ' / 6")', 6));
  }
  await page.click('#atlas-tour-next');
  check('third route completes', await page.eval(
    'document.getElementById("atlas-tour-panel").hidden && ' +
    'document.getElementById("toast").textContent.includes("已完成")'));

  await page.send('Emulation.setDeviceMetricsOverride',
    { width:390, height:844, deviceScaleFactor:1, mobile:true });
  await delay(500);
  await page.click('#atlas-trigger');
  const mobile = await page.eval('(() => {const r=document.querySelector(".atlas-modal").getBoundingClientRect();' +
    'return {left:r.left,right:r.right,viewport:innerWidth,scrollWidth:document.documentElement.scrollWidth,' +
    'open:document.getElementById("atlas-overlay").classList.contains("is-open")};})()');
  check('mobile atlas dialog fits viewport',
    mobile.open && mobile.left >= 0 && mobile.right <= 390 && mobile.scrollWidth <= 390, mobile);
  report.mobileScreenshot = await screenshot('docs/baselines/2026-10-23-V3-atlas-mobile.png');
  await page.click('#atlas-close');

  const mobileTheme = await page.eval('(() => {const ds=[...document.querySelectorAll(".cosmos-dialog")];' +
    'return {radii:[...new Set(ds.map(el=>getComputedStyle(el).borderRadius))],' +
    'closeHeights:[...new Set(ds.map(el=>getComputedStyle(el.querySelector(".modal-close")).height))]};})()');
  check('all dialogs share mobile radius and close size',
    mobileTheme.radii.length === 1 && mobileTheme.closeHeights.length === 1, mobileTheme);
  for (const [name, trigger] of [
    ['search', '#search-trigger'], ['help', '#help-trigger'],
    ['compare', '#detail-compare-trigger'], ['atlas', '#atlas-trigger']
  ]) {
    await page.eval('document.querySelector(' + JSON.stringify(trigger) + ').click()');
    const bounds = await page.eval('(() => {const el=document.querySelector(' +
      JSON.stringify('#' + name + '-overlay .cosmos-dialog') +
      '),r=el.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,' +
      'bottom:r.bottom,width:r.width,height:r.height};})()');
    check(name + ' dialog fits mobile viewport',
      bounds.width > 250 && bounds.left >= 0 && bounds.right <= 390 &&
      bounds.top >= 0 && bounds.bottom <= 844, bounds);
    await screenshot('docs/baselines/2026-10-23-T24-' + name + '-mobile.png');
    await page.click('#' + name + '-close');
  }
  // Navigation above creates a fresh Window and clears the desktop clipboard
  // mock. Reapply the denied-permission condition on the mobile page.
  await page.eval('Object.defineProperty(navigator,"clipboard",' +
    '{configurable:true,value:{writeText:()=>Promise.reject(Error("denied"))}})');
  await page.eval('document.getElementById("atlas-trigger").click()');
  await page.click('#atlas-hub-copy');
  if (await page.until('document.getElementById("copy-overlay").classList.contains("is-open")', 5)) {
    const bounds = await page.eval('(() => {const r=document.querySelector(".copy-modal").getBoundingClientRect();' +
      'return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width};})()');
    check('copy dialog fits mobile viewport',
      bounds.width > 250 && bounds.left >= 0 && bounds.right <= 390 &&
      bounds.top >= 0 && bounds.bottom <= 844, bounds);
    await screenshot('docs/baselines/2026-10-23-T24-copy-mobile.png');
    await page.click('#copy-close');
  } else check('copy dialog opens on mobile', false);

  // Narrow portrait and landscape device viewports: every dialog must remain
  // contained in the visible viewport even when its content is scrollable.
  for (const [width, height] of [[360, 740], [844, 390]]) {
    await page.send('Emulation.setDeviceMetricsOverride',
      { width, height, deviceScaleFactor:1, mobile:true });
    await delay(200);
    for (const [name, trigger] of [
      ['search', '#search-trigger'], ['help', '#help-trigger'],
      ['compare', '#detail-compare-trigger'], ['atlas', '#atlas-trigger'],
      ['copy', '#atlas-trigger']
    ]) {
      await page.eval('document.querySelector(' + JSON.stringify(trigger) + ').click()');
      if (name === 'copy') {
        // Wait for the newly-opened dialog to settle after a mobile breakpoint
        // change before dispatching a real pointer click on its footer.
        await page.until(
          'document.getElementById("atlas-overlay").classList.contains("is-open")', 2);
        await delay(150);
        // Device emulation may recreate the Navigator clipboard implementation.
        // Deny each copy attempt explicitly so the fallback path is exercised.
        await page.eval('Object.defineProperty(navigator,"clipboard",' +
          '{configurable:true,value:{writeText:()=>Promise.reject(Error("denied"))}})');
        await page.eval('window.__t25CopyClicks=0;' +
          'document.getElementById("atlas-hub-copy").addEventListener("click",' +
          '()=>window.__t25CopyClicks++, {once:true})');
        await page.click('#atlas-hub-copy');
        const isCopyOpen = await page.until(
          'document.getElementById("copy-overlay").classList.contains("is-open")', 5);
        check('copy popup opens ' + width + 'x' + height, isCopyOpen,
          isCopyOpen ? null : await page.eval('({atlasOpen:document.getElementById("atlas-overlay")' +
            '.classList.contains("is-open"),message:document.getElementById("toast").textContent,' +
            'copyClicks:window.__t25CopyClicks,' +
            'clipboard:String(navigator.clipboard?.writeText),url:location.href})'));
      }
      const snapshot = await page.eval('(() => {const d=document.querySelector(' +
        JSON.stringify('#' + name + '-overlay .cosmos-dialog') +
        '),r=d.getBoundingClientRect(),s=getComputedStyle(d);return {' +
        'open:d.closest(".modal-overlay").classList.contains("is-open"),' +
        'left:r.left,right:r.right,top:r.top,bottom:r.bottom,' +
        'width:r.width,height:r.height,overflowY:s.overflowY};})()');
      check(name + ' popup fits ' + width + 'x' + height,
        snapshot.open && snapshot.width > 245 &&
        snapshot.left >= -1 && snapshot.right <= width + 1 &&
        snapshot.top >= -1 && snapshot.bottom <= height + 1, snapshot);
      if (snapshot.open) await page.click('#' + name + '-close');
      else await page.eval('document.querySelector("#atlas-close").click()');
    }
  }
} catch (error) {
  report.errors.push(String(error?.stack || error));
  console.error(error?.stack || error);
} finally {
  report.finished = new Date().toISOString();
  report.summary = {
    passed: report.checks.filter(item => item.passed).length,
    failed: report.checks.filter(item => !item.passed).length,
    errors: report.errors.length
  };
  await mkdir(path.dirname(reportPath), { recursive:true });
  const destination = report.summary.failed || report.summary.errors
    ? reportPath.replace(/\.json$/, '-failed.json') : reportPath;
  await writeFile(destination, JSON.stringify(report, null, 2), 'utf8');
  page?.close();
  chrome?.kill();
  await delay(300);
  await rm(profile, { recursive:true, force:true, maxRetries:3, retryDelay:250 }).catch(() => {});
  console.log('V3 audit:', JSON.stringify(report.summary), 'report:', destination);
  if (report.summary.failed || report.summary.errors) process.exitCode = 1;
}
