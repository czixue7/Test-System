import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./env";
import { sourceTokenFor } from "./dataSourceRequest";
import { enabledSources, sourcesFingerprint } from "../store/dataSourceStore";
import {
  DataSourceEntry,
  repositoryInfo,
  sourceIdentity,
} from "./sourceConfig";

export const GITHUB_OWNER = "czixue7",
  GITEE_OWNER = "zixue7",
  REPO_NAME = "Test-System",
  REPO_BRANCH = "main";
const cleanPath = (path: string) => path.replace(/^\/+/, "");
export function repositorySources() {
  return enabledSources().filter((s) => s.kind !== "service");
}
export function repoFileUrl(
  source: DataSourceEntry,
  path: string,
  branch = REPO_BRANCH,
): string {
  const { owner, repo } = repositoryInfo(source);
  return source.kind === "github"
    ? `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${cleanPath(path)}`
    : `https://gitee.com/${owner}/${repo}/raw/${branch}/${cleanPath(path)}`;
}
export function repoFileCandidates(
  path: string,
  branch = REPO_BRANCH,
  source?: DataSourceEntry,
): string[] {
  return (source ? [source] : repositorySources()).map((s) =>
    repoFileUrl(s, path, branch),
  );
}
export function contentsApiCandidates(
  path: string,
  branch = REPO_BRANCH,
  source?: DataSourceEntry,
): string[] {
  return (source ? [source] : repositorySources()).map((s) => {
    const { owner, repo } = repositoryInfo(s);
    return s.kind === "github"
      ? `https://api.github.com/repos/${owner}/${repo}/contents/${cleanPath(path)}?ref=${branch}`
      : `https://gitee.com/api/v5/repos/${owner}/${repo}/contents/${cleanPath(path)}?ref=${branch}`;
  });
}
export function parseRepositoryRaw(
  url: string,
): {
  kind: "gitee" | "github";
  url: string;
  path: string;
  branch: string;
} | null {
  const gh = url.match(
    /^https?:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/i,
  );
  if (gh)
    return {
      kind: "github",
      url: `https://github.com/${gh[1]}/${gh[2]}`,
      branch: gh[3],
      path: gh[4],
    };
  const gt = url.match(
    /^https?:\/\/gitee\.com\/([^/]+)\/([^/]+)\/raw\/([^/]+)\/(.+)$/i,
  );
  if (gt)
    return {
      kind: "gitee",
      url: `https://gitee.com/${gt[1]}/${gt[2]}`,
      branch: gt[3],
      path: gt[4],
    };
  return null;
}
export function rawUrlCandidates(url: string): string[] {
  const parsed = parseRepositoryRaw(url);
  if (!parsed) return [url];
  const identity = sourceIdentity({
    ...parsed,
    id: "parsed",
    name: "",
    token: "",
    enabled: true,
  });
  return repositorySources()
    .filter((s) => sourceIdentity(s) === identity)
    .map((s) => repoFileUrl(s, parsed.path, parsed.branch));
}
export function scopedRepoResource(
  source: DataSourceEntry,
  url: string,
): string {
  const parsed = parseRepositoryRaw(url);
  if (parsed) return repoFileUrl(source, parsed.path, parsed.branch);
  if (!/^https?:\/\//i.test(url)) return repoFileUrl(source, url);
  return url;
}
export function releaseMetadataUrl(source: DataSourceEntry): string {
  if (source.kind === "service") return `${source.url}/app-update.json`;
  const { owner, repo } = repositoryInfo(source);
  return source.kind === "gitee"
    ? `${source.url}/releases.json`
    : `https://api.github.com/repos/${owner}/${repo}/releases?per_page=20`;
}
export async function fetchRemoteText(
  candidates: string | string[],
): Promise<string> {
  const fingerprint = sourcesFingerprint();
  const list = [
    ...new Set(typeof candidates === "string" ? [candidates] : candidates),
  ];
  let lastError: unknown;
  for (const url of list) {
    if (fingerprint !== sourcesFingerprint())
      throw new Error("数据来源已修改，请重新获取");
    try {
      const token = sourceTokenFor(url);
      if (isTauri())
        return await invoke<string>("fetch_remote_text", {
          url,
          bearerToken: token,
        });
      const response = await fetch(url, {
        cache: "no-store",
        signal: AbortSignal.timeout(30000),
        ...(token
          ? {
              headers: { Authorization: `Bearer ${token}` },
              redirect: "error" as const,
            }
          : {}),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.text();
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(
        list.length
          ? "所有启用的数据来源均不可用"
          : "没有可用的数据来源，请在设置中添加或启用条目",
      );
}
export async function fetchRemoteJson<T>(
  candidates: string | string[],
): Promise<T> {
  return JSON.parse(await fetchRemoteText(candidates)) as T;
}
export async function fetchRemoteBytes(
  candidates: string | string[],
): Promise<ArrayBuffer> {
  const fingerprint = sourcesFingerprint();
  const list = [
    ...new Set(typeof candidates === "string" ? [candidates] : candidates),
  ];
  let lastError: unknown;
  for (const url of list) {
    if (fingerprint !== sourcesFingerprint())
      throw new Error("数据来源已修改，请重新获取");
    try {
      const token = sourceTokenFor(url);
      if (isTauri()) {
        const data = await invoke<ArrayBuffer | number[] | Uint8Array>(
          "fetch_remote_bytes",
          { url, bearerToken: token },
        );
        if (data instanceof ArrayBuffer) return data;
        if (Array.isArray(data)) return new Uint8Array(data).buffer;
        return new Uint8Array(data).buffer;
      }
      const response = await fetch(url, {
        cache: "no-store",
        signal: AbortSignal.timeout(60000),
        ...(token
          ? {
              headers: { Authorization: `Bearer ${token}` },
              redirect: "error" as const,
            }
          : {}),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.arrayBuffer();
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("没有可用的数据来源");
}
