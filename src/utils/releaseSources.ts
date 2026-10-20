import { enabledSources, updateSourcesFingerprint, useDataSourceStore } from "../store/dataSourceStore";
import { DataSourceEntry } from "./sourceConfig";
import { fetchRemoteJson, releaseMetadataUrl } from "./remoteRepo";
export type ReleaseAsset = { name: string; browser_download_url: string };
interface Release {
  version: string;
  hash: string | null;
  assets: ReleaseAsset[];
  entry: DataSourceEntry;
}
export function compareVersions(a: string, b: string): number {
  const left = a.split(".").map(Number),
    right = b.split(".").map(Number);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const diff = (left[i] || 0) - (right[i] || 0);
    if (diff) return diff;
  }
  return 0;
}
export function compareBuildNumbers(
  a: string | null,
  b: string | null,
): number {
  if (!a || !b) return a ? 1 : b ? -1 : 0;
  if (/^\d+$/.test(a) && /^\d+$/.test(b)) {
    const x = BigInt(a),
      y = BigInt(b);
    return x > y ? 1 : x < y ? -1 : 0;
  }
  return a > b ? 1 : a < b ? -1 : 0;
}
function normalizeHash(value: unknown): string | null {
  return typeof value === "string" &&
    /^(?:[a-f0-9]{8}|[a-f0-9]{40}|[a-f0-9]{64})$/i.test(value)
    ? value.toLowerCase()
    : null;
}
const hashOf = (body: unknown): string | null =>
  typeof body === "string"
    ? normalizeHash(body.match(/hash[:\s]+([a-f0-9]+)/i)?.[1])
    : null;
function parseReleases(data: any, entry: DataSourceEntry): Release[] {
  const list: any[] =
    entry.kind === "gitee"
      ? Array.isArray(data?.releases)
        ? data.releases
        : []
      : Array.isArray(data)
        ? data
        : [data];
  return list
    .filter((item) => item && !item.draft && !item.prerelease)
    .map((item) => {
      const gitee = entry.kind === "gitee";
      const version = String(
        gitee ? (item.tag?.name ?? "") : (item.tag_name ?? item.version ?? ""),
      ).replace(/^v/, "");
      const hash = gitee
        ? hashOf(item.release?.description) || hashOf(item.tag?.message)
        : typeof item.versionHash === "string"
          ? normalizeHash(item.versionHash)
          : hashOf(item.body);
      const raw = gitee ? item.release?.attach_files : item.assets;
      const assets: ReleaseAsset[] = (Array.isArray(raw) ? raw : []).flatMap(
        (asset) => {
          const url = gitee
            ? asset.cli_download_url || asset.download_url
            : asset.browser_download_url || asset.url;
          if (typeof asset.name !== "string" || typeof url !== "string")
            return [];
          const resolved = new URL(
            url,
            gitee ? "https://gitee.com" : `${entry.url}/`,
          );
          return ["http:", "https:"].includes(resolved.protocol)
            ? [{ name: asset.name, browser_download_url: resolved.href }]
            : [];
        },
      );
      return { version, hash, assets, entry };
    })
    .filter((release) => /^\d+(?:\.\d+){1,3}$/.test(release.version));
}
const newer = (a: Release, b: Release) =>
  compareVersions(a.version, b.version) || compareBuildNumbers(a.hash, b.hash);
export async function configuredRelease() {
  if (!useDataSourceStore.getState().updatesEnabled) throw new Error("软件更新已关闭，请在设置中开启后重试");
  const entries = enabledSources(),
    fingerprint = updateSourcesFingerprint();
  if (!entries.length)
    throw new Error("没有启用的安装包更新来源，请在设置中添加或启用条目");
  const results = await Promise.allSettled(
    entries.map(async (entry) =>
      parseReleases(await fetchRemoteJson(releaseMetadataUrl(entry)), entry),
    ),
  );
  if (fingerprint !== updateSourcesFingerprint())
    throw new Error("数据来源已修改，请重新检查更新");
  const releases = results.flatMap((result) =>
    result.status === "fulfilled" ? result.value : [],
  );
  if (!releases.length)
    throw new Error("所有启用的数据来源均未获取到有效更新信息");
  const primary = releases.reduce((best, current) =>
    newer(current, best) > 0 ? current : best,
  );
  const fallback_assets = releases
    .filter(
      (r) =>
        r.entry.id !== primary.entry.id &&
        compareVersions(r.version, primary.version) === 0 &&
        primary.hash !== null &&
        r.hash === primary.hash,
    )
    .flatMap((r) => r.assets);
  return {
    latest_version: primary.version,
    version_hash: primary.hash,
    assets: primary.assets,
    fallback_assets,
    source: primary.entry.kind,
    sourceId: primary.entry.id,
    sourceName: primary.entry.name,
  };
}
