import React, { useEffect, useId, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { invoke, isTauri } from "@tauri-apps/api/core";
import "./style.css";
import ServiceSettings from "./ServiceSettings";
import SyncOverview from "./SyncOverview";
import OverlayScrollbars from "./OverlayScrollbars";
import type { Config, Mount } from "./types";

type Bucket = {
  time: number;
  upload: number;
  download: number;
  requests: number;
};
type RecordRow = {
  time: number;
  method: string;
  path: string;
  status: number;
  upload: number;
  download: number;
  peer: string;
};
type Snapshot = {
  config: Config;
  running: boolean;
  metrics: {
    upload: number;
    download: number;
    requests: number;
    minutes: Bucket[];
    days: Bucket[];
    records: RecordRow[];
  };
  dataDir: string;
};
const bytes = (n: number) =>
  n < 1024
    ? `${n} B`
    : n < 1048576
      ? `${(n / 1024).toFixed(1)} KB`
      : n < 1073741824
        ? `${(n / 1048576).toFixed(1)} MB`
        : `${(n / 1073741824).toFixed(2)} GB`;
const time = (n: number) =>
  new Date(n * 1000).toLocaleString("zh-CN", { hour12: false });
const tabs = [
  ["folders", "发布目录", "01"],
  ["traffic", "流量与历史", "02"],
] as const;
function Chart({
  bins,
  windowSeconds,
}: {
  bins: Bucket[];
  windowSeconds: number;
}) {
  const chartRef = useRef<HTMLDivElement>(null);
  const gradientId = useId().replace(/:/g, "");
  const [width, setWidth] = useState(800);
  useEffect(() => {
    const element = chartRef.current;
    if (!element) return;
    const resize = new ResizeObserver(([entry]) => setWidth(Math.max(160, entry.contentRect.width)));
    resize.observe(element);
    return () => resize.disconnect();
  }, []);
  const left = 64, right = width - 12, top = 10, baseline = 104, height = 132;
  const end = Math.floor(Date.now() / 1000 / 60) * 60;
  const step =
    windowSeconds <= 3600 ? 60 : windowSeconds <= 86400 ? 3600 : 86400;
  const count = Math.ceil(windowSeconds / step);
  const points = Array.from({ length: count }, (_, i) => ({
    time: Math.floor(end / step) * step - (count - i - 1) * step,
    upload: 0,
    download: 0,
  }));
  for (const b of bins) {
    const p = points.find((p) => b.time >= p.time && b.time < p.time + step);
    if (p) {
      p.upload += b.upload;
      p.download += b.download;
    }
  }
  const max = Math.max(1024, ...points.flatMap((p) => [p.upload, p.download]));
  const xy = (
    p: (typeof points)[number],
    i: number,
    kind: "upload" | "download",
  ) =>
    `${left + (i / Math.max(1, count - 1)) * (right - left)},${baseline - (p[kind] / max) * (baseline - top)}`;
  return (
    <div className="chart" ref={chartRef}>
      <div className="legend" title="服务端正文流量，不含 HTTP、TLS 和隧道开销。上传为发送给客户端，下载为接收客户端数据。">
        <span className="up">● 上传</span>
        <span className="down">● 下载</span>
        <small>
          每{step === 60 ? "分钟" : step === 3600 ? "小时" : "天"}
        </small>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="上传与下载流量折线图">
        <defs>
          {(["upload", "download"] as const).map(kind => <linearGradient key={kind} id={`${gradientId}-${kind}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={kind === "upload" ? "#449c82" : "#719bd6"} stopOpacity="0.34" />
            <stop offset="100%" stopColor={kind === "upload" ? "#449c82" : "#719bd6"} stopOpacity="0" />
          </linearGradient>)}
        </defs>
        {[0, 0.5, 1].map((r) => (
          <g key={r}>
            <line
              x1={left}
              x2={right}
              y1={baseline - r * (baseline - top)}
              y2={baseline - r * (baseline - top)}
              className="gridline"
            />
            <text x="0" y={baseline + 4 - r * (baseline - top)}>
              {bytes(Math.round(max * r))}
            </text>
          </g>
        ))}
        {(["upload", "download"] as const).map((k) => (
          <g key={k}>
            <path className="chart-area" fill={`url(#${gradientId}-${k})`}
              d={`M ${left} ${baseline} L ${points.map((p, i) => xy(p, i, k)).join(" L ")} L ${right} ${baseline} Z`} />
            <polyline
              points={points.map((p, i) => xy(p, i, k)).join(" ")}
              className={k}
            />
            {points.map((p, i) => (
              <circle
                key={p.time}
                cx={Number(xy(p, i, k).split(",")[0])}
                cy={Number(xy(p, i, k).split(",")[1])}
                r="2"
                className={k}
              >
                <title>
                  {time(p.time)} · {k === "upload" ? "上传" : "下载"}{" "}
                  {bytes(p[k])}
                </title>
              </circle>
            ))}
          </g>
        ))}
        {[0, Math.floor((count - 1) / 2), count - 1].map((i, j) => (
          <text
            key={j}
            x={left + (i / Math.max(1, count - 1)) * (right - left)}
            y="127"
            textAnchor={j === 0 ? "start" : j === 2 ? "end" : "middle"}
          >
            {new Date(points[i].time * 1000).toLocaleString("zh-CN", {
              ...(windowSeconds > 86400 ? { month: "2-digit", day: "2-digit" } : {}),
              hour: "2-digit",
              minute: "2-digit",
            })}
          </text>
        ))}
      </svg>
    </div>
  );
}
function App() {
  const desktop = isTauri();
  const [tab, setTab] = useState("folders");
  const [config, setConfig] = useState<Config>();
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [range, setRange] = useState(3600);
  const [direction, setDirection] = useState("all");
  const [catalog, setCatalog] = useState<any>();
  useEffect(() => {
    if (!config || !isTauri()) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void invoke("inspect_mounts", { config }).then(value => { if (!cancelled) setCatalog(value); })
        .catch(e => { if (!cancelled) setError(String(e)); });
    }, 500);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [config?.mounts]);
  const initialized = useRef(false);
  const [systemDark, setSystemDark] = useState(
    matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const theme = config?.theme ?? "system";
  useEffect(() => {
    const m = matchMedia("(prefers-color-scheme: dark)");
    const f = () => setSystemDark(m.matches);
    m.addEventListener("change", f);
    return () => m.removeEventListener("change", f);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme =
      theme === "system" ? (systemDark ? "dark" : "light") : theme;
  }, [theme, systemDark]);
  const refresh = async () => {
    const s = await invoke<Snapshot>("get_state");
    setSnapshot(s);
    if (!initialized.current) {
      setConfig(s.config);
      initialized.current = true;
    }
  };
  useEffect(() => {
    if (!isTauri()) {
      setConfig({ host: "127.0.0.1", port: 18080, accessToken: "", theme: "system", mounts: [], publicUrl: "", publicPort: null });
      return;
    }
    let disposed = false;
    const poll = async () => {
      try {
        if (!disposed) await refresh();
      } catch (e) {
        if (!disposed) setError(String(e));
      }
    };
    void poll();
    const timer = setInterval(poll, 2000);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, []);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  const update = (patch: Partial<Config>) => {
    setConfig((c) => (c ? { ...c, ...patch } : c));
    setDirty(true);
  };
  const mount = (id: string, patch: Partial<Mount>) =>
    config &&
    update({
      mounts: config.mounts.map((m) => (m.id === id ? { ...m, ...patch } : m)),
    });
  const pick = async (directory: boolean) =>
    invoke<string | null>("choose_path", { directory });
  const save = async () => {
    if (!config) return;
    await invoke("save_config", { config });
    setDirty(false);
    setMessage("配置已保存");
  };
  const running = snapshot?.running ?? false;
  const locked = running || busy || !desktop;
  return (
    <div className="shell">
      <div className="app-bar">
        <a className="brand" href="#">
          <span className="brand-mark" aria-hidden="true">
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              focusable="false"
            >
              <rect x="3" y="3" width="18" height="7" rx="2" />
              <rect x="3" y="14" width="18" height="7" rx="2" />
              <path d="M7 6.5h.01M7 17.5h.01M11 6.5h6M11 17.5h6" />
            </svg>
          </span>
          <span>
            题库服务台
          </span>
        </a>
        <nav aria-label="主导航">
          {tabs.map(([key, label]) => (
            <button
              key={key}
              className={tab === key ? "active" : ""}
              aria-current={tab === key ? "page" : undefined}
              onClick={() => setTab(key)}
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
                {key === "folders" ? <path d="M3 7V5a1 1 0 0 1 1-1h6l2 3h8a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7Z" /> : <><path d="M3 3v18h18M6 15l4-5 4 3 6-8" /></>}
              </svg>
              {label}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <span className={`service-state ${running ? "is-running" : ""}`}>
          <span className={`status-dot ${running ? "on" : ""}`} />
          {running ? "服务正在运行" : "服务已关闭"}
          </span>
          <select
            aria-label="主题"
            value={theme}
            disabled={busy || !config}
            onChange={(e) => {
              const theme = e.target.value;
              if (!desktop) { setConfig(c => c ? { ...c, theme } : c); return; }
              void run(async () => {
                await invoke("set_theme", { theme });
                setConfig((c) => (c ? { ...c, theme } : c));
              });
            }}
          >
            <option value="system">跟随系统</option>
            <option value="light">浅色主题</option>
            <option value="dark">深色主题</option>
          </select>
        </div>
      </div>
      <main className={tab === "folders" ? "publish-workspace" : "traffic-workspace"}>
        <header>
          <div>
            <h1>{tabs.find((t) => t[0] === tab)?.[1]}{tab === "traffic" && !desktop && <small className="preview-badge">预览</small>}</h1>
            {tab === "folders" && <p>把电脑里的题库、知识库、值班表和软件包，发布到同一个地址。</p>}
          </div>
          <div className="actions">
            {tab === "folders" && <button
              disabled={!config || locked || !dirty}
              onClick={() => run(save)}
            >
              保存配置{dirty ? " *" : ""}
            </button>}
            <button
              className={running ? "danger" : "primary"}
              disabled={!config || busy || !desktop}
              onClick={() =>
                run(async () => {
                  if (running) {
                    await invoke("stop_service");
                    setMessage("服务已关闭，流量记录已保存");
                  } else {
                    await save();
                    await invoke("start_service");
                    setMessage("本地服务已启动，可使用第三方访问链接测试连接");
                  }
                })
              }
            >
              {busy ? "处理中…" : running ? "关闭服务" : "启动服务"}
            </button>
          </div>
        </header>
        {!desktop && tab === "folders" && <div className="preview-notice"><span>预览模式</span>目录选择与服务启动请在桌面版中操作，页面主题可直接切换。</div>}
        {error && (
          <div className="notice error" role="alert">
            {error}
          </div>
        )}
        {message && (
          <div className="notice" role="status">
            {message}
          </div>
        )}
        {tab === "folders" && (
          <div className="publish-grid">
            <div className="publish-main">
            <section className="panel directory-panel">
              <div className="panel-head">
                <div>
                  <h2>发布目录</h2>
                  <p>
                    按文件夹发布，客户端仅能读取已启用目录。
                  </p>
                </div>
                <button
                  disabled={locked || !config}
                  onClick={() =>
                    run(async () => {
                      const path = await pick(true);
                      if (path && config)
                        update({
                          mounts: [
                            ...config.mounts,
                            {
                              id: crypto.randomUUID(),
                              name: path.split(/[\\/]/).pop() || "新目录",
                              path,
                              kind: "bank",
                              enabled: true,
                            },
                          ],
                        });
                    })
                  }
                >
                  ＋ 添加文件夹
                </button>
              </div>
              <div className="catalog-strip" aria-label="已发布内容">
                <span><strong>{catalog?.banks.userBanks.length ?? (config?.mounts.length ? "—" : 0)}</strong> 题库</span>
                <span><strong>{catalog?.knowledge.items.length ?? (config?.mounts.length ? "—" : 0)}</strong> 知识条目</span>
                <span><strong>{catalog?.duties.userDuties.length ?? (config?.mounts.length ? "—" : 0)}</strong> 值班表</span>
                <span><strong>{catalog?.packages?.items.length ?? (config?.mounts.length ? "—" : 0)}</strong> 软件包</span>
              </div>
              <div className="directory-content" tabIndex={0} aria-label="发布目录列表">
              {!config?.mounts.length ? (
                <div className="empty">
                  <span className="empty-icon" aria-hidden="true"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M3 7V5a1 1 0 0 1 1-1h5l3 3h8a1 1 0 0 1 1 1v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" /><path d="M12 10v6m-3-3h6" /></svg></span>
                  <div>
                  <h3>选择第一个发布目录</h3>
                  <p>
                    添加文件夹后，题库、知识库、值班表和软件包会在这里集中管理。
                  </p>
                  <div className="format-labels"><span>JSON 题库</span><span>Markdown / TXT</span><span>值班表</span><span>软件包</span></div>
                  </div>
                </div>
              ) : (
                <div className="mount-list">
                  {config.mounts.map((m) => (
                    <div className="mount-row" key={m.id}>
                      <input
                        type="checkbox"
                        aria-label={`发布 ${m.name}`}
                        disabled={locked}
                        checked={m.enabled}
                        onChange={(e) =>
                          mount(m.id, { enabled: e.target.checked })
                        }
                      />
                      <div className="mount-info">
                        <input
                          className="mount-name"
                          aria-label="目录名称"
                          value={m.name}
                          disabled={locked}
                          onChange={(e) =>
                            mount(m.id, { name: e.target.value })
                          }
                        />
                        <div className="path-control">
                          <input
                            aria-label="文件夹路径"
                            value={m.path}
                            disabled={locked}
                            onChange={(e) =>
                              mount(m.id, { path: e.target.value })
                            }
                          />
                          <button
                            disabled={locked}
                            onClick={() =>
                              run(async () => {
                                const p = await pick(true);
                                if (p) mount(m.id, { path: p });
                              })
                            }
                          >
                            更换
                          </button>
                        </div>
                      </div>
                      <select
                        aria-label="数据类型"
                        value={m.kind}
                        disabled={locked}
                        onChange={(e) => mount(m.id, { kind: e.target.value })}
                      >
                        <option value="bank">题库</option>
                        <option value="knowledge">知识库</option>
                        <option value="duty">值班表</option>
                        <option value="package">软件包</option>
                      </select>
                      <button
                        className="quiet"
                        disabled={locked}
                        onClick={() =>
                          update({
                            mounts: config.mounts.filter((x) => x.id !== m.id),
                          })
                        }
                      >
                        移除
                      </button>
                    </div>
                  ))}
                </div>
              )}
              </div>
              <footer>
                <span>
                  {config?.mounts.filter((m) => m.enabled).length ?? 0}{" "}
                  个目录已启用
                </span>
                <button
                  disabled={!config || busy || !desktop}
                  onClick={() =>
                    run(async () => {
                      setCatalog(await invoke("inspect_mounts", { config }));
                    })
                  }
                >
                  检查目录内容
                </button>
              </footer>
              <div className="directory-notes">
                {catalog?.warnings?.length > 0 && <details className="catalog-warnings"><summary>目录检查提示 · {catalog.warnings.length} 项</summary>{catalog.warnings.map((w: string, i: number) => <p className="warning" key={i}>{w}</p>)}</details>}
                <details className="help"><summary>目录准备说明</summary><p>题库与值班表使用 JSON；题库图片放在同级 image 文件夹。知识库支持 JSON、Markdown 和 UTF-8 TXT。软件包名称需包含版本号与构建号，例如 Answer_Test_v0.4.4_build20261021_arm64.apk 或 Answer_Test_v0.4.4_build20261021_x64.exe。发布目录只读，客户端同步备份单独存放。</p></details>
              </div>
            </section>
            </div>
            <div className="publish-side">
            {config && (
              <ServiceSettings
                config={config}
                running={running}
                busy={busy || !desktop}
                onChange={update}
                onEndpointSaved={(publicUrl) =>
                  setConfig((current) =>
                    current ? { ...current, publicUrl, publicPort: null } : current,
                  )
                }
              />
            )}
            <SyncOverview dataDir={snapshot?.dataDir ?? ''} />
            </div>
          </div>
        )}
        {tab === "traffic" && (
          <>
            <section className="panel trend-panel">
            <div className="traffic-summary">
            <div className="stats overview">
              <article>
                <span title="服务端累计发送给客户端的正文流量">累计上传</span>
                <strong>{bytes(snapshot?.metrics.upload ?? 0)}</strong>
              </article>
              <article>
                <span title="服务端累计接收客户端的正文流量">累计下载</span>
                <strong>{bytes(snapshot?.metrics.download ?? 0)}</strong>
              </article>
              <article>
                <span>累计请求</span>
                <strong>
                  {snapshot?.metrics.requests.toLocaleString() ?? "0"}
                </strong>
              </article>
            </div>
                <select
                  aria-label="统计时间范围"
                  value={range}
                  onChange={(e) => setRange(Number(e.target.value))}
                >
                  <option value={3600}>最近 1 小时</option>
                  <option value={86400}>最近 24 小时</option>
                  <option value={604800}>最近 7 天</option>
                </select>
              </div>
              <Chart
                bins={
                  range > 86400
                    ? (snapshot?.metrics.days ?? [])
                    : (snapshot?.metrics.minutes ?? [])
                }
                windowSeconds={range}
              />
            </section>
            <section className="panel requests-panel">
              <div className="panel-head">
              <h2>
                最近请求 <small>保留最近 500 条</small>
              </h2>
              <select aria-label="请求传输方向" value={direction} onChange={e => setDirection(e.target.value)}>
                <option value="all">全部请求</option>
                <option value="upload">上传 · 发送给客户端</option>
                <option value="download">下载 · 接收客户端数据</option>
              </select>
              </div>
              <div className="table-wrap" tabIndex={0} aria-label="最近请求列表">
                <table>
                  <thead>
                    <tr>
                      <th>时间</th>
                      <th>请求</th>
                      <th>状态</th>
                      <th className="up" title="发送给客户端">上传 ↑</th>
                      <th className="down" title="接收客户端数据">下载 ↓</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...(snapshot?.metrics.records ?? [])]
                      .reverse()
                      .filter(r => direction === "all" || (direction === "download" ? r.method === "PUT" : r.method !== "PUT"))
                      .map((r, i) => (
                        <tr key={i}>
                          <td>{time(r.time)}</td>
                          <td>
                            <div className="request-line">
                            <span className={`request-direction ${r.method === "PUT" ? "down" : "up"}`} title={r.method === "PUT" ? "接收客户端数据" : "发送给客户端"}>{r.method === "PUT" ? "↓ 下载" : "↑ 上传"}</span>
                            <code>
                              {r.method} {r.path}
                            </code>
                            </div>
                            <small>{r.peer}</small>
                          </td>
                          <td className={r.status >= 400 ? "warning" : ""}>
                            {r.status}
                          </td>
                          <td className="up transfer-cell">{bytes(r.upload)}</td>
                          <td className="down transfer-cell">{bytes(r.download)}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
                {!snapshot?.metrics.records.length && <p className="empty-small">暂无请求，客户端连接后自动显示。</p>}
                {!!snapshot?.metrics.records.length && !snapshot.metrics.records.some(r => direction === "all" || (direction === "download" ? r.method === "PUT" : r.method !== "PUT")) && <p className="empty-small">当前方向没有请求记录。</p>}
              </div>
            </section>
          </>
        )}
      </main>
      <OverlayScrollbars />
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
