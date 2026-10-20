import React, { useEffect, useState } from 'react';
import { DutyRoleAssignment, DutyShiftType } from '../../types';
import Modal from '../../components/Modal';

const SHIFT_LABEL: Record<DutyShiftType, string> = {
  morning: '早班', noon: '中班', night: '晚班', allday: '全天'
};

interface RoleEditModalProps {
  open: boolean;
  date: string | null;
  roles: DutyRoleAssignment[];
  onSave: (roles: DutyRoleAssignment[]) => void;
  onClose: () => void;
}

const RoleEditModal: React.FC<RoleEditModalProps> = ({ open, date, roles, onSave, onClose }) => {
  const [list, setList] = useState<DutyRoleAssignment[]>([]);

  useEffect(() => {
    if (open) setList(roles.map((r) => ({ ...r, leader: r.leader, posts: r.posts.map((p) => ({ ...p })) })));
  }, [open, roles]);

  const updateLeader = (idx: number, leader: string) => {
    setList((prev) => prev.map((r, i) => (i === idx ? { ...r, leader } : r)));
  };

  const updatePost = (idx: number, pidx: number, patch: Partial<{ name: string; person: string }>) => {
    setList((prev) =>
      prev.map((r, i) =>
        i === idx ? { ...r, posts: r.posts.map((p, j) => (j === pidx ? { ...p, ...patch } : p)) } : r
      )
    );
  };

  const addPost = (idx: number) => {
    setList((prev) => prev.map((r, i) => (i === idx ? { ...r, posts: [...r.posts, { name: '', person: '' }] } : r)));
  };

  const removePost = (idx: number, pidx: number) => {
    setList((prev) => prev.map((r, i) => (i === idx ? { ...r, posts: r.posts.filter((_, j) => j !== pidx) } : r)));
  };

  const handleSave = () => {
    const cleaned = list.map((r) => ({
      ...r,
      leader: r.leader?.trim(),
      posts: r.posts
        .map((p) => ({ name: p.name.trim(), person: p.person.trim() }))
        .filter((p) => p.person.length > 0),
    }));
    onSave(cleaned);
  };

  return (
    <Modal open={open} onClose={onClose} className="w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden max-h-[85vh] flex flex-col">
      <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 dark:border-gray-700">
        <h2 className="text-lg font-semibold dark:text-white">岗位改写</h2>
        <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 dark:text-gray-400">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-4">
        {date && <p className="text-xs text-gray-400 dark:text-gray-500">{date} 的岗位划分</p>}
        {list.length === 0 && (
          <p className="text-center text-sm text-gray-400 py-6">当天暂未导入岗位划分</p>
        )}
        {list.map((r, idx) => (
          <div key={idx} className="space-y-3 p-3 bg-gray-50 dark:bg-gray-700/40 rounded-xl">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
                {r.group ? `${r.group}组` : '长白班'} · {SHIFT_LABEL[r.shiftType] || r.shiftType}
              </span>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">值班长</label>
              <input
                value={r.leader || ''}
                onChange={(e) => updateLeader(idx, e.target.value)}
                placeholder="值班长姓名（可留空）"
                className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-800 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>
            <div className="space-y-2">
              {r.posts.map((p, pidx) => (
                <div key={pidx} className="flex items-center gap-2">
                  <input
                    value={p.name}
                    onChange={(e) => updatePost(idx, pidx, { name: e.target.value })}
                    placeholder="岗位名（如 配电）"
                    className="w-1/3 min-w-0 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-800 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                  <input
                    value={p.person}
                    onChange={(e) => updatePost(idx, pidx, { person: e.target.value })}
                    placeholder="人员姓名"
                    className="flex-1 min-w-0 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-800 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                  <button
                    onClick={() => removePost(idx, pidx)}
                    title="删除该岗位"
                    className="w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                </div>
              ))}
              <button
                onClick={() => addPost(idx)}
                className="w-full py-1.5 rounded-lg border border-dashed border-blue-300 dark:border-blue-700 text-xs text-blue-500 hover:bg-blue-50/50 dark:hover:bg-blue-900/20 transition-colors"
              >
                + 添加岗位
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="px-5 py-3 border-t border-gray-100 dark:border-gray-700">
        <button onClick={handleSave} className="w-full py-2.5 bg-blue-500 text-white rounded-lg font-medium hover:bg-blue-600 transition-colors">
          保存
        </button>
      </div>
    </Modal>
  );
};

export default RoleEditModal;
