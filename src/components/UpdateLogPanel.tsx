import React, { useEffect, useRef, useState } from 'react';
import { copyText } from '../utils/copyText';

function UpdateLogPanel({ logs }: { logs: string[] }) {
  const list = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const [copyStatus, setCopyStatus] = useState('复制');
  useEffect(() => { if (following.current && list.current) list.current.scrollTop = list.current.scrollHeight; }, [logs]);
  return <section className="update-log-panel" aria-label="更新日志">
    <div className="update-log-heading"><span>更新日志 <small>{logs.length} 条</small></span>
      <button type="button" onClick={async () => setCopyStatus(await copyText(logs.join('\n')) ? '已复制' : '复制失败')}>{copyStatus}</button>
    </div>
    <div ref={list} className="update-log-list" tabIndex={0} onScroll={() => {
      const el = list.current; if (el) following.current = el.scrollHeight - el.scrollTop - el.clientHeight < 32;
    }}>
      {logs.map((log, index) => {
        const match = log.match(/^\[(.*?)\] ([\s\S]*)$/);
        const message = match?.[2] || log;
        const level = /❌|失败|错误/.test(message) ? 'error' : /⚠️|警告/.test(message) ? 'warn' : /✅|完成|成功|已是最新/.test(message) ? 'success' : 'info';
        return <div key={index} className={`update-log-row update-log-row--${level}`}>
          <span className="update-log-dot" /><time>{match?.[1] || '—'}</time><span>{message}</span>
        </div>;
      })}
    </div>
  </section>;
}

export default React.memo(UpdateLogPanel);
