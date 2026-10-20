import { useQuestionBankStore } from "../store/questionBankStore";
import type { QuestionBank, BankIndexItem } from "../types";
import { isBuiltInBank } from "./builtInBanks";
import { canonicalJson } from "./dataSyncMerge";
import { getStoreValue, setStoreValue } from "./tauriStore";
import { sourceRequest, resolveSourceResource } from "./dataSourceRequest";
import { fetchRemoteBytes } from "./remoteRepo";
import { hydrateSourceBank } from "./dataSourceAssets";
import { convertJsonToBank } from "./jsonImporter";

export async function contentHash(content: string | Uint8Array): Promise<string> {
  const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content;
  const hash = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer);
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, "0")).join("");
}
const validId = (id: unknown): id is string => typeof id === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(id) && !isBuiltInBank(id);
const validHash = (hash: unknown): hash is string => typeof hash === "string" && /^[a-f0-9]{64}$/.test(hash);
function validateBank(bank: any, id: string): asserts bank is QuestionBank {
  if (!bank || bank.id !== id || !validId(id) || typeof bank.name !== "string" ||
      typeof bank.createdAt !== "string" || typeof bank.updatedAt !== "string" || !Array.isArray(bank.questions) ||
      !bank.questions.every((q: any) => q && typeof q.id === "string" && typeof q.type === "string" && typeof (q.question ?? q.content) === "string"))
    throw new Error("同步题库结构无效，未写入本机");
}
type Plan = {
  upload: { id: string; baseHash: string | null }[];
  download: { id: string; hash: string; conflict: boolean }[];
  published: BankIndexItem[];
};
/** One manifest first, then individual changed banks. Never infer deletions from absent IDs. */
export async function syncQuestionBanks(config: { url: string; token: string; space: string }, enabled: () => boolean) {
  const store = useQuestionBankStore;
  if (!store.getState().isLoaded) return;
  const key = `bank-sync-hashes:${encodeURIComponent(config.url)}:${config.space}`;
  const hashes = await getStoreValue<Record<string, string>>(key, {});
  const initialHashes = { ...hashes };
  const banks = store.getState().banks.filter(b => !isBuiltInBank(b.id));
  const local = new Map(await Promise.all(banks.map(async bank => {
    validateBank(bank, bank.id);
    const content = canonicalJson(bank);
    return [bank.id, { bank, content, hash: await contentHash(content) }] as const;
  })));
  const prefix = `service:${encodeURIComponent(config.url)}:`;
  const path = `api/v1/bank-sync/${config.space}`;
  const request = <T,>(resource: string, data?: unknown) => sourceRequest<T>(resource, {
    base: config.url, token: config.token, ...(data === undefined ? {} : { method: "PUT" as const, data }),
  });
  if (!enabled()) return;
  const { data: plan } = await request<Plan>(`${path}/manifest`, {
    banks: [...local].map(([id, b]) => ({ id, hash: b.hash, baseHash: hashes[id] ?? null })),
    published: [...new Map(banks.filter(b => b.sourceFilename?.startsWith(prefix)).map(b => [b.sourceFilename, b])).values()].map(b => ({
      filename: b.sourceFilename!.slice(prefix.length), sha: b.sourceSha, images: b.images ?? null,
    })),
  });
  if (!plan || !Array.isArray(plan.upload) || !Array.isArray(plan.download) || !Array.isArray(plan.published))
    throw new Error("服务台不支持题库 hash 同步，请安装新版服务台");
  const ids = new Set<string>();
  for (const item of [...plan.upload, ...plan.download]) {
    if (!validId(item.id) || ids.has(item.id)) throw new Error("服务台返回的题库清单无效");
    ids.add(item.id);
  }
  for (const item of plan.upload) {
    if (!enabled()) return;
    const value = local.get(item.id);
    if (!value || (item.baseHash !== null && !validHash(item.baseHash))) throw new Error("题库上传清单无效");
    const result = await request<{ hash: string }>(`${path}/banks/${item.id}`, {
      baseHash: item.baseHash, hash: value.hash, content: value.content,
    });
    if (result.status === 409) throw new Error("题库已被其他设备修改，请重新同步");
    if (result.data.hash !== value.hash) throw new Error("服务端题库 hash 确认失败");
    hashes[item.id] = value.hash;
  }
  for (const item of plan.download) {
    if (!enabled()) return;
    if (!validHash(item.hash) || typeof item.conflict !== "boolean") throw new Error("题库下载清单无效");
    const { data: remote } = await request<{ hash: string; content: string }>(`${path}/banks/${item.id}`);
    if (remote.hash !== item.hash || typeof remote.content !== "string" || await contentHash(remote.content) !== item.hash)
      throw new Error("题库下载 hash 校验失败，请重新同步");
    const bank = JSON.parse(remote.content);
    validateBank(bank, item.id);
    if (!enabled()) return;
    const current = store.getState().banks.find(b => b.id === item.id);
    const before = local.get(item.id);
    if ((current && canonicalJson(current) !== before?.content) || (!current && before))
      throw new Error("同步期间题库发生编辑或删除，已保留本机内容，请重新同步");
    const incoming = [bank];
    if (item.conflict && current) incoming.push({ ...current, id: crypto.randomUUID(), sourceFilename: undefined, sourceSha: undefined, sourceType: undefined, name: `${current.name}（冲突副本）`, updatedAt: new Date().toISOString() });
    await store.getState().applySyncedBanks(incoming);
    hashes[item.id] = item.hash;
  }
  // Equal hashes also establish a baseline, e.g. after interrupted acknowledgements.
  for (const [id, value] of local) if (!ids.has(id)) hashes[id] = value.hash;
  if (!enabled()) return;
  await setStoreValue(key, hashes);
  for (const item of plan.published) {
    if (!enabled()) return;
    if (typeof item.filename !== "string" || !validHash(item.sha)) throw new Error("发布题库清单无效");
    const url = resolveSourceResource(item.downloadUrl, config.url);
    const raw = new Uint8Array(await fetchRemoteBytes(url));
    if (await contentHash(raw) !== item.sha) throw new Error("发布题库 hash 校验失败，请重新同步");
    const data = await hydrateSourceBank(JSON.parse(new TextDecoder().decode(raw)), url,
      item.imagePath ? resolveSourceResource(item.imagePath, config.url) : undefined);
    if (!Array.isArray(data.questions) || !data.questions.every((q: any) => q && q.type && (q.question || q.content)))
      throw new Error("发布题库格式无效");
    if (!enabled()) return;
    const filename = `${prefix}${item.filename}`;
    const old = store.getState().banks.find(b => b.sourceFilename === filename);
    // Preserve an edited local copy when the published original changes.
    const copies: QuestionBank[] = [];
    if (old) {
      const before = canonicalJson(old);
      const baseline = initialHashes[old.id];
      const changed = !baseline || await contentHash(before) !== baseline;
      if (canonicalJson(store.getState().banks.find(b => b.id === old.id)) !== before)
        throw new Error("获取发布题库期间发生本机编辑，请重新同步");
      if (changed)
        copies.push({ ...old, id: crypto.randomUUID(), sourceFilename: undefined, sourceSha: undefined, name: `${old.name}（本机副本）` });
    }
    const converted = convertJsonToBank(data);
    const bank = { ...converted, id: old?.id ?? converted.id, createdAt: old?.createdAt ?? converted.createdAt,
      sourceFilename: filename, sourceSha: item.sha, sourceType: "user" as const, images: item.images };
    await store.getState().applySyncedBanks([...copies, bank]);
  }
}
