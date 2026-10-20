import { enabledSources, sourcesFingerprint } from "../store/dataSourceStore";
import { DataSourceEntry, sourceIdentity } from "./sourceConfig";
import { sourceRequest, resolveSourceResource } from "./dataSourceRequest";
import { selectBankVersions, bankTimestamp } from "./bankVersions";
import {
  contentsApiCandidates,
  fetchRemoteJson,
  repoFileCandidates,
  scopedRepoResource,
} from "./remoteRepo";
import type {
  BankIndex,
  BankIndexItem,
  DutyIndex,
  DutyIndexItem,
} from "../types";
type IndexItem = BankIndexItem | DutyIndexItem;
type RepoFile = {
  name: string;
  path: string;
  sha: string;
  type: string;
  download_url?: string;
};
async function fromRepository(
  source: DataSourceEntry,
  resource: "bank" | "duty",
) {
  const current = () => {
    if (
      !enabledSources().some((s) => s.id === source.id && s.url === source.url)
    )
      throw new Error("数据来源已删除或停用");
  };
  const bank = resource === "bank",
    systemKey = bank ? "systemBanks" : "systemDuties",
    userKey = bank ? "userBanks" : "userDuties";
  let valid = false;
  let base: { [key: string]: IndexItem[] } = { [systemKey]: [], [userKey]: [] };
  try {
    const data = await fetchRemoteJson<any>(
      repoFileCandidates(
        bank ? "bank-index.json" : "duty-index.json",
        "main",
        source,
      ),
    );
    if (!Array.isArray(data[systemKey]) || !Array.isArray(data[userKey]))
      throw new Error("索引格式无效");
    base = data;
    valid = true;
  } catch {
    /* A repository can use directory discovery without a static index. */
  }
  if (bank) {
    // The published manifest is authoritative for hashes, dates, and stable IDs.
    if (valid) return base;
    const discover = async (directory: string, depth = 0): Promise<BankIndexItem[]> => {
      current();
      if (depth > 5) throw new Error('题库目录层级过深，请生成 bank-index.json');
      const files = await fetchRemoteJson<RepoFile[]>(contentsApiCandidates(directory, 'main', source));
      if (!Array.isArray(files)) throw new Error('题库目录格式无效');
      const items: BankIndexItem[] = files
        .filter(file => file.type === 'file' && file.name.endsWith('.json') && file.download_url)
        .map(file => ({ name: directory.split('/').pop() || file.name, filename: file.name,
          downloadUrl: file.download_url!, sha: file.sha, images: [],
          imagePath: files.some(file => file.type === 'dir' && file.name === 'image') ? `${directory}/image` : undefined }));
      for (const dir of files.filter(file => file.type === 'dir' && file.name !== 'image' && !file.name.startsWith('.') && !/[\\/]/.test(file.name))) {
        items.push(...await discover(`${directory}/${dir.name}`, depth + 1));
      }
      return items;
    };
    const results = await Promise.allSettled([
      discover('Question_bank/public/banks'),
      discover('Question_bank/private/Question'),
    ]);
    if (results.every(result => result.status === 'rejected')) throw new Error(`${source.name} 无法获取题库`);
    return {
      systemBanks: results[0].status === 'fulfilled' ? results[0].value : [],
      userBanks: results[1].status === 'fulfilled' ? results[1].value : [],
    };
  }
  const dynamic: IndexItem[] = [];
  try {
    current();
    const dirs = await fetchRemoteJson<RepoFile[]>(
      contentsApiCandidates("Duty_schedule", "main", source),
    );
    if (!Array.isArray(dirs)) throw new Error("目录格式无效");
    valid = true;
    for (const dir of dirs.filter((d) => d.type === "dir")) {
      try {
        current();
        const files = await fetchRemoteJson<RepoFile[]>(
          contentsApiCandidates(dir.path, "main", source),
        );
        if (!Array.isArray(files)) continue;
        const file = files.find(
          (f) => f.type === "file" && f.name.endsWith(".json"),
        );
        if (file?.download_url)
          dynamic.push({
            name: dir.name,
            filename: file.name,
            downloadUrl: file.download_url,
            sha: file.sha,
            ...(bank
              ? {
                  imagePath: files.some(
                    (f) => f.type === "dir" && f.name === "image",
                  )
                    ? `${dir.path}/image`
                    : undefined,
                  images: [],
                }
              : {}),
          });
      } catch {
        /* Keep the remaining directories. */
      }
    }
  } catch {
    /* A valid static index remains usable. */
  }
  if (!valid)
    throw new Error(`${source.name} 无法获取${bank ? "题库" : "值班表"}`);
  const names = new Set(base[userKey].map((item) => item.filename));
  return {
    [systemKey]: base[systemKey],
    [userKey]: [
      ...base[userKey],
      ...dynamic.filter(item => !names.has(item.filename)),
    ],
  };
}
export async function fetchConfiguredIndex(
  resource: "bank",
): Promise<BankIndex>;
export async function fetchConfiguredIndex(
  resource: "duty",
): Promise<DutyIndex>;
export async function fetchConfiguredIndex(
  resource: "bank" | "duty",
): Promise<BankIndex | DutyIndex> {
  const sources = enabledSources(),
    fingerprint = sourcesFingerprint();
  if (!sources.length)
    throw new Error("没有启用的数据来源，请在设置中添加或启用条目");
  const bank = resource === "bank",
    systemKey = bank ? "systemBanks" : "systemDuties",
    userKey = bank ? "userBanks" : "userDuties";
  const results = await Promise.allSettled(
    sources.map(async (source) => ({
      source,
      data:
        source.kind === "service"
          ? (
              await sourceRequest<any>(
                bank ? "bank-index.json" : "duty-index.json",
                { base: source.url, token: source.token },
              )
            ).data
          : await fromRepository(source, resource),
    })),
  );
  if (fingerprint !== sourcesFingerprint())
    throw new Error("数据来源已修改，请重新获取");
  const output: { [key: string]: IndexItem[] } = {
    [systemKey]: [],
    [userKey]: [],
  };
  const seen = new Set<string>();
  let valid = 0;
  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    const { source, data } = result.value;
    if (!Array.isArray(data[systemKey]) || !Array.isArray(data[userKey]))
      continue;
    valid++;
    for (const key of [systemKey, userKey])
      for (const item of data[key] as BankIndexItem[]) {
        if (
          !item ||
          typeof item.name !== "string" ||
          typeof item.filename !== "string" ||
          typeof item.downloadUrl !== "string" ||
          (bank && (typeof item.sha !== "string" || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(item.sha)
            || (item.bankId !== undefined && typeof item.bankId !== "string")
            || (item.images !== undefined && (!Array.isArray(item.images) || item.images.some(image => !image || typeof image.filename !== "string" || typeof image.sha !== "string")))))
        )
          continue;
        const group = sourceIdentity(source),
          identity = `${group}:${key}:${item.filename}`;
        if (!bank && seen.has(identity)) continue;
        const filename =
          source.kind === "service"
            ? `service:${encodeURIComponent(source.url)}:${item.filename}`
            : group === "test-system"
              ? item.filename
              : `repo:${encodeURIComponent(group)}:${item.filename}`;
        try {
          const downloadUrl =
            source.kind === "service"
              ? resolveSourceResource(item.downloadUrl, source.url)
              : scopedRepoResource(source, item.downloadUrl);
          const imagePath = item.imagePath
            ? source.kind === "service"
              ? resolveSourceResource(item.imagePath, source.url)
              : contentsApiCandidates(item.imagePath, "main", source)[0]
            : undefined;
          output[key].push({
            ...item,
            filename,
            downloadUrl,
            imagePath,
            sourceId: source.id,
            sourceName: source.name,
            ...(bank ? { sourceAliases: [] } : {}),
            ...(bankTimestamp((item as BankIndexItem).updatedAt) ? { updatedAt: new Date(bankTimestamp((item as BankIndexItem).updatedAt)).toISOString() } : {}),
          });
          seen.add(identity);
        } catch {
          /* Ignore malformed resources without discarding the other sources. */
        }
      }
  }
  if (!valid) throw new Error("所有启用的数据来源均无法获取索引");
  if (bank) return selectBankVersions([
    ...output[systemKey].map(item => ({ item: item as BankIndexItem, section: 'systemBanks' as const })),
    ...output[userKey].map(item => ({ item: item as BankIndexItem, section: 'userBanks' as const })),
  ]);
  return output as unknown as BankIndex | DutyIndex;
}
