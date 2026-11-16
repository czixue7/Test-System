import React, { useEffect, useState } from 'react';
import { DutyRoleAssignment } from '../../types';
import Modal from '../../components/Modal';
import {
  addRoleDraft, createRoleDrafts, dutyPostKind, dutyPostKindRank, finishRoleEdits, removeRoleDraft, renameRoleDraft,
  roleGroupLabel, roleShiftCategory, roleShiftLabel, updateRoleDraftShift,
  RoleDraft, RoleNameChange, RoleShiftCategory,
} from '../../utils/dutyRoleEdits';

const GROUP_OPTIONS = [
  { value: 'A', label: 'A 组' },
  { value: 'B', label: 'B 组' },
  { value: 'C', label: 'C 组' },
  { value: 'D', label: 'D 组' },
  { value: '', label: '长白班' },
];
const CATEGORY_OPTIONS: Array<{ value: RoleShiftCategory; label: string }> = [
  { value: 'white', label: '白班' },
  { value: 'night', label: '夜班' },
];

// 一个姓名对应一行：值班长岗位 + 若干岗位标签
interface PersonLabel { name: string; postIndex: number | null }
interface PersonRow { key: string; name: string; isLeader: boolean; labels: PersonLabel[]; canAdd: boolean }

const buildPersonRows = (draft: RoleDraft): PersonRow[] => {
  const rows: PersonRow[] = [];
  const byName = new Map<string, PersonRow>();
  const leaderName = (draft.leader || '').trim();
  const leaderRow: PersonRow = {
    key: 'leader',
    name: draft.leader || '',
    isLeader: true,
    labels: [{ name: draft.leaderLabel, postIndex: null }],
    canAdd: !!leaderName,
  };
  rows.push(leaderRow);
  if (leaderName) byName.set(leaderName, leaderRow);

  draft.posts.forEach((post, pidx) => {
    const name = post.person.trim();
    if (!name) {
      rows.push({ key: `post:${pidx}`, name: '', isLeader: false, labels: [{ name: post.name, postIndex: pidx }], canAdd: false });
      return;
    }
    const existing = byName.get(name);
    if (existing) { existing.labels.push({ name: post.name, postIndex: pidx }); return; }
    const row: PersonRow = {
      key: `person:${name}`,
      name,
      isLeader: false,
      labels: [{ name: post.name, postIndex: pidx }],
      canAdd: true,
    };
    byName.set(name, row);
    rows.push(row);
  });
  return rows.map((row) => ({
    ...row,
    labels: [...row.labels].sort((a, b) => dutyPostKindRank[dutyPostKind(a.name)] - dutyPostKindRank[dutyPostKind(b.name)]),
  }));
};

interface RoleEditModalProps {
  open: boolean;
  date: string | null;
  roles: DutyRoleAssignment[];
  onSave: (roles: DutyRoleAssignment[], renames: RoleNameChange[]) => void;
  onClose: () => void;
}

const RoleEditModal: React.FC<RoleEditModalProps> = ({ open, date, roles, onSave, onClose }) => {
  const [list, setList] = useState<RoleDraft[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) { setList(createRoleDrafts(roles)); setError(''); }
  }, [open, roles]);

  // 姓名只作用于当天；同时改名该人已有的全部岗位标签。
  const updatePersonName = (rowIdx: number, person: PersonRow, value: string) => {
    setList((prev) => prev.map((draft, i) => {
      if (i !== rowIdx) return draft;
      const fromName = person.name.trim();
      const renamePosts = (posts: RoleDraft['posts']) => fromName
        ? posts.map((post) => (post.person.trim() === fromName ? { ...post, person: value } : post))
        : posts;
      if (person.key === 'leader') return { ...draft, leader: value, posts: renamePosts(draft.posts) };
      if (person.key.startsWith('post:')) {
        const pidx = Number(person.key.slice(5));
        return { ...draft, posts: draft.posts.map((post, j) => (j === pidx ? { ...post, person: value } : post)) };
      }
      return { ...draft, posts: renamePosts(draft.posts) };
    }));
  };

  // 给该姓名追加一个岗位标签（仍属于同一个人，不新增人员行）。
  const addLabel = (rowIdx: number, personName: string) => {
    if (!personName.trim()) return;
    setList((prev) => prev.map((draft, i) => (i === rowIdx
      ? { ...draft, posts: [...draft.posts, { name: '', person: personName, originalName: '' }] }
      : draft)));
  };

  const removeLabel = (rowIdx: number, postIndex: number) => {
    setList((prev) => prev.map((draft, i) => (i === rowIdx
      ? { ...draft, posts: draft.posts.filter((_, j) => j !== postIndex) }
      : draft)));
  };

  // 新增人员：先给一个空姓名 + 空岗位标签，填写姓名后自动归并到同一人。
  const addPerson = (rowIdx: number) => {
    setList((prev) => prev.map((draft, i) => (i === rowIdx
      ? { ...draft, posts: [...draft.posts, { name: '', person: '', originalName: '' }] }
      : draft)));
  };

  // 新增时自动挑选当天尚未占用的「班组 + 白/夜班」组合，避免产生重复条目。
  const addNextRole = () => {
    if (!date) return;
    const used = new Set(list.map((r) => `${r.group}|${roleShiftCategory(r.shiftType)}`));
    const next = GROUP_OPTIONS
      .flatMap((group) => CATEGORY_OPTIONS.map((category) => ({ group: group.value, category: category.value })))
      .find((item) => !used.has(`${item.group}|${item.category}`));
    if (!next) { setError('当天所有班组的白班、夜班岗位划分都已存在'); return; }
    setError('');
    setList((prev) => addRoleDraft(prev, date, next.group, next.category));
  };

  const handleSave = () => {
    try {
      const { roles, renames } = finishRoleEdits(list);
      onSave(roles, renames);
    } catch (e) { setError(e instanceof Error ? e.message : '岗位保存失败'); }
  };

  return (
    <Modal open={open} onClose={onClose} className="w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden max-h-[85vh] flex flex-col">
      <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 dark:border-gray-700">
        <h2 className="text-lg font-semibold dark:text-white">岗位改写</h2>
        <button onClick={onClose} aria-label="关闭岗位改写" className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 dark:text-gray-400">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-4">
        {date && <p className="text-xs text-gray-400 dark:text-gray-500">{date} 的岗位划分</p>}
        <p className="text-xs text-gray-500 dark:text-gray-400">一个姓名可挂多个岗位标签；岗位名称改动会应用到此值班表全部日期和班组，人员姓名仅修改当天。</p>
        {error && <p role="alert" className="text-xs text-red-500">{error}</p>}
        {list.length === 0 && (
          <p className="text-center text-sm text-gray-400 py-6">当天暂未导入岗位划分，可在下方新增白班或夜班</p>
        )}
        {list.map((r, idx) => {
          const category = roleShiftCategory(r.shiftType);
          const persons = buildPersonRows(r);
          return (
            <div key={r.uid} className="space-y-3 p-3 bg-gray-50 dark:bg-gray-700/40 rounded-xl">
              <div className="flex items-center gap-2">
                <select
                  aria-label={`第${idx + 1}条岗位划分的班组`}
                  value={r.group}
                  onChange={(e) => setList((prev) => updateRoleDraftShift(prev, idx, { group: e.target.value }))}
                  className="min-w-0 px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-400"
                >
                  {GROUP_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
                <div className="flex rounded-lg border border-gray-200 dark:border-gray-600 overflow-hidden" role="group" aria-label={`${roleGroupLabel(r.group)}班次`}>
                  {CATEGORY_OPTIONS.map((option) => {
                    const active = category === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        aria-pressed={active}
                        onClick={() => setList((prev) => updateRoleDraftShift(prev, idx, { category: option.value }))}
                        className={`px-3 py-1.5 text-xs font-medium transition-colors ${active
                          ? option.value === 'night'
                            ? 'bg-purple-500 text-white'
                            : 'bg-orange-500 text-white'
                          : 'bg-white dark:bg-gray-700 text-gray-500 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600'}`}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
                <span className="flex-1" aria-hidden="true" />
                <button
                  onClick={() => setList((prev) => removeRoleDraft(prev, idx))}
                  title="删除该班组的岗位划分"
                  aria-label={`删除${roleGroupLabel(r.group)}${roleShiftLabel(category)}岗位划分`}
                  className="w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                </button>
              </div>

              <div className="space-y-2">
                {persons.map((person) => (
                  <div key={person.key} className="flex items-start gap-1.5">
                    <input
                      aria-label={person.isLeader ? `${idx + 1}条值班长姓名` : `${idx + 1}条人员姓名`}
                      value={person.name}
                      onChange={(e) => updatePersonName(idx, person, e.target.value)}
                      placeholder={person.isLeader ? '值班长' : '姓名'}
                      className="w-16 flex-shrink-0 min-w-0 px-2 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-800 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-400"
                    />
                    <div className="flex-1 min-w-0 flex flex-wrap items-center gap-1 pt-1">
                      {person.labels.map((label) => (
                        <span
                          key={label.postIndex ?? 'leader'}
                          className="inline-flex max-w-full items-center gap-0.5 pl-1.5 pr-0.5 py-0.5 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700"
                        >
                          <input
                            aria-label={label.postIndex === null ? `${person.name || '值班长'}的岗位标签` : `${person.name}的岗位标签`}
                            value={label.name}
                            placeholder="岗位名"
                            title={label.name}
                            onChange={(e) => setList((prev) => renameRoleDraft(prev, idx, label.postIndex, e.target.value))}
                            style={{ width: `${Math.max(4.6, (label.name || '').length + 1)}em` }}
                            className="min-w-0 max-w-full border-0 bg-transparent text-xs text-gray-700 dark:text-gray-100 placeholder-gray-400 focus:outline-none"
                          />
                          {label.postIndex !== null ? (
                            <button
                              onClick={() => removeLabel(idx, label.postIndex!)}
                              title="删除该标签"
                              aria-label={`删除${person.name}的标签${label.name || ''}`}
                              className="w-5 h-5 flex-shrink-0 flex items-center justify-center rounded text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                            >
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" /></svg>
                            </button>
                          ) : (
                            <span className="w-5" aria-hidden="true" />
                          )}
                        </span>
                      ))}
                      {person.canAdd && (
                        <button
                          onClick={() => addLabel(idx, person.name)}
                          title="给该姓名新增岗位标签"
                          aria-label={`给${person.name}新增岗位标签`}
                          className="w-7 h-7 flex-shrink-0 flex items-center justify-center rounded-lg text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <button
                onClick={() => addPerson(idx)}
                className="w-full py-1.5 rounded-lg border border-dashed border-blue-300 dark:border-blue-700 text-xs text-blue-500 hover:bg-blue-50/50 dark:hover:bg-blue-900/20 transition-colors"
              >
                + 添加人员
              </button>
            </div>
          );
        })}
        <button
          onClick={addNextRole}
          disabled={!date}
          className="w-full py-2 rounded-xl border border-dashed border-purple-300 dark:border-purple-700 text-sm text-purple-500 hover:bg-purple-50/50 dark:hover:bg-purple-900/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          + 新增白班 / 夜班岗位划分
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

export default RoleEditModal;
