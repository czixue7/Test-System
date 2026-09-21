import { invoke, Channel } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-shell';

export interface DownloadProgress {
  downloaded: number;
  total: number;
  percentage: number;
}

export interface UpdateInfo {
  hasUpdate: boolean;
  latestVersion: string;
  message: string;
  downloadUrl?: string;
  assetName?: string;
  /** 备用下载地址：首选源（Gitee）失败时回退到另一仓库（GitHub） */
  fallbackDownloadUrl?: string;
  versionHash?: string;
  /** 实际采用的发布源 */
  source?: 'gitee' | 'github';
  /** 检查过程是否出错（网络失败等），出错时 hasUpdate 恒为 false */
  error?: boolean;
}

/**
 * 版本信息存储键名
 */
const VERSION_HASH_KEY = 'app_version_hash';

/**
 * 获取当前存储的版本哈希
 */
export function getStoredVersionHash(): string | null {
  try {
    return localStorage.getItem(VERSION_HASH_KEY);
  } catch {
    return null;
  }
}

/**
 * 存储版本哈希
 */
export function storeVersionHash(hash: string): void {
  try {
    localStorage.setItem(VERSION_HASH_KEY, hash);
  } catch (e) {
    console.error('[Updater] 存储版本哈希失败:', e);
  }
}

/**
 * 计算版本哈希（基于版本号和构建时间）
 * 用于检测同一版本的不同构建
 */
export function calculateVersionHash(version: string, buildInfo?: string): string {
  // 简单的哈希计算：版本号 + 构建信息
  const hashInput = buildInfo ? `${version}-${buildInfo}` : version;
  let hash = 0;
  for (let i = 0; i < hashInput.length; i++) {
    const char = hashInput.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).substring(0, 8);
}

const currentVersion = '0.4.2';

/**
 * 当前版本哈希（每次构建时更新）
 * 用于区分同一版本的不同构建
 */
export const CURRENT_VERSION_HASH = '20260922'; // 每次发布时更新此值

/**
 * 检查当前系统架构
 * 返回 'arm64' | 'arm' | 'x86' | 'x86_64' | 'unknown'
 */
export function getSystemArchitecture(): string {
  const userAgent = navigator.userAgent.toLowerCase();
  const platform = navigator.platform.toLowerCase();

  console.log(`[Updater] 检测系统架构`);
  console.log(`[Updater] UserAgent: ${userAgent}`);
  console.log(`[Updater] Platform: ${platform}`);

  // 检测 ARM64 (检查 userAgent 和 platform)
  if (userAgent.includes('aarch64') ||
      userAgent.includes('arm64') ||
      platform.includes('aarch64') ||
      platform.includes('arm64')) {
    console.log('[Updater] 检测到 ARM64 架构');
    return 'arm64';
  }

  // 检测 ARM (检查 userAgent 和 platform)
  if (userAgent.includes('arm') || platform.includes('arm')) {
    // 确保不是 arm64
    if (!userAgent.includes('arm64') && !platform.includes('arm64')) {
      console.log('[Updater] 检测到 ARM 架构');
      return 'arm';
    }
  }

  // 检测 x86_64 (检查 userAgent 和 platform)
  if (userAgent.includes('x86_64') ||
      userAgent.includes('x64') ||
      platform.includes('x86_64') ||
      platform.includes('x64')) {
    console.log('[Updater] 检测到 x86_64 架构');
    return 'x86_64';
  }

  // 检测 x86 (检查 userAgent 和 platform)
  if (userAgent.includes('x86') ||
      userAgent.includes('i686') ||
      platform.includes('x86') ||
      platform.includes('i686')) {
    console.log('[Updater] 检测到 x86 架构');
    return 'x86';
  }

  console.log('[Updater] 无法确定架构，返回 unknown');
  return 'unknown';
}

/**
 * 检查系统是否支持 ARM64
 */
export function isArm64Supported(): boolean {
  const arch = getSystemArchitecture();
  return arch === 'arm64';
}

/**
 * 解析 GitHub Release body 中的版本哈希
 * 支持格式：hash:abc123 或 <!-- hash:abc123 -->
 */
function parseVersionHash(body: string): string | null {
  if (!body) return null;
  const hashMatch = body.match(/hash[:\s]+([a-f0-9]+)/i);
  if (hashMatch) {
    return hashMatch[1].toLowerCase();
  }
  return null;
}

/**
 * 比较两个语义化版本号
 * 返回 >0 表示 v1 更高，<0 表示 v2 更高，0 表示相等
 */
function compareVersions(v1: string, v2: string): number {
  const parts1 = v1.split('.').map(Number);
  const parts2 = v2.split('.').map(Number);
  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const p1 = parts1[i] || 0;
    const p2 = parts2[i] || 0;
    if (p1 > p2) return 1;
    if (p1 < p2) return -1;
  }
  return 0;
}

/**
 * 比较两个构建号（版本号相同时使用）
 * 构建号是内置用于对比的构建时间戳，同一版本下数值越大越新。
 * 返回 >0 表示 a 更新，<0 表示 b 更新，0 表示相同。
 */
function compareBuildNumbers(a: string | null, b: string | null): number {
  if (!a && !b) return 0;
  if (!a) return -1;
  if (!b) return 1;

  const na = /^\d+$/.test(a) ? parseInt(a, 10) : NaN;
  const nb = /^\d+$/.test(b) ? parseInt(b, 10) : NaN;
  if (!Number.isNaN(na) && !Number.isNaN(nb)) {
    if (na > nb) return 1;
    if (na < nb) return -1;
    return 0;
  }

  if (a > b) return 1;
  if (a < b) return -1;
  return 0;
}

interface RemoteRelease {
  version: string;
  hash: string | null;
  assets: { name: string; browser_download_url: string }[];
}

/**
 * 检查更新
 * 同时检查 GitHub 与 Gitee 两个镜像仓库，取更高版本；
 * 版本相同时优先 Gitee。Tauri 环境走 Rust 后端（绕过 WebView 缓存与 CORS），
 * 非 Tauri 环境回退到 fetch。
 */
export async function checkUpdate(): Promise<UpdateInfo> {
  console.log('[Updater] 开始检查更新...');
  console.log(`[Updater] 当前版本: ${currentVersion}, 当前哈希: ${CURRENT_VERSION_HASH}`);

  try {
    let latestVersion: string;
    let latestHash: string | null;
    let assets: { name: string; browser_download_url: string }[];
    let fallbackAssets: { name: string; browser_download_url: string }[] = [];
    let sourceLabel: 'gitee' | 'github' = 'gitee';

    if (isTauri()) {
      console.log('[Updater] 使用 Rust 后端检查 GitHub / Gitee 更新（绕过 WebView 缓存与 CORS）');
      const result = await invoke<{
        latest_version: string;
        version_hash: string | null;
        assets: { name: string; browser_download_url: string }[];
        fallback_assets: { name: string; browser_download_url: string }[];
        source: string;
      }>('check_github_update');

      latestVersion = result.latest_version;
      latestHash = result.version_hash;
      assets = result.assets || [];
      fallbackAssets = result.fallback_assets || [];
      sourceLabel = result.source === 'github' ? 'github' : 'gitee';

      console.log(`[Updater] Rust 后端返回: 来源=${sourceLabel}, 版本=${latestVersion}, 哈希=${latestHash || '未提供'}`);
    } else {
      console.log('[Updater] 非 Tauri 环境，回退到 fetch');
      const cacheBuster = `_t=${Date.now()}`;

      const parseRelease = (data: {
        tag_name?: string;
        body?: string;
        assets?: { name: string; browser_download_url: string }[];
      }): RemoteRelease => ({
        version: (data.tag_name || '0.0.0').replace(/^v/, ''),
        hash: parseVersionHash(data.body || ''),
        assets: (data.assets || []) as { name: string; browser_download_url: string }[],
      });

      // Gitee 网页版 releases.json：{ releases: [{ tag: { name, message }, release: { description, attach_files } }] }
      const parseGiteeWebRelease = (item: {
        tag?: { name?: string; message?: string };
        release?: {
          description?: string;
          attach_files?: { name?: string; cli_download_url?: string; download_url?: string }[];
        };
      }): RemoteRelease => {
        const absoluteUrl = (f: { cli_download_url?: string; download_url?: string }) => {
          const u = f.cli_download_url || f.download_url || '';
          return /^https?:\/\//.test(u) ? u : `https://gitee.com${u}`;
        };
        return {
          version: (item.tag?.name || '0.0.0').replace(/^v/, ''),
          hash:
            parseVersionHash(item.release?.description || '') ||
            parseVersionHash(item.tag?.message || ''),
          assets: (item.release?.attach_files || [])
            .filter((f) => !!f.name)
            .map((f) => ({
              name: f.name as string,
              browser_download_url: absoluteUrl(f),
            })),
        };
      };

      const pickBestRelease = (releases: RemoteRelease[]): RemoteRelease | null => {
        if (!releases || releases.length === 0) return null;
        return releases.reduce((best, cur) => {
          const vc = compareVersions(cur.version, best.version);
          if (vc > 0) return cur;
          if (vc === 0 && compareBuildNumbers(cur.hash, best.hash) > 0) return cur;
          return best;
        });
      };

      const fetchReleaseList = async (
        apiUrl: string,
        headers?: Record<string, string>,
      ): Promise<RemoteRelease[]> => {
        const response = await fetch(apiUrl, { cache: 'no-store', headers });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const data = await response.json();
        const list = Array.isArray(data) ? data : [data];
        return list.map(parseRelease);
      };

      // Gitee 开放 API v5 对匿名调用限流（403 Rate Limit Exceeded），
      // 改用网页版数据接口 releases.json：匿名可访问，且为结构化 JSON。
      const fetchGiteeWebReleases = async (): Promise<RemoteRelease[]> => {
        const response = await fetch(
          `https://gitee.com/zixue7/Test-System/releases.json?${cacheBuster}`,
          { cache: 'no-store' },
        );
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const data = await response.json();
        const list = Array.isArray(data?.releases) ? data.releases : [];
        return list.map(parseGiteeWebRelease);
      };

      const [giteeResult, githubResult] = await Promise.allSettled([
        fetchGiteeWebReleases(),
        fetchReleaseList(`https://api.github.com/repos/czixue7/Test-System/releases?per_page=20&${cacheBuster}`, {
          Accept: 'application/vnd.github.v3+json',
        }),
      ]);

      const gitee = giteeResult.status === 'fulfilled' ? pickBestRelease(giteeResult.value) : null;
      const github = githubResult.status === 'fulfilled' ? pickBestRelease(githubResult.value) : null;

      if (!gitee && !github) {
        throw new Error('GitHub 与 Gitee 均无法访问');
      }

      // 两者都查，取更高版本；版本相同时再比构建号，仍相同则优先 Gitee
      const preferGitee =
        !!gitee &&
        (!github ||
          compareVersions(gitee.version, github.version) > 0 ||
          (compareVersions(gitee.version, github.version) === 0 &&
            compareBuildNumbers(gitee.hash, github.hash) >= 0));
      const primary = preferGitee ? gitee! : github!;
      const fallback = preferGitee ? github : gitee;

      latestVersion = primary.version;
      latestHash = primary.hash;
      assets = primary.assets;
      fallbackAssets = fallback ? fallback.assets : [];
      sourceLabel = preferGitee ? 'gitee' : 'github';

      console.log(`[Updater] 采用来源=${sourceLabel}, 版本=${latestVersion}`);
    }

    console.log(`[Updater] 最新版本: ${latestVersion}, 最新哈希: ${latestHash || '未提供'}`);
    console.log(`[Updater] 首选源资产数量: ${assets.length}, 备用源资产数量: ${fallbackAssets.length}`);

    if (assets.length > 0) {
      console.log(`[Updater] ${sourceLabel} 可用资产列表:`);
      assets.forEach((asset, index) => {
        console.log(`  [${index}] ${asset.name}`);
      });
    }

    const versionCompare = compareVersions(latestVersion, currentVersion);

    let hasUpdate = false;
    let updateReason = '';

    if (versionCompare > 0) {
      hasUpdate = true;
      updateReason = `版本号更新 (${currentVersion} -> ${latestVersion})`;
    } else if (versionCompare === 0) {
      // 版本号相同：再比对构建号（构建时间戳），数值更大表示更新的构建
      const buildCompare = compareBuildNumbers(latestHash, CURRENT_VERSION_HASH);
      if (buildCompare > 0) {
        hasUpdate = true;
        updateReason = `同一版本的新构建 (构建号: ${CURRENT_VERSION_HASH} -> ${latestHash})`;
      }
    }

    console.log(`[Updater] 更新判断: hasUpdate=${hasUpdate}, reason=${updateReason || '无更新'}`);

    if (hasUpdate) {
      console.log('[Updater] 发现新版本或新构建');
      const asset = getPlatformAsset(assets);

      if (asset) {
        const fallbackAsset = getPlatformAsset(fallbackAssets);
        console.log(`[Updater] 找到适合的下载链接: ${asset.browser_download_url}`);
        if (fallbackAsset) {
          console.log(`[Updater] 备用下载链接: ${fallbackAsset.browser_download_url}`);
        }
        return {
          hasUpdate: true,
          latestVersion,
          message: updateReason,
          downloadUrl: asset.browser_download_url,
          assetName: asset.name,
          fallbackDownloadUrl: fallbackAsset?.browser_download_url,
          versionHash: latestHash || undefined,
          source: sourceLabel,
        };
      } else {
        console.warn('[Updater] 未找到适合当前平台的下载文件');
        return {
          hasUpdate: false,
          latestVersion,
          message: '未找到适合当前平台的下载文件'
        };
      }
    } else {
      console.log('[Updater] 当前已是最新版本');
      storeVersionHash(CURRENT_VERSION_HASH);
      return {
        hasUpdate: false,
        latestVersion,
        message: '当前已是最新版本'
      };
    }
  } catch (error) {
    // Tauri invoke 失败时抛出的是字符串，统一转换，避免显示笼统的"检查更新失败"
    const detail = error instanceof Error ? error.message : String(error || '未知错误');
    console.error('[Updater] 检查更新失败:', error);
    return {
      hasUpdate: false,
      latestVersion: currentVersion,
      message: detail,
      error: true
    };
  }
}

/**
 * 获取适合当前平台的资源文件
 * 优先根据系统架构选择对应的 APK，如果不支持则回退到 universal
 */
function getPlatformAsset(assets: { name: string; browser_download_url: string }[]): { name: string; browser_download_url: string } | null {
  if (!assets || !Array.isArray(assets) || assets.length === 0) {
    console.log('[Updater] 没有可用的资产');
    return null;
  }

  const platform = navigator.platform.toLowerCase();
  const userAgent = navigator.userAgent.toLowerCase();
  const arch = getSystemArchitecture();

  console.log(`[Updater] 平台信息: platform=${platform}, userAgent=${userAgent}, arch=${arch}`);

  // Android 平台
  if (userAgent.includes('android') || platform.includes('android')) {
    console.log('[Updater] 检测到 Android 平台');

    // 如果系统支持 ARM64，优先找 ARM64 APK
    if (arch === 'arm64') {
      console.log('[Updater] 系统支持 ARM64，开始查找 ARM64 APK...');

      // 查找包含 arm64 的 APK（不区分大小写）
      const arm64Apk = assets.find(a => {
        const nameLower = a.name.toLowerCase();
        const isMatch = nameLower.includes('arm64') && nameLower.endsWith('.apk');
        console.log(`[Updater] 检查资产: ${a.name}, 匹配: ${isMatch}`);
        return isMatch;
      });

      if (arm64Apk) {
        console.log(`[Updater] ✅ 找到 ARM64 APK: ${arm64Apk.name}`);
        return arm64Apk;
      }
      console.log('[Updater] ❌ 未找到 ARM64 APK，将尝试 universal');
    }

    // 如果系统是 ARM 但不支持 ARM64，找 ARM APK
    if (arch === 'arm') {
      console.log('[Updater] 系统是 ARM，开始查找 ARM APK...');
      const armApk = assets.find(a => {
        const nameLower = a.name.toLowerCase();
        return (nameLower.includes('armeabi') || nameLower.includes('arm-v7a') || nameLower.includes('armeabi-v7a')) &&
               nameLower.endsWith('.apk') &&
               !nameLower.includes('arm64');
      });
      if (armApk) {
        console.log(`[Updater] ✅ 找到 ARM APK: ${armApk.name}`);
        return armApk;
      }
      console.log('[Updater] ❌ 未找到 ARM APK，将尝试 universal');
    }

    // 回退到 Universal APK（支持所有架构）
    console.log('[Updater] 开始查找 Universal APK...');
    const universalApk = assets.find(a => {
      const nameLower = a.name.toLowerCase();
      return nameLower.includes('universal') && nameLower.endsWith('.apk');
    });
    if (universalApk) {
      console.log(`[Updater] ✅ 找到 Universal APK: ${universalApk.name}`);
      return universalApk;
    }

    // 最后找任意 APK
    console.log('[Updater] 开始查找任意 APK...');
    const anyApk = assets.find(a => a.name.toLowerCase().endsWith('.apk'));
    if (anyApk) {
      console.log(`[Updater] ✅ 找到 APK: ${anyApk.name}`);
      return anyApk;
    }

    console.log('[Updater] ❌ 未找到任何 APK');
    return null;
  }

  // Windows 平台
  if (platform.includes('win') || userAgent.includes('windows')) {
    return assets.find(a => a.name.toLowerCase().endsWith('.exe')) ??
           assets.find(a => a.name.toLowerCase().includes('windows') && a.name.toLowerCase().endsWith('.zip')) ??
           null;
  }

  // macOS 平台
  if (platform.includes('mac') || userAgent.includes('mac')) {
    return assets.find(a => a.name.toLowerCase().endsWith('.dmg')) ??
           assets.find(a => a.name.toLowerCase().includes('macos') && a.name.toLowerCase().endsWith('.zip')) ??
           null;
  }

  // Linux 平台
  if (platform.includes('linux') || userAgent.includes('linux')) {
    return assets.find(a => a.name.toLowerCase().endsWith('.appimage')) ??
           assets.find(a => a.name.toLowerCase().includes('linux') && a.name.toLowerCase().endsWith('.zip')) ??
           null;
  }

  return null;
}

/**
 * 下载 APK 文件
 * 使用 Tauri 后端命令下载，支持 Android 平台和实时进度回调。
 * 会依次尝试首选地址（Gitee）与备用地址（GitHub），任一成功即返回。
 */
export async function downloadApk(
  url: string,
  filename: string,
  onProgress?: (progress: DownloadProgress) => void,
  fallbackUrls?: string[]
): Promise<string> {
  const candidates = [url, ...(fallbackUrls || []).filter((u) => !!u && u !== url)];
  console.log(`[Updater] 开始下载 APK，候选地址数: ${candidates.length}`);
  console.log(`[Updater] 文件名: ${filename}`);

  let lastError: unknown;

  for (const candidate of candidates) {
    try {
      console.log(`[Updater] 尝试下载: ${candidate}`);

      // 创建 Channel 接收进度回调
      const progressChannel = new Channel<DownloadProgress>();

      // 设置进度回调处理
      if (onProgress) {
        progressChannel.onmessage = (progress) => {
          onProgress(progress);
        };
      }

      // 调用 Tauri 后端命令下载文件
      const filePath = await invoke<string>('download_apk', {
        url: candidate,
        filename,
        onProgress: progressChannel
      });

      console.log(`[Updater] 下载完成: ${filePath}`);

      return filePath;
    } catch (error) {
      lastError = error;
      console.warn(`[Updater] 下载失败，尝试下一个源: ${candidate}`, error);
    }
  }

  console.error('[Updater] 所有下载源均失败:', lastError);
  throw lastError instanceof Error ? lastError : new Error(String(lastError ?? '所有下载源均不可用'));
}

/**
 * 安装 APK 文件
 * 调用 Android 系统安装器
 */
export async function installApk(filePath: string): Promise<string> {
  console.log(`[Updater] 开始安装 APK: ${filePath}`);

  try {
    // 调用 Tauri 后端命令
    const result = await invoke<string>('install_apk', {
      apkPath: filePath
    });

    console.log(`[Updater] 安装结果: ${result}`);

    // Android 安装已由原生侧处理
    if (isAndroid()) {
      return result;
    }

    // 非 Android 平台回退尝试打开文件
    try {
      await open(`file://${filePath}`);
      return '已尝试打开安装文件';
    } catch (e) {
      console.log('[Updater] shell open 失败');
      return result;
    }
  } catch (error) {
    console.error('[Updater] 安装失败:', error);
    throw error;
  }
}

/**
 * 下载并安装 APK
 * 一键完成下载和安装
 */
export async function downloadAndInstallApk(
  url: string,
  filename: string,
  onProgress?: (progress: DownloadProgress) => void
): Promise<string> {
  console.log(`[Updater] 开始下载并安装: ${url}`);

  try {
    // 先下载
    const filePath = await downloadApk(url, filename, onProgress);

    console.log('[Updater] 下载完成，开始安装');

    // 再安装
    const result = await installApk(filePath);

    return result;
  } catch (error) {
    console.error('[Updater] 下载并安装失败:', error);
    throw error;
  }
}

/**
 * 检查是否在 Tauri 环境中（统一实现见 utils/env.ts）
 */
import { isTauri } from './env';
export { isTauri };

/**
 * 检查是否在 Android 环境中（统一实现见 utils/env.ts）
 */
import { isAndroid } from './env';
export { isAndroid };

