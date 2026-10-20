import assert from "node:assert/strict";
const storage = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  value: {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => storage.set(k, v),
    removeItem: (k: string) => storage.delete(k),
  },
  configurable: true,
});
const windowTarget = new EventTarget();
(globalThis as any).window = windowTarget;
const { useDataSourceStore: source } =
  await import("../src/store/dataSourceStore");
const { normalizeSourceUrl, sourceTokenFor, resolveSourceResource } =
  await import("../src/utils/dataSourceRequest");
const { mergeById, mergeConversations } =
  await import("../src/utils/dataSyncMerge");
const { useKnowledgeStore: knowledge } =
  await import("../src/store/knowledgeStore");
const { useChatStore: chat } = await import("../src/store/chatStore");
const { useDutyScheduleStore: duty } =
  await import("../src/store/dutyScheduleStore");
const { useSettingsStore: settings } =
  await import("../src/store/settingsStore");
const { syncDataNow } = await import("../src/utils/dataSync");
const { fetchBankIndex, checkBankStatus } =
  await import("../src/utils/bankIndex");
const { fetchDutyIndex } = await import("../src/utils/dutyScheduleIndex");
const { hydrateSourceBank } = await import("../src/utils/dataSourceAssets");
const { contentHash } = await import("../src/utils/questionBankSync");
const { listSummaryVersions, mergeSyncedSummaryVersions } =
  await import("../src/utils/knowledgeSummary");
source
  .getState()
  .configure(
    "https://service.test/prefix",
    "test-token-12345678",
    "device-one",
  );
assert.equal(
  normalizeSourceUrl(" https://service.test/prefix/ "),
  "https://service.test/prefix",
);
for (const entry of source.getState().sources) if (entry.kind !== 'service') source.getState().setSourceEnabled(entry.id, false);
for (const url of [
  "ftp://host",
  "https://user:password@host",
  "https://host?token=secret",
])
  assert.throws(() => normalizeSourceUrl(url));
assert.equal(
  sourceTokenFor("https://service.test/prefix/files/one"),
  "test-token-12345678",
);
assert.equal(sourceTokenFor("https://else.test/prefix/files"), undefined);
assert.equal(
  sourceTokenFor("https://service.test/prefix-other/file"),
  undefined,
);
assert.throws(() => resolveSourceResource("https://else.test/file"));
assert.equal(
  mergeById(
    [{ id: "same", time: 2 }],
    [
      { id: "same", time: 1 },
      { id: "remote", time: 1 },
    ],
    (v) => v.time,
  ).length,
  2,
);
console.log("✓ URL 验证、部署前缀和鉴权范围");
const date = "2026-10-20T00:00:00Z";
const item = (id: string, content = id) => ({
  id,
  title: id,
  content,
  category: "测试",
  createdAt: date,
  updatedAt: date,
});
const conversation = (id: string) => ({
  id,
  title: id,
  createdAt: date,
  updatedAt: date,
  messages: [
    {
      id: `${id}-message`,
      role: "user" as const,
      content: id,
      source: "ai" as const,
      createdAt: date,
    },
  ],
});
knowledge.setState({ items: [item("local")], categories: ["本地"] });
chat.setState({
  conversations: [conversation("local-chat")],
  activeConversationId: "local-chat",
});
duty.setState({
  isLoaded: true,
  duties: [
    {
      id: "local-duty",
      name: "本地值班",
      shifts: [],
      createdAt: date,
      updatedAt: date,
    },
  ],
});
settings.setState({ apiKey: "DO-NOT-SYNC-API-SECRET" });
const remote = new Map<string, { revision: number; data: any }>();
remote.set("knowledge", {
  revision: 1,
  data: { items: [item("remote")], categories: ["远程"] },
});
remote.set("chat", {
  revision: 1,
  data: { conversations: [conversation("remote-chat")] },
});
remote.set("duty", {
  revision: 1,
  data: {
    duties: [
      {
        id: "remote-duty",
        name: "远程值班",
        shifts: [],
        createdAt: date,
        updatedAt: date,
      },
    ],
  },
});
remote.set("summaries", {
  revision: 1,
  data: {
    knowledge: [],
    questionBank: [],
    combined: [
      {
        id: "summary-remote",
        version: "v1",
        content: "远程总结",
        createdAt: 100,
      },
    ],
  },
});
const requests: { url: string; method: string; body: string }[] = [];
let conflict = true;
let delayChat = false;
let releaseChat: (() => void) | undefined;
let chatStarted: (() => void) | undefined;
const publicDutyRaw = JSON.stringify({ name: "公共值班", shifts: [] });
const publicDutySha = await contentHash(publicDutyRaw);
globalThis.fetch = (async (input: any, init: any = {}) => {
  const url = String(input);
  const method = init.method ?? "GET";
  requests.push({ url, method, body: init.body ?? "" });
  assert.equal(init.headers?.Authorization, "Bearer test-token-12345678");
  const path = new URL(url).pathname.replace("/prefix/", "");
  if (path === "bank-index.json")
    return Response.json({
      systemBanks: [],
      userBanks: [
        {
          name: "同名题库",
          filename: "mount/bank.json",
          sha: "a".repeat(64),
          downloadUrl: "/files/mount/bank.json",
          imagePath: "/api/v1/images/mount/image",
        },
      ],
    });
  if (path === "duty-index.json")
    return Response.json({
      systemDuties: [],
      userDuties: [
        {
          name: "值班",
          filename: "mount/duty.json",
          sha: publicDutySha,
          downloadUrl: "/files/mount/duty.json",
        },
      ],
    });
  if (path === "api/v1/knowledge")
    return Response.json({ items: [item("published")] });
  if (path === "files/mount/duty.json") return new Response(publicDutyRaw);
  if (path === "api/v1/images/mount/image")
    return Response.json([
      {
        name: "1-1.png",
        type: "file",
        download_url: "/files/mount/image/1-1.png",
      },
    ]);
  if (path === "files/mount/image/1-1.png")
    return new Response(new Uint8Array([137, 80, 78, 71]));
  const kind = path.split("/").at(-1)!;
  if (delayChat && kind === "chat" && method === "GET") {
    chatStarted?.();
    await new Promise<void>((r) => {
      releaseChat = r;
    });
  }
  const current = remote.get(kind) ?? { revision: 0, data: null };
  if (method === "GET") return Response.json(current);
  const body = JSON.parse(init.body);
  if (kind === "knowledge" && conflict) {
    conflict = false;
    const next = {
      revision: current.revision + 1,
      data: {
        ...current.data,
        items: [...current.data.items, item("concurrent")],
      },
    };
    remote.set(kind, next);
    return Response.json(next, { status: 409 });
  }
  if (body.baseRevision !== current.revision)
    return Response.json(current, { status: 409 });
  const next = { revision: current.revision + 1, data: body.data };
  remote.set(kind, next);
  return Response.json(next);
}) as typeof fetch;
await syncDataNow();
assert.equal(requests.length, 0);
source.getState().setSync("knowledge", true);
await syncDataNow();
assert(knowledge.getState().items.some((v) => v.id === "concurrent"));
assert(!requests.some((v) => /\/(chat|duty|summaries)$/.test(v.url)));
assert.equal(
  new Set(knowledge.getState().items.map((v) => v.id)).size,
  knowledge.getState().items.length,
);
console.log("✓ 同步开关隔离、并发版本冲突重试和稳定 ID 合并");
for (const kind of ["summaries", "chat", "duty"] as const)
  source.getState().setSync(kind, true);
await syncDataNow();
assert.equal(chat.getState().conversations.length, 2);
assert.equal(chat.getState().activeConversationId, "local-chat");
assert.equal(duty.getState().duties.length, 2);
assert.equal((await listSummaryVersions("combined"))[0].content, "远程总结");
assert(!requests.some((v) => v.body.includes("DO-NOT-SYNC-API-SECRET")));
await syncDataNow();
assert.equal(chat.getState().conversations.length, 2);
assert.equal(duty.getState().duties.length, 2);
assert(!requests.some(v => /\/sync\/[^/]+\/duty/.test(v.url)));
console.log("✓ 个人内容往返、公共值班表只获取、重复同步幂等、总结落盘和 AI 密钥隔离");
const index = await fetchBankIndex();
assert(index);
assert.equal(
  index.userBanks[0].downloadUrl,
  "https://service.test/prefix/files/mount/bank.json",
);
assert(index.userBanks[0].filename.startsWith("service:"));
assert(
  !checkBankStatus(
    "同名题库",
    "a".repeat(64),
    [],
    index.userBanks[0].filename,
    "user",
    [
      {
        id: "unrelated",
        name: "同名题库",
        questions: [],
        createdAt: date,
        updatedAt: date,
      },
    ],
  ).exists,
);
assert((await fetchDutyIndex())?.userDuties[0].filename.startsWith("service:"));
const bank = await hydrateSourceBank(
  { questions: [{ content: "题目" }] },
  index.userBanks[0].downloadUrl,
  index.userBanks[0].imagePath,
);
assert(bank.questions[0].images[0].startsWith("data:image/png;base64,"));
console.log("✓ 题库和值班表自定义来源、同名隔离和图片离线缓存");
source.setState({
  sync: { knowledge: false, summaries: false, chat: true, duty: false },
});
delayChat = true;
const started = new Promise<void>((r) => {
  chatStarted = r;
});
const pending = syncDataNow();
const pendingResult = assert.rejects(pending, /已切换/);
await started;
source
  .getState()
  .configure("https://another.test", "test-token-12345678", "another-space");
releaseChat!();
await pendingResult;
assert.equal(chat.getState().conversations.length, 2);
console.log("✓ 请求期间切换数据源，丢弃旧请求结果");
const merged = mergeConversations(
  [
    {
      ...conversation("c"),
      updatedAt: "2026-10-20T00:02:00Z",
      messages: [{ ...conversation("c").messages[0], content: "完整回答" }],
    },
  ],
  [
    {
      ...conversation("c"),
      messages: [
        { ...conversation("c").messages[0], content: "半条回答" },
        { ...conversation("c").messages[0], id: "other", content: "其他消息" },
      ],
    },
  ],
);
assert.equal(
  merged[0].messages.find((v) => v.id === "c-message")?.content,
  "完整回答",
);
assert.equal(merged[0].messages.length, 2);
await mergeSyncedSummaryVersions("combined", [
  { id: "summary-local", version: "v1", content: "本地总结", createdAt: 200 },
]);
assert.equal((await listSummaryVersions("combined")).length, 2);
console.log("✓ 聊天并发编辑保留新内容，总结导入不覆盖本地历史");
const twoMessages = (
  first: string,
  second: string,
  firstTime: string,
  secondTime: string,
) => ({
  ...conversation("parallel"),
  updatedAt: secondTime,
  messages: [
    {
      ...conversation("parallel").messages[0],
      id: "z-user",
      content: first,
      updatedAt: firstTime,
    },
    {
      ...conversation("parallel").messages[0],
      id: "a-assistant",
      content: second,
      updatedAt: secondTime,
    },
  ],
});
const parallel = mergeConversations(
  [twoMessages("新问题", "旧回答", "2026-10-20T00:02:00Z", date)],
  [twoMessages("旧问题", "新回答", date, "2026-10-20T00:03:00Z")],
);
assert.deepEqual(
  parallel[0].messages.map((m) => m.content),
  ["新问题", "新回答"],
);
assert.deepEqual(
  parallel[0].messages.map((m) => m.id),
  ["z-user", "a-assistant"],
);
console.log("✓ 两端同时修改不同消息时分别合并，毫秒相同的消息保留会话内顺序");
