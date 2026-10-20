import React, { useMemo, useState } from 'react';
import { useUpdaterStore } from '../store/updaterStore';
import { resolveUpdateStage } from '../utils/updateStages';
import { getUpdateStageAction } from '../utils/updateActions';
import UpdateControl from './UpdateControl';

export default function AboutUpdatePanel({ expanded, onExpand }: { expanded: boolean; onExpand: () => void }) {
  // Progress notifications update this region, rather than the complete profile page.
  const updater = useUpdaterStore();
  const [cancelling, setCancelling] = useState(false);
  const stage = useMemo(() => resolveUpdateStage(updater), [updater.checkingUpdate, updater.downloadStatus, updater.downloadProgress, updater.updateInfo, updater.logs]);
  const action = getUpdateStageAction(stage, !!updater.downloadedFilePath);
  const callbacks = { check: updater.checkForUpdate, download: updater.startDownload, install: updater.installUpdate };
  const run = (callback: () => Promise<void>) => { void callback().catch(error => updater.addLog(`更新操作失败: ${String(error)}`)); };
  return <UpdateControl expanded={expanded} onStart={() => { onExpand(); run(updater.checkForUpdate); }} stage={stage} logs={updater.logs}
    action={action ? { ...action, onClick: () => run(callbacks[action.kind]) } : undefined}
    cancelling={cancelling} onCancel={() => {
      if (cancelling) return;
      setCancelling(true);
      void updater.cancelDownload().catch(error => updater.addLog(`取消下载失败: ${String(error)}`)).finally(() => setCancelling(false));
    }} />;
}
