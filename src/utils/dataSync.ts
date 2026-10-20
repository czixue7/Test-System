import { useDataSourceStore, SyncKind } from "../store/dataSourceStore";
import { useKnowledgeStore } from "../store/knowledgeStore";
import { useChatStore, Conversation } from "../store/chatStore";
import { useDutyScheduleStore } from "../store/dutyScheduleStore";
import { useKnowledgeSummaryStore } from "../store/knowledgeSummaryStore";
import { KnowledgeItem } from "../types";
import {
  getSummaryHistoryState,
  mergeSyncedSummaryVersions,
  normalizeHistory,
  SummaryType,
  SummaryVersion,
} from "./knowledgeSummary";
import { sourceRequest, normalizeSourceUrl, sourceRequestError } from "./dataSourceRequest";
import { mergeById, mergeConversations, dateValue, canonicalJson } from "./dataSyncMerge";
import { fetchPublicResources } from "./publicResources";
import { useQuestionBankStore } from "../store/questionBankStore";
import { useToastStore } from "../components/Toast";

const syncNames: Record<SyncKind, string> = {
  banks: "题库", knowledge: "知识库", summaries: "总结", chat: "AI 聊天", duty: "值班表",
};

const summaryTypes: SummaryType[] = ["knowledge", "questionBank", "combined"];
type Envelope = { revision: number; data: any };
type PersonalSyncKind = Exclude<SyncKind, "banks" | "duty">;
const isString = (v: unknown): v is string => typeof v === "string";
const arrayOf = (value: unknown, test: (v: any) => boolean): value is any[] =>
  Array.isArray(value) &&
  value.every((v) => v && typeof v === "object" && test(v));
function validate(kind: PersonalSyncKind, data: any) {
  if (data === null) return;
  let valid = data && typeof data === "object";
  if (kind === "knowledge")
    valid =
      valid &&
      arrayOf(data.items, (v) =>
        [v.id, v.title, v.content, v.category, v.createdAt, v.updatedAt].every(
          isString,
        ),
      ) &&
      Array.isArray(data.categories) &&
      data.categories.every(isString);
  if (kind === "chat")
    valid =
      valid &&
      arrayOf(
        data.conversations,
        (v) =>
          [v.id, v.title, v.createdAt, v.updatedAt].every(isString) &&
          arrayOf(
            v.messages,
            (m) =>
              [m.id, m.content, m.createdAt].every(isString) &&
              ["user", "assistant"].includes(m.role) &&
              ["knowledge", "questionBank", "combined", "ai"].includes(
                m.source,
              ),
          ),
      );
  if (kind === "summaries")
    valid =
      valid &&
      (data.deleted === undefined || (data.deleted && typeof data.deleted === "object" && summaryTypes.every(type => Array.isArray(data.deleted[type]) && data.deleted[type].every(isString)))) && summaryTypes.every(
        (type) =>
          Array.isArray(data[type]) &&
          normalizeHistory(data[type]).length === data[type].length,
      );
  if (!valid) throw new Error(`${syncNames[kind]}同步数据格式无效，未写入本机`);
}
async function snapshot(kind: PersonalSyncKind): Promise<any> {
  if (kind === "knowledge") {
    const s = useKnowledgeStore.getState();
    return { items: s.items, categories: s.categories };
  }
  if (kind === "chat")
    return { conversations: useChatStore.getState().conversations };
  const entries = await Promise.all(summaryTypes.map(type => getSummaryHistoryState(type)));
  return {
    ...Object.fromEntries(summaryTypes.map((type, i) => [type, entries[i].history])),
    deleted: Object.fromEntries(summaryTypes.map((type, i) => [type, entries[i].deletedIds])),
  };
}
function merge(kind: PersonalSyncKind, local: any, remote: any): any {
  if (!remote) return local;
  if (kind === "knowledge")
    return {
      items: mergeById<KnowledgeItem>(local.items, remote.items, dateValue),
      categories: [
        ...new Set<string>([...local.categories, ...remote.categories]),
      ].sort(),
    };
  if (kind === "chat")
    return {
      conversations: mergeConversations<Conversation>(
        local.conversations,
        remote.conversations,
      ),
    };
  const deleted = Object.fromEntries(summaryTypes.map(type => [type, [...new Set<string>([...(local.deleted?.[type] ?? []), ...(remote.deleted?.[type] ?? [])])]]));
  return {
    ...Object.fromEntries(summaryTypes.map(type => [type,
      mergeById<SummaryVersion>(local[type], remote[type], dateValue).filter(v => !deleted[type].includes(v.id)),
    ])), deleted,
  };
}
async function apply(kind: PersonalSyncKind, value: any) {
  if (kind === "knowledge")
    useKnowledgeStore.setState({
      items: value.items,
      categories: value.categories,
      isLoaded: true,
    });
  if (kind === "chat") {
    const current = useChatStore.getState().activeConversationId;
    useChatStore.setState({
      conversations: value.conversations,
      activeConversationId: value.conversations.some(
        (c: Conversation) => c.id === current,
      )
        ? current
        : (value.conversations[0]?.id ?? null),
    });
  }
  if (kind === "summaries") {
    for (const type of summaryTypes)
      await mergeSyncedSummaryVersions(type, value[type], value.deleted?.[type]);
    window.dispatchEvent(new Event("data-source-summaries-updated"));
  }
}
export async function importPublishedKnowledge(
  stillEnabled: () => boolean = () => true,
): Promise<number> {
  const initial = useDataSourceStore.getState();
  const { data } = await sourceRequest<{ items: KnowledgeItem[] }>(
    "api/v1/knowledge",
  );
  if (!stillEnabled()) return 0;
  if (
    useDataSourceStore.getState().url !== initial.url ||
    useDataSourceStore.getState().token !== initial.token
  )
    throw new Error("数据源已经切换，请重新获取");
  if (
    !arrayOf(data.items, (v) =>
      [v.id, v.title, v.content, v.category, v.updatedAt].every(isString),
    )
  )
    throw new Error("知识库数据格式无效");
  // Namespace published IDs by source so similarly named directories on different servers do not collide.
  const prefix = encodeURIComponent(normalizeSourceUrl(initial.url));
  const incoming = data.items.map((item) => ({
    ...item,
    id: `${prefix}:${item.id}`,
    updatedAt: /^\d+$/.test(item.updatedAt)
      ? new Date(Number(item.updatedAt) * 1000).toISOString()
      : item.updatedAt,
  }));
  const local = useKnowledgeStore.getState();
  const items = mergeById(local.items, incoming, dateValue);
  useKnowledgeStore.setState({ items, isLoaded: true });
  return incoming.length;
}
let running: Promise<void> | null = null;
type SyncScope = "all" | "public" | "personal";
async function performSync(scope: SyncScope) {
  const config = useDataSourceStore.getState();
  if (!config.url) throw new Error("请先选择电脑同步服务");
  const valid = (kind: SyncKind) => {
    const s = useDataSourceStore.getState();
    return (
      s.url === config.url &&
      s.token === config.token &&
      ((kind === "banks" || kind === "duty") || s.space === config.space) &&
      (scope === "all" || ((kind === "banks" || kind === "duty") === (scope === "public"))) &&
      s.sync[kind]
    );
  };
  const failures: string[] = [];
  let completed = 0;
  let skipped = 0;
  // Legacy bank flags are ignored: downloads and updates belong to the bank pages.
  for (const kind of ["knowledge", "summaries", "chat", "duty"] as SyncKind[]) {
    if (!valid(kind)) continue;
    try {
      if (kind === "banks" && !useQuestionBankStore.getState().isLoaded)
        await useQuestionBankStore.getState().loadBanks();
      if (kind === "duty" && !useDutyScheduleStore.getState().isLoaded)
        await useDutyScheduleStore.getState().loadDuties();
      if (!valid(kind)) continue;
      if (kind === "summaries" && useKnowledgeSummaryStore.getState().summaryRunning) {
        skipped++;
        continue;
      }
      if (kind === "banks" || kind === "duty") {
        await fetchPublicResources(kind, config, () => valid(kind));
        if (valid(kind)) completed++;
        continue;
      }
      if (kind === "knowledge") {
        await importPublishedKnowledge(() => valid(kind));
        if (!valid(kind)) continue;
      }
      const path = `api/v1/sync/${config.space}/${kind}`;
      const requestOptions = { base: config.url, token: config.token };
      let result = await sourceRequest<Envelope>(path, requestOptions);
      for (let attempt = 0; attempt < 3; attempt++) {
        if (!valid(kind)) break;
        if (
          !Number.isSafeInteger(result.data.revision) ||
          result.data.revision < 0
        )
          throw new Error("同步版本号无效");
        validate(kind, result.data.data);
        const local = await snapshot(kind);
        if (!valid(kind)) break;
        const merged = merge(kind, local, result.data.data);
        validate(kind, merged);
        if (canonicalJson(merged) !== canonicalJson(result.data.data)) {
          result = await sourceRequest<Envelope>(path, {
            ...requestOptions,
            method: "PUT",
            data: { baseRevision: result.data.revision, data: merged },
          });
          if (result.status === 409) {
            if (attempt === 2) throw new Error("其他设备正在同步，请稍后重试");
            continue;
          }
        }
        if (!valid(kind)) break;
        validate(kind, result.data.data);
        // Capture edits made while waiting on the network, rather than replacing them with an old snapshot.
        const current = await snapshot(kind);
        if (!valid(kind)) break;
        await apply(kind, merge(kind, current, result.data.data));
        completed++;
        break;
      }
    } catch (e) {
      failures.push(`${syncNames[kind]}：${sourceRequestError(e)}`);
    }
  }
  const current = useDataSourceStore.getState();
  const sameSource = current.url === config.url && current.token === config.token && (scope === "public" || current.space === config.space);
  const detail = failures.length ? `${completed ? `已完成 ${completed} 项；` : ""}${failures.join("；")}` : "";
  if (sameSource)
    useDataSourceStore.setState({
      ...(completed ? { lastSync: new Date().toISOString() } : {}),
      lastError: detail,
    });
  if (!sameSource) throw new Error("同步服务或空间已切换，已停止应用旧服务的后续结果，请重新同步");
  if (failures.length) throw new Error(detail);
  return { completed, skipped };
}
export function syncDataNow(scope: SyncScope = "all"): Promise<void> {
  if (!running) {
    useDataSourceStore.setState({ syncing: true, lastError: "" });
    running = performSync(scope).then(({ completed, skipped }) => {
      const suffix = skipped ? "；总结正在生成，本次已跳过，请生成后再同步" : "";
      useToastStore.getState().addToast(
        completed ? `${scope === "public" ? "公共资源获取完成" : "同步成功"}，已完成 ${completed} 项${suffix}` : skipped ? suffix.slice(1) : "请先选择要处理的内容",
        completed && !skipped ? "success" : "warning", 5000,
      );
    }).catch(error => {
      useToastStore.getState().addToast(`同步未完成：${sourceRequestError(error)}`, "error", 7000);
      throw error;
    }).finally(() => {
      useDataSourceStore.setState({ syncing: false });
      running = null;
    });
  }
  return running;
}
