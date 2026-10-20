import assert from "node:assert/strict";

const saved = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
  getItem: (key: string) => saved.get(key) ?? null,
  setItem: (key: string, value: string) => saved.set(key, value),
  removeItem: (key: string) => saved.delete(key),
} });
(globalThis as any).window = new EventTarget();
const { useDataSourceStore: source } = await import("../src/store/dataSourceStore");
const { useQuestionBankStore: banks } = await import("../src/store/questionBankStore");
const { useDutyScheduleStore: duties } = await import("../src/store/dutyScheduleStore");
const { useToastStore: toast } = await import("../src/components/Toast");
const { syncDataNow } = await import("../src/utils/dataSync");
const { fetchPublicResources } = await import("../src/utils/publicResources");
const fetchBanks = () => fetchPublicResources('banks', source.getState(), () => true);
const { contentHash } = await import("../src/utils/questionBankSync");
const { sourceRequest } = await import("../src/utils/dataSourceRequest");
const { mergeSyncedSummaryVersions, deleteSummaryVersion, getSummaryHistoryState } = await import("../src/utils/knowledgeSummary");
const date = "2026-10-20T00:00:00Z";
source.getState().configure("https://controlled.test/prefix", "test-only-token-1234", "personal-one");
banks.setState({ banks: [], isLoaded: true });
duties.setState({ duties: [], isLoaded: true });
const payloads = {
  banks: JSON.stringify({ name: "公共题库", questions: [{ type: "subjective", content: "题目", correctAnswer: "答案" }] }),
  duty: JSON.stringify({ name: "公共值班表", shifts: [{ date: "2026-10-20", shiftType: "早班", tasks: ["巡视"] }] }),
};
const hashes = { banks: await contentHash(payloads.banks), duty: await contentHash(payloads.duty) };
let requests: { path: string; method: string; body?: string }[] = [];
let summaryRemote: any = { revision: 0, data: null };
let mode = "normal";
let release: (() => void) | undefined;
globalThis.fetch = (async (input: any, init: any = {}) => {
  const path = new URL(String(input)).pathname.replace("/prefix/", "");
  const method = init.method ?? "GET";
  requests.push({ path, method, body: init.body });
  if (mode === "timeout") throw new DOMException("signal timed out", "TimeoutError");
  if (mode === "flaky" && requests.length === 1) throw new TypeError("Failed to fetch");
  if (mode === "gateway") return new Response("Bad Gateway", { status: 502 });
  if (mode === "hold") { await new Promise<void>(resolve => { release = resolve; }); }
  if (path.endsWith("-index.json")) {
    const bank = path === "bank-index.json", kind = bank ? "banks" : "duty";
    return Response.json(bank ? { systemBanks: [], userBanks: [{ name: "题库", filename: "bank.json", downloadUrl: "/files/banks.json", sha: hashes.banks }] }
      : { systemDuties: [], userDuties: [{ name: "值班表", filename: "duty.json", downloadUrl: "/files/duty.json", sha: hashes[kind] }] });
  }
  if (path.startsWith("files/")) return new Response(path === "files/banks.json" ? payloads.banks : payloads.duty);
  if (path.endsWith("/summaries")) {
    if (method === "PUT") summaryRemote = { revision: summaryRemote.revision + 1, data: JSON.parse(init.body).data };
    return Response.json(summaryRemote);
  }
  return Response.json({ ok: true });
}) as typeof fetch;

source.getState().setSync("banks", true);
source.getState().setSync("duty", true);
window.dispatchEvent(new Event("online"));
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(requests.length, 0, "settings and network restoration must not sync");
await syncDataNow("public");
assert.equal(banks.getState().banks.length, 0, 'Settings must ignore the legacy bank flag');
await fetchBanks();
assert.equal(banks.getState().banks.length, 1);
assert.equal(duties.getState().duties.length, 1);
assert(requests.every(r => r.method === "GET" && !r.body && !r.path.includes("sync/") && !r.path.includes("personal-one")));
assert.equal(toast.getState().toasts.at(-1)?.type, "success");
const ids = [banks.getState().banks[0].id, duties.getState().duties[0].id];
requests = [];
source.getState().setSpace("personal-two");
await syncDataNow("public");
await fetchBanks();
assert.deepEqual([banks.getState().banks[0].id, duties.getState().duties[0].id], ids);
assert.equal(requests.length, 2, "unchanged public resources only read catalogs, regardless of personal space");
console.log("✓ 公共题库/值班表仅 GET，无上传/空间 ID；切空间与重复获取均不重复导入");

banks.getState().updateBank(ids[0], { name: "本机编辑" });
payloads.banks = JSON.stringify({ name: "公共新版", questions: [{ type: "subjective", content: "新题目", correctAnswer: "新答案" }] });
hashes.banks = await contentHash(payloads.banks);
await fetchBanks();
assert.equal(banks.getState().banks.length, 2);
assert(banks.getState().banks.some(b => b.name === "本机编辑（本机副本）"));
assert(banks.getState().banks.some(b => b.name === "公共新版"));
console.log("✓ 公共资源更新保留本机编辑副本");

requests = []; mode = "flaky";
await sourceRequest("api/v1/health");
assert.equal(requests.length, 2);
requests = []; mode = "timeout";
await assert.rejects(sourceRequest("api/v1/health"), /连接超时.*电脑服务/);
assert.equal(requests.length, 2);
requests = [];
await assert.rejects(sourceRequest("api/v1/sync/test/chat", { method: "PUT", data: {} }), /结果尚未确认/);
assert.equal(requests.length, 1, "uncertain writes must not be automatically repeated");
requests = []; mode = "gateway";
await assert.rejects(sourceRequest("api/v1/health"), /电脑服务暂时不可用/);
assert.equal(requests.length, 2);
mode = "timeout"; toast.getState().clearToasts();
await assert.rejects(syncDataNow("public"), /值班表.*连接超时/);
assert.equal(toast.getState().toasts.length, 1);
assert.equal(toast.getState().toasts[0].type, "error");
assert.equal(source.getState().syncing, false);
assert(!source.getState().lastError.includes("duty"));
console.log("✓ 读取短暂失败重试一次；写入超时不重复；中文错误及全局错误通知");

mode = "hold"; toast.getState().clearToasts();
source.getState().setSync("duty", true);
const first = syncDataNow("public"), second = syncDataNow("public");
assert.equal(first, second);
assert.equal(source.getState().syncing, true);
await new Promise(resolve => setTimeout(resolve, 0));
mode = "normal"; release!(); await first;
assert.equal(toast.getState().toasts.length, 1);
assert.equal(source.getState().syncing, false);
console.log("✓ 连点共用同一任务，跨页面保留忙碌状态且只通知一次");

const version = { id: "delete-me", version: "v1", content: "测试总结", createdAt: 100 };
await mergeSyncedSummaryVersions("combined", [version]);
await deleteSummaryVersion("combined", version.id);
assert.equal((await getSummaryHistoryState("combined")).history.length, 0);
await mergeSyncedSummaryVersions("combined", [version]);
assert.equal((await getSummaryHistoryState("combined")).history.length, 0, "stale remote copies must not resurrect deletions");
source.getState().setSync("summaries", true);
summaryRemote = { revision: 1, data: { knowledge: [], questionBank: [], combined: [version] } };
requests = [];
await syncDataNow("personal");
assert.deepEqual(summaryRemote.data.combined, []);
assert.deepEqual(summaryRemote.data.deleted.combined, [version.id]);
assert(requests.every(r => !r.path.includes("bank-index") && !r.path.includes("duty-index")));
await mergeSyncedSummaryVersions("combined", [{ ...version, id: "new-version" }]);
await mergeSyncedSummaryVersions("combined", [], ["new-version"]);
assert.equal((await getSummaryHistoryState("combined")).history.length, 0);
console.log("✓ 删除最后总结版本持久化；旧远端不复活；删除标记双向同步；个人同步不触碰公共资源");
