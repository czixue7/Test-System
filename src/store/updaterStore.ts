import { create } from 'zustand';
import { sourceTokenFor } from '../utils/dataSourceRequest';
import { updateSourcesFingerprint as sourcesFingerprint, useDataSourceStore } from './dataSourceStore';
import {
  checkUpdate as doCheckUpdate,
  downloadApk,
  cancelApkDownload,
  canInstallApk,
  installApk,
  isTauri,
  isAndroid,
  UpdateInfo,
  DownloadProgress,
} from '../utils/updater';

export type DownloadStatus = 'idle' | 'downloading' | 'downloaded' | 'installing';

/**
 * 每次下载使用独立标识；原生取消确认并清理后，才允许再次下载。
 */
let downloadGeneration = 0;
let activeDownload: { id: string; controller: AbortController; promise: Promise<string> } | null = null;
/** 正在跳转「未知来源应用」授权页，避免重复点击叠加多个设置页。 */
let permissionPrompting = false;
/** 系统安装器接管后不会回调结果，超时后恢复为可再次点击。 */
const INSTALL_RESPONSE_TIMEOUT = 15000;

/** 回到前台时触发回调；非浏览器环境（如测试）返回空清理函数。 */
function watchAppResume(onResume: () => void): () => void {
  const doc = typeof document !== 'undefined' ? document : null;
  const win = typeof window !== 'undefined' ? window : null;
  if (!doc && !win) return () => {};
  const handler = () => {
    if (!doc || doc.visibilityState === 'visible') onResume();
  };
  doc?.addEventListener?.('visibilitychange', handler);
  win?.addEventListener?.('focus', handler);
  return () => {
    doc?.removeEventListener?.('visibilitychange', handler);
    win?.removeEventListener?.('focus', handler);
  };
}

const updateKey = (info: UpdateInfo | null) => info ? `${info.latestVersion}-${info.versionHash || 'release'}` : '';

interface UpdaterState {
  checkingUpdate: boolean;
  updateInfo: UpdateInfo | null;
  downloadStatus: DownloadStatus;
  downloadProgress: DownloadProgress;
  downloadedFilePath: string;
  logs: string[];

  /** 检查更新（后台执行，关闭弹窗不中断） */
  checkForUpdate: () => Promise<void>;
  /** 开始下载（后台执行，关闭弹窗不中断） */
  startDownload: () => Promise<void>;
  /** 取消下载 */
  cancelDownload: () => Promise<void>;
  /** 安装已下载的更新 */
  installUpdate: () => Promise<void>;
  /** 添加日志 */
  addLog: (message: string) => void;
  /** 重置所有状态（用户手动触发） */
  resetState: () => void;
}

export const useUpdaterStore = create<UpdaterState>((set, get) => ({
  checkingUpdate: false,
  updateInfo: null,
  downloadStatus: 'idle',
  downloadProgress: { downloaded: 0, total: 0, percentage: 0 },
  downloadedFilePath: '',
  logs: [],

  addLog: (message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    const logMessage = `[${timestamp}] ${message}`;
    console.log(logMessage);
    set((state) => ({
      logs: [...state.logs.slice(-49), logMessage],
    }));
  },

  checkForUpdate: async () => {
    const { addLog } = get();
    if (get().checkingUpdate || activeDownload || get().downloadStatus === 'installing') return;
    const previous = get();
    set({
      checkingUpdate: true,
    });
    addLog('开始检查更新...');

    try {
      const info = await doCheckUpdate();
      if (info.error && previous.downloadedFilePath) {
        addLog(`检查失败，保留已下载的安装包: ${info.message}`);
        return;
      }
      set({ updateInfo: info });
      if (updateKey(info) !== updateKey(previous.updateInfo)) {
        set({ downloadedFilePath: '', downloadStatus: 'idle', downloadProgress: { downloaded: 0, total: 0, percentage: 0 } });
      }
      if (info.error) {
        addLog(`❌ 检查失败: ${info.message}`);
      } else {
        addLog(`检查结果: ${info.message}`);
      }
      if (info.downloadUrl) {
        addLog(`下载链接: ${info.downloadUrl}`);
      }
    } catch (error) {
      addLog(`❌ 检查更新失败: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      set({ checkingUpdate: false });
    }
  },

  startDownload: async () => {
    const { updateInfo, addLog } = get();
    if (!useDataSourceStore.getState().updatesEnabled) { addLog('软件更新已关闭'); return; }
    if (activeDownload || get().downloadStatus === 'installing' || get().checkingUpdate) return;
    if (get().downloadedFilePath) {
      set({ downloadStatus: 'downloaded' });
      addLog('安装包已下载，直接使用现有文件');
      return;
    }
    if (!updateInfo?.downloadUrl) {
      addLog('错误: 没有可用的下载链接');
      return;
    }

    if (updateInfo.sourcesFingerprint && updateInfo.sourcesFingerprint !== sourcesFingerprint()) {
      addLog('数据来源已修改，请重新检查更新');
      return;
    }

    if (!isTauri()) {
      if (sourceTokenFor(updateInfo.downloadUrl)) {
        addLog('电脑服务安装包需要在桌面或 Android 应用中下载');
        return;
      }
      addLog('错误: 不在 Tauri 环境中，无法使用原生下载');
      window.open(updateInfo.downloadUrl, '_blank');
      return;
    }

    // Native cancellation closes the request and removes .part before retries are allowed.
    set({ downloadStatus: 'downloading' });
    const generation = ++downloadGeneration;
    const id = `apk-${generation}-${Date.now()}`;
    const controller = new AbortController();
    addLog('开始下载安装包...');

    try {
      const assetName = (updateInfo.assetName || 'update.apk').replace(/[^a-zA-Z0-9._-]/g, '_');
      const filename = `app-update-${updateKey(updateInfo).replace(/[^a-zA-Z0-9._-]/g, '_')}-${assetName}`;
      addLog(`文件名: ${filename}`);

      const promise = downloadApk(
        updateInfo.downloadUrl,
        filename,
        (progress) => {
          // 已取消（generation 过期）后忽略迟到的进度回调，
          // 否则界面会被「复活」成下载中
          if (controller.signal.aborted || generation !== downloadGeneration) return;
          set({ downloadProgress: progress });
        },
        // 首选源（Gitee）失败时回退到备用源（GitHub）
        [updateInfo.fallbackDownloadUrl].filter((url): url is string => !!url),
        id,
        controller.signal
      );
      activeDownload = { id, controller, promise };
      const filePath = await promise;

      if (generation !== downloadGeneration) {
        addLog('该次下载已被取消，忽略其结果');
        return;
      }

      addLog(`下载完成: ${filePath}`);
      set({ downloadedFilePath: filePath, downloadStatus: 'downloaded' });
    } catch (error) {
      addLog(controller.signal.aborted ? '下载已取消，未完成文件已清理' : `下载失败: ${error instanceof Error ? error.message : String(error)}`);
      if (generation === downloadGeneration) {
        set({ downloadStatus: 'idle' });
      }
    } finally {
      if (activeDownload?.id === id) activeDownload = null;
    }
  },

  cancelDownload: async () => {
    const { addLog } = get();
    const download = activeDownload;
    if (!download || download.controller.signal.aborted) return;
    download.controller.abort();
    addLog('正在取消下载并清理临时文件...');
    try {
      await cancelApkDownload(download.id);
      await download.promise.catch(() => undefined);
      set({ downloadProgress: { downloaded: 0, total: 0, percentage: 0 } });
    } catch (error) {
      addLog(`取消下载失败: ${String(error)}`);
    }
  },

  installUpdate: async () => {
    const { downloadedFilePath, addLog } = get();
    if (!downloadedFilePath) {
      addLog('错误: 没有下载好的文件');
      return;
    }

    if (!isTauri()) {
      addLog('错误: 不在 Tauri 环境中');
      return;
    }

    if (get().downloadStatus === 'installing') {
      addLog('安装器正在启动，请稍候');
      return;
    }
    if (permissionPrompting) {
      addLog('正在等待安装权限授权，请返回应用后再试');
      return;
    }

    addLog(isAndroid() ? '开始安装 APK...' : '正在打开下载文件...');
    addLog(`文件路径: ${downloadedFilePath}`);

    // Android 每次点击安装都先确认「未知来源应用」权限：
    // 未授权时只跳转设置，不进入安装中状态，返回后可直接再次点击安装。
    if (isAndroid() && !(await canInstallApk())) {
      permissionPrompting = true;
      addLog('需要允许安装未知来源应用，已打开系统设置');
      addLog('请在设置中允许后返回应用，再次点击「安装更新」');
      try {
        // 原生安装命令在无权限时只负责打开授权页。
        await installApk(downloadedFilePath);
      } catch (error) {
        addLog(`打开安装权限设置失败: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        permissionPrompting = false;
      }
      set({ downloadStatus: 'downloaded' });
      return;
    }

    set({ downloadStatus: 'installing' });
    // 安装器接管或停留在系统界面时，回到应用即恢复为可再次安装。
    const stopWatching = watchAppResume(() => {
      if (get().downloadStatus !== 'installing') return;
      addLog('已返回应用，安装包仍保留，可再次点击安装');
      set({ downloadStatus: 'downloaded' });
    });
    let timer: ReturnType<typeof setTimeout> | undefined;

    try {
      const result = await Promise.race([
        installApk(downloadedFilePath),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('安装器响应超时')), INSTALL_RESPONSE_TIMEOUT);
        }),
      ]);
      addLog(`安装结果: ${result}`);

      if (result === 'REQUEST_INSTALL_PERMISSION') {
        addLog('⚠️ 需要允许安装未知来源应用，已跳转系统设置');
        addLog('请在系统设置中允许后，返回应用再次点击安装');
      } else if (!isAndroid()) {
        addLog('下载目录已打开，请关闭当前程序后手动安装或替换便携版');
      } else if (result === 'INSTALL_INTENT_SENT' || result.includes('已尝试打开') || result.includes('成功')) {
        addLog('✅ 系统安装器已启动，请查看系统界面');
      } else {
        addLog('⚠️ 自动安装可能未成功');
        addLog('请手动到下载目录中找到安装包并更新');
        addLog(`文件位置: ${downloadedFilePath}`);
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : '未知错误';
      addLog(`❌ 安装失败: ${detail}`);
      addLog(detail.includes('超时') ? '安装器未响应，安装包已保留，可重试安装' : '安装包已保留，可直接重试安装');
    } finally {
      if (timer) clearTimeout(timer);
      stopWatching();
      // 原生侧无法回传「用户是否真的装完」，因此无论拉起安装器、
      // 跳转权限设置还是失败，都统一回到「点击安装」，避免按钮卡在
      // 「正在启动安装...」这类无法收敛的中间态。
      set({ downloadStatus: 'downloaded' });
    }
  },

  resetState: () => {
    if (activeDownload || get().downloadedFilePath || get().checkingUpdate || get().downloadStatus === 'installing') return;
    set({
      checkingUpdate: false,
      updateInfo: null,
      downloadStatus: 'idle',
      downloadProgress: { downloaded: 0, total: 0, percentage: 0 },
      downloadedFilePath: '',
      logs: [],
    });
  },
}));
