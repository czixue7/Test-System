import type { DownloadProgress, UpdateInfo } from './updater';

export type UpdatePhase = 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'installing' | 'permission' | 'latest' | 'cancelled' | 'error';
export type UpdateTone = 'blue' | 'green' | 'amber' | 'red' | 'slate';
export interface UpdateStageModel {
  phase: UpdatePhase; title: string; description: string; tone: UpdateTone; step: number;
  progress?: number; detail: string; version?: string; source?: string; badge: string;
}
interface UpdaterView {
  checkingUpdate: boolean; updateInfo: UpdateInfo | null;
  downloadStatus: 'idle' | 'downloading' | 'downloaded' | 'installing';
  downloadProgress: DownloadProgress; logs: string[];
}
const descriptions: Record<UpdatePhase, Omit<UpdateStageModel, 'phase'>> = {
  idle: { title: '准备检查更新', description: '查看是否有可用的新版本。', tone: 'slate', step: 0, detail: '点击下方按钮开始检查', badge: '待开始' },
  checking: { title: '正在检查更新', description: '正在获取版本信息，请稍候。', tone: 'blue', step: 0, detail: '连接发布源，核对版本与构建号', badge: '检查中' },
  available: { title: '发现新版本', description: '新版本已就绪，可以开始下载。', tone: 'blue', step: 0, detail: '版本信息已确认', badge: '可更新' },
  downloading: { title: '正在下载更新', description: '下载完成后即可安装。', tone: 'blue', step: 1, detail: '正在接收安装包', badge: '下载中' },
  ready: { title: '安装包已就绪', description: '下载完成，可直接安装，无需重复下载。', tone: 'green', step: 2, progress: 100, detail: '安装包已保留', badge: '已下载' },
  installing: { title: '正在启动安装', description: '请在系统安装界面中继续。', tone: 'blue', step: 3, detail: '正在交接给系统安装器', badge: '安装中' },
  permission: { title: '需要安装权限', description: '允许安装此来源的应用后，返回再次安装。', tone: 'amber', step: 3, detail: '安装包已保留，授权后可继续', badge: '待授权' },
  latest: { title: '当前已是最新版本', description: '版本检查完成，暂无可用更新。', tone: 'green', step: 0, detail: '本次检查已完成', badge: '已完成' },
  cancelled: { title: '下载已取消', description: '未完成的临时文件已清理，可以重新下载。', tone: 'slate', step: 1, detail: '取消与清理已完成', badge: '已取消' },
  error: { title: '更新遇到问题', description: '本次操作未完成，请查看原因后重试。', tone: 'red', step: 1, detail: '无法连接下载源，请稍后重试', badge: '未完成' },
};

export function createUpdateStage(phase: UpdatePhase, extras: Partial<UpdateStageModel> = {}): UpdateStageModel {
  return { phase, ...descriptions[phase], ...extras };
}
export function resolveUpdateStage(state: UpdaterView): UpdateStageModel {
  const { updateInfo: info, downloadProgress: progress, logs } = state;
  const extras = { version: info?.latestVersion, source: info?.sourceName || (info?.source === 'gitee' ? 'Gitee' : info?.source === 'github' ? 'GitHub' : info?.source === 'service' ? '电脑服务' : undefined) };
  if (state.checkingUpdate) return createUpdateStage('checking', extras);
  if (state.downloadStatus === 'downloading') {
    const percentage = Number.isFinite(progress.percentage) ? Math.max(0, Math.min(100, progress.percentage)) : 0;
    return createUpdateStage('downloading', { ...extras, progress: percentage,
      detail: progress.total > 0 ? `${(progress.downloaded / 1048576).toFixed(1)} / ${(progress.total / 1048576).toFixed(1)} MB` : '正在获取安装包大小' });
  }
  if (state.downloadStatus === 'installing') return createUpdateStage('installing', extras);
  // A new operation supersedes an earlier failure or cancellation.
  let operationStart = 0;
  for (let index = logs.length - 1; index >= 0; index--) {
    if (/开始检查更新|开始下载|开始安装/.test(logs[index])) { operationStart = index; break; }
  }
  const last = logs.slice(Math.max(0, operationStart)).map(log => log.replace(/^\[.*?\]\s*/, '')).join('\n');
  if (state.downloadStatus === 'downloaded') {
    if (/安装失败/.test(last)) return createUpdateStage('error', { ...extras, step: 3,
      title: '未能启动安装', description: '安装包已保留，可以重试安装。', detail: last.split('\n').find(log => /安装失败/.test(log)) || last });
    return createUpdateStage(/未知来源|需要允许安装/.test(last) ? 'permission' : 'ready', extras);
  }
  if (info?.error) return createUpdateStage('error', { ...extras, step: 0, detail: info.message });
  if (/下载失败|安装失败|取消下载失败|检查更新失败/.test(last)) return createUpdateStage('error', { ...extras, step: /检查更新失败/.test(last) ? 0 : /安装失败/.test(last) ? 3 : 1,
    detail: last.split('\n').find(log => /下载失败|安装失败|取消下载失败|检查更新失败/.test(log)) || last });
  if (/下载已取消.*清理/.test(last)) return createUpdateStage('cancelled', extras);
  if (info?.hasUpdate) return createUpdateStage('available', extras);
  if (info) return createUpdateStage('latest', extras);
  return createUpdateStage('idle');
}
