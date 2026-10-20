import { redactText, sanitizeDebugUrl, sensitiveDebugKey } from './debugValues';

export const BODY_LIMIT = 64 * 1024;
export interface DebugRequest {
  id: number; time: number; method: string; url: string; source: 'fetch' | 'xhr' | 'beacon';
  status: number | null; duration: number; error?: string; query?: Record<string, string[]>;
  requestHeaders?: Record<string, string>; responseHeaders?: Record<string, string>;
  requestBody?: string; responseBody?: string; bodyNote?: string;
}
export function debugHeaders(input?: HeadersInit): Record<string, string> {
  const result: Record<string, string> = Object.create(null);
  try { let count = 0; new Headers(input).forEach((value, key) => { if (count++ < 80) result[key] = sensitiveDebugKey.test(key) ? '•••' : redactText(value.slice(0, 2000)); }); } catch {}
  return result;
}
export function debugQuery(url: string): Record<string, string[]> {
  const query: Record<string, string[]> = Object.create(null);
  try { new URL(sanitizeDebugUrl(url)).searchParams.forEach((value, key) => { (query[key] ||= []).push(value); }); } catch {}
  return query;
}
export function debugBodyText(text: string): string {
  const clipped = text.slice(0, BODY_LIMIT);
  try { return JSON.stringify(JSON.parse(clipped, (key, value) => sensitiveDebugKey.test(key) ? '•••' : typeof value === 'string' ? redactText(value) : value), null, 2).slice(0, BODY_LIMIT); }
  catch { return redactText(clipped) + (text.length > BODY_LIMIT ? '\n[正文已截断]' : ''); }
}
export function debugBodyPreview(body: unknown): string {
  if (body == null) return '';
  if (typeof body === 'string') return debugBodyText(body);
  if (body instanceof URLSearchParams) return JSON.stringify(debugQuery('https://preview.invalid/?' + body), null, 2);
  if (typeof FormData !== 'undefined' && body instanceof FormData) {
    const entries: Record<string, unknown[]> = Object.create(null);
    let count = 0;
    body.forEach((value, key) => { if (count++ < 40) (entries[key] ||= []).push(sensitiveDebugKey.test(key) ? '•••' : typeof value === 'string' ? redactText(value.slice(0, 2000)) : `[文件 ${value.name}, ${value.size} bytes]`); });
    return JSON.stringify(entries, null, 2).slice(0, BODY_LIMIT);
  }
  if (body instanceof Blob) return `[Blob ${body.type || 'binary'}, ${body.size} bytes]`;
  if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) return `[二进制 ${body.byteLength} bytes]`;
  return '[流式正文未读取]';
}

export function installDebugNetworkCapture(hooks: {
  add: (method: string, url: string, source: DebugRequest['source']) => DebugRequest | null;
  patch: (request: DebugRequest | null, patch: Partial<DebugRequest>) => void;
  active: () => boolean;
}): () => void {
  const cleanups: Array<() => void> = [], readers = new Set<() => void>();
  const patch = (request: DebugRequest | null, changes: Partial<DebugRequest>) => { if (request && hooks.active()) hooks.patch(request, changes); };
  const safe = (work: () => void) => { try { work(); } catch {} };
  const readClone = async (body: Response | Request): Promise<{ text: string; note: string }> => {
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let note = '', size = 0, text = '';
    const decoder = new TextDecoder();
    const cancel = () => { if (reader) void reader.cancel().catch(() => undefined); };
    try {
      reader = body.body?.getReader(); if (!reader) return { text: '', note: '' };
      readers.add(cancel);
      const timeout = new Promise<null>(resolve => { timer = setTimeout(() => { note = '读取超过 2 秒，正文仅显示已接收部分'; cancel(); resolve(null); }, 2000); });
      while (hooks.active()) {
        const chunk = await Promise.race([reader.read(), timeout]);
        if (!chunk || chunk.done) break;
        const bytes = chunk.value.subarray(0, BODY_LIMIT - size);
        text += decoder.decode(bytes, { stream: true }); size += bytes.length;
        if (size >= BODY_LIMIT) { note = '正文最多记录 64 KiB，超出部分已截断'; cancel(); break; }
      }
      text += decoder.decode();
      return { text: debugBodyText(text), note };
    } catch { return { text: debugBodyText(text), note: '正文不可读取或已中止' }; }
    finally { if (timer) clearTimeout(timer); readers.delete(cancel); }
  };
  const originalFetch = globalThis.fetch;
  if (typeof originalFetch === 'function') {
    const wrapped: typeof fetch = async (...args) => {
      const [input, init] = args;
      const isRequest = typeof Request !== 'undefined' && input instanceof Request;
      let request: DebugRequest | null = null;
      safe(() => {
        request = hooks.add(init?.method || (isRequest ? input.method : 'GET'), isRequest ? input.url : String(input), 'fetch');
        if (!request) return;
        patch(request, { requestHeaders: debugHeaders(init?.headers ?? (isRequest ? input.headers : undefined)), requestBody: debugBodyPreview(init?.body) });
        if (init?.body === undefined && isRequest && input.body && !input.bodyUsed) {
          if (/json|text|xml|javascript|urlencoded/i.test(input.headers.get('content-type') || '')) void readClone(input.clone()).then(body => patch(request, { requestBody: body.text }));
          else patch(request, { requestBody: '[Request 的流式或二进制正文未读取]' });
        }
      });
      const started = performance.now();
      try {
        const response = await Reflect.apply(originalFetch, globalThis, args);
        safe(() => {
          patch(request, { status: response.status, duration: Math.round(performance.now() - started), responseHeaders: debugHeaders(response.headers) });
          if (!request || !hooks.active()) return;
          const type = response.headers.get('content-type') || '';
          if (/event-stream/i.test(type)) patch(request, { bodyNote: '事件流持续传输，未读取正文' });
          else if (/json|text|xml|javascript|urlencoded/i.test(type)) {
            void readClone(response.clone()).then(body => patch(request, { responseBody: body.text, bodyNote: body.note }));
          } else patch(request, { bodyNote: `未读取二进制或未知类型正文（${type || '未声明 Content-Type'}）` });
        });
        return response;
      } catch (error) {
        patch(request, { status: 0, duration: Math.round(performance.now() - started), error: redactText(error instanceof Error ? error.message : String(error)) });
        throw error;
      }
    };
    globalThis.fetch = wrapped;
    cleanups.push(() => { if (globalThis.fetch === wrapped) globalThis.fetch = originalFetch; });
  }
  if (typeof XMLHttpRequest !== 'undefined') {
    const prototype = XMLHttpRequest.prototype, originalOpen = prototype.open, originalSend = prototype.send, originalHeader = prototype.setRequestHeader;
    const metadata = new WeakMap<XMLHttpRequest, { method: string; url: string; headers: Record<string, string> }>();
    const listeners = new Set<() => void>();
    const open = function(this: XMLHttpRequest, ...args: unknown[]) {
      const result = Reflect.apply(originalOpen, this, args);
      metadata.set(this, { method: String(args[0]), url: String(args[1]), headers: Object.create(null) }); return result;
    } as typeof prototype.open;
    const header = function(this: XMLHttpRequest, name: string, value: string) {
      const result = Reflect.apply(originalHeader, this, [name, value]);
      safe(() => { const info = metadata.get(this); if (info) { const key = name.toLowerCase(); info.headers[key] = sensitiveDebugKey.test(key) ? '•••' : redactText((info.headers[key] ? info.headers[key] + ', ' : '') + value); } }); return result;
    };
    const send = function(this: XMLHttpRequest, ...args: unknown[]) {
      const info = metadata.get(this); let request: DebugRequest | null = null;
      safe(() => { request = info ? hooks.add(info.method, info.url, 'xhr') : null; patch(request, { requestHeaders: info?.headers, requestBody: debugBodyPreview(args[0]) }); });
      const started = performance.now(); let failure = '';
      const failed = (event: Event) => { failure = event.type === 'abort' ? '请求已取消' : event.type === 'timeout' ? '请求超时' : '网络错误'; };
      const cleanup = () => { this.removeEventListener('loadend', done); ['abort', 'timeout', 'error'].forEach(name => this.removeEventListener(name, failed)); listeners.delete(cleanup); };
      const done = () => {
        cleanup();
        safe(() => {
          const responseHeaders: Record<string, string> = Object.create(null);
          (this.getAllResponseHeaders?.() || '').trim().split(/[\r\n]+/).forEach(line => { const index = line.indexOf(':'); if (index > 0) { const key = line.slice(0, index).toLowerCase(); responseHeaders[key] = sensitiveDebugKey.test(key) ? '•••' : redactText(line.slice(index + 1).trim()); } });
          let responseBody = '', bodyNote = '';
          if (this.responseType === 'json') responseBody = debugBodyText(JSON.stringify(this.response));
          else if (!this.responseType || this.responseType === 'text') responseBody = debugBodyText(this.responseText || '');
          else bodyNote = `未读取 ${this.responseType} 类型正文`;
          patch(request, { status: this.status, duration: Math.round(performance.now() - started), responseHeaders, responseBody, bodyNote, error: failure || (this.status ? undefined : '请求失败或已取消') });
        });
      };
      this.addEventListener('loadend', done); ['abort', 'timeout', 'error'].forEach(name => this.addEventListener(name, failed)); listeners.add(cleanup);
      try { return Reflect.apply(originalSend, this, args); }
      catch (error) { cleanup(); patch(request, { status: 0, duration: Math.round(performance.now() - started), error: redactText(String(error)) }); throw error; }
    } as typeof prototype.send;
    prototype.open = open; prototype.send = send; if (typeof originalHeader === 'function') prototype.setRequestHeader = header;
    cleanups.push(() => { listeners.forEach(cleanup => cleanup()); if (prototype.open === open) prototype.open = originalOpen; if (prototype.send === send) prototype.send = originalSend; if (prototype.setRequestHeader === header) prototype.setRequestHeader = originalHeader; });
  }
  if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
    const original = navigator.sendBeacon;
    const wrapped = (url: string | URL, body?: BodyInit | null) => {
      const result = Reflect.apply(original, navigator, [url, body]);
      safe(() => { const request = hooks.add('POST', String(url), 'beacon'); patch(request, { status: result ? 202 : 0, duration: 0, requestBody: debugBodyPreview(body), bodyNote: result ? '浏览器已接受发送，无法取得服务端状态及响应' : '浏览器未接受发送' }); }); return result;
    };
    try { navigator.sendBeacon = wrapped; cleanups.push(() => { if (navigator.sendBeacon === wrapped) navigator.sendBeacon = original; }); } catch {}
  }
  return () => { readers.forEach(cancel => cancel()); readers.clear(); cleanups.reverse().forEach(cleanup => cleanup()); };
}
