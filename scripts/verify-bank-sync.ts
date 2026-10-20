import assert from "node:assert/strict";
const storage = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", { value: {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
  removeItem: (key: string) => storage.delete(key),
}, configurable: true });
(globalThis as any).window = new EventTarget();
const { useQuestionBankStore: store } = await import("../src/store/questionBankStore");
const { useDataSourceStore: sources } = await import("../src/store/dataSourceStore");
const { syncQuestionBanks, contentHash } = await import("../src/utils/questionBankSync");
const { canonicalJson } = await import("../src/utils/dataSyncMerge");
const config = { url: "https://sync.test/prefix", token: "only-test-token-1234", space: "shared" };
sources.getState().configure(config.url, config.token, config.space);
const bank = (id: string, name = id) => ({ id, name, questions: [{ id: "q", type: "subjective" as const, question: "题目", correctAnswer: "答案", score: 1, category: "a", difficulty: "easy" as const }], createdAt: "2026-10-20T00:00:00Z", updatedAt: "2026-10-20T00:00:00Z" });
store.setState({ isLoaded: true, banks: [bank("one")] });
const remote = new Map<string, { hash: string; content: string }>();
const calls: { path: string; body: any }[] = [];
let onDownload: (() => void) | undefined;
let corrupt = false;
let conflict = false;
let published: any[] = [];
let publishedRaw = JSON.stringify({ name: "发布库", questions: bank("q").questions });
let publishedSha = await contentHash(publishedRaw);
globalThis.fetch = async (input, init) => {
  const path = new URL(String(input)).pathname;
  const body = init?.body ? JSON.parse(String(init.body)) : undefined;
  calls.push({ path, body });
  assert.equal((init?.headers as any)?.Authorization, `Bearer ${config.token}`);
  if (path === "/prefix/files/bank/demo.json") return new Response(publishedRaw);
  let result: any;
  if (path.endsWith("/manifest")) {
    assert.equal(new Set(body.published.map((b: any) => b.filename)).size, body.published.length);
    assert.ok(body.banks.every((b: any) => Object.keys(b).sort().join(",") === "baseHash,hash,id"));
    const upload: any[] = [], download: any[] = [];
    for (const b of body.banks) {
      const saved = remote.get(b.id);
      if (!saved || (saved.hash !== b.hash && saved.hash === b.baseHash)) upload.push({ id: b.id, baseHash: saved?.hash ?? null });
      else if (saved.hash !== b.hash) download.push({ id: b.id, hash: saved.hash, conflict: b.hash !== b.baseHash });
    }
    for (const [id, b] of remote) if (!body.banks.some((b: any) => b.id === id)) download.push({ id, hash: b.hash, conflict: false });
    result = { upload, download, published: published.filter(p => !body.published.some((b: any) => b.sha === p.sha)) };
  } else {
    const id = path.split("/").at(-1)!;
    if (body) {
      if (conflict) return new Response(JSON.stringify({ error: "conflict" }), { status: 409 });
      assert.equal(await contentHash(body.content), body.hash);
      remote.set(id, { hash: body.hash, content: body.content });
      result = { hash: body.hash };
    } else {
      result = { ...remote.get(id) };
      onDownload?.();
      if (corrupt) result.content += " ";
    }
  }
  return new Response(JSON.stringify(result));
};
const sync = () => syncQuestionBanks(config, () => true);
const saveRemote = async (id: string, name: string) => {
  const content = canonicalJson(bank(id, name)); remote.set(id, { content, hash: await contentHash(content) });
};
await sync();
assert.equal(remote.size, 1);
calls.length = 0; await sync();
assert.equal(calls.length, 1, "unchanged banks send only a hash manifest");
assert.equal(calls[0].body.banks[0].hash.length, 64);
store.getState().updateBank("one", { name: "本机编辑" });
await sync(); assert.equal(JSON.parse(remote.get("one")!.content).name, "本机编辑");
console.log("✓ 首次上传前先发送 hash 清单；相同题库不传正文；编辑后仅上传变化题库");
await saveRemote("one", "远端编辑"); await sync();
assert.equal(store.getState().banks.find(b => b.id === "one")?.name, "远端编辑");
await saveRemote("one", "同时远端编辑"); store.getState().updateBank("one", { name: "同时本机编辑" });
await sync();
assert.ok(store.getState().banks.some(b => b.name === "同时本机编辑（冲突副本）"));
assert.equal(store.getState().banks.find(b => b.id === "one")?.name, "同时远端编辑");
await sync(); assert.equal(remote.size, 2, "conflict copy is uploaded on next sync");
console.log("✓ 远端变化下载、双端冲突保留本机副本并在下一轮备份");
await saveRemote("one", "损坏测试"); corrupt = true;
await assert.rejects(sync, /hash 校验失败/); corrupt = false;
assert.equal(store.getState().banks.find(b => b.id === "one")?.name, "同时远端编辑");
onDownload = () => store.getState().updateBank("one", { name: "下载期间编辑" });
await assert.rejects(sync, /同步期间/); onDownload = undefined;
assert.equal(store.getState().banks.find(b => b.id === "one")?.name, "下载期间编辑");
await sync();
store.getState().updateBank("one", { name: "版本冲突" }); conflict = true;
await assert.rejects(sync, /其他设备/); conflict = false;
console.log("✓ hash 损坏不落盘、请求期间编辑不覆盖、并发写入 409 不覆盖");
await sync();
await saveRemote("new", "新设备题库");
let enabled = true; onDownload = () => { enabled = false; };
await syncQuestionBanks(config, () => enabled); onDownload = undefined;
assert.ok(!store.getState().banks.some(b => b.id === "new"));
await sync(); assert.ok(store.getState().banks.some(b => b.id === "new"));
published = [{ filename: "bank/demo.json", name: "发布库", sha: publishedSha, downloadUrl: "/files/bank/demo.json" }];
await sync();
assert.ok(store.getState().banks.some(b => b.name === "发布库" && b.sourceSha === publishedSha));
calls.length = 0; await sync(); await sync();
assert.ok(!calls.some(c => c.path === "/prefix/files/bank/demo.json"), "unchanged published bank is not downloaded again");
const publishedLocal = store.getState().banks.find(b => b.sourceSha === publishedSha)!;
store.getState().updateBank(publishedLocal.id, { name: "发布库本机编辑" });
publishedRaw = JSON.stringify({ name: "发布库新版", questions: bank("q").questions });
publishedSha = await contentHash(publishedRaw);
published[0] = { ...published[0], sha: publishedSha };
await sync();
assert.ok(store.getState().banks.some(b => b.name === "发布库本机编辑（本机副本）"), "published updates must preserve local edits even when uploaded in this round");
assert.equal(store.getState().banks.find(b => b.id === publishedLocal.id)?.name, "发布库新版");
await sync(); // establish the updated published bank's baseline
const changedPublished = { ...store.getState().banks.find(b => b.id === publishedLocal.id)!, name: "远端发布库编辑" };
const changedContent = canonicalJson(changedPublished);
remote.set(changedPublished.id, { content: changedContent, hash: await contentHash(changedContent) });
store.getState().updateBank(changedPublished.id, { name: "本机发布库编辑" });
await sync(); await sync();
const conflictCopy = store.getState().banks.find(b => b.name === "本机发布库编辑（冲突副本）");
assert.ok(conflictCopy); assert.equal(conflictCopy.sourceFilename, undefined);
assert.ok(storage.has(`exam-store:question-banks`));
console.log("✓ 关闭开关丢弃旧结果、发布题库按 hash 下载、持久化后无变化不重复下载");
