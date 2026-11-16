import React, { useId, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

export type BodyPreview = { kind: string; text: string; truncated: boolean };
export type RequestDetail = {
  protocol: string; direction: string; durationMs: number; resource: string; localPath?: string | null;
  query: string; requestHeaders: Record<string, string>; responseHeaders: Record<string, string>;
  requestBody: BodyPreview; responseBody: BodyPreview;
};
export type RecordRow = {
  id?: string; time: number; method: string; path: string; status: number;
  upload: number; download: number; peer: string;
  summary?: string; direction?: string; hasDetail?: boolean;
};
const bytes = (n: number) => n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : n < 1073741824 ? `${(n / 1048576).toFixed(1)} MB` : `${(n / 1073741824).toFixed(2)} GB`;
const time = (n: number) => new Date(n * 1000).toLocaleString('zh-CN', { hour12: false });
export const requestDirection = (r: RecordRow) => r.direction || (['PUT', 'POST', 'PATCH'].includes(r.method) ? 'download' : 'upload');
const loadRequestDetail = (id: string) => invoke<RequestDetail | null>('get_request_detail', { id });

function Headers({ title, headers }: { title: string; headers: Record<string, string> }) {
  return <section className="request-detail-section"><h3>{title}</h3>
    {Object.keys(headers).length ? <dl className="request-headers">{Object.entries(headers).map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{value}</dd></div>)}</dl> : <p>无记录</p>}
  </section>;
}
function Preview({ title, body }: { title: string; body: BodyPreview }) {
  return <section className="request-detail-section"><h3>{title}{body.truncated && <small>已截取摘要</small>}</h3>
    {body.kind === 'json' || body.kind === 'text' ? <pre tabIndex={0}>{body.text}</pre> : <p>{body.text || '无正文'}</p>}
  </section>;
}

/* Hierarchy: resource and direction first, endpoint and transfer counts second,
   headers/body previews on demand. Reuse panel/input/line/text/soft tokens;
   green upload and blue download also retain arrows and explicit text (§5.7). */
export default function RequestHistory({ records, direction, loadDetail = loadRequestDetail }: {
  records: RecordRow[]; direction: string; loadDetail?: (id: string) => Promise<RequestDetail | null>;
}) {
  const [selected, setSelected] = useState<{ key: string; record: RecordRow } | null>(null);
  const [detail, setDetail] = useState<RequestDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const sequence = useRef(0);
  const panelId = useId();
  const show = async (record: RecordRow, key: string) => {
    const ticket = ++sequence.current;
    if (selected?.key === key) { setSelected(null); setLoading(false); return; }
    setSelected({ record, key }); setDetail(null); setError('');
    if (!record.hasDetail || !record.id) { setLoading(false); return; }
    setLoading(true);
    try { const result = await loadDetail(record.id); if (ticket === sequence.current) setDetail(result); }
    catch (e) { if (ticket === sequence.current) setError(String(e)); }
    finally { if (ticket === sequence.current) setLoading(false); }
  };
  const rows = records.map((record, index) => ({ record, key: record.id || `${record.time}-${record.path}-${index}` }))
    .reverse().filter(({ record }) => direction === 'all' || requestDirection(record) === direction);
  return <div className="table-wrap" tabIndex={0} aria-label="最近请求列表">
    <table><thead><tr><th>时间</th><th>请求与资源</th><th>状态</th>
      <th className="up" title="发送给客户端">上传 ↑</th><th className="down" title="接收客户端数据">下载 ↓</th><th>详情</th>
    </tr></thead><tbody>{rows.map(({ record: r, key }) => {
      const transfer = requestDirection(r);
      const open = selected?.key === key;
      return <React.Fragment key={key}>
        <tr data-request-id={r.id} className={`request-row is-${transfer} ${open ? 'is-expanded' : ''}`}>
          <td>{time(r.time)}</td><td><div className="request-line">
            <span className={`request-direction ${transfer === 'download' ? 'down' : 'up'}`}>{transfer === 'download' ? '↓ 下载' : '↑ 上传'}</span>
            <strong className="request-resource">{r.summary || `${r.method} 请求`}</strong>
          </div><code className="request-endpoint">{r.method} {r.path}</code><small>{r.peer}</small></td>
          <td className={r.status >= 400 ? 'warning' : ''}>{r.status}</td>
          <td className="up transfer-cell">{bytes(r.upload)}</td><td className="down transfer-cell">{bytes(r.download)}</td>
          <td><button type="button" className="request-toggle" aria-expanded={open} aria-controls={open ? panelId : undefined}
            aria-label={`${open ? '收起' : '查看'}请求详情：${r.method} ${r.path}`} onClick={() => void show(r, key)}>{open ? '收起详情' : '查看详情'}</button></td>
        </tr>
        {open && <tr className="request-detail-row"><td colSpan={6}><div className="request-detail" id={panelId} role="region" aria-label="请求详情" aria-busy={loading}>
          <div className="request-detail-heading"><h3>{r.summary || '请求详情'}</h3><span>{transfer === 'download' ? '下载：客户端 → 服务台' : '上传：服务台 → 客户端'}</span></div>
          <dl className="request-facts">
            <div><dt>时间</dt><dd>{time(r.time)}</dd></div><div><dt>客户端</dt><dd>{r.peer}</dd></div>
            <div><dt>方法 / 协议</dt><dd>{r.method} / {detail?.protocol || '未记录'}</dd></div>
            <div><dt>响应状态</dt><dd>{r.status}</dd></div><div><dt>发送给客户端</dt><dd>{bytes(r.upload)}</dd></div>
            <div><dt>接收客户端数据</dt><dd>{bytes(r.download)}</dd></div>
            <div><dt>处理耗时</dt><dd>{detail ? `${detail.durationMs} ms` : '未记录'}</dd></div>
            <div><dt>请求地址</dt><dd><code>{r.path}{detail?.query ? `?${detail.query}` : ''}</code></dd></div>
            {detail?.localPath && <div className="request-file-path"><dt>本地资源文件</dt><dd>{detail.localPath}</dd></div>}
          </dl>
          {loading ? <p role="status">正在读取详情…</p> : error ? <p className="warning" role="alert">{error}</p> : detail ? <>
            <div className="request-detail-columns"><Headers title="请求头" headers={detail.requestHeaders} /><Headers title="响应头" headers={detail.responseHeaders} /></div>
            <div className="request-detail-columns"><Preview title="请求正文" body={detail.requestBody} /><Preview title="响应正文" body={detail.responseBody} /></div>
            <p className="request-detail-note">正文显示有限长度的摘要；密钥和凭据已隐藏。处理耗时不包含文件流发送完成后的时间。</p>
          </> : <p className="request-detail-note">这是一条旧记录，仅保留上方基础信息。新请求会记录资源、耗时、请求头与正文摘要。</p>}
        </div></td></tr>}
      </React.Fragment>;
    })}</tbody></table>
    {!records.length && <p className="empty-small">暂无请求，客户端连接后自动显示。</p>}
    {!!records.length && !rows.length && <p className="empty-small">当前方向没有请求记录。</p>}
  </div>;
}
