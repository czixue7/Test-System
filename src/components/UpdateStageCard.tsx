import React, { useEffect, useRef, useState } from 'react';
import type { UpdateStageModel } from '../utils/updateStages';
import UpdateLogPanel from './UpdateLogPanel';

export function UpdateStageIcon({ stage, small = false }: { stage: UpdateStageModel; small?: boolean }) {
  const spinner = stage.phase === 'checking' || stage.phase === 'installing';
  const name = stage.phase;
  return <svg width={small ? 13 : 22} height={small ? 13 : 22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={spinner ? 'update-stage-spinner' : undefined}>
    {spinner ? <><path d="M21 12a9 9 0 1 1-3-6.7" /><path d="M21 3v6h-6" /></> :
      name === 'error' || name === 'permission' ? <><path d="m12 3 10 18H2L12 3Z" /><path d="M12 9v5m0 3h.01" /></> :
      name === 'latest' || name === 'ready' ? <><circle cx="12" cy="12" r="9" /><path d="m8 12 3 3 5-6" /></> :
      name === 'cancelled' ? <><circle cx="12" cy="12" r="9" /><path d="m8 8 8 8m0-8-8 8" /></> :
      name === 'available' ? <><path d="M12 21V4m-6 6 6-6 6 6" /><path d="M4 17v4h16v-4" /></> :
      <><path d="M12 3v12m-5-5 5 5 5-5" /><path d="M4 16v5h16v-5" /></>}
  </svg>;
}

export interface UpdateStageCardProps {
  stage: UpdateStageModel;
  logs?: string[];
  action?: { label: string; onClick: () => void; disabled?: boolean };
  onCancel?: () => void;
  cancelling?: boolean;
}

export default function UpdateStageCard({ stage, logs = [], action, onCancel, cancelling = false }: UpdateStageCardProps) {
  const [logsOpen, setLogsOpen] = useState(false);
  const downloading = stage.phase === 'downloading';
  const lastDownload = useRef<UpdateStageModel | null>(null);
  // Retain the last committed progress while the region collapses. Progress
  // events update the bar only; they do not restart the region's transition.
  useEffect(() => { if (downloading) lastDownload.current = stage; }, [downloading, stage]);
  const download = downloading ? stage : lastDownload.current;
  const completed = stage.phase === 'ready' || stage.phase === 'available' || stage.phase === 'latest';
  const steps = ['检查', '下载', '就绪', '安装'];
  const progress = Number.isFinite(download?.progress) ? Math.max(0, Math.min(100, download!.progress!)) : 0;
  const description = stage.phase === 'error' ? stage.detail : stage.description;
  return <section className={`update-stage-card update-stage-card--${stage.tone}`} aria-label="更新阶段">
    <div className="update-stage-lead">
      <span className="update-stage-icon"><UpdateStageIcon stage={stage} /></span>
      <div className="update-stage-heading" role="status" aria-live="polite">
        <div className="update-stage-title-line"><h3>{stage.title}</h3>{stage.version && <span className="update-stage-version">v{stage.version}</span>}</div>
        <p title={description}>{description}</p>
      </div>
      {action && <button type="button" className="update-stage-action" disabled={action.disabled} onClick={action.onClick}>{action.label}</button>}
    </div>
    <ol className="update-stage-steps" aria-label="更新流程">
      {steps.map((label, index) => {
        const status = index < stage.step || (index === stage.step && completed) ? 'done' : index === stage.step && stage.phase !== 'idle' ? 'current' : 'pending';
        return <li key={label} className={`update-stage-step update-stage-step--${status}`} aria-current={status === 'current' ? 'step' : undefined}>
          <span className="update-stage-step-dot">{status === 'done' ? <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m3 8 3 3 7-7" /></svg> : index + 1}</span><span>{label}</span>
        </li>;
      })}
    </ol>
    <div className={`update-stage-download-reveal ${downloading ? 'update-stage-download-reveal--open' : ''}`} aria-hidden={!downloading} ref={node => node?.toggleAttribute('inert', !downloading)}>
      <div className="update-stage-download-reveal-inner">{download && <>
        <div className="update-stage-download">
          <div className="update-stage-progress" role="progressbar" aria-label="安装包下载进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)}><span style={{ transform: `scaleX(${progress / 100})` }} /></div>
          <span className="update-stage-percentage">{Math.round(progress)}%</span>
          {onCancel && <button type="button" className="update-stage-cancel" disabled={!downloading || cancelling} onClick={onCancel}>{cancelling ? '取消中' : '取消下载'}</button>}
        </div>
        <div className="update-stage-transfer"><span>{download.detail}</span>{download.source && <span>{download.source}</span>}</div>
      </>}</div>
    </div>
    {!!logs.length && <details className="update-stage-logs" onToggle={event => { if (event.target === event.currentTarget) setLogsOpen(event.currentTarget.open); }}><summary>过程详情 <small>{logs.length} 条记录</small><span aria-hidden="true">⌄</span></summary>{logsOpen && <UpdateLogPanel logs={logs} />}</details>}
  </section>;
}
