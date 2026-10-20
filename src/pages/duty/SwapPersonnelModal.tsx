import React, { useEffect, useMemo, useState } from 'react';
import { DutyShift, DutyShiftType } from '../../types';
import { isRestShiftText } from '../../utils/dutyParsers';
import Modal from '../../components/Modal';

/**
 * 人员交换核心算法：对调 personInCharge，多余字段（日期/班次/任务/备注/班组槽位）保持不变。
 * 跨班组对调时记录 originGroup = 调入人员原属班组，供详情页显示「A→B」跨组支援标识。
 * 支持数量非对等：传入的 pair 按选择顺序一一配对，未配对的班次保持原负责人不动。
 */
export function swapPersonnel(shifts: DutyShift[], pairs: Array<[string, string]>): DutyShift[] {
  const byId = new Map(shifts.map((s) => [s.id, s]));
  return shifts.map((s) => {
    const p = pairs.find(([a, b]) => a === s.id || b === s.id);
    if (!p) return s;
    const peer = p[0] === s.id ? byId.get(p[1]) : byId.get(p[0]);
    if (!peer) return s;
    const originGroup = peer.originGroup ?? peer.group;
    const transferred = !!originGroup && originGroup !== s.group;
    return {
      ...s,
      personInCharge: peer?.personInCharge ?? s.personInCharge,
      originGroup: transferred ? originGroup : undefined,
      originDate: transferred ? (peer.originDate ?? peer.date) : undefined
    };
  });
}

const SHIFT_LABEL: Record<DutyShiftType, string> = {
  morning: '早班', noon: '中班', night: '晚班', allday: '全天'
};

// 与 DutySchedule 的 GROUP_COLOR 保持一致的班组徽章配色（软件全局统一）
const GROUP_BADGE: Record<string, string> = {
  A: 'bg-orange-500 text-white',
  B: 'bg-blue-500 text-white',
  C: 'bg-purple-500 text-white',
  D: 'bg-emerald-500 text-white'
};

// 某一天实际在岗班组字母（与主日历/DutySchedule.dateGroups 规则一致）：
// 剔除"休"，按白/夜班次类别各取当班人数最多的班组，白前夜后。
// 只显示当天真实当班班组，不再把该日全部组的字母都挂出来。
const groupsOfDay = (list: DutyShift[]): string[] => {
  const active = list.filter((s) => s.group && !isRestShiftText(s.tasks[0]));
  const catCount = new Map<'white' | 'night', Map<string, number>>();
  for (const s of active) {
    const cat: 'white' | 'night' = s.shiftType === 'night' ? 'night' : 'white';
    if (!catCount.has(cat)) catCount.set(cat, new Map());
    const gm = catCount.get(cat)!;
    gm.set(s.group!, (gm.get(s.group!) || 0) + 1);
  }
  const groups: string[] = [];
  for (const cat of ['white', 'night'] as const) {
    const gm = catCount.get(cat);
    if (!gm || gm.size === 0) continue;
    let bestG = '';
    let bestN = 0;
    for (const [g, n] of gm.entries()) {
      if (n > bestN || (n === bestN && g < bestG)) { bestN = n; bestG = g; }
    }
    if (bestG) groups.push(bestG);
  }
  return groups;
};

interface SwapPersonnelModalProps {
  open: boolean;
  date: string | null;
  targetDate: string | null;
  shifts: DutyShift[];
  onApply: (newShifts: DutyShift[]) => void;
  onClose: () => void;
}

const SwapPersonnelModal: React.FC<SwapPersonnelModalProps> = ({ open, date, targetDate, shifts, onApply, onClose }) => {
  const [step, setStep] = useState(1);
  const [selectedSource, setSelectedSource] = useState<string[]>([]);
  const [selectedTarget, setSelectedTarget] = useState<string[]>([]);

  useEffect(() => {
    if (open) {
      setStep(1);
      setSelectedSource([]);
      setSelectedTarget([]);
    }
  }, [open]);

  const sourceShifts = useMemo(() => shifts.filter((s) => s.date === date), [shifts, date]);
  const targetShifts = useMemo(
    () => (targetDate ? shifts.filter((s) => s.date === targetDate) : []),
    [shifts, targetDate]
  );

  const toggle = (list: string[], setList: (v: string[]) => void, id: string) => {
    if (!id) return;
    setList(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  };

  const pairs = useMemo(() => {
    const result: Array<{ from: DutyShift; to: DutyShift }> = [];
    const min = Math.min(selectedSource.length, selectedTarget.length);
    for (let i = 0; i < min; i++) {
      const from = sourceShifts.find((s) => s.id === selectedSource[i]);
      const to = targetShifts.find((s) => s.id === selectedTarget[i]);
      if (from && to) result.push({ from, to });
    }
    return result;
  }, [selectedSource, selectedTarget, sourceShifts, targetShifts]);

  const handleConfirm = () => {
    const pairList = pairs.map((p) => [p.from.id, p.to.id] as [string, string]);
    onApply(swapPersonnel(shifts, pairList));
  };

  const renderPersonName = (s: DutyShift) => s.personInCharge || '未命名';

  /**
   * 仅渲染该日期实际当班班组（group 为 A/B/C/D）的人员，长白班（group 为空）不参与交换；
   * 与日历格规则一致：剔除"休"，只保留白/夜各当班班组的人，其余班组人员不在此列出。
   */
  const renderPersonList = (
    list: DutyShift[],
    selected: string[],
    onToggle: (id: string) => void
  ) => {
    const dayGroups = groupsOfDay(list);
    const rotationShifts = list.filter((s) => s.group && dayGroups.includes(s.group) && !isRestShiftText(s.tasks[0]));
    const blockTitle = (shifts: DutyShift[]) => {
      const groups = groupsOfDay(shifts);
      return groups.length ? `${groups.join('')}班` : '';
    };
    return (
      <>
        {rotationShifts.length > 0 && (
          <div>
            <div className="flex items-center gap-1.5 px-1 pt-1 pb-2 text-xs font-medium text-gray-400 dark:text-gray-500">
              <span className="inline-block w-1 h-3 rounded bg-blue-400" />
              轮班组（{blockTitle(rotationShifts)}）
              <span className="text-gray-300 dark:text-gray-600">（{rotationShifts.length}人）</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {rotationShifts.map((s) => {
                const checked = selected.includes(s.id);
                return (
                  <button
                    key={s.id}
                    onClick={() => onToggle(s.id)}
                    className={`w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl border text-left transition-colors ${
                      checked
                        ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-300 dark:border-blue-700'
                        : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-600'
                    }`}
                  >
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm text-gray-800 dark:text-white truncate">{renderPersonName(s)}</span>
                  </span>
                  <span className="flex items-center gap-1.5 shrink-0">
                    {s.group ? (
                      <span className={`w-6 h-5 flex items-center justify-center rounded-md text-[10px] font-bold ${GROUP_BADGE[s.group]}`}>
                        {s.group}
                      </span>
                    ) : (
                      <span className="w-6 h-5 flex items-center justify-center rounded-md bg-gray-400 text-white text-[10px] font-bold">长</span>
                    )}
                    <span className="text-xs text-gray-400">{SHIFT_LABEL[s.shiftType] || s.shiftType}</span>
                  </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </>
    );
  };

  const renderStep1 = () => (
    <div className="space-y-2">
      <p className="text-sm text-gray-600 dark:text-gray-300">
        换出 <span className="font-medium text-gray-800 dark:text-white">{date}</span>
        {groupsOfDay(sourceShifts).map((g) => (
          <span key={g} className={`ml-1.5 inline-flex w-6 h-5 items-center justify-center rounded-md text-[10px] font-bold ${GROUP_BADGE[g]}`}>{g}</span>
        ))}
        <span className="ml-1.5 text-gray-400">要换出的人员（可多选）</span>
      </p>
      {sourceShifts.length === 0 ? (
        <p className="text-center text-sm text-gray-400 py-6">当天无班次人员</p>
      ) : (
        renderPersonList(sourceShifts, selectedSource, (id) => toggle(selectedSource, setSelectedSource, id))
      )}
    </div>
  );

  const renderStep2 = () => {
    if (!targetDate) return null;
    return (
    <div className="space-y-2">
      <p className="text-sm text-gray-600 dark:text-gray-300">
        换入 <span className="font-medium text-gray-800 dark:text-white">{targetDate}</span>
        {groupsOfDay(targetShifts).map((g) => (
          <span key={g} className={`ml-1.5 inline-flex w-6 h-5 items-center justify-center rounded-md text-[10px] font-bold ${GROUP_BADGE[g]}`}>{g}</span>
        ))}
        <span className="ml-1.5 text-gray-400">要换出的人员（可多选，数量可与左侧不同）</span>
      </p>
      {targetShifts.length === 0 ? (
        <p className="text-center text-sm text-gray-400 py-6">目标日期无班次人员</p>
      ) : (
        renderPersonList(targetShifts, selectedTarget, (id) => toggle(selectedTarget, setSelectedTarget, id))
      )}
    </div>
    );
  };

  const renderStep3 = () => (
    <div className="space-y-2">
      <p className="text-sm text-gray-600 dark:text-gray-300">
        {pairs.length > 0
          ? `将按顺序对调 ${pairs.length} 组人员，未配对人员保持不变：`
          : '未选择可配对的人员，无法交换。'}
      </p>
      {pairs.length > 0 && (
        <div className="space-y-1.5">
          {pairs.map((p, i) => (
            <div key={i} className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-gray-50 dark:bg-gray-700/40">
              <div className="min-w-0 text-right">
                <span className="block text-sm text-gray-800 dark:text-white">{renderPersonName(p.from)}</span>
                <span className="flex items-center gap-1 mt-0.5">
                  {p.from.group ? (
                    <span className={`w-5 h-4 flex items-center justify-center rounded text-[9px] font-bold ${GROUP_BADGE[p.from.group]}`}>
                      {p.from.group}
                    </span>
                  ) : (
                    <span className="w-5 h-4 flex items-center justify-center rounded bg-gray-400 text-white text-[9px] font-bold">长</span>
                  )}
                  <span className="text-xs text-gray-400">{SHIFT_LABEL[p.from.shiftType] || p.from.shiftType}</span>
                </span>
              </div>
              <svg className="w-4 h-4 text-blue-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" /></svg>
              <div className="min-w-0 text-left">
                <span className="block text-sm text-gray-800 dark:text-white">{renderPersonName(p.to)}</span>
                <span className="flex items-center gap-1 mt-0.5">
                  {p.to.group ? (
                    <span className={`w-5 h-4 flex items-center justify-center rounded text-[9px] font-bold ${GROUP_BADGE[p.to.group]}`}>
                      {p.to.group}
                    </span>
                  ) : (
                    <span className="w-5 h-4 flex items-center justify-center rounded bg-gray-400 text-white text-[9px] font-bold">长</span>
                  )}
                  <span className="text-xs text-gray-400">{SHIFT_LABEL[p.to.shiftType] || p.to.shiftType}</span>
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <Modal open={open} onClose={onClose} containerClassName="items-end" className="w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden max-h-[85vh] flex flex-col">
      <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 dark:border-gray-700">
        <div>
          <h2 className="text-lg font-semibold dark:text-white">人员交换</h2>
          <p className="text-xs text-gray-400 mt-0.5">第 {step} / 3 步</p>
        </div>
        <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 dark:text-gray-400">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
        </button>
      </div>

      <div className="flex-1 min-h-0 p-5 overflow-y-auto">
        {step === 1 && renderStep1()}
        {step === 2 && renderStep2()}
        {step === 3 && renderStep3()}
      </div>

      <div className="flex items-center gap-2 px-5 py-3 border-t border-gray-100 dark:border-gray-700">
        <button
          onClick={() => (step === 1 ? onClose() : setStep((s) => s - 1))}
          className="px-4 py-2.5 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-lg font-medium"
        >
          {step === 1 ? '取消' : '上一步'}
        </button>
        {step < 3 ? (
          <button
            onClick={() => setStep((s) => s + 1)}
            disabled={(step === 1 && selectedSource.length === 0) || (step === 2 && selectedTarget.length === 0)}
            className="flex-1 py-2.5 bg-blue-500 text-white rounded-lg font-medium hover:bg-blue-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            下一步
          </button>
        ) : (
          <button
            onClick={handleConfirm}
            disabled={pairs.length === 0}
            className="flex-1 py-2.5 bg-blue-500 text-white rounded-lg font-medium hover:bg-blue-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            确认交换
          </button>
        )}
      </div>
    </Modal>
  );
};

export default SwapPersonnelModal;
