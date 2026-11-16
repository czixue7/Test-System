// Shared by the client and service desk. Ancestry tracks edits without trusting device clocks.
export interface APIProfile {
  id: string;
  name: string;
  apiKey: string;
  apiModel: string;
  apiEndpoint: string;
  apiProvider: string;
  apiPassword: string;
  concurrency?: number;
}
export const DEFAULT_API_CONCURRENCY = 2;
export const MAX_API_CONCURRENCY = 32;
export const validAPIConcurrency = (value: unknown): value is number => Number.isInteger(value) && Number(value) >= 1 && Number(value) <= MAX_API_CONCURRENCY;
export const apiConcurrency = (value: unknown): number => validAPIConcurrency(value) ? value : DEFAULT_API_CONCURRENCY;
export type ProfileValue = Omit<APIProfile, 'id'>;
export interface APIConfigEntry {
  id: string;
  version: string;
  ancestors: string[];
  value: ProfileValue | null;
}
export interface APIConfigDocument { schema: 1; entries: APIConfigEntry[] }
export const emptyAPIConfig = (): APIConfigDocument => ({ schema: 1, entries: [] });
const fields = ['name', 'apiKey', 'apiModel', 'apiEndpoint', 'apiProvider', 'apiPassword'] as const;
const identifier = (v: unknown): v is string => typeof v === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(v);
export function validateAPIConfig(value: unknown): asserts value is APIConfigDocument {
  const doc = value as APIConfigDocument;
  if (!doc || doc.schema !== 1 || !Array.isArray(doc.entries) || doc.entries.length > 1000)
    throw new Error('API 配置数据格式无效');
  const ids = new Set<string>();
  for (const entry of doc.entries) {
    if (!entry || !identifier(entry.id) || !identifier(entry.version) || ids.has(entry.id) ||
      !Array.isArray(entry.ancestors) || entry.ancestors.length > 10000 ||
      !entry.ancestors.every(identifier) || entry.ancestors.includes(entry.version) ||
      (entry.value !== null && (!entry.value || fields.some(key => typeof entry.value![key] !== 'string' || entry.value![key].length > 16384) ||
        (entry.value.concurrency !== undefined && !validAPIConcurrency(entry.value.concurrency)))))
      throw new Error('API 配置数据格式无效');
    ids.add(entry.id);
  }
}
const cleanValue = (value: ProfileValue): ProfileValue => ({ ...Object.fromEntries(fields.map(key => [key, value[key]])), concurrency: apiConcurrency(value.concurrency) }) as unknown as ProfileValue;
const equal = (a: ProfileValue | null, b: ProfileValue | null) => JSON.stringify(a && cleanValue(a)) === JSON.stringify(b && cleanValue(b));
const compare = (a: string, b: string) => a === b ? 0 : a < b ? -1 : 1;
const sorted = (entries: Iterable<APIConfigEntry>): APIConfigDocument => ({ schema: 1, entries: [...entries].map(entry => ({ ...entry, value: entry.value && cleanValue(entry.value) })).sort((a, b) => compare(a.id, b.id)) });
export function profilesFromAPIConfig(doc: APIConfigDocument): APIProfile[] {
  return doc.entries.filter(entry => entry.value !== null).map(entry => ({ id: entry.id, ...cleanValue(entry.value!) }));
}
// Deletions retain only version metadata, never the removed key or password.
export function editAPIConfig(doc: APIConfigDocument, profiles: APIProfile[]): APIConfigDocument {
  validateAPIConfig(doc);
  const entries = new Map(doc.entries.map(entry => [entry.id, entry]));
  const values = new Map(profiles.map(profile => [profile.id, cleanValue(profile)]));
  for (const id of new Set([...entries.keys(), ...values.keys()])) {
    const old = entries.get(id);
    const value = values.get(id) ?? null;
    if (old && equal(old.value, value)) continue;
    entries.set(id, { id, version: crypto.randomUUID(), ancestors: old ? [...new Set([...old.ancestors, old.version])].sort() : [], value });
  }
  const next = sorted(entries.values());
  validateAPIConfig(next);
  return next;
}
export function mergeAPIConfig(local: APIConfigDocument, remote: APIConfigDocument | null): APIConfigDocument {
  validateAPIConfig(local);
  if (!remote) return sorted(local.entries);
  validateAPIConfig(remote);
  const entries = new Map<string, APIConfigEntry>();
  const copies: APIConfigEntry[] = [];
  for (const entry of [...local.entries, ...remote.entries]) {
    const old = entries.get(entry.id);
    if (!old) { entries.set(entry.id, entry); continue; }
    if (old.version === entry.version && !equal(old.value, entry.value))
      throw new Error('API 配置版本内容不一致，请检查同步存储');
    if (old.ancestors.includes(entry.version)) continue;
    if (entry.ancestors.includes(old.version)) { entries.set(entry.id, entry); continue; }
    // Concurrent edit/delete keeps the edit; concurrent distinct edits keep both values.
    const [winner, other] = [old, entry].sort((a, b) =>
      Number(b.value !== null) - Number(a.value !== null) || compare(a.version, b.version));
    if (winner.value && other.value && !equal(winner.value, other.value)) {
      copies.push({ ...other, id: `conflict-${other.version}`, value: { ...other.value, name: `${other.value.name}（冲突副本）` } });
    }
    entries.set(entry.id, { ...winner, ancestors: [...new Set([...old.ancestors, ...entry.ancestors, old.version, entry.version])].filter(version => version !== winner.version).sort() });
  }
  // Existing edited/deleted conflict copies take precedence over recreating an old copy.
  for (const copy of copies) if (!entries.has(copy.id)) entries.set(copy.id, copy);
  const next = sorted(entries.values());
  validateAPIConfig(next);
  return next;
}
