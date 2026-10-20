import type { BankIndexItem } from '../types';

export function bankTimestamp(value: unknown): number {
  if (typeof value === 'number' || (typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value))) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 && number < 8.64e15 ? (number < 1e11 ? number * 1000 : number) : 0;
  }
  const number = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(number) && number > 0 ? number : 0;
}

/** Explicit IDs distinguish unrelated same-name banks. Legacy catalogs use the file name. */
export function bankResourceId(item: { bankId?: string; filename: string }): string {
  if (item.bankId?.trim()) return item.bankId.trim();
  let filename = item.filename.replace(/^(?:service|repo):[^:]+:/, '').replace(/\\/g, '/');
  try { filename = decodeURIComponent(filename); } catch { /* Keep malformed legacy names scoped as-is. */ }
  return `bank:${filename.split('/').pop()}`;
}

function bundleHash(item: BankIndexItem): string {
  return JSON.stringify([item.sha.toLowerCase(), [...(item.images ?? [])].map(i => [i.filename, i.sha.toLowerCase()]).sort((a,b) => a[0].localeCompare(b[0]))]);
}

export function selectBankVersions(entries: Array<{ item: BankIndexItem; section: 'systemBanks' | 'userBanks' }>) {
  const groups = new Map<string, typeof entries>();
  for (const entry of entries) {
    const id = bankResourceId(entry.item);
    const group = groups.get(id) ?? [];
    group.push(entry);
    groups.set(id, group);
  }
  const output: { systemBanks: BankIndexItem[]; userBanks: BankIndexItem[] } = { systemBanks: [], userBanks: [] };
  for (const [bankId, group] of groups) {
    const versions = new Map<string, { entries: typeof entries; time: number }>();
    for (const entry of group) {
      const hash = bundleHash(entry.item), version = versions.get(hash) ?? { entries: [], time: 0 };
      version.entries.push(entry);
      version.time = Math.max(version.time, bankTimestamp(entry.item.updatedAt));
      versions.set(hash, version);
    }
    const newest = [...versions.values()].reduce((best, version) => version.time > best.time ? version : best);
    // Equal hashes share a version timestamp, while downloads keep source priority.
    const selected = newest.entries[0], time = newest.time;
    const item: BankIndexItem = {
      ...selected.item, bankId,
      updatedAt: time ? new Date(time).toISOString() : undefined,
      sourceAliases: [...new Set(group.flatMap(({ item }) => [item.filename, ...(item.sourceAliases ?? [])]))],
      mirrors: group.filter(entry => entry !== selected && bundleHash(entry.item) === bundleHash(selected.item))
        .map(({ item }) => ({ downloadUrl: item.downloadUrl, imagePath: item.imagePath, sourceId: item.sourceId, sourceName: item.sourceName })),
    };
    output[group.some(entry => entry.section === 'systemBanks') ? 'systemBanks' : 'userBanks'].push(item);
  }
  return output;
}

export function hasNewBankVersion(local: { sourceSha?: string; sourceUpdatedAt?: string }, remote: BankIndexItem): boolean {
  if (!local.sourceSha || !remote.sha || local.sourceSha.toLowerCase() === remote.sha.toLowerCase()) return false;
  const localTime = bankTimestamp(local.sourceUpdatedAt), remoteTime = bankTimestamp(remote.updatedAt);
  // An undated source cannot replace a known dated version. Never use local edit time.
  return !(localTime && (!remoteTime || remoteTime < localTime));
}
