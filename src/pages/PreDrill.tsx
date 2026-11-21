// 管路拓扑是主体，现场读数用于定位，演练记录用于回顾。留白和中性色沿用客户端主题。
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSafeArea } from '../hooks/useSafeArea';
import { Diagram, itemKindName } from './pre-drill/Diagram';
import type { DeviceKind, DrillItem, DrillSnapshot, Reading } from './pre-drill/types';
import './pre-drill/pre-drill.css';

// Site-specific snapshots are kept in the ignored local archive.
const snapshots = import.meta.glob<DrillSnapshot>('../../local-archive/pre-drill/snapshot.ts', { eager: true, import: 'default' });
const snapshot = Object.values(snapshots)[0];
const storageKey = 'pre-drill-simulation-v1';

const operations: Record<DeviceKind | 'pipe', [idle: string, active: string]> = {
  pipe: ['隔离', '通水'], tower: ['停机', '启动'], pump: ['停机', '启动'],
  valve: ['关闭', '打开'], exchanger: ['旁通', '投入'], terminal: ['停用', '投入'],
  sensor: ['停用', '恢复采集'], tank: ['停止补水', '开始补水'], auxiliary: ['停用', '投入'],
};

interface Attributes {
  condition: '正常' | '异常' | '故障';
  operation: string;
  note: string;
  readings: Record<string, string>;
}

interface Entry { at: string; target: string; event: string }
interface Session { items: Record<string, Attributes>; log: Entry[] }
const emptyAttributes: Attributes = { condition: '正常', operation: '', note: '', readings: {} };

const optionalReadings: Partial<Record<DrillItem['kind'], Reading[]>> = {
  pipe: [['温度', '', '°C'], ['压力', '', 'bar'], ['流量', '', 'm³/h']],
  valve: [['开度', '', '%']], pump: [['频率', '', 'Hz']],
};

function editableReadings(item: DrillItem) {
  const extra = optionalReadings[item.kind] ?? [];
  return [...item.readings, ...extra.filter(([label]) => !item.readings.some(([name]) => name === label))];
}

function readSession(): Session {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) ?? 'null');
    if (saved?.items && Array.isArray(saved.log)) return saved;
  } catch { /* An unreadable session starts fresh. */ }
  return { items: {}, log: [] };
}

function ItemEditor({ item, initial, onSave, onReset, onClose }: {
  item: DrillItem;
  initial?: Attributes;
  onSave: (attributes: Attributes) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState(initial ?? emptyAttributes);
  const readings = editableReadings(item);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);

  return (
    <dialog ref={dialog} className="drill-dialog" aria-labelledby="drill-item-title" onCancel={event => {
      event.preventDefault();
      onClose();
    }}>
      <form onSubmit={event => { event.preventDefault(); onSave(draft); }}>
        <div className="drill-dialog-header">
          <div>
            <p>{itemKindName(item)}{item.tag && ` · ${item.tag}`}</p>
            <h2 id="drill-item-title">{item.label}</h2>
          </div>
          <button type="button" className="drill-secondary" onClick={onClose}>关闭</button>
        </div>
        {item.note && <p className="drill-item-note">{item.note}</p>}
        {readings.length > 0 && (
          <div className="drill-fields">
            <div className="drill-field-head"><span>测点</span><span>截图值</span><span>模拟值</span></div>
            {readings.map(([label, original, unit]) => (
              <label className="drill-field" key={label}>
                <span>{label}</span><span className="drill-original">{original ? `${original}${unit ? ` ${unit}` : ''}` : '—'}</span>
                <input aria-label={`${label}模拟值${unit ? `（${unit}）` : ''}`} placeholder={original ? '沿用截图值' : unit} maxLength={48}
                  value={draft.readings[label] ?? ''} onChange={event => {
                    const value = event.target.value;
                    setDraft(previous => ({ ...previous, readings: { ...previous.readings, [label]: value } }));
                  }} />
              </label>
            ))}
          </div>
        )}
        <div className="drill-settings">
          <label>模拟状态<select value={draft.condition} onChange={event => {
            const condition = event.target.value as Attributes['condition'];
            setDraft(previous => ({ ...previous, condition }));
          }}><option>正常</option><option>异常</option><option>故障</option></select></label>
          <label>模拟操作<select value={draft.operation} onChange={event => {
            const operation = event.target.value;
            setDraft(previous => ({ ...previous, operation }));
          }}><option value="">未操作</option>{operations[item.kind].map(operation => <option key={operation}>{operation}</option>)}</select></label>
          <label className="drill-note-field">故障现象或操作备注<textarea rows={2} maxLength={300} value={draft.note} onChange={event => {
            const note = event.target.value;
            setDraft(previous => ({ ...previous, note }));
          }} /></label>
        </div>
        <footer className="drill-dialog-footer">
          {initial && <button type="button" className="drill-secondary" onClick={onReset}>还原本项</button>}
          <button type="submit" className="drill-primary">应用模拟</button>
        </footer>
      </form>
    </dialog>
  );
}

export default function PreDrill() {
  const safeArea = useSafeArea();
  const [session, setSession] = useState(readSession);
  const [selected, setSelected] = useState<{ key: string; item: DrillItem }>();
  const [saveFailed, setSaveFailed] = useState(false);

  function updateItem(key: string, item: DrillItem, attributes?: Attributes) {
    const items = { ...session.items };
    if (attributes) items[key] = attributes;
    else delete items[key];
    const changes = attributes && editableReadings(item).flatMap(([name, , unit]) => {
      const value = attributes.readings[name]?.trim();
      return value ? [`${name} ${value}${unit ? ` ${unit}` : ''}`] : [];
    });
    const event = attributes ? [attributes.condition, attributes.operation, ...(changes ?? []), attributes.note].filter(Boolean).join(' · ') : '还原截图值';
    const entry = { at: new Date().toISOString(), target: item.label, event };
    const next = { items, log: [entry, ...session.log].slice(0, 100) };
    setSession(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
      setSaveFailed(false);
    } catch { setSaveFailed(true); }
    setSelected(undefined);
  }

  return (
    <main className="drill-page" style={{ paddingTop: safeArea.top + 16, paddingBottom: safeArea.bottom + 32 }}>
      <div className="drill-content">
        <Link className="drill-back" to="/">← 返回首页</Link>
        <div className="drill-page-header">
          <div>
            <p className="drill-kicker">预演练 · 离线模拟</p>
            <h1>{snapshot?.title ?? '系统架构图'}</h1>
            {snapshot && <p>点击管段或设备查看截图读数、设置模拟故障或记录操作。</p>}
          </div>
          {snapshot && <nav className="drill-nav" aria-label="图面导航">{snapshot.scenes.map(scene => (
            <button type="button" key={scene.id} onClick={() => document.getElementById(`pre-drill-${scene.id}`)?.scrollIntoView({ block: 'start' })}>{scene.title}</button>
          ))}</nav>}
        </div>
        {saveFailed && <p role="status" className="drill-save-error">本机存储不可用，本次演练状态仅在当前页面有效。</p>}
        {snapshot ? snapshot.scenes.map(scene => (
          <Diagram key={scene.id} scene={scene} stateOf={item => {
            const state = session.items[`${scene.id}/${item.id}`];
            if (!state) return undefined;
            return state.condition !== '正常' ? state.condition : state.operation || '已设定';
          }} onSelect={item => setSelected({ key: `${scene.id}/${item.id}`, item })} />
        )) : <p className="drill-empty">当前没有本地演练快照。</p>}
        {snapshot && <details className="drill-history">
          <summary>演练记录（{session.log.length}）</summary>
          {session.log.length ? <ol>{session.log.map(({ at, target, event }, index) => (
            <li key={`${at}/${index}`}><time dateTime={at}>{new Date(at).toLocaleString('zh-CN', { hour12: false })}</time><strong>{target}</strong><span>{event}</span></li>
          ))}</ol> : <p>暂无演练记录。</p>}
        </details>}
        {selected && <ItemEditor key={selected.key} item={selected.item} initial={session.items[selected.key]}
          onSave={attributes => updateItem(selected.key, selected.item, attributes)}
          onReset={() => updateItem(selected.key, selected.item)} onClose={() => setSelected(undefined)} />}
      </div>
    </main>
  );
}
