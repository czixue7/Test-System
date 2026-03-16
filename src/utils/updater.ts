import { invoke } from '@tauri-apps/api/core';
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
}

const currentVersion = '0.3.5';

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
 * 从 GitHub Releases 获取最新版本信息
 */
export async function checkUpdate(): Promise<UpdateInfo> {
  console.log('[Updater] 开始检查更新...');

  try {
    const response = await fetch('https://api.github.com/repos/czixue7/Test-System/releases/latest');

    if (!response.ok) {
      throw new Error(`无法获取版本信息: ${response.status}`);
    }

    const data = await response.json();
    const latestVersion = data.tag_name?.replace(/^v/, '') || '0.0.0';

    console.log(`[Updater] 当前版本: ${currentVersion}, 最新版本: ${latestVersion}`);
    console.log(`[Updater] GitHub API 返回的资产数量: ${data.assets?.length || 0}`);
    
    // 打印所有资产名称用于调试
    if (data.assets && Array.isArray(data.assets)) {
      console.log('[Updater] GitHub 可用资产列表:');
      data.assets.forEach((asset: any, index: number) => {
        console.log(`  [${index}] ${asset.name}`);
      });
    }

    const compareVersions = (v1: string, v2: string): number => {
      const parts1 = v1.split('.').map(Number);
      const parts2 = v2.split('.').map(Number);
      for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
        const p1 = parts1[i] || 0;
        const p2 = parts2[i] || 0;
        if (p1 > p2) return 1;
        if (p1 < p2) return -1;
      }
      return 0;
    };

    const hasUpdate = compareVersions(latestVersion, currentVersion) > 0;

    if (hasUpdate) {
      console.log('[Updater] 发现新版本');

      // 获取适合当前平台的下载链接
      const asset = getPlatformAsset(data.assets);

      if (asset) {
        console.log(`[Updater] 找到适合的下载链接: ${asset.browser_download_url}`);
        return {
          hasUpdate: true,
          latestVersion,
          message: `发现新版本 v${latestVersion}`,
          downloadUrl: asset.browser_download_url,
          assetName: asset.name
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
      return {
        hasUpdate: false,
        latestVersion,
        message: '当前已是最新版本'
      };
    }
  } catch (error) {
    console.error('[Updater] 检查更新失败:', error);
    return {
      hasUpdate: false,
      latestVersion: currentVersion,
      message: error instanceof Error ? error.message : '检查更新失败'
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
 * 使用 Tauri 后端命令下载，支持 Android 平台
 */
export async function downloadApk(
  url: string,
  filename: string,
  onProgress?: (progress: DownloadProgress) => void
): Promise<string> {
  console.log(`[Updater] 开始下载 APK: ${url}`);
  console.log(`[Updater] 文件名: ${filename}`);

  try {
    // 调用 Tauri 后端命令下载文件
    const filePath = await invoke<string>('download_apk', {
      url,
      filename
    });

    console.log(`[Updater] 下载完成: ${filePath}`);

    // 模拟进度回调（因为当前实现是一次性下载）
    if (onProgress) {
      onProgress({
        downloaded: 100,
        total: 100,
        percentage: 100
      });
    }

    return filePath;
  } catch (error) {
    console.error('[Updater] 下载失败:', error);
    throw error;
  }
}

/**
 * 安装 APK 文件
 * 调用 Android 系统安装器
 */
export async function installApk(filePath: string): Promise<string> {
  console.log(`[Updater] 开始安装 APK: ${filePath}`);

  try {
    // 调用 Tauri 后端命令
    // 注意：当前后端实现只是返回路径，实际的安装需要通过其他方式实现
    const result = await invoke<string>('install_apk', {
      apkPath: filePath
    });

    console.log(`[Updater] 安装结果: ${result}`);
    
    // 如果后端返回的是文件路径，说明需要前端处理安装
    if (result === filePath) {
      // 尝试使用 shell open 来触发安装
      // 在 Android 上，这会尝试打开文件
      try {
        await open(`file://${filePath}`);
        return '已尝试打开安装文件';
      } catch (e) {
        console.log('[Updater] shell open 失败，尝试其他方式');
        // 如果 shell open 失败，返回路径让前端处理
        return result;
      }
    }
    
    return result;
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
 * 检查是否在 Tauri 环境中
 */
export function isTauri(): boolean {
  return typeof window !== 'undefined' &&
         typeof (window as any).__TAURI_INTERNALS__ !== 'undefined';
}

/**
 * 检查是否在 Android 环境中
 */
export function isAndroid(): boolean {
  const userAgent = navigator.userAgent.toLowerCase();
  return userAgent.includes('android');
}
