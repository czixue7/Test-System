import { invoke, Channel } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-shell';
import { configuredRelease, compareVersions, compareBuildNumbers } from './releaseSources';
import { sourceTokenFor } from './dataSourceRequest';
import { platformAsset } from './updateAssets';
import { updateSourcesFingerprint as sourcesFingerprint, useDataSourceStore } from '../store/dataSourceStore';

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
  /** 仅使用已启用且版本和构建均相同的备用来源 */
  fallbackDownloadUrl?: string;
  versionHash?: string;
  /** 实际采用的发布源 */
  source?: 'gitee' | 'github' | 'service';
  sourceId?: string;
  sourceName?: string;
  sourcesFingerprint?: string;
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

const currentVersion = '0.4.4';

/**
 * 当前版本哈希（每次构建时更新）
 * 用于区分同一版本的不同构建
 */
export const CURRENT_VERSION_HASH = '20261021'; // 每次发布时更新此值

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
 * 检查更新
 * 检查已启用的数据来源，取更高版本和构建，相同时按列表顺序选择。
 * Tauri 环境通过 Rust 请求，浏览器环境使用 fetch。
 */
export async function checkUpdate(): Promise<UpdateInfo> {
  console.log('[Updater] 开始检查更新...');
  console.log(`[Updater] 当前版本: ${currentVersion}, 当前哈希: ${CURRENT_VERSION_HASH}`);

  try {
    const result = await configuredRelease();
    const latestVersion = result.latest_version;
    const latestHash = result.version_hash;
    const assets = result.assets;
    const fallbackAssets = result.fallback_assets;
    const sourceLabel = result.source;
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
          sourceId: result.sourceId,
          sourceName: result.sourceName,
          sourcesFingerprint: sourcesFingerprint(),
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
function getPlatformAsset(assets: { name: string; browser_download_url: string }[]) {
  return platformAsset(assets);
}

/**
 * 下载 APK 文件
 * 使用 Tauri 后端命令下载，支持 Android 平台和实时进度回调。
 * 依次尝试已配置的首选和备用地址，修改来源后停止后续尝试。
 */
export async function downloadApk(
  url: string,
  filename: string,
  onProgress?: (progress: DownloadProgress) => void,
  fallbackUrls?: string[],
  downloadId?: string,
  signal?: AbortSignal
): Promise<string> {
  if (!useDataSourceStore.getState().updatesEnabled) throw new Error('软件更新已关闭');
  const candidates = [url, ...(fallbackUrls || []).filter((u) => !!u && u !== url)];
  const configuredSources = sourcesFingerprint();
  console.log(`[Updater] 开始下载 APK，候选地址数: ${candidates.length}`);
  console.log(`[Updater] 文件名: ${filename}`);

  let lastError: unknown;

  for (const candidate of candidates) {
    if (signal?.aborted) throw new Error('下载已取消');
    if (configuredSources !== sourcesFingerprint()) throw new Error('数据来源已修改，请重新检查更新');
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
        bearerToken: sourceTokenFor(candidate),
        url: candidate,
        filename,
        downloadId: downloadId || filename,
        onProgress: progressChannel
      });

      console.log(`[Updater] 下载完成: ${filePath}`);

      return filePath;
    } catch (error) {
      if (signal?.aborted) throw new Error('下载已取消');
      lastError = error;
      console.warn(`[Updater] 下载失败，尝试下一个源: ${candidate}`, error);
    }
  }

  console.error('[Updater] 所有下载源均失败:', lastError);
  throw lastError instanceof Error ? lastError : new Error(String(lastError ?? '所有下载源均不可用'));
}

export async function cancelApkDownload(downloadId: string): Promise<void> {
  await invoke('cancel_apk_download', { downloadId });
}

/**
 * 安装 APK 文件
 * 调用 Android 系统安装器
 */
export async function installApk(filePath: string): Promise<string> {
  if (!isAndroid()) {
    return invoke<string>('install_apk', { apkPath: filePath });
  }
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

