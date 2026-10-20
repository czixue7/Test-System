export interface DebugValue {
  type: string; preview: string; children?: Array<{ key: string; value: DebugValue }>; truncated?: boolean;
}
export const sensitiveDebugKey = /api[\s_-]?key|token|password|secret|authorization|cookie/i;
export function redactText(text: string): string {
  return text.replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer •••')
    .replace(/((?:api[\s_-]?key|password|token|secret|authorization)["']?\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;}]+)/gi, '$1"•••"');
}
export function snapshotDebugValue(value: unknown): DebugValue {
  const seen = new WeakSet<object>(); let budget = 256;
  const visit = (item: unknown, depth: number): DebugValue => {
    if (--budget < 0) return { type: 'limit', preview: '[节点数量已截断]' };
    if (item === null) return { type: 'null', preview: 'null' };
    if (item === undefined) return { type: 'undefined', preview: 'undefined' };
    const type = typeof item;
    if (type !== 'object') return { type, preview: type === 'string' ? redactText(String(item).slice(0, 8000)) : String(item).slice(0, 1000) };
    const object = item as object;
    if (seen.has(object)) return { type: 'reference', preview: '[Circular]' };
    seen.add(object);
    if (typeof Element !== 'undefined' && item instanceof Element) return { type: 'element', preview: `<${item.tagName.toLowerCase()}${item.id ? ` id="${item.id}"` : ''}>` };
    if (item instanceof Date) return { type: 'date', preview: Number.isNaN(item.getTime()) ? 'Invalid Date' : item.toISOString() };
    if (item instanceof RegExp) return { type: 'regexp', preview: String(item) };
    let kind = Array.isArray(item) ? 'array' : item instanceof Error ? 'error' : item instanceof Map ? 'map' : item instanceof Set ? 'set' : 'object';
    const preview = kind === 'array' ? `Array(${(item as unknown[]).length})` : kind === 'map' ? `Map(${(item as Map<unknown, unknown>).size})` : kind === 'set' ? `Set(${(item as Set<unknown>).size})` : item instanceof Error ? redactText(`${item.name}: ${item.message}`) : 'Object';
    if (depth >= 6) return { type: kind, preview: preview + ' […]', truncated: true };
    let entries: Array<[string, PropertyDescriptor]>;
    if (item instanceof Map) {
      entries = []; for (const [key, val] of item) { if (entries.length >= 41) break; entries.push([typeof key === 'string' ? key : String(entries.length), { value: typeof key === 'string' ? val : { key, value: val } }]); }
    }
    else if (item instanceof Set) { entries = []; for (const val of item) { if (entries.length >= 41) break; entries.push([String(entries.length), { value: val }]); } }
    else entries = Reflect.ownKeys(object).filter(key => key !== 'length').slice(0, 41).map(key => [String(key), Object.getOwnPropertyDescriptor(object, key)!]);
    const children = entries.slice(0, 40).map(([key, descriptor]) => ({ key, value: sensitiveDebugKey.test(key) ? { type: 'redacted', preview: '•••' } : 'value' in descriptor ? visit(descriptor.value, depth + 1) : { type: 'getter', preview: '[Getter]' } }));
    if (entries.length > 40 || budget <= 0) children.push({ key: '…', value: { type: 'limit', preview: '[更多属性已截断]' } });
    return { type: kind, preview, children, truncated: entries.length > 40 || budget <= 0 };
  };
  try { return visit(value, 0); } catch { return { type: 'unknown', preview: '[无法展开的值]' }; }
}
export function debugValueToPlain(node: DebugValue): unknown {
  if (!node.children) return node.preview;
  return Object.fromEntries(node.children.map(child => [child.key, debugValueToPlain(child.value)]));
}
export function serializeDebugValue(value: unknown): string {
  const node = snapshotDebugValue(value);
  return (node.children ? JSON.stringify(debugValueToPlain(node), null, 2) : node.preview).slice(0, 16000);
}
export function sanitizeDebugUrl(value: string): string {
  try {
    const url = new URL(value, typeof location === 'undefined' ? 'https://preview.invalid/' : location.href);
    for (const key of [...url.searchParams.keys()]) if (sensitiveDebugKey.test(key)) url.searchParams.set(key, '•••');
    if (url.username) url.username = '•••'; if (url.password) url.password = '•••';
    return url.href.slice(0, 3000);
  } catch { return redactText(value).slice(0, 3000); }
}
