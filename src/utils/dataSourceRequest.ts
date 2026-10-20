import { invoke } from "@tauri-apps/api/core";
import { useDataSourceStore } from "../store/dataSourceStore";
import { isTauri } from "./env";
import { normalizeSourceUrl } from "./sourceConfig";
export { normalizeSourceUrl } from "./sourceConfig";

export function sourceUrl(
  path: string,
  base = useDataSourceStore.getState().url,
): string {
  const normalized = normalizeSourceUrl(base);
  if (!normalized) throw new Error("尚未配置电脑数据源");
  // A leading slash is relative to the configured deployment prefix, not the domain root.
  return new URL(path.replace(/^\/+/, ""), `${normalized}/`).href;
}
export function serviceSourceFor(url: string) {
  const target = new URL(url);
  const matches = useDataSourceStore
    .getState()
    .sources.filter((s) => s.enabled && s.kind === "service" && s.token)
    .sort((a, b) => b.url.length - a.url.length);
  return matches.find((entry) => {
    const base = new URL(`${normalizeSourceUrl(entry.url)}/`);
    return (
      target.origin === base.origin && target.pathname.startsWith(base.pathname)
    );
  });
}
export function sourceTokenFor(url: string): string | undefined {
  return serviceSourceFor(url)?.token;
}
export function assertSourceAvailable(
  id: string | undefined,
  url: string,
): void {
  if (!id) return;
  const entry = useDataSourceStore
    .getState()
    .sources.find((s) => s.id === id && s.enabled);
  if (!entry) throw new Error("数据来源已删除或停用，请刷新列表");
  if (entry.kind === "service") resolveSourceResource(url, entry.url);
}
export function resolveSourceResource(
  path: string,
  base = useDataSourceStore.getState().url,
): string {
  const target = sourceUrl(path, base);
  const root = new URL(`${normalizeSourceUrl(base)}/`);
  const parsed = new URL(target);
  if (
    parsed.origin !== root.origin ||
    !parsed.pathname.startsWith(root.pathname)
  )
    throw new Error("数据源返回了超出服务范围的资源地址");
  return target;
}

function transientRequestError(error: unknown): boolean {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return /TimeoutError|AbortError|timed?\s*out|timeout|Failed to fetch|fetch failed|NetworkError|network request failed|error sending request|connection (?:refused|reset|closed)/i.test(message);
}

export function sourceRequestError(error: unknown, method = "GET"): string {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  if (/TimeoutError|AbortError|timed?\s*out|timeout/i.test(message))
    return method === "PUT"
      ? "发送超时，同步结果尚未确认；请手动重试以重新核对"
      : "连接超时，请检查电脑服务是否启动、网络是否正常，然后重试";
  if (transientRequestError(error))
    return method === "PUT"
      ? "连接中断，同步结果尚未确认；请检查网络后重新同步"
      : "无法连接电脑服务，请检查服务地址、网络和浏览器跨域设置";
  return error instanceof Error ? error.message : String(error);
}

export async function sourceRequest<T>(
  path: string,
  options: {
    method?: "GET" | "PUT";
    data?: unknown;
    base?: string;
    token?: string;
    raw?: boolean;
  } = {},
): Promise<{ status: number; data: T }> {
  const state = useDataSourceStore.getState();
  const url = sourceUrl(path, options.base ?? state.url);
  const token = options.token ?? state.token;
  const method = options.method ?? "GET";
  const body =
    options.data === undefined ? undefined : JSON.stringify(options.data);
  let status: number;
  let text: string;
  // Retry reads once on transient transport failure. A timed-out write has an
  // unknown outcome and must be reconciled by the next manual sync.
  for (let attempt = 0; ; attempt++) {
    try {
      if (isTauri()) {
        const result = await invoke<{ status: number; body: string }>(
          "data_source_request",
          { url, token, method, body },
        );
        status = result.status;
        text = result.body;
      } else {
        const res = await fetch(url, {
          method,
          headers: {
            Authorization: `Bearer ${token}`,
            ...(body ? { "Content-Type": "application/json" } : {}),
          },
          body,
          cache: "no-store",
          redirect: "error",
          signal: AbortSignal.timeout(30000),
        });
        status = res.status;
        text = await res.text();
      }
      if (method === "GET" && attempt === 0 && [502, 503, 504].includes(status)) continue;
      break;
    } catch (error) {
      if (method === "GET" && attempt === 0 && transientRequestError(error)) continue;
      throw new Error(sourceRequestError(error, method));
    }
  }
  let data: any;
  if (options.raw && status >= 200 && status < 300)
    return { status, data: text as T };
  try {
    data = JSON.parse(text);
  } catch {
    if ((status >= 200 && status < 300) || status === 409)
      throw new Error("数据源返回了无效 JSON，请检查服务地址是否正确");
    data = null;
  }
  if (status !== 409 && (status < 200 || status >= 300)) {
    const messages: Record<number, string> = {
      401: "访问密钥无效，请检查电脑服务的访问密钥",
      403: "没有访问权限，请检查电脑服务的访问密钥",
      404: "电脑服务接口不存在，请检查服务地址和服务台版本",
      413: "同步内容过大，请减少单次同步的数据量",
      502: "电脑服务暂时不可用，请检查服务和转发连接后重试",
      503: "电脑服务暂时不可用，请稍后重试",
      504: "电脑服务响应超时，请检查服务和转发连接后重试",
    };
    throw new Error(messages[status] || data?.error || `电脑服务请求失败（HTTP ${status}）`);
  }
  return { status, data: data as T };
}
