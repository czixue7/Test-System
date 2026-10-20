import React, { useMemo, useState } from 'react';
import { debugStorageAvailable, debugStorageEntries, writeDebugStorage, type DebugStorageKind } from '../../utils/debugStorage';
import { sensitiveDebugKey, snapshotDebugValue } from '../../utils/debugValues';
import ValueTree from './ValueTree';

export default function StoragePanel({ kind, setKind, query, refresh, notify }: { kind: DebugStorageKind; setKind: (kind: DebugStorageKind) => void; query: string; refresh: number; notify: (message: string) => void }) {
  const [revision, setRevision] = useState(0);
  const [editor, setEditor] = useState<{ original?: string; key: string; value: string } | null>(null);
  const [undo, setUndo] = useState<{ kind: DebugStorageKind; key: string; value: string | null } | null>(null);
  const entries = useMemo(() => debugStorageEntries(kind).filter(entry => `${entry.key} ${entry.preview}`.toLowerCase().includes(query)), [kind, query, refresh, revision]);
  const unavailable = debugStorageAvailable(kind);
  const mutate = (key: string, value: string | null) => {
    try {
      const before = debugStorageEntries(kind).find(entry => entry.key === key)?.raw ?? null;
      writeDebugStorage(kind, key, value); setUndo({ kind, key, value: before }); setRevision(value => value + 1); setEditor(null);
      notify(value === null ? '已删除，可撤销' : '已保存；应用设置在刷新页面后重新读取');
    } catch (error) { notify(String(error)); }
  };
  return <div className="debug-storage-panel">
    <div className="debug-subtabs" role="tablist" aria-label="存储类型">{([['local', 'LocalStorage'], ['session', 'SessionStorage'], ['cookie', 'Cookies']] as const).map(([id, label]) => <button type="button" key={id} role="tab" aria-selected={kind === id} onClick={() => { setKind(id); setEditor(null); }}>{label}</button>)}</div>
    <div className="debug-inline-actions"><span>页面存储 · 默认隐藏敏感字段</span><button type="button" disabled={!!unavailable} onClick={() => setEditor({ key: '', value: '' })}>新增</button>{undo && <button type="button" onClick={() => {
      try { writeDebugStorage(undo.kind, undo.key, undo.value); setKind(undo.kind); setUndo(null); setEditor(null); setRevision(value => value + 1); notify('已撤销'); } catch (error) { notify(String(error)); }
    }}>撤销</button>}</div>
    {unavailable && <p className="debug-inline-note">{unavailable}</p>}
    {editor && <form className="debug-storage-editor" onSubmit={event => {
      event.preventDefault();
      if (!editor.original && debugStorageEntries(kind).some(entry => entry.key === editor.key)) { notify('此名称已存在，请编辑对应条目'); return; }
      mutate(editor.key, editor.value);
    }}>
      <label>名称<input aria-label="存储名称" value={editor.key} readOnly={!!editor.original} onChange={event => setEditor({ ...editor, key: event.target.value })} required /></label>
      <label>原始值<textarea aria-label="存储原始值" value={editor.value} onChange={event => setEditor({ ...editor, value: event.target.value })} rows={5} spellCheck={false} /></label>
      <div className="debug-inline-actions"><span>编辑时显示原始值</span><button type="button" onClick={() => setEditor(null)}>取消</button><button type="submit">保存</button></div>
    </form>}
    {entries.map(entry => {
      let value: unknown = entry.raw; try { value = JSON.parse(entry.raw); } catch {}
      return <details key={`${kind}:${entry.key}`} className="debug-storage-row"><summary><span className="debug-storage-key" title={entry.key}>{entry.key}</span><small>{entry.raw.length.toLocaleString()} 字符</small></summary>
        <ValueTree node={snapshotDebugValue(sensitiveDebugKey.test(entry.key) ? '•••' : value)} initialOpen />
        <div className="debug-inline-actions"><button type="button" onClick={() => setEditor({ original: entry.key, key: entry.key, value: entry.raw })}>编辑</button><button className="debug-danger" type="button" onClick={() => mutate(entry.key, null)}>删除</button></div>
      </details>;
    })}
    {!entries.length && !unavailable && <div className="debug-console-empty">没有匹配的存储条目，可点击“新增”创建</div>}
  </div>;
}
