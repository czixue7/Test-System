import React, { useEffect, useState } from 'react';
import { DutyDrill } from '../../types';
import Modal from '../../components/Modal';

const GROUP_OPTIONS = ['A', 'B', 'C', 'D'];

// 与 DutySchedule 的 GROUP_COLOR 保持一致的班组徽章配色（软件全局统一）
const GROUP_BADGE: Record<string, string> = {
  A: 'bg-orange-500 text-white',
  B: 'bg-blue-500 text-white',
  C: 'bg-purple-500 text-white',
  D: 'bg-emerald-500 text-white'
};

interface DrillEditModalProps {
  open: boolean;
  date: string | null;
  initialRows: DutyDrill[];
  defaultGroup: string;
  onSave: (rows: DutyDrill[]) => void;
  onClose: () => void;
}

const DrillEditModal: React.FC<DrillEditModalProps> = ({
  open,
  date,
  initialRows,
  defaultGroup,
  onSave,
  onClose,
}) => {
  const [rows, setRows] = useState<DutyDrill[]>([]);

  useEffect(() => {
    if (open) setRows(initialRows.map((r) => ({ ...r, name: r.name, group: r.group })));
  }, [open, initialRows]);

  const updateRow = (idx: number, patch: Partial<DutyDrill>) => {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };

  const removeRow = (idx: number) => {
    setRows((prev) => prev.filter((_, i) => i !== idx));
  };

  const addRow = () => {
    setRows((prev) => [...prev, { date: date || '', group: defaultGroup || GROUP_OPTIONS[0], name: '' }]);
  };

  const handleSave = () => {
    const cleaned = rows
      .map((r) => ({ ...r, date: date || r.date, group: r.group.trim(), name: r.name.trim() }))
      .filter((r) => r.name.length > 0 && r.group.length > 0);
    onSave(cleaned);
  };

  return (
    <Modal open={open} onClose={onClose} className="w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden max-h-[85vh] flex flex-col">
      <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 dark:border-gray-700">
        <h2 className="text-lg font-semibold dark:text-white">内容改写</h2>
        <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 dark:text-gray-400">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-3">
        {date && <p className="text-xs text-gray-400 dark:text-gray-500">{date} 的演练条目</p>}
        {rows.length === 0 && (
          <p className="text-center text-sm text-gray-400 py-6">当天暂无演练条目，点击下方「添加演练」新增</p>
        )}
        {rows.map((r, i) => (
          <div key={i} className="flex items-center gap-2">
            <div className="flex-shrink-0 flex items-center gap-1.5">
              {GROUP_OPTIONS.map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => updateRow(i, { group: g })}
                  className={`w-7 h-7 flex items-center justify-center rounded-lg text-xs font-bold transition-colors ${
                    r.group === g
                      ? `${GROUP_BADGE[g]} ring-2 ring-offset-1 ring-offset-white dark:ring-offset-gray-800/0 ring-gray-300 dark:ring-gray-500`
                      : 'bg-gray-100 dark:bg-gray-700/60 text-gray-400 dark:text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-600'
                  }`}
                >
                  {g}
                </button>
              ))}
            </div>
            <input
              value={r.name}
              onChange={(e) => updateRow(i, { name: e.target.value })}
              placeholder="演练名称"
              className="flex-1 min-w-0 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-800 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
            <button
              onClick={() => removeRow(i)}
              title="删除该条目"
              className="w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
            </button>
          </div>
        ))}
        <button
          onClick={addRow}
          className="w-full py-2.5 rounded-lg border border-dashed border-blue-300 dark:border-blue-700 text-sm text-blue-500 hover:bg-blue-50/50 dark:hover:bg-blue-900/20 transition-colors"
        >
          + 添加演练
        </button>
      </div>

      <div className="px-5 py-3 border-t border-gray-100 dark:border-gray-700">
        <button onClick={handleSave} className="w-full py-2.5 bg-blue-500 text-white rounded-lg font-medium hover:bg-blue-600 transition-colors">
          保存
        </button>
      </div>
    </Modal>
  );
};

export default DrillEditModal;
