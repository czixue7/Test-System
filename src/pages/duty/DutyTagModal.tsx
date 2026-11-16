import React from 'react';
import Modal from '../../components/Modal';

// 标签类型：值班长 → 巡检区域 → 做表 → 休息 → 跨组/交换。
export type DutyTagKind = 'leader' | 'patrol' | 'report' | 'rest' | 'cross' | 'swap' | 'on';

export interface DutyTagPerson {
  name: string;
  tags: Array<{ label: string; kind: DutyTagKind }>;
}

// 同类型标签固定在同一位置，不随表格列序或写入顺序变化。
const TAG_RANK: Record<DutyTagKind, number> = {
  leader: 0, patrol: 1, report: 2, rest: 3, cross: 4, swap: 5, on: 6,
};

export const sortDutyTags = <T extends { kind: DutyTagKind }>(tags: T[]): T[] =>
  [...tags].sort((a, b) => TAG_RANK[a.kind] - TAG_RANK[b.kind]);

interface DutyTagModalProps {
  open: boolean;
  title: string;
  subtitle?: string;
  persons: DutyTagPerson[];
  onClose: () => void;
}

// 班组卡片点击后的「按姓名分组标签」弹窗：同一人的巡检、做表、休息、跨组等标签集中展示。
const DutyTagModal: React.FC<DutyTagModalProps> = ({ open, title, subtitle, persons, onClose }) => (
  <Modal open={open} onClose={onClose} className="w-full max-w-md rounded-2xl shadow-2xl overflow-hidden max-h-[80vh] flex flex-col">
    <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 dark:border-gray-700">
      <div className="min-w-0">
        <h2 className="text-base font-semibold dark:text-white truncate">{title}</h2>
        {subtitle && <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{subtitle}</p>}
      </div>
      <button onClick={onClose} aria-label="关闭人员标签" className="w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 dark:text-gray-400">
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
      </button>
    </div>
    <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-2">
      {persons.length === 0 && <p className="text-center text-sm text-gray-400 py-6">当天暂无可显示的人员标签</p>}
      {persons.map((person) => {
        // 「当班」属于默认状态，不在弹窗里重复展示。
        const tags = sortDutyTags(person.tags.filter((tag) => tag.kind !== 'on'));
        return (
          <div key={person.name} className="duty-tag-person">
            <span className="duty-tag-person-name">{person.name}</span>
            {tags.length > 0 && (
              <span className="duty-tag-list">
                {tags.map((tag, index) => (
                  <span key={`${tag.label}-${index}`} className={`duty-tag duty-tag--${tag.kind}`}>{tag.label}</span>
                ))}
              </span>
            )}
          </div>
        );
      })}
    </div>
  </Modal>
);

export default DutyTagModal;
