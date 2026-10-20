import type { BankIndexItem } from '../types';
import { fetchRemoteBytes } from './remoteRepo';
import { assertSourceAvailable } from './dataSourceRequest';
import { sourcesFingerprint } from '../store/dataSourceStore';

export async function bankContentHash(bytes: Uint8Array, expectedSha: string): Promise<string> {
  const gitBlob = expectedSha.length === 40;
  const prefix = gitBlob ? new TextEncoder().encode(`blob ${bytes.byteLength}\0`) : new Uint8Array();
  const content = new Uint8Array(prefix.length + bytes.length);
  content.set(prefix); content.set(bytes, prefix.length);
  const digest = await crypto.subtle.digest(gitBlob ? 'SHA-1' : 'SHA-256', content);
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

/** Fetch exactly the selected version; only verified identical mirrors may substitute. */
export async function fetchBankContent(item: BankIndexItem) {
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(item.sha)) throw new Error('题库 hash 无效，请刷新列表');
  const fingerprint = sourcesFingerprint();
  const assertCurrent = () => { if (sourcesFingerprint() !== fingerprint) throw new Error('数据来源已修改，请刷新题库列表'); };
  let lastError: unknown;
  for (const location of [item, ...(item.mirrors ?? [])]) {
    assertCurrent();
    try {
      assertSourceAvailable(location.sourceId, location.downloadUrl);
      assertCurrent();
      const bytes = new Uint8Array(await fetchRemoteBytes(location.downloadUrl));
      assertSourceAvailable(location.sourceId, location.downloadUrl);
      if (await bankContentHash(bytes, item.sha) !== item.sha.toLowerCase()) throw new Error('题库 hash 校验失败，来源内容已变化，请刷新列表');
      assertCurrent();
      return { data: JSON.parse(new TextDecoder().decode(bytes)), location, assertCurrent };
    } catch (error) { lastError = error; }
  }
  throw lastError instanceof Error ? lastError : new Error('所选版本的题库来源均不可用');
}
