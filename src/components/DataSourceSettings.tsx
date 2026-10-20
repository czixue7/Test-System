import Collapse from "./Collapse";
import React, { useId, useState } from "react";
import ConfirmDialog from "./ConfirmDialog";
import SettingsSelect from "./SettingsSelect";
import { useDataSourceStore, SyncKind } from "../store/dataSourceStore";
import {
  DataSourceEntry,
  validateSource,
} from "../utils/sourceConfig";
import { sourceRequest } from "../utils/dataSourceRequest";
import { fetchRemoteJson, releaseMetadataUrl } from "../utils/remoteRepo";
import { syncDataNow } from "../utils/dataSync";
import { useToast } from "../hooks/useToast";
import "./DataSourceSettings.css";

const options: [SyncKind, string, string, string][] = [
  ["knowledge", "知识库", "同步知识库内容", "知识条目与分类"],
  ["summaries", "总结", "同步总结内容", "各类总结的历史版本"],
  ["chat", "AI 聊天", "同步 AI 聊天内容", "会话与消息，不含 API 密钥"],
  ["duty", "值班表", "获取公共值班表", "仅获取服务台发布的值班表，不上传本机排班"],
];
const symbol = { gitee: "G", github: "GH", service: "PC" };
const Chevron = ({ open }: { open: boolean }) => (
  <svg
    className={`ds-chevron ${open ? "is-open" : ""}`}
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    aria-hidden="true"
  >
    <path d="m9 5 7 7-7 7" />
  </svg>
);
const Cloud = () => (
  <svg
    width="19"
    height="19"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    aria-hidden="true"
  >
    <path d="M7 18H6a4 4 0 0 1-.6-8A7 7 0 0 1 19 9a4.5 4.5 0 0 1-.5 9H17M12 12v9m-3-6 3-3 3 3" />
  </svg>
);

export default function DataSourceSettings() {
  const state = useDataSourceStore();
  const { showSuccess, showError } = useToast();
  const id = useId();
  const [expanded, setExpanded] = useState(false);
  const [syncExpanded, setSyncExpanded] = useState(false);
  const [spaceExpanded, setSpaceExpanded] = useState(false);
  const [moreId, setMoreId] = useState<string | null>(null);
  const [draft, setDraft] = useState<DataSourceEntry | null>(null);
  const [deleting, setDeleting] = useState<DataSourceEntry | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [space, setSpace] = useState(state.space);
  const [working, setBusy] = useState(false);
  const busy = working || state.syncing;
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const services = state.sources.filter(
    (s) => s.enabled && s.kind === "service",
  );
  const active = services.find((s) => s.id === state.syncSourceId);
  const enabled = state.sources.filter((s) => s.enabled);
  const syncCount = options.filter(([key]) => state.sync[key]).length;
  const spaceDirty = space !== state.space;
  const act = async (fn: () => Promise<string>, notify = true) => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await fn();
      setMessage(result);
      if (notify) showSuccess(result);
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      setError(detail);
      if (notify) showError(detail);
    } finally {
      setBusy(false);
    }
  };
  const edit = (entry?: DataSourceEntry) => {
    setDraft(
      entry
        ? { ...entry }
        : {
            id: crypto.randomUUID(),
            name: "",
            kind: "service",
            url: "",
            token: "",
            enabled: true,
          },
    );
    setExpanded(true);
    setMoreId(null);
    setError("");
    setMessage("");
  };
  const change = (patch: Partial<DataSourceEntry>) =>
    setDraft((current) => current && { ...current, ...patch });
  const test = async () => {
    const entry = validateSource(draft!);
    if (entry.kind === "service") {
      const result = await sourceRequest<{ service: string; version: number }>(
        "api/v1/health",
        { base: entry.url, token: entry.token },
      );
      if (
        result.data.service !== "question-bank-service" ||
        result.data.version !== 1
      )
        throw new Error("链接未指向兼容的题库服务台");
      return "连接成功，访问密钥有效";
    }
    await fetchRemoteJson(releaseMetadataUrl(entry));
    return "连接成功，已获取软件更新信息";
  };
  return (
    <div className="data-settings">
      <section
        className="ds-card bg-white dark:bg-gray-800 rounded-2xl shadow-md overflow-hidden"
        aria-label="数据来源设置"
      >
        <button
          className="ds-heading"
          aria-expanded={expanded}
          aria-controls={`${id}-sources`}
          onClick={() => setExpanded(!expanded)}
        >
          <span className="ds-heading-icon">
            <svg
              width="19"
              height="19"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              aria-hidden="true"
            >
              <ellipse cx="12" cy="5" rx="8" ry="3" />
              <path d="M4 5v7c0 4 16 4 16 0V5M4 12v7c0 4 16 4 16 0v-7" />
            </svg>
          </span>
          <span className="ds-heading-copy">
            <span className="ds-title text-gray-700 dark:text-gray-200">
              数据来源{" "}
              <span className="ds-count">
                {enabled.length}/{state.sources.length} 已启用
              </span>
            </span>
            <span className="ds-subtitle">
              {enabled.map((s) => s.name).join(" · ") ||
                "添加题库、值班表和更新来源"}
            </span>
          </span>
          <Chevron open={expanded} />
        </button>
        <Collapse open={expanded}>
          <div id={`${id}-sources`} className="ds-body">
            <div className="ds-list">
              {!state.sources.length && (
                <p className="ds-empty">
                  还没有数据来源，添加后即可获取在线内容。
                </p>
              )}
              {state.sources.map((entry, index) => (
                <div
                  className={`ds-source ${!entry.enabled ? "is-disabled" : ""}`}
                  key={entry.id}
                >
                  <div className="ds-source-row">
                    <span
                      className={`ds-symbol ds-symbol--${entry.kind}`}
                      aria-hidden="true"
                    >
                      {symbol[entry.kind]}
                    </span>
                    <button
                      className="ds-source-copy"
                      disabled={busy}
                      onClick={() => edit(entry)}
                      aria-label={`编辑 ${entry.name}`}
                    >
                      <span className="ds-source-name">
                        {entry.name}
                        {entry.id === state.syncSourceId && (
                          <span className="ds-mini-tag">同步</span>
                        )}
                      </span>
                      <span className="ds-source-url" title={entry.url}>
                        {entry.url.replace(/^https?:\/\//, "")}
                      </span>
                    </button>
                    <input
                      type="checkbox"
                      role="switch"
                      className="ds-switch"
                      aria-label={`启用 ${entry.name}`}
                      checked={entry.enabled}
                      disabled={busy}
                      onChange={(e) =>
                        state.setSourceEnabled(entry.id, e.target.checked)
                      }
                    />
                    <button
                      className="ds-icon-button"
                      aria-label={`管理 ${entry.name}`}
                      aria-expanded={moreId === entry.id}
                      aria-controls={`${id}-row-${entry.id}`}
                      disabled={busy}
                      onClick={() =>
                        setMoreId(moreId === entry.id ? null : entry.id)
                      }
                    >
                      <svg
                        width="17"
                        height="17"
                        viewBox="0 0 24 24"
                        fill="currentColor"
                        aria-hidden="true"
                      >
                        <circle cx="12" cy="5" r="1.5" />
                        <circle cx="12" cy="12" r="1.5" />
                        <circle cx="12" cy="19" r="1.5" />
                      </svg>
                    </button>
                  </div>
                  <Collapse open={moreId === entry.id}>
                    <div
                      className="ds-row-actions"
                      id={`${id}-row-${entry.id}`}
                    >
                      <span>{entry.kind === "service" ? "电脑服务" : "软件更新"}</span>
                      <button
                        disabled={busy || index === 0}
                        aria-label={`上移 ${entry.name}`}
                        onClick={() => state.moveSource(entry.id, -1)}
                      >
                        上移
                      </button>
                      <button
                        disabled={busy || index === state.sources.length - 1}
                        aria-label={`下移 ${entry.name}`}
                        onClick={() => state.moveSource(entry.id, 1)}
                      >
                        下移
                      </button>
                      <button
                        className="ds-delete"
                        disabled={busy}
                        aria-label={`删除 ${entry.name}`}
                        onClick={() => {
                          setDeleting(entry);
                          setDeleteOpen(true);
                        }}
                      >
                        删除
                      </button>
                    </div>
                  </Collapse>
                </div>
              ))}
            </div>
            {!draft ? (
              <button className="ds-add" disabled={busy} onClick={() => edit()}>
                ＋ 添加数据来源
              </button>
            ) : (
              <form
                className="ds-editor"
                aria-label="编辑数据来源"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!busy)
                    void act(async () => {
                      state.saveSource(draft);
                      setDraft(null);
                      return "数据来源已保存";
                    });
                }}
              >
                <div className="ds-editor-title">
                  <strong>
                    {state.sources.some((s) => s.id === draft.id)
                      ? "编辑来源"
                      : "新增来源"}
                  </strong>
                  <button
                    type="button"
                    className="ds-icon-button"
                    aria-label="取消编辑"
                    disabled={busy}
                    onClick={() => {
                      setDraft(null);
                      setError("");
                    }}
                  >
                    ×
                  </button>
                </div>
                <div className="ds-form-grid">
                  <label>
                    来源名称
                    <input
                      autoFocus
                      value={draft.name}
                      disabled={busy}
                      placeholder="例如：家里的电脑"
                      onChange={(e) => change({ name: e.target.value })}
                    />
                  </label>
                  <SettingsSelect
                    label="来源类型"
                    value={draft.kind === "service" ? "service" : "update"}
                    disabled={busy}
                    options={[{ value: "update", label: "软件更新" }, { value: "service", label: "电脑服务" }]}
                    onChange={(value) =>
                      change({ kind: value === "service" ? "service" : draft.url.includes("github.com") ? "github" : "gitee" })
                    }
                  />
                </div>
                {draft.kind !== "service" && <p className="ds-note">支持 GitHub／Gitee 仓库，按链接自动识别平台，同时提供题库和软件更新。</p>}
                <label>
                  数据来源链接
                  <input
                    type="url"
                    value={draft.url}
                    disabled={busy}
                    placeholder={
                      draft.kind === "service"
                        ? "https://bank.example.com:端口"
                        : `https://${draft.kind === "github" ? "github.com" : "gitee.com"}/作者/仓库`
                    }
                    onChange={(e) => change({ url: e.target.value })}
                  />
                </label>
                {draft.kind === "service" && (
                  <label>
                    访问密钥
                    <input
                      type="password"
                      autoComplete="off"
                      value={draft.token}
                      disabled={busy}
                      placeholder="与电脑服务端一致，至少 16 个字符"
                      onChange={(e) => change({ token: e.target.value })}
                    />
                  </label>
                )}
                <div className="ds-actions">
                  <button className="ds-primary" type="submit" disabled={busy}>
                    保存来源
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void act(test)}
                  >
                    测试连接
                  </button>
                </div>
              </form>
            )}
            <p className="ds-note">
              题库先比对 hash，再按时间选择最新版本；软件更新仅在版本和构建一致时使用备用来源。
            </p>
          </div>
        </Collapse>
      </section>
      <section
        className="ds-card bg-white dark:bg-gray-800 rounded-2xl shadow-md overflow-hidden"
        aria-label="内容同步设置"
      >
        <button
          className="ds-heading"
          aria-expanded={syncExpanded}
          aria-controls={`${id}-sync`}
          onClick={() => setSyncExpanded(!syncExpanded)}
        >
          <span className="ds-heading-icon">
            <Cloud />
          </span>
          <span className="ds-heading-copy">
            <span className="ds-title text-gray-700 dark:text-gray-200">
              内容同步{" "}
              <span
                className={`ds-count ${active && syncCount ? "is-active" : ""}`}
              >
                {active ? `${syncCount} 项已选` : "未连接"}
              </span>
            </span>
            <span className="ds-subtitle">
              {active
                ? `${active.name} · 仅手动同步 · ${state.lastSync ? `最近 ${new Date(state.lastSync).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "尚未同步"}`
                : "知识库 · 总结 · AI 聊天；值班表只获取发布内容"}
            </span>
          </span>
          <Chevron open={syncExpanded} />
        </button>
        <Collapse open={syncExpanded}>
          <div className="ds-body" id={`${id}-sync`}>
            <p className="ds-note">仅手动执行。题库和值班表只获取发布目录，不上传到同步空间；知识库、总结、AI 聊天按空间 ID 合并。启动、资料缺失和恢复网络均不会自动同步。</p>
            <div className="ds-sync-list" role="group" aria-label="软件更新设置">
              <label className="ds-sync-row">
                <span><span className="ds-sync-name">软件更新</span><span className="ds-sync-hint">允许从已启用来源检查和下载软件更新，不影响题库获取</span></span>
                <input type="checkbox" role="switch" className="ds-switch" aria-label="软件更新" checked={state.updatesEnabled}
                  onChange={e => state.setUpdatesEnabled(e.target.checked)} />
              </label>
            </div>
            <SettingsSelect
              label="同步服务"
              value={state.syncSourceId ?? ""}
              disabled={busy}
              options={[
                { value: "", label: "不选择", hint: "暂停个人内容同步" },
                ...services.map((entry) => ({
                  value: entry.id,
                  label: entry.name,
                  hint: entry.url,
                })),
              ]}
              onChange={(value) => state.selectSyncSource(value || null)}
            />
            {!services.length && (
              <p className="ds-note">先在数据来源中添加并启用一个电脑服务。</p>
            )}
            {(["public", "personal"] as const).map(group => (
            <div className="ds-sync-list" key={group} role="group" aria-label={group === "public" ? "公共资源（仅获取）" : "个人内容（双向同步）"}>
              <p className="ds-sync-name">{group === "public" ? "公共值班表 · 仅获取，不使用空间 ID" : "个人内容 · 按空间 ID 双向同步"}</p>
              {options.filter(([key]) => (key === "banks" || key === "duty") === (group === "public")).map(([key, name, label, hint]) => (
                <label key={key} className="ds-sync-row">
                  <span>
                    <span className="ds-sync-name">{name}</span>
                    <span className="ds-sync-hint">{hint}</span>
                  </span>
                  <input
                    type="checkbox"
                    role="switch"
                    aria-label={label}
                    className="ds-switch"
                    disabled={busy || !state.url}
                    checked={state.sync[key]}
                    onChange={(e) => state.setSync(key, e.target.checked)}
                  />
                </label>
              ))}
              <div className="ds-actions">
                <button className="ds-primary"
                  disabled={busy || !state.url || (group === "personal" && spaceDirty) || !options.some(([key]) => ((key === "banks" || key === "duty") === (group === "public")) && state.sync[key])}
                  onClick={() => void act(async () => { await syncDataNow(group); return ""; }, false)}>
                  {state.syncing ? "处理中…" : group === "public" ? "获取值班表" : "立即同步个人内容"}
                </button>
              </div>
            </div>
            ))}
            <div className="ds-advanced">
              <button
                type="button"
                className="ds-advanced-toggle"
                aria-expanded={spaceExpanded}
                onClick={() => setSpaceExpanded(!spaceExpanded)}
              >
                个人同步空间与规则 <Chevron open={spaceExpanded} />
              </button>
              <Collapse open={spaceExpanded}>
                <div className="ds-advanced-body">
                  <label>
                    同步空间 ID
                    <input
                      value={space}
                      disabled={busy}
                      onChange={(e) => setSpace(e.target.value)}
                      autoComplete="off"
                    />
                  </label>
                  {spaceDirty && (
                    <button
                      className="ds-small-button"
                      disabled={busy}
                      onClick={() =>
                        void act(async () => {
                          state.setSpace(space);
                          return "同步空间已保存";
                        })
                      }
                    >
                      保存空间
                    </button>
                  )}
                  <p className="ds-note">
                    个人内容在多设备间同步时，请使用相同空间 ID 和访问密钥。题库、值班表只从公共发布目录获取，不上传，也不受空间 ID 影响。知识条目和聊天记录在本机删除后，可能在手动合并时从另一端恢复。
                  </p>
                </div>
              </Collapse>
            </div>
            {spaceDirty && (
              <p className="ds-note">同步个人内容前，请先保存修改后的空间；公共资源获取不受影响。</p>
            )}
          </div>
        </Collapse>
      </section>
      {message && (
        <p role="status" className="ds-feedback">
          {message}
        </p>
      )}
      {(error || state.lastError) && (
        <p role="alert" className="ds-feedback ds-feedback--error">
          {error || state.lastError}
        </p>
      )}
      <ConfirmDialog
        open={deleteOpen}
        title="删除数据来源？"
        confirmText="确认删除"
        message={
          <>
            <span className="break-all">
              删除“{deleting?.name}
              ”后，将停止从该来源获取题库、值班表及安装包更新。
            </span>
            {deleting?.id === state.syncSourceId && (
              <p className="mt-2">
                该来源正用于个人内容同步，删除后同步将停止。
              </p>
            )}
            <p className="mt-2">已导入的本地数据和已下载的安装包会保留。</p>
          </>
        }
        onCancel={() => setDeleteOpen(false)}
        onConfirm={() => {
          if (deleting) {
            state.deleteSource(deleting.id);
            if (draft?.id === deleting.id) setDraft(null);
            setMoreId(null);
            setMessage("数据来源已删除");
          }
          setDeleteOpen(false);
        }}
      />
    </div>
  );
}
