import type { UpdateStageModel } from './updateStages';

export function getUpdateStageAction(stage: UpdateStageModel, hasInstaller = false) {
  if (stage.phase === 'downloading') return null;
  if (stage.phase === 'checking') return { kind: 'check' as const, label: '检查中', disabled: true };
  if (stage.phase === 'installing') return { kind: 'install' as const, label: '安装中', disabled: true };
  if (hasInstaller || stage.phase === 'ready' || stage.phase === 'permission') return { kind: 'install' as const, label: stage.phase === 'error' ? '重试安装' : '安装更新', disabled: false };
  if (stage.phase === 'available') return { kind: 'download' as const, label: '立即更新', disabled: false };
  if (stage.phase === 'cancelled' || (stage.phase === 'error' && stage.step === 1)) return { kind: 'download' as const, label: '重新下载', disabled: false };
  return { kind: 'check' as const, label: stage.phase === 'latest' ? '重新检查' : '检查重试', disabled: false };
}
