import { invoke } from '@tauri-apps/api/core';
import { isTauri } from './env';

/**
 * 远端仓库访问层
 *
 * 应用同时存在两个镜像仓库：
 *   - GitHub: czixue7/Test-System
 *   - Gitee : zixue7/Test-System
 *
 * 发布策略：优先从 Gitee 拉取，失败再回退 GitHub。
 *
 * ⚠️ Gitee 的 raw 地址（https://gitee.com/<owner>/<repo>/raw/...）没有返回
 * CORS 头，WebView 里直接 fetch 会被浏览器拦截。因此在 Tauri 环境下统一
 * 走 Rust 后端命令（fetch_remote_text / fetch_remote_bytes）抓取，
 * 由原生侧发起请求绕开 CORS；浏览器（开发预览）环境则退化为原生 fetch。
 */

export const GITHUB_OWNER = 'czixue7';
export const GITEE_OWNER = 'zixue7';
export const REPO_NAME = 'Test-System';
export const REPO_BRANCH = 'main';

function normalizePath(path: string): string {
  return path.replace(/^\/+/, '');
}

function dedupe(list: string[]): string[] {
  return Array.from(new Set(list.filter((item) => !!item)));
}

/** GitHub raw 地址 */
export function githubRawUrl(path: string, branch: string = REPO_BRANCH): string {
  return `https://raw.githubusercontent.com/${GITHUB_OWNER}/${REPO_NAME}/${branch}/${normalizePath(path)}`;
}

/** Gitee raw 地址 */
export function giteeRawUrl(path: string, branch: string = REPO_BRANCH): string {
  return `https://gitee.com/${GITEE_OWNER}/${REPO_NAME}/raw/${branch}/${normalizePath(path)}`;
}

const GITHUB_RAW_RE = /^https?:\/\/raw\.githubusercontent\.com\/[^/]+\/[^/]+\/([^/]+)\/(.+)$/i;
const GITEE_RAW_RE = /^https?:\/\/gitee\.com\/[^/]+\/[^/]+\/raw\/([^/]+)\/(.+)$/i;
const GITHUB_CONTENTS_RE = /^https?:\/\/api\.github\.com\/repos\/[^/]+\/[^/]+\/contents\/([^?]*)(?:\?.*)?$/i;
const GITEE_CONTENTS_RE = /^https?:\/\/gitee\.com\/api\/v5\/repos\/[^/]+\/[^/]+\/contents\/([^?]*)(?:\?.*)?$/i;

function parseRawUrl(url: string): { branch: string; path: string } | null {
  const gh = url.match(GITHUB_RAW_RE);
  if (gh) return { branch: gh[1], path: gh[2] };
  const gt = url.match(GITEE_RAW_RE);
  if (gt) return { branch: gt[1], path: gt[2] };
  return null;
}

function parseContentsPath(url: string): string | null {
  const gh = url.match(GITHUB_CONTENTS_RE);
  if (gh) return gh[1];
  const gt = url.match(GITEE_CONTENTS_RE);
  if (gt) return gt[1];
  return null;
}

/** 转换为 Gitee raw 地址（无法识别时返回 null） */
export function toGiteeRawUrl(url: string): string | null {
  const parsed = parseRawUrl(url);
  return parsed ? giteeRawUrl(parsed.path, parsed.branch) : null;
}

/** 转换为 GitHub raw 地址（无法识别时返回 null） */
export function toGithubRawUrl(url: string): string | null {
  const parsed = parseRawUrl(url);
  return parsed ? githubRawUrl(parsed.path, parsed.branch) : null;
}

/** 任意 raw 链接 → [Gitee, GitHub] 候选（Gitee 优先） */
export function rawUrlCandidates(url: string): string[] {
  const parsed = parseRawUrl(url);
  if (parsed) {
    return dedupe([giteeRawUrl(parsed.path, parsed.branch), githubRawUrl(parsed.path, parsed.branch)]);
  }
  return [url];
}

/** 仓库内文件路径 → [Gitee, GitHub] raw 候选 */
export function repoFileCandidates(path: string, branch: string = REPO_BRANCH): string[] {
  return dedupe([giteeRawUrl(path, branch), githubRawUrl(path, branch)]);
}

/** 仓库内路径 → [Gitee, GitHub] Contents API 候选（用于列目录 / 取下载链接） */
export function contentsApiCandidates(path: string, branch: string = REPO_BRANCH): string[] {
  const p = normalizePath(path);
  return [
    `https://gitee.com/api/v5/repos/${GITEE_OWNER}/${REPO_NAME}/contents/${p}?ref=${branch}`,
    `https://api.github.com/repos/${GITHUB_OWNER}/${REPO_NAME}/contents/${p}?ref=${branch}`,
  ];
}

/** 把单个链接展开成「Gitee 优先」的候选列表 */
function expandCandidates(url: string): string[] {
  const raw = parseRawUrl(url);
  if (raw) {
    return dedupe([giteeRawUrl(raw.path, raw.branch), githubRawUrl(raw.path, raw.branch)]);
  }
  const contentsPath = parseContentsPath(url);
  if (contentsPath !== null) {
    return contentsApiCandidates(contentsPath);
  }
  return [url];
}

function normalizeCandidates(candidates: string | string[]): string[] {
  const input = typeof candidates === 'string' ? [candidates] : candidates;
  const expanded: string[] = [];
  for (const item of input) {
    for (const candidate of expandCandidates(item)) {
      if (!expanded.includes(candidate)) expanded.push(candidate);
    }
  }
  return expanded;
}

async function fetchTextOnce(url: string): Promise<string> {
  if (isTauri()) {
    return await invoke<string>('fetch_remote_text', { url });
  }
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return await response.text();
}

async function fetchBytesOnce(url: string): Promise<ArrayBuffer> {
  if (isTauri()) {
    const data = await invoke<ArrayBuffer | number[] | Uint8Array>('fetch_remote_bytes', { url });
    if (data instanceof ArrayBuffer) return data;
    if (Array.isArray(data)) return new Uint8Array(data).buffer;
    if (data && (data as Uint8Array).buffer) return (data as Uint8Array).buffer as ArrayBuffer;
    throw new Error('未知的二进制返回格式');
  }
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return await response.arrayBuffer();
}

/** 依次尝试候选地址（Gitee 优先），返回首个成功的文本 */
export async function fetchRemoteText(candidates: string | string[]): Promise<string> {
  const list = normalizeCandidates(candidates);
  let lastError: unknown;
  for (const url of list) {
    try {
      return await fetchTextOnce(url);
    } catch (error) {
      lastError = error;
      console.warn(`[remoteRepo] 抓取文本失败，尝试下一个源: ${url}`, error);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError ?? '所有远端地址均不可用'));
}

/** 依次尝试候选地址（Gitee 优先），返回首个成功的 JSON */
export async function fetchRemoteJson<T>(candidates: string | string[]): Promise<T> {
  const text = await fetchRemoteText(candidates);
  return JSON.parse(text) as T;
}

/** 依次尝试候选地址（Gitee 优先），返回首个成功的二进制数据 */
export async function fetchRemoteBytes(candidates: string | string[]): Promise<ArrayBuffer> {
  const list = normalizeCandidates(candidates);
  let lastError: unknown;
  for (const url of list) {
    try {
      return await fetchBytesOnce(url);
    } catch (error) {
      lastError = error;
      console.warn(`[remoteRepo] 抓取二进制失败，尝试下一个源: ${url}`, error);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError ?? '所有远端地址均不可用'));
}
