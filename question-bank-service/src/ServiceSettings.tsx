import React, { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Config } from "./types";

type TestResult = {
  success: boolean;
  reachable: boolean;
  baseUrl: string;
  checkedUrl: string;
  latencyMs: number;
  message: string;
  suggestedUrl?: string;
};
export default function ServiceSettings({
  config,
  running,
  busy,
  onChange,
  onEndpointSaved,
}: {
  config: Config;
  running: boolean;
  busy: boolean;
  onChange: (patch: Partial<Config>) => void;
  onEndpointSaved: (url: string) => void;
}) {
  const [url, setUrl] = useState(config.publicUrl ?? "");
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);
  const [error, setError] = useState("");
  const [reveal, setReveal] = useState(false);
  const locked = running || busy || testing;
  const edit = () => {
    setResult(null);
    setError("");
  };
  const test = async () => {
    setTesting(true);
    edit();
    try {
      const base = await invoke<string>("save_public_endpoint", {
        url,
        port: null,
      });
      setUrl(base);
      onEndpointSaved(base);
      setResult(
        await invoke<TestResult>("test_endpoint", {
          url: base,
          port: null,
          token: config.accessToken,
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setTesting(false);
    }
  };
  const localHost =
    config.host === "0.0.0.0"
      ? "127.0.0.1"
      : config.host === "::"
        ? "[::1]"
        : config.host.includes(":")
          ? `[${config.host}]`
          : config.host;
  return (
    <section className="panel access-panel">
      <div className="panel-head">
        <div>
          <h2>访问测试</h2>
          <p>粘贴第三方 frp 提供的完整地址，自动识别其中的端口。</p>
        </div>
      </div>
      <div className="endpoint-form">
        <label className="field">
          <span>访问链接</span>
          <input
            value={url}
            placeholder="frp-sea.com:65079 或 https://服务器地址:端口"
            disabled={busy || testing}
            onChange={(e) => {
              setUrl(e.target.value);
              edit();
            }}
          />
        </label>
        <button
          className="primary"
          disabled={busy || testing || !url.trim()}
          onClick={() => void test()}
        >
          {testing ? "测试中…" : "测试连接"}
        </button>
      </div>
      <p className="hint">
        不带协议时默认使用 HTTP；需要 HTTPS 的节点请填写 https://。测试使用本地配置的访问密钥。
      </p>
      {error && (
        <div role="alert" className="notice error">
          {error}
        </div>
      )}
      {result && (
        <div
          role="status"
          className={`notice endpoint-result ${result.success ? "" : "error"}`}
        >
          <strong>{result.success ? "测试成功" : "测试失败"}</strong>
          <p>{result.message}</p>
          {result.suggestedUrl && (
            <button
              disabled={busy || testing}
              onClick={() => {
                setUrl(result.suggestedUrl!);
                edit();
              }}
            >
              填入 HTTPS 地址
            </button>
          )}
          <code>{result.checkedUrl}</code>
          <small>
            耗时 {result.latencyMs} ms ·{" "}
            {result.reachable ? "已收到服务器响应" : "未收到服务器响应"} ·
            仅代表本次测试结果
          </small>
        </div>
      )}
      <details className="local-settings">
        <summary>
          本地服务设置{" "}
          <code>
            http://{localHost}:{config.port}
          </code>
        </summary>
        <fieldset disabled={locked}>
          <div className="form-grid">
            <label className="field">
              <span>监听 IP</span>
              <input
                value={config.host}
                onChange={(e) => onChange({ host: e.target.value })}
              />
              <small>本机 frp 通常转发到 127.0.0.1。</small>
            </label>
            <label className="field">
              <span>本地服务端口</span>
              <input
                type="number"
                min="1"
                max="65535"
                value={config.port}
                onChange={(e) => onChange({ port: Number(e.target.value) })}
              />
              <small>第三方 frp 的本地目标端口。</small>
            </label>
            <label className="field">
              <span>访问密钥</span>
              <input
                type={reveal ? "text" : "password"}
                autoComplete="off"
                value={config.accessToken}
                onChange={(e) => {
                  onChange({ accessToken: e.target.value });
                  edit();
                }}
              />
              <small>答题软件填写相同密钥。</small>
            </label>
            <div className="field">
              <span>密钥显示</span>
              <button onClick={() => setReveal(!reveal)}>
                {reveal ? "隐藏密钥" : "显示密钥"}
              </button>
            </div>
          </div>
        </fieldset>
        <p className="hint">
          修改本地设置前请先关闭服务，修改后点击顶部“保存配置”。访问测试在服务运行时也可使用。
        </p>
      </details>
    </section>
  );
}
