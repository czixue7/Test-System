import { create } from 'zustand';
import {
  checkUpdate as doCheckUpdate,
  downloadApk,
  installApk,
  isTauri,
  isAndroid,
  UpdateInfo,
  DownloadProgress,
} from '../utils/updater';

export type DownloadStatus = 'idle' | 'downloading' | 'downloaded' | 'installing';

/**
 * 下载代次。native 侧 download_apk 无法被中止，用代次号让「取消」之后
 * 迟到的进度/完成回调全部失效，避免界面被复活、以及被标记成「已下载」。
 */
let downloadGeneration = 0;

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
  cancelDownload: () => void;
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
    set({
      checkingUpdate: true,
      updateInfo: null,
      downloadStatus: 'idle',
      downloadProgress: { downloaded: 0, total: 0, percentage: 0 },
      downloadedFilePath: '',
    });
    addLog('开始检查更新...');

    try {
      const info = await doCheckUpdate();
      set({ updateInfo: info });
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
    if (!updateInfo?.downloadUrl) {
      addLog('错误: 没有可用的下载链接');
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

    // 防止并发重复下载：native 侧下载无法真正中止，
    // 若在「取消」后允许再次启动，两次下载会写入同一个
    // Download/app-update-<ver>.apk（Rust 用 File::create 截断打开），
    // 交错写入会产出损坏的 APK。
    set({ downloadStatus: 'downloading' });
    const generation = ++downloadGeneration;
    addLog('开始下载 APK...');

    try {
      const filename = `app-update-${updateInfo.latestVersion}.apk`;
      addLog(`文件名: ${filename}`);

      const filePath = await downloadApk(
        updateInfo.downloadUrl,
        filename,
        (progress) => {
          // 已取消（generation 过期）后忽略迟到的进度回调，
          // 否则界面会被「复活」成下载中
          if (generation !== downloadGeneration) return;
          set({ downloadProgress: progress });
        }
      );

      if (generation !== downloadGeneration) {
        addLog('该次下载已被取消，忽略其结果');
        return;
      }

      addLog(`下载完成: ${filePath}`);
      set({ downloadedFilePath: filePath, downloadStatus: 'downloaded' });
    } catch (error) {
      addLog(`下载失败: ${error instanceof Error ? error.message : '未知错误'}`);
      if (generation === downloadGeneration) {
        set({ downloadStatus: 'idle' });
      }
    }
  },

  cancelDownload: () => {
    const { addLog } = get();
    addLog('用户取消下载（native 下载仍在后台完成，但其进度与结果将被忽略）');
    // 让在途下载的回调全部失效：native 侧无法真正 abort，
    // 至少要保证它不会再覆盖界面状态、也不会把结果标记成「已下载」
    downloadGeneration++;
    set({
      downloadStatus: 'idle',
      downloadProgress: { downloaded: 0, total: 0, percentage: 0 },
    });
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
      set({ downloadStatus: 'downloaded' });
    }
  },

  resetState: () => {
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
