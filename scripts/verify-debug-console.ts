import assert from 'node:assert/strict';
import { createTriggerDrag, clampTrigger, type TriggerPoint } from '../src/utils/debugTriggerDrag';
import { useDebugConsoleStore, startDebugCapture, stopDebugCapture, flushDebugLogs, clearDebugData, serializeDebugValue, sanitizeDebugUrl, LOG_LIMIT, REQUEST_LIMIT } from '../src/utils/debugConsole';

const listeners = new Map<string, Set<EventListener>>();
Object.assign(globalThis, { window: {
  addEventListener(type: string, listener: EventListener) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type)!.add(listener); },
  removeEventListener(type: string, listener: EventListener) { listeners.get(type)?.delete(listener); },
} });
class MockXHR extends EventTarget {
  status = 0;
  open(..._args: unknown[]) {}
  send(body?: string) { if (body === 'throw') throw new Error('sync failure'); this.status = 204; this.dispatchEvent(new Event('loadend')); }
}
Object.assign(globalThis, { XMLHttpRequest: MockXHR });
const xhrOpen = MockXHR.prototype.open;
const xhrSend = MockXHR.prototype.send;
const nativeConsole = { log: console.log, info: console.info, warn: console.warn, error: console.error, debug: console.debug };
let nativeCalls = 0;
for (const level of Object.keys(nativeConsole) as Array<keyof typeof nativeConsole>) console[level] = () => { nativeCalls++; };
const silentConsole = { log: console.log, info: console.info, warn: console.warn, error: console.error, debug: console.debug };
let fetchCalls = 0;
let resolvePending: ((response: Response) => void) | null = null;
const response = new Response('ok', { status: 201 });
const abort = new Error('cancelled');
let lastInit: RequestInit | undefined;
const originalFetch: typeof fetch = async (input, init) => {
  fetchCalls++; lastInit = init;
  if (String(input).includes('abort')) throw abort;
  if (String(input).includes('pending')) return new Promise(resolve => { resolvePending = resolve; });
  return response;
};
globalThis.fetch = originalFetch;

async function verify() {
  try {
    let bounds = { left: 8, top: 8, right: 493, bottom: 863 };
    let point: TriggerPoint = { x: 430, y: 680 };
    const drag = createTriggerDrag(() => bounds, value => { point = value; });
    assert.equal(drag.start(1, 440, 690, point), true);
    assert.equal(drag.start(2, 440, 690, point), false, 'second finger cannot steal the drag');
    assert.equal(drag.move(2, 0, 0), false);
    assert.equal(drag.move(1, 442, 692), false, 'finger jitter remains a tap');
    drag.end(1);
    assert.equal(drag.click(), true);
    drag.start(3, 440, 690, point);
    drag.move(3, 300, 500);
    assert.deepEqual(point, { x: 290, y: 490 });
    drag.move(3, -100, -100);
    assert.deepEqual(point, { x: 8, y: 8 }, 'drag stays inside the screen');
    drag.move(3, 2000, 2000);
    assert.deepEqual(point, { x: 449, y: 819 });
    drag.end(3);
    drag.end(3, true); // lostpointercapture after pointerup must not change the result.
    assert.equal(drag.click(), false, 'release after dragging must not open the panel');
    drag.start(4, 100, 100, point);
    drag.move(4, 110, 100);
    drag.move(4, 100, 100);
    drag.end(4);
    assert.equal(drag.click(), false, 'returning to the origin is still a drag');
    drag.start(5, 100, 100, point);
    drag.end(5, true);
    assert.equal(drag.click(), false, 'cancelled touch must not open the panel');
    assert.equal(drag.click(true), true, 'keyboard activation remains available');
    bounds = { left: 8, top: 8, right: 313, bottom: 300 };
    assert.deepEqual(clampTrigger(point, bounds), { x: 269, y: 256 }, 'resize keeps the trigger reachable');
    startDebugCapture();
    assert.equal(useDebugConsoleStore.getState().open, false, 'enabling capture must leave the panel collapsed');
    const wrapped = console.log;
    useDebugConsoleStore.setState({ open: true });
    startDebugCapture();
    assert.equal(useDebugConsoleStore.getState().open, true, 'idempotent capture startup must preserve an explicitly opened panel');
    assert.equal(console.log, wrapped, 'enable must not install duplicate hooks');
    assert.equal(listeners.get('error')!.size, 1);
    for (let i = 0; i < LOG_LIMIT + 80; i++) console.log('entry', i);
    flushDebugLogs();
    assert.equal(useDebugConsoleStore.getState().logs.length, LOG_LIMIT);
    assert.equal(nativeCalls, LOG_LIMIT + 80);
    clearDebugData('logs');
    console.warn('repeat'); console.warn('repeat'); flushDebugLogs();
    assert.equal(useDebugConsoleStore.getState().logs[0].count, 2);
    useDebugConsoleStore.setState({ paused: true });
    console.error('not collected'); flushDebugLogs();
    assert.equal(useDebugConsoleStore.getState().logs.length, 1);
    useDebugConsoleStore.setState({ paused: false });
    const cyclic: Record<string, unknown> = { apiKey: 'sk-private', token: 'private-token' };
    cyclic.self = cyclic;
    Object.defineProperty(cyclic, 'getter', { enumerable: true, get() { throw new Error('getter must not execute'); } });
    const serialized = serializeDebugValue(cyclic);
    assert.ok(serialized.includes('[Circular]') && serialized.includes('[Getter]'));
    assert.ok(!serialized.includes('sk-private') && !serialized.includes('private-token'));
    assert.ok(!serializeDebugValue('{"apiKey":"secret-json"}').includes('secret-json'));
    assert.ok(!sanitizeDebugUrl('https://example.test/path?api_key=secret-url&x=1').includes('secret-url'));
    const init = { method: 'POST', signal: new AbortController().signal };
    assert.equal(await fetch('https://example.test/api?token=secret', init), response);
    assert.equal(lastInit, init, 'fetch must forward the original init and abort signal');
    assert.equal(useDebugConsoleStore.getState().requests[0].status, 201);
    assert.ok(!useDebugConsoleStore.getState().requests[0].url.includes('secret'));
    await assert.rejects(fetch('https://example.test/abort'), error => error === abort);
    assert.equal(useDebugConsoleStore.getState().requests.at(-1)!.status, 0);
    const xhr = new MockXHR(); xhr.open('GET', 'https://example.test/xhr'); xhr.send();
    assert.equal(useDebugConsoleStore.getState().requests.at(-1)!.source, 'xhr');
    assert.equal(useDebugConsoleStore.getState().requests.at(-1)!.status, 204);
    for (let i = 0; i < REQUEST_LIMIT + 10; i++) await fetch(`https://example.test/item/${i}`);
    assert.equal(useDebugConsoleStore.getState().requests.length, REQUEST_LIMIT);
    const pending = fetch('https://example.test/pending');
    clearDebugData('network');
    resolvePending!(response); await pending;
    assert.equal(useDebugConsoleStore.getState().requests.length, 0, 'cleared requests must not return after completion');
    const inFlight = fetch('https://example.test/pending');
    const finish = resolvePending!;
    stopDebugCapture();
    assert.equal(globalThis.fetch, originalFetch);
    assert.equal(console.log, silentConsole.log);
    assert.equal(MockXHR.prototype.open, xhrOpen);
    assert.equal(MockXHR.prototype.send, xhrSend);
    assert.equal(listeners.get('error')!.size, 0);
    assert.equal(listeners.get('unhandledrejection')!.size, 0);
    const count = useDebugConsoleStore.getState().requests.length;
    finish(response); await inFlight;
    assert.equal(useDebugConsoleStore.getState().requests.length, count, 'disabled capture must ignore in-flight completions');
    assert.ok(fetchCalls > 0);
    assert.equal(useDebugConsoleStore.getState().enabled, false);
  } finally {
    stopDebugCapture();
    Object.assign(console, nativeConsole);
  }
  console.log('PASS: bounded logs/requests, deduplication, pause, redaction, fetch/XHR behavior, in-flight cleanup and native hook restoration.');
}
verify().catch(error => { Object.assign(console, nativeConsole); console.error(error); process.exitCode = 1; });
