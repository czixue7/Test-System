export type DataSourceKind = "gitee" | "github" | "service";
export interface DataSourceEntry {
  id: string;
  name: string;
  kind: DataSourceKind;
  url: string;
  token: string;
  enabled: boolean;
}
export const defaultSources = (): DataSourceEntry[] => [
  {
    id: "default-gitee",
    name: "Gitee",
    kind: "gitee",
    url: "https://gitee.com/zixue7/Test-System",
    token: "",
    enabled: true,
  },
  {
    id: "default-github",
    name: "GitHub",
    kind: "github",
    url: "https://github.com/czixue7/Test-System",
    token: "",
    enabled: true,
  },
];
export function normalizeSourceUrl(value: string): string {
  if (!value.trim()) return "";
  const url = new URL(value.trim());
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error("请填写 HTTP/HTTPS 地址，不包含账号、查询参数或片段");
  return url.href.replace(/\/+$/, "");
}
export function repositoryInfo(source: DataSourceEntry) {
  const url = new URL(source.url);
  const parts = url.pathname.split("/").filter(Boolean);
  if (
    source.kind === "service" ||
    url.hostname !== (source.kind === "github" ? "github.com" : "gitee.com") ||
    parts.length !== 2
  )
    throw new Error(
      "仓库来源请填写对应平台的仓库首页链接，例如 https://github.com/作者/仓库",
    );
  return { owner: parts[0], repo: parts[1].replace(/\.git$/, "") };
}
export function validateSource(source: DataSourceEntry): DataSourceEntry {
  if (!source.name.trim()) throw new Error("请填写来源名称");
  const url = normalizeSourceUrl(source.url);
  if (!url) throw new Error("请填写来源链接");
  const result = { ...source, name: source.name.trim(), url };
  if (result.kind !== "service") {
    // The UI exposes one software-update type; the URL identifies its transport.
    const host = new URL(url).hostname;
    if (host !== "gitee.com" && host !== "github.com")
      throw new Error("软件更新来源请填写 GitHub 或 Gitee 仓库首页链接");
    result.kind = host === "github.com" ? "github" : "gitee";
    const info = repositoryInfo(result);
    result.url = `https://${result.kind === "github" ? "github.com" : "gitee.com"}/${info.owner}/${info.repo}`;
    result.token = "";
  } else if (result.token.length < 16)
    throw new Error("电脑服务访问密钥至少 16 个字符");
  return result;
}
export function sourceIdentity(source: DataSourceEntry): string {
  if (source.kind === "service") return `service:${source.url}`;
  if (
    defaultSources().some(
      (s) =>
        s.kind === source.kind &&
        s.url.toLowerCase() === source.url.toLowerCase(),
    )
  )
    return "test-system";
  return `${source.kind}:${source.url.toLowerCase()}`;
}
