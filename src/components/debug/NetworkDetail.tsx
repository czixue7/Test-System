import React, { useState } from 'react';
import type { DebugRequest } from '../../utils/debugNetwork';
import { snapshotDebugValue } from '../../utils/debugValues';
import ValueTree from './ValueTree';

export default function NetworkDetail({ request }: { request: DebugRequest }) {
  const [tab, setTab] = useState<'overview' | 'headers' | 'payload' | 'response'>('overview');
  let parsed: unknown;
  try { parsed = JSON.parse(request.responseBody || ''); } catch {}
  return <div className="debug-network-detail">
    <div className="debug-subtabs" role="tablist" aria-label="请求详情">{([['overview', '概览'], ['headers', '请求头'], ['payload', '参数'], ['response', '响应']] as const).map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>{label}</button>)}</div>
    {tab === 'overview' && <dl className="debug-page-info">
      {Object.entries({ 地址: request.url, 方式: request.method, 来源: request.source, 状态: request.source === 'beacon' ? request.bodyNote : request.status === null ? '等待响应' : request.status || '失败', 耗时: `${request.duration} ms`, ...(request.error ? { 错误: request.error } : {}) }).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}
    </dl>}
    {tab === 'headers' && <><p className="debug-inline-note">展示页面可读取的头；浏览器自动添加的头不一定对脚本可见。</p><h4>Request Headers</h4><ValueTree node={snapshotDebugValue(request.requestHeaders || {})} initialOpen /><h4>Response Headers</h4><ValueTree node={snapshotDebugValue(request.responseHeaders || {})} initialOpen /></>}
    {tab === 'payload' && <><h4>Query String</h4><ValueTree node={snapshotDebugValue(request.query || {})} initialOpen /><h4>Request Body</h4><pre>{request.requestBody || '无请求正文'}</pre></>}
    {tab === 'response' && <>{parsed !== undefined ? <ValueTree node={snapshotDebugValue(parsed)} initialOpen /> : <pre>{request.responseBody || (request.status === null ? '等待响应' : '无可显示的正文')}</pre>}{request.bodyNote && <p className="debug-inline-note">{request.bodyNote}</p>}</>}
  </div>;
}
