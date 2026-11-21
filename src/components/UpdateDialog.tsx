import React, { useMemo } from 'react';
import Modal from './Modal';
import MarkdownView from './MarkdownView';
import UpdateLogPanel from './UpdateLogPanel';
import { useUpdaterStore } from '../store/updaterStore';
import { CURRENT_VERSION, CURRENT_VERSION_HASH } from '../utils/updater';
import { resolveUpdateStage } from '../utils/updateStages';
import { getUpdateStageAction } from '../utils/updateActions';

interface UpdateDialogProps {
  open: boolean;
  onClose: () => void;
}

/**
 * 启动时检测到新版本后弹出的更新弹窗。
 * 上半部分只保留进度条与过程详情（阶段名称、四步流程等由底部按钮和进度体现），尽量压缩高度。
 */
const UpdateDialog: React.FC<UpdateDialogProps> = ({ open, onClose }) => {
  const updater = useUpdaterStore();
  const stage = useMemo(
    () => resolveUpdateStage(updater),
    [updater.checkingUpdate, updater.downloadStatus, updater.downloadProgress, updater.updateInfo, updater.logs],
  );
  const info = updater.updateInfo;
  const downloading = stage.phase === 'downloading';
  const percentage = Number.isFinite(updater.downloadProgress.percentage)
    ? Math.max(0, Math.min(100, updater.downloadProgress.percentage))
    : 0;
  // 非下载阶段按阶段含义给固定进度：已下载/已就绪为 100%，其余为 0%。
  const finished = !!updater.downloadedFilePath || ['ready', 'permission', 'installing', 'latest'].includes(stage.phase);
  const progress = downloading ? percentage : finished ? 100 : 0;
  const action = getUpdateStageAction(stage, !!updater.downloadedFilePath);
  const callbacks = { check: updater.checkForUpdate, download: updater.startDownload, install: updater.installUpdate };
  const run = (callback: () => Promise<void>) => {
    void callback().catch(error => updater.addLog(`更新操作失败: ${String(error)}`));
  };
  const primary = action ?? { kind: 'download' as const, label: `下载中 ${Math.round(percentage)}%`, disabled: true };
  // 没有更新说明时不占用空间，也避免把「当前已是最新版本」这类状态文案当成说明展示。
  const notes = info?.releaseNotes?.trim();
  // 右侧显示已下载/总大小；没有总大小时退回百分比
  const { downloaded, total } = updater.downloadProgress;
  const sizeLabel = total > 0
    ? `${(downloaded / 1048576).toFixed(1)}/${(total / 1048576).toFixed(1)}MB`
    : `${Math.round(progress)}%`;
  const versionLine = `当前 ${CURRENT_VERSION}（${CURRENT_VERSION_HASH}）${info?.latestVersion ? ` → 最新 ${info.latestVersion}${info.versionHash ? `（${info.versionHash}）` : ''}` : ''}`;

  return (
    <Modal open={open} onClose={onClose} className="update-dialog w-full max-w-sm" containerClassName="update-overlay">
      <div className="update-info-box">
        {notes && (
          <div className="update-info-notes-block">
            <p className="update-info-notes-title">更新说明</p>
            <div className="update-info-notes" role="region" aria-label="更新说明">
              <MarkdownView content={notes} />
            </div>
          </div>
        )}
        <div className="update-progress-strip">
          <div
            className="update-progress-bar"
            role="progressbar"
            aria-label="更新进度"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress)}
          >
            <span style={{ transform: `scaleX(${progress / 100})` }} />
          </div>
          <span className="update-progress-value">{sizeLabel}</span>
          {updater.logs.length > 0 ? (
            <details className="update-progress-logs">
              <summary>
                <span className="update-progress-versions">{versionLine}</span>
                <span aria-hidden="true">⌄</span>
              </summary>
              <UpdateLogPanel logs={updater.logs} />
            </details>
          ) : (
            <p className="update-progress-versions">{versionLine}</p>
          )}
        </div>
      </div>
      <div className="update-dialog-actions">
        <button type="button" className="update-dialog-later" onClick={onClose}>{downloading ? '后台下载' : '稍后更新'}</button>
        <button
          type="button"
          className="update-dialog-primary"
          disabled={primary.disabled}
          onClick={() => { run(callbacks[primary.kind]); }}
        >
          {primary.label}
        </button>
      </div>
    </Modal>
  );
};

export default UpdateDialog;
