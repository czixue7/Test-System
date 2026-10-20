import React, { useEffect, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";

type Row = {
  space: string;
  kind: string;
  revision: number;
  updatedAt: number;
  bytes: number;
  records: number;
};
type Overview = { rows: Row[]; warnings: string[] };
const kinds = [
  ["banks", "题库", "个题库"],
  ["knowledge", "知识库", "条知识"],
  ["summaries", "总结", "个版本"],
  ["chat", "AI 聊天", "个会话"],
  ["duty", "值班表", "张表"],
] as const;
const size = (n: number) =>
  n < 1024
    ? `${n} B`
    : n < 1048576
      ? `${(n / 1024).toFixed(1)} KB`
      : `${(n / 1048576).toFixed(1)} MB`;
export default function SyncOverview({ dataDir }: { dataDir: string }) {
  const [open, setOpen] = useState(true);
  const [data, setData] = useState<Overview>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!open || !isTauri()) return;
    let disposed = false;
    let pending = false;
    const refresh = async () => {
      if (pending) return;
      pending = true;
      setLoading(true);
      try {
        const next = await invoke<Overview>("get_sync_overview");
        if (!disposed) {
          setData(next);
          setError("");
        }
      } catch (e) {
        if (!disposed) setError(String(e));
      } finally {
        pending = false;
        if (!disposed) setLoading(false);
      }
    };
    void refresh();
    const timer = setInterval(refresh, 10000);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [open]);
  const rows = data?.rows ?? [];
  const spaces = [...new Set(rows.map((row) => row.space))];
  return (
    <section className="panel sync-overview" aria-label="电脑同步存储" data-expanded={open}>
      <button
        className="sync-overview-heading"
        aria-expanded={open}
        aria-controls="sync-storage-body"
        onClick={() => setOpen(!open)}
      >
        <span>
          <strong>同步存储</strong>
          <small>
            {data
              ? `${spaces.length} 个空间 · ${size(rows.reduce((sum, row) => sum + row.bytes, 0))}`
              : "题库、知识库、总结、AI 聊天、值班表"}
          </small>
        </span>
        <span
          className={`sync-overview-chevron ${open ? "open" : ""}`}
          aria-hidden="true"
        >
          ⌄
        </span>
      </button>
      {open && (
        <div id="sync-storage-body" className="sync-overview-body">
          <p className="sync-storage-hint">
            客户端开启同步后，内容保存在这台电脑。相同空间的设备会合并共享；发布目录与同步存储分别管理。
          </p>
          {error && (
            <p role="alert" className="warning">
              {error}
            </p>
          )}
          {loading && !data && <p role="status">正在读取同步存储…</p>}
          <div className="sync-channel-grid">
            {kinds.map(([kind, label, unit]) => (
              <article key={kind}>
                <span>{label}</span>
                <strong>
                  {rows
                    .filter((row) => row.kind === kind)
                    .reduce((sum, row) => sum + row.records, 0)}
                  <small>{unit}</small>
                </strong>
                <small>
                  {rows.some((row) => row.kind === kind)
                    ? "已保存在电脑"
                    : "等待首次同步"}
                </small>
              </article>
            ))}
          </div>
          {spaces.map((space) => (
            <details className="sync-space" key={space}>
              <summary>
                <span title={space}>{space}</span>
                <small>
                  {rows.filter((row) => row.space === space).length} 类内容
                </small>
              </summary>
              <div className="sync-space-rows">
                {rows
                  .filter((row) => row.space === space)
                  .map((row) => (
                    <div key={row.kind}>
                      <span>
                        {kinds.find((kind) => kind[0] === row.kind)?.[1]}
                      </span>
                      <small>
                        {row.kind === "banks" ? "SHA-256 校验" : `版本 ${row.revision}`} · {size(row.bytes)}
                      </small>
                      <time>
                        {row.updatedAt
                          ? new Date(row.updatedAt * 1000).toLocaleString(
                              "zh-CN",
                              { hour12: false },
                            )
                          : "时间未知"}
                      </time>
                    </div>
                  ))}
              </div>
            </details>
          ))}
          {!spaces.length && data && (
            <p className="sync-storage-hint">
              尚未收到同步内容。在答题软件的“内容同步”中选择此电脑服务，填写相同空间
              ID 后启用所需项目。
            </p>
          )}
          {data?.warnings.map((warning) => (
            <p className="warning" key={warning}>
              {warning}
            </p>
          ))}
          <p className="sync-storage-path">
            保存位置{" "}
            <code>
              {dataDir
                ? `${dataDir.replace(/[\\/]$/, "")}/sync`
                : "应用数据目录 / sync"}
            </code>
            <span>展开时每 10 秒刷新 · 数量按空间累计</span>
          </p>
        </div>
      )}
    </section>
  );
}
