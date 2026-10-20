import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { snapshotDebugValue, serializeDebugValue } from '../src/utils/debugValues';
import { debugStorageAvailable, debugStorageEntries, writeDebugStorage } from '../src/utils/debugStorage';
import { evaluateDebugCommand } from '../src/utils/debugEvaluator';
import { startDebugCapture, stopDebugCapture, useDebugConsoleStore, executeDebugCommand, flushDebugLogs, clearDebugData } from '../src/utils/debugConsole';
import { BODY_LIMIT, debugBodyPreview } from '../src/utils/debugNetwork';
import { getDebugSystemInfo } from '../src/utils/debugSystem';
import { elementLabel, isInspectableElement, installElementPicker } from '../src/components/debug/ElementsPanel';
import ValueTree from '../src/components/debug/ValueTree';
import NetworkDetail from '../src/components/debug/NetworkDetail';

function memoryStorage() {
  const storage: Record<string, any> = {};
  Object.defineProperties(storage, {
    getItem: { value: (key: string) => typeof storage[key] === 'string' ? storage[key] : null },
    setItem: { value: (key: string, value: string) => { storage[key] = String(value); } },
    removeItem: { value: (key: string) => { delete storage[key]; } },
    clear: { value: () => { for (const key of Object.keys(storage)) delete storage[key]; } },
    key: { value: (index: number) => Object.keys(storage)[index] ?? null },
    length: { get: () => Object.keys(storage).length },
  }); return storage;
}
const local = memoryStorage(), session = memoryStorage();
local.setItem('formal-sentinel', 'keep'); session.setItem('formal-session', 'keep');
const listeners = new Map<string, Set<EventListener>>();
class FakeElement {
  tagName = 'BUTTON'; id = 'sample'; classList = ['sample']; isConnected = true;
  children: FakeElement[] = []; attributes = [{ name: 'id', value: 'sample' }]; parentElement = null;
  insideConsole = false;
  closest(_selector: string) { return this.insideConsole ? this : null; }
  getBoundingClientRect() { return { left: 10, top: 20, x: 10, y: 20, width: 100, height: 30 }; }
  get outerHTML() { return '<button id="sample">Example</button>'; }
}
const element = new FakeElement();
const cookies = new Map<string, string>();
const fakeDocument = {
  documentElement: { classList: { contains: () => false }, dataset: { theme: 'immersive' } },
  querySelector(selector: string) { if (selector === '[') throw new Error('invalid selector'); return selector === '#sample' ? element : null; },
  querySelectorAll(selector: string) { return selector === '*' || selector === '.sample' ? [element] : []; },
  addEventListener(type: string, listener: EventListener) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type)!.add(listener); },
  removeEventListener(type: string, listener: EventListener) { listeners.get(type)?.delete(listener); },
  get cookie() { return [...cookies].map(([key, value]) => key + '=' + value).join('; '); },
  set cookie(value: string) { const first = value.split(';')[0], index = first.indexOf('='), key = first.slice(0, index); if (value.includes('Max-Age=0')) cookies.delete(key); else cookies.set(key, first.slice(index + 1)); },
};
const windowListeners = new Map<string, Set<EventListener>>();
Object.assign(globalThis, {
  Element: FakeElement, localStorage: local, sessionStorage: session, document: fakeDocument,
  location: { protocol: 'https:', href: 'https://preview.test/index.html' }, screen: { width: 1080, height: 1920 },
  window: { innerWidth: 805, innerHeight: 871, devicePixelRatio: 1, location: { href: 'https://preview.test/index.html', pathname: '/profile', search: '', hash: '' },
    addEventListener(type: string, listener: EventListener) { if (!windowListeners.has(type)) windowListeners.set(type, new Set()); windowListeners.get(type)!.add(listener); },
    removeEventListener(type: string, listener: EventListener) { windowListeners.get(type)?.delete(listener); },
  },
});
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { userAgent: 'controlled-test', language: 'zh-CN', onLine: true, sendBeacon: (url: string) => !url.includes('reject') } });

class MockXHR extends EventTarget {
  status = 0; responseType = ''; responseText = ''; response: unknown = null; headers: Record<string, string> = {};
  open(..._args: unknown[]) { return 17; }
  setRequestHeader(name: string, value: string) { this.headers[name] = value; }
  getAllResponseHeaders() { return 'content-type: application/json\r\nx-test: ok'; }
  send(body?: string) {
    if (body === 'throw') throw new Error('sync-failure');
    if (body === 'pending') return 42;
    this.status = 200; this.responseText = '{"ok":true,"token":"xhr-secret"}'; this.response = { ok: true, token: 'xhr-secret' };
    this.dispatchEvent(new Event('loadend')); return 42;
  }
  abort() { this.status = 0; this.dispatchEvent(new Event('abort')); this.dispatchEvent(new Event('loadend')); }
}
Object.assign(globalThis, { XMLHttpRequest: MockXHR });
const nativeXHR = { open: MockXHR.prototype.open, send: MockXHR.prototype.send, header: MockXHR.prototype.setRequestHeader };
const nativeBeacon = navigator.sendBeacon;
let forwardedInput: unknown, forwardedInit: unknown;
const originalFetch: typeof fetch = async (input, init) => {
  forwardedInput = input; forwardedInit = init;
  const url = String(input instanceof Request ? input.url : input);
  if (url.includes('large')) return new Response('x'.repeat(BODY_LIMIT + 2000), { headers: { 'content-type': 'text/plain' } });
  if (url.includes('sse')) return new Response('data: example', { headers: { 'content-type': 'text/event-stream' } });
  if (url.includes('binary')) return new Response(new Uint8Array([1, 2]), { headers: { 'content-type': 'application/octet-stream' } });
  return new Response('{"ok":true,"token":"response-secret","nested":{"value":42}}', { status: 201, headers: { 'content-type': 'application/json', 'x-test': 'yes' } });
};
globalThis.fetch = originalFetch;
async function until(check: () => boolean) { for (let i = 0; i < 100; i++) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 5)); } assert.fail('asynchronous capture did not settle'); }

async function verify() {
  const cyclic: Record<string, unknown> = { number: 42, nested: { yes: true }, password: 'secret' }; cyclic.self = cyclic;
  Object.defineProperty(cyclic, 'computed', { enumerable: true, get() { throw new Error('do not execute getters'); } });
  const snapshot = snapshotDebugValue(cyclic);
  assert.equal(snapshot.children!.find(child => child.key === 'number')!.value.type, 'number');
  assert.equal(snapshot.children!.find(child => child.key === 'self')!.value.type, 'reference');
  assert.equal(snapshot.children!.find(child => child.key === 'computed')!.value.type, 'getter');
  assert.ok(!JSON.stringify(snapshot).includes('secret'));
  assert.equal(snapshotDebugValue(1n).type, 'bigint');
  assert.equal(snapshotDebugValue(new Set([1, 2])).children!.length, 2);
  assert.ok(!JSON.stringify(snapshotDebugValue(new Map([['token', 'map-secret']]))).includes('map-secret'));
  assert.equal(snapshotDebugValue(new Date('2026-10-19T00:00:00Z')).type, 'date');
  assert.ok(snapshotDebugValue(Object.fromEntries(Array.from({length:100},(_,i)=>[i,i]))).truncated);
  const html = renderToStaticMarkup(React.createElement(ValueTree, { node: snapshotDebugValue({ nested: { payload: '<script>bad()</script>' } }), initialOpen: true }));
  assert.ok(html.includes('debug-value-tree') && !html.includes('<script>'));

  for (const kind of ['local', 'session', 'cookie'] as const) {
    writeDebugStorage(kind, 'test-entry', '{"token":"private","count":1}');
    assert.ok(debugStorageEntries(kind).some(entry => entry.key === 'test-entry' && !entry.preview.includes('private')));
    writeDebugStorage(kind, 'test-entry', 'edited'); assert.equal(debugStorageEntries(kind).find(entry => entry.key === 'test-entry')!.raw, 'edited');
    writeDebugStorage(kind, 'test-entry', null); assert.ok(!debugStorageEntries(kind).some(entry => entry.key === 'test-entry'));
  }
  assert.equal(local.getItem('formal-sentinel'), 'keep'); assert.equal(session.getItem('formal-session'), 'keep');
  assert.ok(debugStorageEntries('local').some(entry => entry.key === 'formal-sentinel'));
  location.protocol = 'file:'; assert.ok(debugStorageAvailable('cookie')); assert.throws(() => writeDebugStorage('cookie', 'x', '1')); location.protocol = 'https:';
  assert.throws(() => writeDebugStorage('local', ' ', '1'));

  assert.equal(await evaluateDebugCommand('1 + 2', null), 3);
  assert.deepEqual(await evaluateDebugCommand('await Promise.resolve({ Capital: "CaseKept" })', null), { Capital: 'CaseKept' });
  assert.equal(await evaluateDebugCommand('const value = 6; return value * 7;', null), 42);
  assert.equal(await evaluateDebugCommand('$("#sample")', null), element);
  assert.equal(await evaluateDebugCommand('$$(".sample").length', null), 1);
  assert.equal(await evaluateDebugCommand('$0.id', element as unknown as Element), 'sample');
  await evaluateDebugCommand('localStorage.setItem("js-test", "saved"); sessionStorage.setItem("js-session", "saved");', null);
  assert.equal(local.getItem('js-test'), 'saved'); assert.equal(local.getItem('duty-page-preview:v1:js-test'), null);
  assert.equal(session.getItem('js-session'), 'saved'); assert.equal(session.getItem('duty-page-preview:v1:js-session'), null);
  assert.equal(await evaluateDebugCommand('localStorage.property = "scoped"; return localStorage.property;', null), 'scoped');
  assert.equal(local.getItem('property'), 'scoped');
  assert.ok((await evaluateDebugCommand('Object.keys(localStorage)', null) as string[]).includes('property'));
  await evaluateDebugCommand('delete localStorage.property', null); assert.equal(local.getItem('property'), null);
  await assert.rejects(evaluateDebugCommand('throw new Error("js failure")', null), /js failure/);
  await assert.rejects(evaluateDebugCommand('const =', null), SyntaxError);
  await executeDebugCommand('await Promise.reject(new Error("rejected"))', null);
  assert.equal(useDebugConsoleStore.getState().commands.at(-1)!.status, 'rejected');
  for (let i = 0; i < 55; i++) await executeDebugCommand(String(i), null);
  assert.equal(useDebugConsoleStore.getState().commands.length, 50);

  let picked: Element | null = null, hovered: Element | null = null, cancelled = false, prevented = 0;
  const cleanupPicker = installElementPicker({ select: node => { picked = node; }, hover: node => { hovered = node; }, cancel: () => { cancelled = true; } });
  const event = { target: element, preventDefault() { prevented++; }, stopImmediatePropagation() { prevented++; } } as unknown as Event;
  listeners.get('pointermove')!.forEach(listener => listener(event)); assert.equal(hovered, element);
  listeners.get('pointerdown')!.forEach(listener => listener(event)); assert.equal(prevented, 2);
  listeners.get('click')!.forEach(listener => listener(event)); assert.equal(picked, element);
  const ownElement = new FakeElement(); ownElement.insideConsole = true; assert.equal(isInspectableElement(ownElement), false);
  assert.equal(elementLabel(element as unknown as Element), 'button#sample.sample');
  listeners.get('keydown')!.forEach(listener => listener({ ...event, key: 'Escape' } as unknown as Event)); assert.ok(cancelled);
  cleanupPicker(); assert.ok([...listeners.values()].every(set => set.size === 0));
  const system = getDebugSystemInfo(); assert.equal(system.路由, '/profile'); assert.equal(system.DOM元素, 1); assert.ok('JS内存' in system && '资源' in system);

  const silent = console.log; console.log = () => undefined;
  try {
    startDebugCapture(); clearDebugData('network');
    const init = { method: 'POST', headers: { Authorization: 'Bearer request-secret', 'content-type': 'application/json' }, body: '{"password":"body-secret","value":1}', signal: new AbortController().signal };
    const response = await fetch('https://preview.test/api?token=query-secret&x=1', init);
    assert.equal(forwardedInit, init); assert.equal(response.bodyUsed, false);
    assert.ok((await response.text()).includes('response-secret'), 'caller retains the complete original response');
    await until(() => !!useDebugConsoleStore.getState().requests.at(-1)?.responseBody);
    const request = useDebugConsoleStore.getState().requests.at(-1)!;
    assert.equal(request.status, 201); assert.equal(request.responseHeaders!['x-test'], 'yes');
    assert.equal(request.requestHeaders!.authorization, '•••'); assert.equal(request.query!.x[0], '1');
    assert.ok(!JSON.stringify(request).includes('query-secret') && !JSON.stringify(request).includes('body-secret') && !JSON.stringify(request).includes('response-secret'));
    assert.ok(request.responseBody!.includes('42'));
    const detail = renderToStaticMarkup(React.createElement(NetworkDetail, {request})); assert.ok(detail.includes('请求头') && detail.includes('参数') && detail.includes('响应'));
    const large = await fetch('https://preview.test/large'); assert.equal((await large.text()).length, BODY_LIMIT + 2000);
    await until(() => !!useDebugConsoleStore.getState().requests.at(-1)?.bodyNote);
    assert.ok(useDebugConsoleStore.getState().requests.at(-1)!.responseBody!.length <= BODY_LIMIT);
    const sse = await fetch('https://preview.test/sse'); assert.equal(await sse.text(), 'data: example'); assert.match(useDebugConsoleStore.getState().requests.at(-1)!.bodyNote!, /事件流/);
    await fetch('https://preview.test/binary'); assert.equal(useDebugConsoleStore.getState().requests.at(-1)!.responseBody, undefined);
    const input = new Request('https://preview.test/request', { method: 'POST', headers: { 'x-from-request': 'yes' }, body: 'request-object-body' });
    await fetch(input); assert.equal(forwardedInput, input);
    await until(() => useDebugConsoleStore.getState().requests.at(-1)?.requestBody === 'request-object-body');
    assert.equal(await input.text(), 'request-object-body');
    const xhr = new MockXHR(); assert.equal(xhr.open('POST', '/xhr'), 17); xhr.setRequestHeader('Authorization', 'Bearer xhr-private'); assert.equal(xhr.send('hello'), 42);
    const xhrRecord = useDebugConsoleStore.getState().requests.at(-1)!; assert.equal(xhrRecord.requestBody, 'hello'); assert.equal(xhrRecord.responseHeaders!['x-test'], 'ok'); assert.ok(!xhrRecord.responseBody!.includes('xhr-secret'));
    const jsonXHR = new MockXHR(); jsonXHR.open('GET', '/json-xhr'); jsonXHR.responseType = 'json'; jsonXHR.send(); assert.ok(useDebugConsoleStore.getState().requests.at(-1)!.responseBody!.includes('true'));
    const aborted = new MockXHR(); aborted.open('GET', '/abort'); aborted.send('pending'); aborted.abort(); assert.equal(useDebugConsoleStore.getState().requests.at(-1)!.error, '请求已取消');
    const throwing = new MockXHR(); throwing.open('POST', '/throw'); assert.throws(() => throwing.send('throw'), /sync-failure/);
    assert.equal(navigator.sendBeacon('/beacon', 'example'), true); assert.equal(useDebugConsoleStore.getState().requests.at(-1)!.source, 'beacon');
    assert.equal(navigator.sendBeacon('/reject', ''), false); assert.equal(useDebugConsoleStore.getState().requests.at(-1)!.status, 0);
    const form = new FormData(); form.append('token', 'form-private'); assert.ok(!debugBodyPreview(form).includes('form-private'));
    console.log(cyclic); flushDebugLogs(); assert.equal(useDebugConsoleStore.getState().logs.at(-1)!.values[0].type, 'object');
    cyclic.number = 99; assert.equal(useDebugConsoleStore.getState().logs.at(-1)!.values[0].children!.find(child => child.key === 'number')!.value.preview, '42');
  } finally { stopDebugCapture(); console.log = silent; }
  assert.equal(globalThis.fetch, originalFetch); assert.equal(MockXHR.prototype.open, nativeXHR.open); assert.equal(MockXHR.prototype.send, nativeXHR.send); assert.equal(MockXHR.prototype.setRequestHeader, nativeXHR.header); assert.equal(navigator.sendBeacon, nativeBeacon);
  assert.ok([...windowListeners.values()].every(set => set.size === 0));
  assert.ok(serializeDebugValue(new Error('stack check')).includes('stack check'));
  console.log('PASS: typed snapshots, JS/await/errors/history bounds, current-origin storage CRUD/cookies, element picker cleanup, system info, detailed Fetch/XHR/Beacon capture, response consumption and body limits.');
}
verify().catch(error => { stopDebugCapture(); console.error(error); process.exitCode = 1; });
