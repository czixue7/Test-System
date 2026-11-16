import React, { useMemo } from 'react';
import Modal from './Modal';
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
 * 与「关于」弹窗相互独立：上方盒子只写更新信息，不显示应用图标、功能简介和仓库链接。
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
  const action = getUpdateStageAction(stage, !!updater.downloadedFilePath);
  const callbacks = { check: updater.checkForUpdate, download: updater.startDownload, install: updater.installUpdate };
  const run = (callback: () => Promise<void>) => {
    void callback().catch(error => updater.addLog(`更新操作失败: ${String(error)}`));
  };
  const notes = info?.releaseNotes || info?.message || '暂无更新说明。';
  const primary = action ?? { kind: 'download' as const, label: `下载中 ${Math.round(percentage)}%`, disabled: true };

  return (
    <Modal open={open} onClose={onClose} className="update-dialog w-full max-w-sm" containerClassName="update-overlay">
      <div className="update-info-box">
        <div className="update-info-heading">
          <div>
            <p className="update-info-eyebrow">软件更新</p>
            <h2>{stage.title}</h2>
          </div>
          {info?.latestVersion && <span className="update-info-version">v{info.latestVersion}</span>}
        </div>
        <p className="update-info-versions">
          当前 {CURRENT_VERSION}（{CURRENT_VERSION_HASH}）
          {info?.latestVersion && <> → 最新 {info.latestVersion}{info.versionHash ? `（${info.versionHash}）` : ''}</>}
        </p>
        <div className="update-info-notes" role="region" aria-label="更新说明">{notes}</div>
        {downloading && (
          <div className="update-info-progress">
            <div className="update-info-progress-track" role="progressbar" aria-label="更新包下载进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(percentage)}>
              <span style={{ transform: `scaleX(${percentage / 100})` }} />
            </div>
            <p>{stage.detail}</p>
          </div>
        )}
        {!downloading && ['ready', 'permission', 'installing', 'error'].includes(stage.phase) && (
          <p className={`update-info-status update-info-status--${stage.tone}`}>{stage.detail}</p>
        )}
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
