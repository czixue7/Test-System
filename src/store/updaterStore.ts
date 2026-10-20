import { create } from 'zustand';
import { updateSourcesFingerprint as sourcesFingerprint, useDataSourceStore } from './dataSourceStore';
import {
  checkUpdate as doCheckUpdate,
  downloadApk,
  cancelApkDownload,
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
      addLog('错误: 不在 Tauri 环境中，无法使用原生下载');
      window.open(updateInfo.downloadUrl, '_blank');
      return;
    }

    if (!isAndroid()) {
      addLog('错误: 不在 Android 环境中');
      window.open(updateInfo.downloadUrl, '_blank');
      return;
    }

    // Native cancellation closes the request and removes .part before retries are allowed.
    set({ downloadStatus: 'downloading' });
    const generation = ++downloadGeneration;
    const id = `apk-${generation}-${Date.now()}`;
    const controller = new AbortController();
    addLog('开始下载 APK...');

    try {
      const filename = `app-update-${updateKey(updateInfo).replace(/[^a-zA-Z0-9._-]/g, '_')}.apk`;
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

    if (!isAndroid()) {
      addLog('错误: 不在 Android 环境中');
      return;
    }

    set({ downloadStatus: 'installing' });
    addLog('开始安装 APK...');
    addLog(`文件路径: ${downloadedFilePath}`);

    try {
      const result = await installApk(downloadedFilePath);
      addLog(`安装结果: ${result}`);

      if (result === 'REQUEST_INSTALL_PERMISSION') {
        addLog('⚠️ 需要允许安装未知来源应用，已跳转系统设置');
        addLog('请在系统设置中允许后，返回应用再次点击安装');
      } else if (result === 'INSTALL_INTENT_SENT' || result.includes('已尝试打开') || result.includes('成功')) {
        addLog('✅ 系统安装器已启动，请查看系统界面');
      } else {
        addLog('⚠️ 自动安装可能未成功');
        addLog('请手动到下载目录中找到 APK 文件并点击安装');
        addLog(`文件位置: ${downloadedFilePath}`);
      }
    } catch (error) {
      addLog(`❌ 安装失败: ${error instanceof Error ? error.message : '未知错误'}`);
      addLog('请手动到下载目录中找到 APK 文件并点击安装');
    } finally {
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
