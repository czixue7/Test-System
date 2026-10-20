import { serializeDebugValue, sensitiveDebugKey } from './debugValues';

export type DebugStorageKind = 'local' | 'session' | 'cookie';
function browserStorage(kind: 'local' | 'session'): Storage {
  return kind === 'local' ? globalThis.localStorage : globalThis.sessionStorage;
}
export function debugStorageAvailable(kind: DebugStorageKind): string | null {
  try {
    if (kind === 'cookie') return location.protocol === 'file:' ? '本地文件页面不支持持久 Cookie。' : null;
    void browserStorage(kind).length;
    return null;
  } catch { return '当前环境不允许访问此页面存储。'; }
}
const decode = (value: string) => { try { return decodeURIComponent(value); } catch { return value; } };
export function debugStorageEntries(kind: DebugStorageKind): Array<{ key: string; raw: string; preview: string }> {
  const pairs: Array<[string, string]> = [];
  try {
    if (kind === 'cookie') {
      for (const part of document.cookie.split(';').filter(Boolean)) {
        const split = part.indexOf('='); if (split < 0) continue;
        pairs.push([decode(part.slice(0, split).trim()), decode(part.slice(split + 1))]);
      }
    } else {
      const storage = browserStorage(kind);
      for (let index = 0; index < storage.length; index++) {
        const key = storage.key(index); if (key === null) continue;
        const value = storage.getItem(key); if (value !== null) pairs.push([key, value]);
      }
    }
  } catch {}
  return pairs.map(([key, raw]) => {
    let value: unknown = raw; try { value = JSON.parse(raw); } catch {}
    return { key, raw, preview: sensitiveDebugKey.test(key) ? '•••' : serializeDebugValue(value) };
  }).sort((a, b) => a.key.localeCompare(b.key));
}
export function writeDebugStorage(kind: DebugStorageKind, key: string, value: string | null): void {
  if (!key.trim()) throw new Error('请输入存储名称');
  const unavailable = debugStorageAvailable(kind); if (unavailable) throw new Error(unavailable);
  if (kind !== 'cookie') {
    const storage = browserStorage(kind);
    if (value === null) storage.removeItem(key); else storage.setItem(key, value);
    return;
  }
  document.cookie = `${encodeURIComponent(key)}=${encodeURIComponent(value || '')}; Path=/; SameSite=Lax${value === null ? '; Max-Age=0' : ''}`;
  const after = debugStorageEntries(kind).find(entry => entry.key === key);
  if (value !== null && after?.raw !== value) throw new Error('浏览器未保存 Cookie，可能已禁止此来源的 Cookie');
  if (value === null && after) throw new Error('Cookie 未删除，可能属于其他路径');
}
// Resolve storage on use so disabled/unavailable storage cannot block app startup.
export function createDebugStorageFacade(kind: 'local' | 'session'): Storage {
  return new Proxy(Object.create(null), {
    get: (_target, key) => {
      if (key === Symbol.toStringTag) return 'Storage';
      const storage = browserStorage(kind);
      if (key === 'length') return storage.length;
      if (typeof key !== 'string') return undefined;
      if (['getItem', 'setItem', 'removeItem', 'clear', 'key'].includes(key)) return (storage[key as 'getItem'] as Function).bind(storage);
      return storage.getItem(key) ?? undefined;
    },
    set: (_target, key, value) => { if (typeof key !== 'string') return false; browserStorage(kind).setItem(key, String(value)); return true; },
    deleteProperty: (_target, key) => { if (typeof key === 'string') browserStorage(kind).removeItem(key); return true; },
    has: (_target, key) => typeof key === 'string' && (['getItem', 'setItem', 'removeItem', 'clear', 'key', 'length'].includes(key) || browserStorage(kind).getItem(key) !== null),
    ownKeys: () => debugStorageEntries(kind).map(entry => entry.key),
    getOwnPropertyDescriptor: (_target, key) => typeof key === 'string' && browserStorage(kind).getItem(key) !== null ? { configurable: true, enumerable: true, writable: true, value: browserStorage(kind).getItem(key) } : undefined,
  }) as Storage;
}
