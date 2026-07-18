import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const port = process.env.CHROME_DEBUG_PORT ?? '9223';
const targetUrl = process.env.AUDIT_URL ?? 'http://127.0.0.1:3100/search';
const outputDir = resolve(process.env.AUDIT_OUTPUT ?? '.next/phase8-viewports');
const widths = [360, 375, 390, 430, 768, 1024, 1440, 1920];

async function createTarget() {
  const response = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent('about:blank')}`, { method: 'PUT' });
  if (!response.ok) throw new Error(`Cannot create Chrome target: ${response.status}`);
  return response.json();
}

async function audit(width) {
  const target = await createTarget();
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  const pending = new Map();
  let sequence = 0;
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (!message.id) return;
    const task = pending.get(message.id);
    if (!task) return;
    pending.delete(message.id);
    if (message.error) task.reject(new Error(message.error.message));
    else task.resolve(message.result);
  });
  await new Promise((resolveOpen, reject) => {
    socket.addEventListener('open', resolveOpen, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  const send = (method, params = {}) => new Promise((resolveResult, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve: resolveResult, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 768 });
  await send('Page.navigate', { url: targetUrl });
  await new Promise((done) => setTimeout(done, 1800));
  const result = await send('Runtime.evaluate', {
    returnByValue: true,
    awaitPromise: true,
    expression: `(async () => {
      const root = document.documentElement;
      const candidates = [...document.querySelectorAll('button, a, input, select, textarea, [role="button"]')];
      const smallTargets = candidates.flatMap((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden' || rect.width === 0 || rect.height === 0) return [];
        if (rect.width >= 44 && rect.height >= 44) return [];
        return [{ tag: element.tagName, label: (element.getAttribute('aria-label') || element.textContent || '').trim().slice(0, 50), width: Math.round(rect.width), height: Math.round(rect.height) }];
      });
      const registrations = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistrations() : [];
      return { title: document.title, innerWidth, scrollWidth: root.scrollWidth, hasHorizontalOverflow: root.scrollWidth > innerWidth + 1, serviceWorkerRegistered: registrations.some((registration) => registration.scope === location.origin + '/'), smallTargets };
    })()`,
  });
  const manifest = await send('Page.getAppManifest');
  const screenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(resolve(outputDir, `search-${width}.png`), Buffer.from(screenshot.data, 'base64'));
  socket.close();
  await fetch(`http://127.0.0.1:${port}/json/close/${target.id}`);
  return { width, ...result.result.value, manifestErrors: manifest.errors };
}

await mkdir(outputDir, { recursive: true });
const report = [];
for (const width of widths) report.push(await audit(width));
await writeFile(resolve(outputDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
const browser = await fetch(`http://127.0.0.1:${port}/json/version`).then((response) => response.json());
const browserSocket = new WebSocket(browser.webSocketDebuggerUrl);
await new Promise((done, reject) => { browserSocket.addEventListener('open', done, { once: true }); browserSocket.addEventListener('error', reject, { once: true }); });
browserSocket.send(JSON.stringify({ id: 1, method: 'Browser.close' }));
