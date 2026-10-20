import React, { useState } from 'react';
import { executeDebugCommand, useDebugConsoleStore } from '../../utils/debugConsole';
import ValueTree from './ValueTree';

export default function JSPanel({ selected, query = '' }: { selected: Element | null; query?: string }) {
  const { commands } = useDebugConsoleStore();
  const [source, setSource] = useState(''), [historyIndex, setHistoryIndex] = useState(-1), [draft, setDraft] = useState('');
  const run = () => { if (!source.trim()) return; void executeDebugCommand(source, selected); setSource(''); setHistoryIndex(-1); };
  return <div className="debug-js-panel">
    <p className="debug-inline-note">支持表达式、语句及 await。$ / $$ 查询元素，$0 为选中元素；localStorage / sessionStorage 指向当前页面存储。</p>
    <form className="debug-js-editor" onSubmit={event => { event.preventDefault(); run(); }}>
      <textarea aria-label="JavaScript 代码" placeholder={'输入 JavaScript…\n如 await Promise.resolve({ ready: true })'} value={source} rows={3} spellCheck={false} onChange={event => setSource(event.target.value)} onKeyDown={event => {
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); run(); }
        if (event.key === 'ArrowUp' && !source.includes('\n')) {
          const index = Math.min(commands.length - 1, historyIndex + 1); if (index < 0) return; event.preventDefault();
          if (historyIndex < 0) setDraft(source); setSource(commands[commands.length - 1 - index].source); setHistoryIndex(index);
        } else if (event.key === 'ArrowDown' && historyIndex >= 0) {
          event.preventDefault(); const index = Math.min(commands.length - 1, historyIndex - 1); setSource(index < 0 ? draft : commands[commands.length - 1 - index]?.source ?? draft); setHistoryIndex(index);
        }
      }} />
      <div className="debug-inline-actions"><span>Ctrl / ⌘ + Enter 执行 · ↑↓ 历史</span><button type="button" onClick={() => useDebugConsoleStore.setState({ commands: [] })}>清空结果</button><button type="submit">执行 JS</button></div>
    </form>
    {commands.filter(command => `${command.source} ${JSON.stringify(command.result)}`.toLowerCase().includes(query)).map(command => <div key={command.id} className={`debug-js-result ${command.status === 'rejected' ? 'debug-js-result--error' : ''}`}>
      <button className="debug-js-source" type="button" title="重新载入此命令" onClick={() => { setSource(command.source); setHistoryIndex(-1); }}>› {command.source}</button>
      {command.result ? <ValueTree node={command.result} initialOpen /> : <p className="debug-inline-note">等待 Promise 返回…</p>}
    </div>)}
  </div>;
}
