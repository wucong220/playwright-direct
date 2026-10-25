import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

// The plugin is distributed as a bundle. Load only its protocol model, without
// starting the DSH host, opening sockets, or accessing an actual browser.
const host = readFileSync(new URL('../lib/host.js', import.meta.url), 'utf8');
const start = host.indexOf('// src/vendor/browser-model.js');
const end = host.indexOf('// src/pairing.js', start);
assert.ok(start >= 0 && end > start, 'BrowserModel bundle boundaries must exist');
const BrowserModel = new vm.Script(`${host.slice(start, end)}; BrowserModel;`)
  .runInNewContext({ Map, Set, Promise });

const TAB_ID = 123;
const NATIVE_ID = '0EB490D2EB25E51564A285425BCE2BDF';
const CHILD_ID = '1A8CB9F1C940EE56260DA04DB3B67B01';
const CHILD_SESSION = 'native-child-session';
const copy = value => JSON.parse(JSON.stringify(value));

function fixture({ browserContextId, beforeAttach } = {}) {
  const calls = [];
  const events = [];
  const targetInfo = {
    targetId: NATIVE_ID,
    type: 'page',
    title: 'Regression fixture',
    url: 'http://fixture.invalid/',
    attached: true,
    ...(browserContextId === undefined ? {} : { browserContextId }),
  };
  const model = new BrowserModel(async (method, params) => {
    calls.push({ method, params: copy(params) });
    if (method === 'chrome.debugger.attach') {
      await beforeAttach?.();
      return {};
    }
    if (method === 'chrome.debugger.sendCommand') {
      if (params[1] === 'Target.getTargetInfo') return { targetInfo: { ...targetInfo } };
      if (params[1] === 'Page.getFrameTree') {
        return { frameTree: { frame: { id: NATIVE_ID, url: targetInfo.url } } };
      }
      return { acknowledged: true };
    }
    return {};
  });
  model.primaryTabId = TAB_ID;
  model.onTabCreated({ id: TAB_ID, title: targetInfo.title, url: targetInfo.url });
  const unsubscribe = model.connectOverCDP(event => events.push(copy(event)));
  return { model, calls, events, unsubscribe };
}

test('announced target, root frame, and execution context keep the same native identity', async () => {
  const { model, events } = fixture();
  const attached = await model.attachTab(TAB_ID);
  const announcement = events.find(event => event.method === 'Target.attachedToTarget');
  assert.equal(announcement.params.targetInfo.targetId, NATIVE_ID);
  assert.ok(announcement.params.targetInfo.browserContextId, 'Playwright requires a nonempty browserContextId');
  assert.equal(attached.targetInfo.targetId, NATIVE_ID);

  const { frameTree } = await model.command('Page.getFrameTree', undefined, attached.sessionId);
  const context = { id: 7, name: '', auxData: { frameId: NATIVE_ID, isDefault: true } };
  model.onDebuggerEvent({ tabId: TAB_ID }, 'Runtime.executionContextCreated', { context });
  const runtimeEvent = events.at(-1);
  assert.equal(runtimeEvent.sessionId, attached.sessionId);
  assert.equal(runtimeEvent.params.context.auxData.frameId, frameTree.frame.id);
  assert.equal(frameTree.frame.id, announcement.params.targetInfo.targetId);
});

test('preserves an existing native browser context instead of replacing it', async () => {
  const { model, events } = fixture({ browserContextId: 'native-context-id' });
  await model.attachTab(TAB_ID);
  assert.equal(events[0].params.targetInfo.browserContextId, 'native-context-id');
  const { targetInfo } = await model.command('Target.getTargetInfo', { targetId: NATIVE_ID });
  assert.equal(targetInfo.browserContextId, 'native-context-id');
});

test('overlapping auto/manual attachment attaches and announces a target once', async () => {
  let release;
  const blocked = new Promise(resolve => { release = resolve; });
  const { model, calls, events } = fixture({ beforeAttach: () => blocked });
  const first = model.attachTab(TAB_ID);
  const second = model.attachTab(TAB_ID);
  const manual = model.command('Target.attachToTarget', { targetId: String(TAB_ID) });
  assert.equal(calls.filter(call => call.method === 'chrome.debugger.attach').length, 1);
  release();
  const [one, two, reply] = await Promise.all([first, second, manual]);
  assert.equal(one.sessionId, two.sessionId);
  assert.equal(reply.sessionId, one.sessionId);
  assert.equal(events.filter(event => event.method === 'Target.attachedToTarget').length, 1);
});

test('native target IDs route get, attach, discover, and activate to the original tab', async () => {
  const { model, calls, events } = fixture();
  const attached = await model.attachTab(TAB_ID);
  const activated = [];
  model.onActivateTab = async tabId => activated.push(tabId);
  for (const targetId of [NATIVE_ID, String(TAB_ID)]) {
    const result = await model.command('Target.getTargetInfo', { targetId });
    assert.equal(result.targetInfo.targetId, NATIVE_ID);
    const reply = await model.command('Target.attachToTarget', { targetId });
    assert.equal(reply.sessionId, attached.sessionId);
    await model.command('Target.activateTarget', { targetId });
  }
  assert.deepEqual(activated, [TAB_ID, TAB_ID]);
  assert.equal(calls.filter(call => call.method === 'chrome.debugger.attach').length, 1);
  assert.equal(events.filter(event => event.method === 'Target.attachedToTarget').length, 1);
  const { targetInfos } = await model.command('Target.getTargets');
  assert.deepEqual(targetInfos.map(info => info.targetId), [NATIVE_ID]);
  await model.command('Target.setDiscoverTargets', { discover: true });
  const created = events.filter(event => event.method === 'Target.targetCreated');
  assert.ok(created.length >= 1);
  assert.ok(created.every(event => event.params.targetInfo.targetId === NATIVE_ID));
  assert.equal((await model.command('Target.getTargetInfo')).targetInfo.targetId, NATIVE_ID);
  assert.equal((await model.command('Target.getTargetInfo', undefined, attached.sessionId)).targetInfo.targetId, NATIVE_ID);
});

test('rejects unknown native and numeric targets instead of silently using the primary tab', async () => {
  const { model, calls } = fixture();
  await model.attachTab(TAB_ID);
  model.onActivateTab = async () => assert.fail('unknown target must not activate a tab');
  const previousCalls = calls.length;
  for (const targetId of ['UNKNOWN-NATIVE-TARGET', '999999']) {
    for (const method of ['Target.getTargetInfo', 'Target.attachToTarget', 'Target.activateTarget']) {
      await assert.rejects(model.command(method, { targetId }), `${method} must reject ${targetId}`);
    }
  }
  assert.equal(calls.length, previousCalls, 'unknown targets must not reach the extension');
});

test('normalizes omitted command parameters and retains explicit parameters', async () => {
  const { model, calls } = fixture();
  const attached = await model.attachTab(TAB_ID);
  for (const params of [undefined, null]) {
    await model.command('Page.enable', params, attached.sessionId);
    assert.deepEqual(calls.at(-1), {
      method: 'chrome.debugger.sendCommand',
      params: [{ tabId: TAB_ID }, 'Page.enable', {}],
    });
  }
  const params = { expression: '21 * 2', returnByValue: true };
  await model.command('Runtime.evaluate', params, attached.sessionId);
  assert.deepEqual(calls.at(-1).params, [{ tabId: TAB_ID }, 'Runtime.evaluate', params]);
});

test('routes nested target commands and events through their native child session', async () => {
  const { model, calls, events } = fixture();
  const attached = await model.attachTab(TAB_ID);
  const child = {
    sessionId: CHILD_SESSION,
    targetInfo: { targetId: CHILD_ID, type: 'iframe', url: 'http://child.invalid/' },
    waitingForDebugger: true,
  };
  model.onDebuggerEvent({ tabId: TAB_ID }, 'Target.attachedToTarget', child);
  assert.equal(events.at(-1).sessionId, attached.sessionId);
  assert.deepEqual(events.at(-1).params, child);

  await model.command('Runtime.enable', undefined, CHILD_SESSION);
  assert.deepEqual(calls.at(-1), {
    method: 'chrome.debugger.sendCommand',
    params: [{ tabId: TAB_ID, sessionId: CHILD_SESSION }, 'Runtime.enable', {}],
  });
  const context = { id: 11, auxData: { frameId: CHILD_ID, isDefault: true } };
  model.onDebuggerEvent({ tabId: TAB_ID, sessionId: CHILD_SESSION }, 'Runtime.executionContextCreated', { context });
  assert.equal(events.at(-1).sessionId, CHILD_SESSION);
  assert.deepEqual(events.at(-1).params, { context });

  model.onDebuggerEvent({ tabId: TAB_ID }, 'Target.detachedFromTarget', { sessionId: CHILD_SESSION, targetId: CHILD_ID });
  await assert.rejects(model.command('Runtime.evaluate', { expression: '1' }, CHILD_SESSION));
});

test('forwards only owned tab events and stops forwarding after unsubscribe', async () => {
  const { model, events, unsubscribe } = fixture();
  await model.attachTab(TAB_ID);
  const before = events.length;
  model.onDebuggerEvent({ tabId: TAB_ID + 1 }, 'Page.loadEventFired', { timestamp: 1 });
  assert.equal(events.length, before);
  model.onDebuggerEvent({ tabId: TAB_ID }, 'Page.loadEventFired', { timestamp: 2 });
  assert.equal(events.length, before + 1);
  unsubscribe();
  model.onDebuggerEvent({ tabId: TAB_ID }, 'Page.loadEventFired', { timestamp: 3 });
  assert.equal(events.length, before + 1);
});

test('debugger detachment reports the native target identity', async () => {
  const { model, events } = fixture();
  const attached = await model.attachTab(TAB_ID);
  model.onDebuggerDetach({ tabId: TAB_ID });
  assert.deepEqual(events.at(-1), {
    method: 'Target.detachedFromTarget',
    params: { sessionId: attached.sessionId, targetId: NATIVE_ID },
  });
  await assert.rejects(model.command('Runtime.evaluate', { expression: '1' }, attached.sessionId));
});

test('direct websocket subscribes before attach, forwards events and replies, then removes its listener', async () => {
  const methodStart = host.indexOf('  acceptDirect(direct, ws) {');
  const methodEnd = host.indexOf('  acceptCDP(', methodStart);
  assert.ok(methodStart >= 0 && methodEnd > methodStart, 'acceptDirect bundle boundaries must exist');
  const { acceptDirect } = new vm.Script(`({ ${host.slice(methodStart, methodEnd)} })`)
    .runInNewContext({ WebSocket: { OPEN: 1 }, Promise });
  const { model } = fixture();
  const sent = [];
  const bridge = new EventEmitter();
  bridge.request = async () => ({});
  const ws = new EventEmitter();
  ws.readyState = 1;
  ws.send = raw => sent.push(JSON.parse(raw));
  ws.close = () => { ws.readyState = 3; ws.emit('close'); };
  const profile = { ws: { readyState: 1 } };
  const direct = { model, profile, tabId: TAB_ID, attached: () => model.attachTab(TAB_ID) };
  acceptDirect.call(bridge, direct, ws);
  await new Promise(setImmediate);
  const attached = sent.find(message => message.method === 'Target.attachedToTarget');
  assert.ok(attached, 'the initial attach event must reach the websocket');
  assert.equal(attached.params.targetInfo.targetId, NATIVE_ID);

  const count = sent.length;
  const context = { id: 3, auxData: { frameId: NATIVE_ID, isDefault: true } };
  bridge.emit('debuggerEvent', {}, { tabId: TAB_ID }, 'Runtime.executionContextCreated', { context });
  bridge.emit('debuggerEvent', profile, { tabId: TAB_ID + 1 }, 'Runtime.executionContextCreated', { context });
  assert.equal(sent.length, count);
  bridge.emit('debuggerEvent', profile, { tabId: TAB_ID }, 'Runtime.executionContextCreated', { context });
  assert.equal(sent.at(-1).sessionId, attached.params.sessionId);
  assert.deepEqual(sent.at(-1).params, { context });

  ws.emit('message', Buffer.from(JSON.stringify({
    id: 42, method: 'Runtime.evaluate', params: { expression: '21 * 2' }, sessionId: attached.params.sessionId,
  })));
  await new Promise(setImmediate);
  assert.deepEqual(sent.at(-1), { id: 42, sessionId: attached.params.sessionId, result: { acknowledged: true } });
  ws.close();
  assert.equal(bridge.listenerCount('debuggerEvent'), 0);
});
