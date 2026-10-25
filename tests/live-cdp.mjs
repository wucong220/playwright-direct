// Live acceptance test for an already-running, paired extension bridge.
// Never launches Chrome or reads an existing user's page content.
// Usage: node tests/live-cdp.mjs --output-dir C:\path\to\outputs [--port 43187]
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { readFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
function dependency(name) {
  for (const directory of [path.resolve(here, '..'), path.resolve(here, '../..')]) {
    try { return createRequire(path.join(directory, 'package.json'))(name); }
    catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; }
  }
  throw new Error(`Cannot resolve ${name} from the repository or its parent`);
}
const { chromium } = dependency('playwright-core');
const { WebSocket } = dependency('ws');

const options = {};
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index];
  if (!['--output-dir', '--port'].includes(key) || !process.argv[index + 1]) {
    throw new Error('Usage: node tests/live-cdp.mjs --output-dir <directory> [--port 43187]');
  }
  options[key] = process.argv[index + 1];
}
assert(options['--output-dir'], '--output-dir is required');
const outputDirectory = path.resolve(options['--output-dir']);
const bridgePort = Number(options['--port'] || 43187);
assert(Number.isSafeInteger(bridgePort) && bridgePort > 0 && bridgePort < 65536, 'Invalid bridge port');
const pairingPath = path.join(process.env.USERPROFILE || homedir(), '.dsh', 'browser-tabs', 'pairing.json');
const { token } = JSON.parse(await readFile(pairingPath, 'utf8'));
assert(typeof token === 'string' && token.length > 0, 'Pairing token is missing');
const headers = { Authorization: `Bearer ${token}` };
const bridgeHttp = `http://127.0.0.1:${bridgePort}`;
const bridgeWs = `ws://127.0.0.1:${bridgePort}`;
const runId = randomUUID();
const routePrefix = `/live-cdp-${runId}`;
const title = 'Playwright Direct — Live Acceptance';
const nextTitle = 'Playwright Direct — Navigation Passed';
const paragraphs = Array.from({ length: 320 }, (_, index) =>
  `FULL_TEXT_${String(index).padStart(4, '0')}: 中文完整正文验证 ${'abcdefghijklmnopqrstuvwxyz0123456789 '.repeat(4).trimEnd()} END_${index}`);
const steps = [];
let server;
let browser;
let creationConnection;
let tabId;
let fixtureBase;
let fixtureClosed = false;

async function deadline(promise, label, milliseconds = 15000) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label}: timeout after ${milliseconds} ms`)), milliseconds); }),
    ]);
  } finally { clearTimeout(timer); }
}
async function step(label, action, milliseconds = 15000) {
  const started = performance.now();
  await deadline(Promise.resolve().then(action), label, milliseconds);
  steps.push({ step: label, milliseconds: Math.round(performance.now() - started) });
  console.log(`PASS ${label}`);
}
async function inventory() {
  const response = await fetch(`${bridgeHttp}/tabs`, { headers, signal: AbortSignal.timeout(5000) });
  assert.equal(response.status, 200, 'Bridge inventory request failed');
  const data = await response.json();
  assert(Array.isArray(data.tabs), 'Bridge inventory has no tabs array');
  return data.tabs;
}
async function until(label, check, milliseconds = 10000) {
  const end = Date.now() + milliseconds;
  do {
    const value = await check();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 100));
  } while (Date.now() < end);
  throw new Error(`${label}: condition did not become true`);
}

// A small transport is enough to create and finally close only our fixture tab.
// Events are captured immediately, including events emitted before 'open' resolves.
async function rawConnection(endpoint) {
  const socket = new WebSocket(endpoint, { headers, handshakeTimeout: 10000 });
  const pending = new Map();
  let sequence = 0;
  let rootSession;
  let closed = false;
  socket.on('message', bytes => {
    const message = JSON.parse(bytes.toString());
    if (message.method === 'Target.attachedToTarget' && !message.sessionId && message.params?.targetInfo?.type === 'page') {
      rootSession = message.params.sessionId;
    }
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    clearTimeout(entry.timer);
    if (message.error) entry.reject(new Error(message.error.message || 'CDP command failed'));
    else entry.resolve(message.result);
  });
  socket.on('error', () => {});
  socket.on('close', () => {
    closed = true;
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(new Error('CDP connection closed'));
    }
    pending.clear();
  });
  await deadline(new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  }), 'Raw CDP connection', 12000);
  return {
    async session() { return until('Root CDP session', () => rootSession, 10000); },
    command(method, params = {}, sessionId) {
      if (closed || socket.readyState !== WebSocket.OPEN) return Promise.reject(new Error('CDP socket is not open'));
      const id = ++sequence;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`${method}: timeout`));
        }, 10000);
        pending.set(id, { resolve, reject, timer });
        socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
      });
    },
    async close() {
      if (closed) return;
      const done = new Promise(resolve => socket.once('close', resolve));
      socket.close();
      try { await deadline(done, 'Close raw CDP transport', 2000); }
      catch { socket.terminate(); }
    },
  };
}

function documentHtml(documentTitle, body) {
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>${documentTitle}</title>
    <style>body{font:16px system-ui;max-width:1050px;margin:32px auto;padding:0 20px;color:#17212f;background:#f7f9fc}input,button{font:inherit;padding:8px}iframe{width:100%;height:150px;border:1px solid #8292aa}p{line-height:1.55;overflow-wrap:anywhere}output{display:block;padding:12px;background:#e2f2e8}</style>
    <body>${body}</body></html>`;
}
function fixtureResponse(request, response) {
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
  if (pathname === `${routePrefix}/start`) {
    response.end(documentHtml(title, `<h1>Playwright Direct live acceptance</h1>
      <p id="first-marker">FULL_DOCUMENT_START_${runId}</p>
      <label>Name <input id="name" aria-label="Name"></label><button id="apply">Apply</button><output id="result">Waiting</output>
      <iframe title="Local fixture frame" src="${routePrefix}/frame"></iframe>
      <script>document.getElementById('apply').onclick=()=>{document.getElementById('result').textContent='Accepted: '+document.getElementById('name').value}</script>
      ${paragraphs.map(text => `<p>${text}</p>`).join('\n')}
      <p id="last-marker">FULL_DOCUMENT_END_${runId}</p>`));
  } else if (pathname === `${routePrefix}/frame`) {
    response.end(documentHtml('Ordinary same-origin iframe', `<label>Frame input <input aria-label="Frame input"></label><button>Confirm frame</button><output>Frame waiting</output>
      <script>document.querySelector('button').onclick=()=>{document.querySelector('output').textContent='Frame accepted: '+document.querySelector('input').value}</script>`));
  } else if (pathname === `${routePrefix}/next`) {
    response.end(documentHtml(nextTitle, `<h1 id="navigation-result">Navigation and reload ${runId}</h1>`));
  } else {
    response.writeHead(404).end('Unknown fixture route');
  }
}
async function connectFixture() {
  browser = await chromium.connectOverCDP(`${bridgeWs}/cdp/tab/${tabId}`, { headers, timeout: 15000, noDefaults: true });
  assert.equal(browser.contexts().length, 1, 'Expected the existing browser context');
  const pages = browser.contexts()[0].pages();
  assert.equal(pages.length, 1, 'Expected exactly the selected fixture page');
  const page = pages[0];
  assert(page.url().startsWith(fixtureBase), 'Connected page is not the local test fixture');
  page.setDefaultTimeout(10000);
  page.setDefaultNavigationTimeout(12000);
  return page;
}
async function closeFixture() {
  if (!fixtureBase || fixtureClosed) return;
  const tabs = await inventory();
  if (!tabId) tabId = tabs.find(tab => tab.url.startsWith(fixtureBase))?.tabId;
  if (!tabId) { fixtureClosed = true; return; }
  const matching = tabs.find(tab => tab.tabId === tabId);
  if (!matching) { fixtureClosed = true; return; }
  assert(matching.url.startsWith(fixtureBase), 'Refusing to close a tab that is no longer the fixture');
  let connection;
  try {
    connection = await rawConnection(`${bridgeWs}/cdp/tab/${tabId}`);
    const sessionId = await connection.session();
    // Target.closeTarget is deliberately blocked by this bridge. Page.close
    // closes this one local test page; a transport close before its reply is OK.
    await connection.command('Page.close', {}, sessionId).catch(() => {});
  } finally { await connection?.close(); }
  await until('Fixture tab cleanup', async () => !(await inventory()).some(tab => tab.tabId === tabId), 10000);
  fixtureClosed = true;
}

let failed;
try {
  await mkdir(outputDirectory, { recursive: true });
  await step('start local fixture server', async () => {
    server = createServer(fixtureResponse);
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    fixtureBase = `http://127.0.0.1:${server.address().port}${routePrefix}`;
  });
  await step('create a fixture tab through the existing extension', async () => {
    creationConnection = await rawConnection(`${bridgeWs}/cdp/direct`);
    await creationConnection.command('Target.createTarget', { url: `${fixtureBase}/start`, background: true });
    // Inventory resolves the browser's numeric tab id even if createTarget
    // correctly returns a native opaque CDP target id in a newer bridge.
    tabId = (await until('Fixture tab inventory', async () =>
      (await inventory()).find(tab => tab.url === `${fixtureBase}/start`))).tabId;
    await creationConnection.close();
    creationConnection = undefined;
  });
  let page;
  await step('connect to the selected fixture tab', async () => { page = await connectFixture(); });
  await step('page.title returns the exact document title', async () => { assert.equal(await page.title(), title); });
  await step('page.evaluate returns 42', async () => { assert.equal(await page.evaluate(() => 21 * 2), 42); });
  await step('read every paragraph of the full long document', async () => {
    const text = await page.locator('body').innerText();
    assert(text.includes(`FULL_DOCUMENT_START_${runId}`), 'Missing start marker');
    assert(text.includes(`FULL_DOCUMENT_END_${runId}`), 'Missing end marker');
    let previous = -1;
    for (const paragraph of paragraphs) {
      const position = text.indexOf(paragraph);
      assert(position > previous, 'A full paragraph is missing, truncated, or reordered');
      previous = position;
    }
    assert(text.length > 50000, 'Long document was unexpectedly short');
  });
  await step('locator fill and click update the local form', async () => {
    await page.getByLabel('Name', { exact: true }).fill('Codex 本地验证');
    await page.getByRole('button', { name: 'Apply', exact: true }).click();
    assert.equal(await page.locator('#result').innerText(), 'Accepted: Codex 本地验证');
  });
  await step('ordinary iframe supports fill and click', async () => {
    const frame = page.frameLocator('iframe[title="Local fixture frame"]');
    await frame.getByLabel('Frame input', { exact: true }).fill('iframe 42');
    await frame.getByRole('button', { name: 'Confirm frame', exact: true }).click();
    assert.equal(await frame.locator('output').innerText(), 'Frame accepted: iframe 42');
  });
  await step('capture a PNG screenshot of only the fixture', async () => {
    await page.evaluate(() => window.scrollTo(0, 0));
    const bytes = await page.screenshot({ path: path.join(outputDirectory, 'playwright-direct-live.png'), fullPage: false, timeout: 10000 });
    assert(bytes.length > 1000, 'Screenshot is empty');
    assert(bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), 'Screenshot is not a PNG');
  });
  await step('navigate to a second fixture document', async () => {
    await page.goto(`${fixtureBase}/next`, { waitUntil: 'load' });
    assert.equal(await page.title(), nextTitle);
    assert.equal(await page.locator('#navigation-result').innerText(), `Navigation and reload ${runId}`);
  });
  await step('reload preserves a usable execution context', async () => {
    await page.reload({ waitUntil: 'load' });
    assert.equal(await page.title(), nextTitle);
    assert.equal(await page.evaluate(() => 6 * 7), 42);
  });
  await step('disconnect without closing the fixture tab', async () => {
    await browser.close();
    browser = undefined;
    assert((await inventory()).some(tab => tab.tabId === tabId), 'Disconnect closed the fixture tab');
  });
  await step('reconnect and use the existing page again', async () => {
    page = await connectFixture();
    assert.equal(await page.title(), nextTitle);
    assert.equal(await page.evaluate(() => 21 * 2), 42);
    assert.equal(await page.locator('#navigation-result').innerText(), `Navigation and reload ${runId}`);
    await browser.close();
    browser = undefined;
  }, 20000);
} catch (error) {
  failed = error;
} finally {
  try { await deadline(creationConnection?.close() ?? Promise.resolve(), 'Creation transport cleanup', 3000); }
  catch (error) { failed ||= error; }
  try { await deadline(browser?.close() ?? Promise.resolve(), 'Playwright transport cleanup', 5000); }
  catch (error) { failed ||= error; }
  try { await deadline(closeFixture(), 'Close only the fixture tab', 25000); }
  catch (error) { failed ||= error; }
  if (server) {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}
if (failed) {
  // Never print credentials, websocket headers, or an existing page's contents.
  console.error(`FAIL ${String(failed.message || failed).split(token).join('<redacted>')}`);
  console.error(`Completed ${steps.length} checks; fixture cleanup ${fixtureClosed ? 'confirmed' : 'not confirmed'}.`);
  process.exitCode = 1;
} else {
  console.log(`PASS fixture tab cleanup`);
  console.log(JSON.stringify({ status: 'passed', checks: steps, fixtureClosed, screenshot: path.join(outputDirectory, 'playwright-direct-live.png') }, null, 2));
}
