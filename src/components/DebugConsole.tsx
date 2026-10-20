import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useDebugConsoleStore, clearDebugData, stopDebugCapture, serializeDebugValue, executeDebugCommand, DebugLevel, LOG_LIMIT, REQUEST_LIMIT } from '../utils/debugConsole';
import { useSettingsStore } from '../store/settingsStore';
import { debugStorageEntries, type DebugStorageKind } from '../utils/debugStorage';
import { getDebugSystemInfo } from '../utils/debugSystem';
import ValueTree from './debug/ValueTree';
import NetworkDetail from './debug/NetworkDetail';
import StoragePanel from './debug/StoragePanel';
import JSPanel from './debug/JSPanel';
import ElementsPanel, { useElementInspector } from './debug/ElementsPanel';
import type { DebugRequest } from '../utils/debugConsole';
import { copyText } from '../utils/copyText';
import { snapshotDebugValue, redactText } from '../utils/debugValues';
import DebugConsoleTrigger from './DebugConsoleTrigger';

type Tab = 'logs' | 'network' | 'elements' | 'storage' | 'js' | 'page';
const labels: Record<DebugLevel, string> = { log: '日志', info: '信息', warn: '警告', error: '错误', debug: '调试' };
const time = (value: number) => new Date(value).toLocaleTimeString('zh-CN', { hour12: false });
function Icon({ name }: { name: 'code' | 'close' | 'copy' | 'download' | 'expand' }) {
  const paths = { code: 'm8 7-5 5 5 5m8-10 5 5-5 5M14 4l-4 16', close: 'm6 6 12 12M18 6 6 18',
    copy: 'M9 9h12v12H9zM15 9V3H3v12h6', download: 'M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4', expand: 'M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6' };
  return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}

function useConsoleSlide(active: boolean) {
  const [mounted, setMounted] = useState(active);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    let firstFrame = 0, secondFrame = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (active) {
      setMounted(true);
      if (reduced) setShown(true);
      else firstFrame = requestAnimationFrame(() => { secondFrame = requestAnimationFrame(() => setShown(true)); });
    } else {
      setShown(false);
      // Keep the panel in the document until its slide-out has completed.
      if (reduced) setMounted(false);
      else timer = setTimeout(() => setMounted(false), 280);
    }
    return () => { cancelAnimationFrame(firstFrame); cancelAnimationFrame(secondFrame); if (timer) clearTimeout(timer); };
  }, [active]);
  return { mounted, shown };
}

export default function DebugConsole() {
  const { enabled, open, paused, logs, requests, commands } = useDebugConsoleStore();
  const slide = useConsoleSlide(enabled && open);
  const [tab, setTab] = useState<Tab>('logs');
  const [level, setLevel] = useState<DebugLevel | 'all'>('all');
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [notice, setNotice] = useState('');
  const [command, setCommand] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [storageKind, setStorageKind] = useState<DebugStorageKind>('local');
  const [historyIndex, setHistoryIndex] = useState(-1);
  const historyDraft = useRef('');
  const inspector = useElementInspector(enabled, () => setTab('elements'));
  const list = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const search = query.toLowerCase().trim();
  const visibleLogs = useMemo(() => logs.filter(item => (level === 'all' || item.level === level) && item.text.toLowerCase().includes(search)), [logs, level, search]);
  const visibleRequests = useMemo(() => requests.filter(item => `${item.url} ${item.method} ${item.status ?? ''} ${item.error || ''}`.toLowerCase().includes(search)), [requests, search]);
  const page = useMemo(() => (open || slide.mounted) && tab === 'page' ? getDebugSystemInfo() : {}, [open, slide.mounted, tab, refresh]);
  useEffect(() => {
    if (!enabled || !open || tab !== 'page') return;
    const timer = setInterval(() => setRefresh(value => value + 1), 1000); return () => clearInterval(timer);
  }, [enabled, open, tab]);

  useEffect(() => {
    if (open && follow.current && list.current && (tab === 'logs' || tab === 'network' || tab === 'js')) list.current.scrollTop = list.current.scrollHeight;
  }, [open, slide.mounted, tab, logs, requests, commands, query, level]);
  useEffect(() => {
    if (!open) return;
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') useDebugConsoleStore.setState({ open: false }); };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [open]);
  if ((!enabled && !slide.mounted) || typeof document === 'undefined') return null;

  const exportText = () => JSON.stringify(tab === 'logs' ? visibleLogs : tab === 'network' ? visibleRequests : tab === 'js' ? commands.map(command => ({ ...command, source: redactText(command.source) })) : tab === 'storage' ? debugStorageEntries(storageKind).filter(item => `${item.key} ${item.preview}`.toLowerCase().includes(search)).map(({key, preview}) => ({key, value: preview})) : tab === 'elements' ? { element: inspector.selected?.tagName, html: serializeDebugValue(inspector.selected?.outerHTML.slice(0, 16000)) } : page, null, 2);
  const exportFile = () => {
    const url = URL.createObjectURL(new Blob([exportText()], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url; link.download = `debug-${tab}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
    link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice('已导出当前筛选结果');
  };
  const changeTab = (next: Tab) => { setTab(next); setQuery(''); setNotice(''); follow.current = true; setRefresh(value => value + 1); };
  const runCommand = () => {
    const source = command.trim(), input = source.toLowerCase(); setCommand(''); setHistoryIndex(-1);
    if (!source) return;
    if (input === 'clear') { if (tab === 'js') useDebugConsoleStore.setState({ commands: [] }); else clearDebugData(tab === 'network' ? 'network' : 'logs'); }
    else if (input === 'system') changeTab('page');
    else if (input === 'storage') changeTab('storage');
    else if (input === 'network') changeTab('network');
    else if (input === 'elements') changeTab('elements');
    else if (input === 'pause' || input === 'resume') useDebugConsoleStore.setState({ paused: input === 'pause' });
    else if (input === 'export') exportFile();
    else if (input === 'help') setNotice('快捷命令：clear / network / elements / system / storage / pause / resume / export；也可直接输入 JS');
    else { changeTab('js'); void executeDebugCommand(source, inspector.selected); }
  };

  return createPortal(<div className="debug-console-root">
    {inspector.overlay}
    <DebugConsoleTrigger visible={enabled && !open && !slide.mounted && !inspector.picking} errors={logs.filter(item => item.level === 'error').length} onOpen={() => useDebugConsoleStore.setState({ open: true })} />
    {slide.mounted && <section ref={node => { node?.toggleAttribute('inert', !enabled || !open); }} className={`debug-console-panel ${slide.shown ? 'debug-console-panel--open' : ''} ${expanded ? 'debug-console-panel--expanded' : ''}`} aria-label="调试控制台" aria-hidden={!enabled || !open}>
      <div className="debug-console-heading">
        <div className="debug-console-title"><span className="debug-console-mark"><Icon name="code" /></span><strong>调试控制台</strong><span className={`debug-live ${paused ? 'debug-live--paused' : ''}`}>{paused ? '已暂停' : '正在采集'}</span></div>
        <div className="debug-console-heading-actions">
          <button type="button" title="复制当前筛选结果" aria-label="复制当前筛选结果" onClick={async () => setNotice(await copyText(exportText()) ? '已复制' : '复制失败，请使用导出')}><Icon name="copy" /></button>
          <button type="button" title="导出 JSON" aria-label="导出 JSON" onClick={exportFile}><Icon name="download" /></button>
          <button type="button" title={expanded ? '恢复面板高度' : '放大面板'} aria-label={expanded ? '恢复面板高度' : '放大面板'} onClick={() => setExpanded(!expanded)}><Icon name="expand" /></button>
          <button type="button" title="收起控制台（Esc）" aria-label="收起控制台" onClick={() => useDebugConsoleStore.setState({ open: false })}><Icon name="close" /></button>
        </div>
      </div>
      <div className="debug-console-tabs" role="tablist" aria-label="调试分类">
        {([['logs', '日志', logs.length], ['network', '网络', requests.length], ['elements', '元素', null], ['storage', '存储', null], ['js', 'JS', commands.length], ['page', '系统', null]] as const).map(([id, label, count]) =>
          <button type="button" key={id} role="tab" aria-selected={tab === id} id={`debug-tab-${id}`} aria-controls="debug-console-content" onClick={() => changeTab(id)}>{label}{count !== null && <small>{count}</small>}</button>)}
      </div>
      <div className="debug-console-toolbar">
        <input aria-label="搜索调试内容" placeholder={tab === 'network' ? '搜索 URL、状态码、请求方式…' : tab === 'elements' ? 'CSS 选择器，如 #root 或 .duty-day' : '搜索内容…'} value={query} onChange={event => setQuery(event.target.value)} />
        <button type="button" onClick={() => useDebugConsoleStore.setState({ paused: !paused })}>{paused ? '继续' : '暂停'}</button>
        {tab === 'logs' || tab === 'network' ? <button type="button" onClick={() => clearDebugData(tab)}>清空</button> : <button type="button" onClick={() => { if (tab === 'js') useDebugConsoleStore.setState({ commands: [] }); else setRefresh(value => value + 1); }}>{tab === 'js' ? '清空' : '刷新'}</button>}
      </div>
      {tab === 'logs' && <div className="debug-console-levels" aria-label="日志级别">
        {(['all', 'log', 'info', 'warn', 'error', 'debug'] as const).map(value => <button type="button" key={value} aria-pressed={level === value} className={`debug-level-filter debug-level-filter--${value}`} onClick={() => setLevel(value)}>{value === 'all' ? '全部' : labels[value]}<small>{value === 'all' ? logs.length : logs.filter(item => item.level === value).length}</small></button>)}
      </div>}
      <div ref={list} id="debug-console-content" className="debug-console-content" role="tabpanel" aria-labelledby={`debug-tab-${tab}`} tabIndex={0} onScroll={() => {
        const el = list.current; if (el) follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
      }}>
        {tab === 'logs' && (visibleLogs.length ? visibleLogs.map(item => <details key={item.id} className={`debug-log debug-log--${item.level}`}>
          <summary><time>{time(item.time)}</time><span className="debug-level-label">{labels[item.level]}</span><span className="debug-log-preview">{item.text.replace(/\s+/g, ' ')}</span>{item.count > 1 && <small>×{item.count}</small>}</summary><div className="debug-log-values">{item.values.map((value, index) => <ValueTree key={index} node={value} label={item.values.length > 1 ? String(index) : undefined} />)}</div>
        </details>) : <div className="debug-console-empty"><Icon name="code" /><strong>{search ? '没有匹配的日志' : '等待新的日志'}</strong><span>开启后自动采集 console 日志及页面错误</span></div>)}
        {tab === 'network' && (visibleRequests.length ? visibleRequests.map(item => <NetworkRow key={item.id} request={item} />) : <div className="debug-console-empty"><strong>{search ? '没有匹配的请求' : '等待网络请求'}</strong><span>记录 Fetch / XHR / Beacon 的请求头、参数、响应和耗时</span></div>)}
        {tab === 'page' && <dl className="debug-page-info">{Object.entries(page).filter(([key, value]) => `${key} ${serializeDebugValue(value)}`.toLowerCase().includes(search)).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value && typeof value === 'object' ? <ValueTree node={snapshotDebugValue(value)} /> : String(value)}</dd></div>)}</dl>}
        {tab === 'storage' && <StoragePanel kind={storageKind} setKind={setStorageKind} query={search} refresh={refresh} notify={setNotice} />}
        {tab === 'js' && <JSPanel selected={inspector.selected} query={search} />}
        {tab === 'elements' && <ElementsPanel selected={inspector.selected} select={inspector.select} startPicker={inspector.start} query={query} refresh={refresh} notify={setNotice} />}
      </div>
      <form className="debug-console-command" onSubmit={event => { event.preventDefault(); runCommand(); }}><span aria-hidden="true">›</span><input aria-label="JavaScript 或快捷命令" placeholder="输入 JS 或 help；Enter 执行" value={command} onChange={event => setCommand(event.target.value)} onKeyDown={event => {
        if (event.key === 'ArrowUp') { const index = Math.min(commands.length - 1, historyIndex + 1); if (index < 0) return; event.preventDefault(); if (historyIndex < 0) historyDraft.current = command; setHistoryIndex(index); setCommand(commands[commands.length - 1 - index].source); }
        else if (event.key === 'ArrowDown' && historyIndex >= 0) { event.preventDefault(); const index = Math.min(commands.length - 1, historyIndex - 1); setHistoryIndex(index); setCommand(index < 0 ? historyDraft.current : commands[commands.length - 1 - index]?.source ?? historyDraft.current); }
      }} /><button type="submit">执行</button></form>
      <div className="debug-console-footer"><span role="status">{notice || `${tab === 'logs' ? `${logs.length} / ${LOG_LIMIT} 条日志` : tab === 'network' ? `${requests.length} / ${REQUEST_LIMIT} 条请求` : '页面内调试'}${paused ? ' · 已暂停采集' : ''}`}</span><button type="button" onClick={() => { stopDebugCapture(); useSettingsStore.getState().setVconsoleEnabled(false); }}>停止调试</button></div>
    </section>}
  </div>, document.body);
}

function NetworkRow({ request: item }: { request: DebugRequest }) {
  const [open, setOpen] = useState(false);
  return <details className="debug-network-row" onToggle={event => { if (event.target === event.currentTarget) setOpen(event.currentTarget.open); }}>
    <summary><span className={`debug-status ${item.status === null ? 'debug-status--pending' : item.status === 0 || item.status >= 400 ? 'debug-status--error' : ''}`}>{item.source === 'beacon' ? item.status ? '已提交' : '失败' : item.status === null ? '等待' : item.status || '失败'}</span><b>{item.method}</b><span className="debug-log-preview">{item.url}</span><time>{item.duration} ms</time></summary>
    {open && <NetworkDetail request={item} />}
  </details>;
}
