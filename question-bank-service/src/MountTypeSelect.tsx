import React, { useId, useState } from 'react';
const types = [['bank','题库'],['knowledge','知识库'],['duty','值班表'],['package','软件包'],['text','文本'],['novel','小说']] as const;
export default function MountTypeSelect({ value, disabled, onChange }: { value: string; disabled: boolean; onChange: (kind: string) => void }) {
  const id = useId();
  const builtin = types.some(([kind]) => kind === value);
  const [editingCustom, setEditingCustom] = useState(!builtin);
  const custom = editingCustom || !builtin;
  return <div className="mount-type-control">
    <select aria-label="数据类型" value={custom ? '__custom__' : value} disabled={disabled} onChange={event => {
      setEditingCustom(event.target.value === '__custom__');
      onChange(event.target.value === '__custom__' ? '文本资料' : event.target.value);
    }}>
      {types.map(([kind,label]) => <option key={kind} value={kind}>{label}</option>)}
      <option value="__custom__">自定义</option>
    </select>
    {custom && <input id={id} aria-label="自定义类型名称" value={value} disabled={disabled} maxLength={40} placeholder="例如：小说、文档" onChange={event => onChange(event.target.value)} />}
    <span>{['bank','knowledge','duty','package'].includes(value) ? '只读发布' : '文本双向同步'}</span>
  </div>;
}
