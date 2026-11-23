import { enabledSources, updateSourcesFingerprint, useDataSourceStore } from "../store/dataSourceStore";
import { DataSourceEntry } from "./sourceConfig";
import { fetchRemoteJson, releaseMetadataUrl } from "./remoteRepo";
import { resolveSourceResource } from "./dataSourceRequest";
import { platformAsset } from "./updateAssets";
export type ReleaseAsset = { name: string; browser_download_url: string };
interface Release {
  version: string;
  hash: string | null;
  assets: ReleaseAsset[];
  notes: string;
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
  const left = buildKey(a),
    right = buildKey(b);
  if (left && right) {
    if (left.base !== right.base) return left.base > right.base ? 1 : -1;
    return left.letter === right.letter ? 0 : left.letter > right.letter ? 1 : -1;
  }
  return a > b ? 1 : a < b ? -1 : 0;
}
/**
 * 构建号 = 北京时间日期 + 字母后缀，同日首次构建为 A，之后 B-Z 递增。
 * 兼容无字母的旧构建号（视为小于 A），例如 20261121 < 20261121A < 20261121Z < 20261122。
 */
function buildKey(value: string): { base: bigint; letter: number } | null {
  const match = /^(\d+)([A-Za-z])?$/.exec(value.trim());
  if (!match) return null;
  return {
    base: BigInt(dateBuild(match[1]) || match[1]),
    letter: match[2] ? match[2].toUpperCase().charCodeAt(0) : 0,
  };
}
// Published builds use YYYYMMDD, optionally followed by an A-Z suffix.
// Keep comparisons compatible with the brief YYMMDD format and arbitrary
// numeric service builds so existing packages cannot distort update ordering.
function dateBuild(value: string): string | null {
  const full = /^\d{6}$/.test(value) ? `20${value}` : value;
  if (!/^20\d{6}$/.test(full)) return null;
  const year = +full.slice(0, 4), month = +full.slice(4, 6), day = +full.slice(6, 8);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month && date.getUTCDate() === day ? full : null;
}
function normalizeHash(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const dated = /^(\d{6,8})([A-Za-z]?)$/.exec(value);
  if (dated && dateBuild(dated[1]) !== null) {
    return `${dated[1]}${dated[2].toUpperCase()}`;
  }
  return /^(?:[a-f0-9]{8}|[a-f0-9]{40}|[a-f0-9]{64})$/i.test(value)
    ? value.toLowerCase()
    : null;
}
const hashOf = (body: unknown): string | null =>
  typeof body === "string"
    ? normalizeHash(body.match(/hash[:\s]+([a-z0-9]+)/i)?.[1])
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
          ? entry.kind === "service" && /^\d{1,20}[A-Za-z]?$/.test(item.versionHash)
            ? item.versionHash.toUpperCase()
            : normalizeHash(item.versionHash)
          : hashOf(item.body);
      const raw = gitee ? item.release?.attach_files : item.assets;
      const assets: ReleaseAsset[] = (Array.isArray(raw) ? raw : []).flatMap(
        (asset) => {
          const url = gitee
            ? asset.cli_download_url || asset.download_url
            : asset.browser_download_url || asset.url;
          if (typeof asset.name !== "string" || typeof url !== "string")
            return [];
          if (entry.kind === "service") {
            try { return [{ name: asset.name, browser_download_url: resolveSourceResource(url, entry.url) }]; }
            catch { return []; }
          }
          const resolved = new URL(
            url,
            gitee ? "https://gitee.com" : `${entry.url}/`,
          );
          return ["http:", "https:"].includes(resolved.protocol)
            ? [{ name: asset.name, browser_download_url: resolved.href }]
            : [];
        },
      );
      return { version, hash, assets, notes: String(
        gitee
          ? item.release?.description ?? item.tag?.message ?? ""
          : entry.kind === "service"
            ? item.notes ?? item.body ?? item.message ?? ""
            : item.body ?? "",
      ).trim(), entry };
    })
    .filter((release) => /^\d+(?:\.\d+){1,3}$/.test(release.version)
      && (entry.kind !== "service" || release.hash !== null)
      && platformAsset(release.assets) !== null);
}
const newer = (a: Release, b: Release) =>
  compareVersions(a.version, b.version) || compareBuildNumbers(a.hash, b.hash);
// 版本与构建完全一致时优先从 Gitee 下载；其余情况仍按版本/构建与来源顺序。
const preferGiteeOnTie = (best: Release, current: Release) =>
  best.entry.kind === "gitee" || current.entry.kind !== "gitee" ? best : current;
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
  const primary = releases.reduce((best, current) => {
    const order = newer(current, best);
    if (order > 0) return current;
    if (order < 0) return best;
    return preferGiteeOnTie(best, current);
  });
  const fallback_assets = releases
    .filter(
      (r) =>
        r.entry.id !== primary.entry.id &&
        compareVersions(r.version, primary.version) === 0 &&
        primary.hash !== null &&
        r.hash === primary.hash,
    )
    .flatMap((r) => r.assets);
  // 首选来源可能不提供发布说明（如电脑服务），此时取同一版本与构建的其他来源。
  const notes = primary.notes || releases.find(r =>
    r !== primary && compareVersions(r.version, primary.version) === 0 && r.hash === primary.hash && r.notes,
  )?.notes || "";
  return {
    latest_version: primary.version,
    version_hash: primary.hash,
    notes,
    assets: primary.assets,
    fallback_assets,
    source: primary.entry.kind,
    sourceId: primary.entry.id,
    sourceName: primary.entry.name,
  };
}
