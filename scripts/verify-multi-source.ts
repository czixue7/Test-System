import assert from "node:assert/strict";

// Controlled data only: never contact public repositories or an actual user service.
const saved = new Map<string, string>();
saved.set(
  "data-source-settings",
  JSON.stringify({
    version: 0,
    state: {
      url: "https://old.test/bank",
      token: "old-token-123456789",
      space: "old-device",
      sync: { chat: true },
    },
  }),
);
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => saved.set(key, value),
    removeItem: (key: string) => saved.delete(key),
  },
});
(globalThis as any).window = new EventTarget();
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: { userAgent: "Android arm64", platform: "Linux aarch64" },
});
const { useDataSourceStore: store, sourcesFingerprint } =
  await import("../src/store/dataSourceStore");
const { defaultSources } = await import("../src/utils/sourceConfig");
const { sourceTokenFor, assertSourceAvailable } =
  await import("../src/utils/dataSourceRequest");
const { fetchConfiguredIndex } = await import("../src/utils/sourceCatalog");
const { configuredRelease } = await import("../src/utils/releaseSources");
const { rawUrlCandidates, fetchRemoteText } =
  await import("../src/utils/remoteRepo");
const { hydrateSourceBank } = await import("../src/utils/dataSourceAssets");
const { checkUpdate, downloadApk } = await import("../src/utils/updater");
const { useUpdaterStore } = await import("../src/store/updaterStore");

assert.deepEqual(
  store.getState().sources.map((s) => s.kind),
  ["gitee", "github", "service"],
);
assert.equal(store.getState().url, "https://old.test/bank");
assert.equal(store.getState().sync.chat, true);
store.getState().deleteSource("legacy-service");
assert.equal(store.getState().url, "");
assert.equal(store.getState().syncSourceId, null);
for (const entry of store.getState().sources)
  store.getState().deleteSource(entry.id);
await store.persist.rehydrate();
assert.deepEqual(
  store.getState().sources,
  [],
  "Deleted defaults must stay deleted after reload",
);
let requests: { url: string; auth: string | null }[] = [];
globalThis.fetch = (async (url: string, init?: RequestInit) => {
  requests.push({ url, auth: new Headers(init?.headers).get("Authorization") });
  throw new Error(`Unexpected request: ${url}`);
}) as any;
await assert.rejects(fetchConfiguredIndex("bank"), /没有启用/);
await assert.rejects(configuredRelease(), /没有启用/);
assert.deepEqual(
  rawUrlCandidates(
    "https://raw.githubusercontent.com/czixue7/Test-System/main/bank-index.json",
  ),
  [],
);
assert.equal(requests.length, 0);
console.log(
  "✓ 旧单链接迁移；删除当前同步来源停止同步；空来源重载后保持为空且无隐藏请求",
);

for (const entry of defaultSources()) store.getState().saveSource(entry);
for (const [id, url] of [
  ["first", "https://service.test/one"],
  ["second", "https://service.test/two"],
] as const) {
  store.getState().saveSource({
    id,
    url,
    name: id,
    kind: "service",
    enabled: true,
    token: `${id}-token-123456789`,
  });
}
store.getState().saveSource({
  id: "custom",
  name: "Other repo",
  kind: "github",
  url: "https://github.com/other/banks",
  token: "",
  enabled: true,
});
const item = {
  name: "Shared name",
  filename: "shared.json",
  sha: "a".repeat(64),
  downloadUrl: "files/shared.json",
};
assert.equal(
  store.getState().url,
  "",
  "Adding another service must not resume private sync after deleting the previous source",
);
assert.throws(
  () => assertSourceAvailable("second", "https://old.test/bank/file"),
  /超出服务范围/,
);
let githubHash = "20261020";
globalThis.fetch = (async (url: string, init?: RequestInit) => {
  requests.push({ url, auth: new Headers(init?.headers).get("Authorization") });
  if (url.includes("/contents/")) return Response.json([]);
  if (url.endsWith("bank-index.json"))
    return Response.json({ systemBanks: [], userBanks: [{ ...item, bankId: url.includes('service.test/one') ? 'service-one-bank' : url.includes('service.test/two') ? 'service-two-bank' : url.includes('/other/banks/') ? 'other-bank' : 'default-bank' }] });
  if (url.endsWith("duty-index.json"))
    return Response.json({ systemDuties: [], userDuties: [item] });
  if (url.includes("/images/")) return new Response(new Uint8Array([1, 2, 3]));
  if (url.includes("releases"))
    return Response.json(
      url.includes("gitee")
        ? {
            releases: [
              {
                tag: { name: "v0.5.0" },
                release: {
                  description: "hash:20261020",
                  attach_files: [
                    {
                      name: "universal.apk",
                      cli_download_url: "https://gitee.test/app.apk",
                    },
                  ],
                },
              },
            ],
          }
        : [
            {
              tag_name: "v0.5.0",
              body: `hash:${githubHash}`,
              assets: [
                {
                  name: "universal.apk",
                  browser_download_url: "https://github.test/app.apk",
                },
              ],
            },
          ],
    );
  if (url.endsWith("/app-update.json"))
    return Response.json({ version: "0.4.0", assets: [] });
  throw new Error(`Unexpected request: ${url}`);
}) as any;
requests = [];
const banks = await fetchConfiguredIndex("bank");
assert.equal(
  banks.userBanks.length,
  4,
  "Default mirror pair deduplicates; independent repositories and services remain distinct",
);
assert.equal(new Set(banks.userBanks.map((b) => b.filename)).size, 4);
assert.equal(banks.userBanks[0].sourceId, "default-gitee");
const duties = await fetchConfiguredIndex("duty");
assert.equal(duties.userDuties.length, 4);
assert.equal(
  sourceTokenFor("https://service.test/two/images/1.png"),
  "second-token-123456789",
);
assert.equal(
  sourceTokenFor("https://service.test/two-other/images/1.png"),
  undefined,
);
assert.equal(sourceTokenFor("https://outside.test/file"), undefined);
const secondBank = banks.userBanks.find((b) => b.sourceId === "second")!;
const hydrated = await hydrateSourceBank(
  { questions: [{ images: ["../images/1.png"] }] },
  secondBank.downloadUrl,
);
assert.match(hydrated.questions[0].images[0], /^data:image\/png;base64,/);
assert(
  requests
    .filter((r) => r.url.startsWith("https://service.test/two/"))
    .every((r) => r.auth === "Bearer second-token-123456789"),
);
assert(
  requests
    .filter((r) => !r.url.startsWith("https://service.test/"))
    .every((r) => r.auth === null),
);
console.log(
  "✓ 多来源题库/值班表合并、镜像去重、同名隔离；非同步来源图片使用自己的密钥",
);

for (const id of ["first", "second", "custom"])
  store.getState().deleteSource(id);
const same = await checkUpdate();
assert.equal(same.sourceId, "default-gitee");
assert.equal(same.fallbackDownloadUrl, "https://github.test/app.apk");
githubHash = "abc";
assert.equal(
  (await configuredRelease()).fallback_assets.length,
  0,
  "Malformed build hashes cannot authorize a fallback",
);
githubHash = "20261020";
store.getState().moveSource("default-github", -1);
assert.equal((await checkUpdate()).sourceId, "default-github");
store.getState().setSourceEnabled("default-gitee", false);
requests = [];
const githubOnly = await checkUpdate();
assert.equal(githubOnly.fallbackDownloadUrl, undefined);
assert(requests.every((r) => !r.url.includes("gitee")));
useUpdaterStore.setState({ updateInfo: githubOnly });
store.getState().deleteSource("default-github");
requests = [];
await useUpdaterStore.getState().startDownload();
assert.match(useUpdaterStore.getState().logs.at(-1)!, /重新检查更新/);
assert.equal(requests.length, 0);
assert.equal((await checkUpdate()).error, true);
assert.equal(requests.length, 0);
console.log(
  "✓ 更新按启用条目和顺序取源；停用/删除无回退请求；旧下载信息不能继续发起请求",
);

// Deleting while an index request is pending invalidates its eventual result.
store.getState().saveSource({
  id: "pending",
  name: "Pending",
  kind: "service",
  url: "https://pending.test",
  token: "pending-token-123456",
  enabled: true,
});
let finish!: (response: Response) => void;
globalThis.fetch = (() =>
  new Promise<Response>((resolve) => {
    finish = resolve;
  })) as any;
const pending = fetchConfiguredIndex("bank");
store.getState().deleteSource("pending");
finish(Response.json({ systemBanks: [], userBanks: [item] }));
await assert.rejects(pending, /数据来源已修改/);

// A source removed between failed candidates must not be used for the next request.
store.getState().saveSource(defaultSources()[0]);
requests = [];
globalThis.fetch = (async (url: string) => {
  requests.push({ url, auth: null });
  store.getState().deleteSource("default-gitee");
  throw new Error("Offline");
}) as any;
await assert.rejects(
  fetchRemoteText(["https://one.test", "https://two.test"]),
  /数据来源已修改/,
);
assert.equal(requests.length, 1);
let nativeAttempts = 0;
(globalThis as any).window.__TAURI_INTERNALS__ = {
  transformCallback: () => 1,
  invoke: async () => {
    nativeAttempts++;
    store.getState().saveSource(defaultSources()[0]);
    throw new Error("Offline");
  },
};
await assert.rejects(
  downloadApk("https://one.test/app.apk", "test.apk", undefined, [
    "https://two.test/app.apk",
  ]),
  /数据来源已修改/,
);
assert.equal(nativeAttempts, 1);
delete (globalThis as any).window.__TAURI_INTERNALS__;
assert(sourcesFingerprint());
console.log("✓ 请求中修改来源丢弃旧索引，停止后续文本和安装包备用请求");
