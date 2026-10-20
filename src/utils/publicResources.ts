import { useQuestionBankStore } from "../store/questionBankStore";
import { buildShifts, useDutyScheduleStore } from "../store/dutyScheduleStore";
import type { BankIndexItem, DutyIndexItem, DutySchedule, JsonDutyScheduleData, QuestionBank } from "../types";
import { sourceRequest, resolveSourceResource } from "./dataSourceRequest";
import { contentHash } from "./questionBankSync";
import { canonicalJson } from "./dataSyncMerge";
import { convertJsonToBank, validateJsonBank } from "./jsonImporter";
import { hydrateSourceBank } from "./dataSourceAssets";
import { getStoreValue, setStoreValue } from "./tauriStore";

/** Public catalog downloads never send local resources or a personal space ID. */
export async function fetchPublicResources(
  kind: "banks" | "duty",
  config: { url: string; token: string },
  enabled: () => boolean,
): Promise<number> {
  const bank = kind === "banks";
  const request = <T,>(path: string, raw = false) => sourceRequest<T>(path, {
    base: config.url, token: config.token, raw,
  });
  const { data: index } = await request<Record<string, (BankIndexItem | DutyIndexItem)[]>>(
    bank ? "bank-index.json" : "duty-index.json",
  );
  if (!enabled()) return 0;
  const system = bank ? "systemBanks" : "systemDuties";
  const user = bank ? "userBanks" : "userDuties";
  if (!Array.isArray(index?.[system]) || !Array.isArray(index?.[user]))
    throw new Error("公共资源目录格式无效，请检查服务台版本");
  const key = `public-resource-hashes:${encodeURIComponent(config.url)}:${kind}`;
  const baselines = await getStoreValue<Record<string, string>>(key, {});
  const prefix = `service:${encodeURIComponent(config.url)}:`;
  const seen = new Set<string>();
  let count = 0;
  for (const group of [system, user]) for (const item of index[group]) {
    if (!enabled()) return count;
    if (!item || typeof item.filename !== "string" || typeof item.downloadUrl !== "string" || !/^[a-f0-9]{64}$/.test(item.sha))
      throw new Error("公共资源目录条目无效");
    const filename = `${prefix}${item.filename}`;
    if (seen.has(filename)) continue;
    seen.add(filename);
    const sourceType = group === system ? "system" as const : "user" as const;
    const old = bank
      ? useQuestionBankStore.getState().banks.find(b => b.sourceFilename === filename)
      : useDutyScheduleStore.getState().duties.find(d => d.sourceFilename === filename);
    if (old?.sourceSha === item.sha && (!bank || canonicalJson((old as QuestionBank).images ?? []) === canonicalJson((item as BankIndexItem).images ?? []))) continue;
    const before = old ? canonicalJson(old) : "";
    const url = resolveSourceResource(item.downloadUrl, config.url);
    const { data: raw } = await request<string>(url, true);
    if (await contentHash(raw) !== item.sha) throw new Error("公共资源完整性校验失败，请重新获取");
    const data = JSON.parse(raw);
    let incoming: QuestionBank | DutySchedule;
    if (bank) {
      const result = validateJsonBank(data);
      if (!result.valid) throw new Error(result.error || "题库格式无效");
      const hydrated = await hydrateSourceBank(data, url,
        (item as BankIndexItem).imagePath ? resolveSourceResource((item as BankIndexItem).imagePath!, config.url) : undefined);
      incoming = { ...convertJsonToBank(hydrated), images: (item as BankIndexItem).images };
    } else {
      const duty = data as JsonDutyScheduleData;
      if (!duty || !Array.isArray(duty.shifts) || !duty.shifts.every(s => s && typeof s.date === "string"))
        throw new Error("值班表格式无效，缺少有效班次");
      const now = new Date().toISOString();
      incoming = { id: crypto.randomUUID(), name: duty.name || item.name, description: duty.description,
        shifts: buildShifts(duty), drills: duty.drills, roles: duty.roles, createdAt: now, updatedAt: now };
    }
    if (!enabled()) return count;
    const edited = old && (!baselines[old.id] || await contentHash(before) !== baselines[old.id]);
    if (!enabled()) return count;
    const current = bank
      ? useQuestionBankStore.getState().banks.find(b => b.sourceFilename === filename)
      : useDutyScheduleStore.getState().duties.find(d => d.sourceFilename === filename);
    if (canonicalJson(current ?? null) !== canonicalJson(old ?? null))
      throw new Error("获取期间本地内容发生编辑或删除，已保留本地内容，请重新获取");
    const resource = { ...incoming, id: old?.id ?? incoming.id, createdAt: old?.createdAt ?? incoming.createdAt,
      sourceFilename: filename, sourceSha: item.sha, sourceType };
    const copy = edited ? { ...old, id: crypto.randomUUID(), name: `${old.name}（本机副本）`,
      sourceFilename: undefined, sourceSha: undefined, sourceType: undefined } : null;
    if (bank) {
      await useQuestionBankStore.getState().applySyncedBanks([...(copy ? [copy as QuestionBank] : []), resource as QuestionBank]);
    } else {
      const duties = useDutyScheduleStore.getState().duties;
      const next = [...duties.filter(d => d.id !== old?.id), ...(copy ? [copy as DutySchedule] : []), resource as DutySchedule];
      useDutyScheduleStore.setState({ duties: next });
      await setStoreValue("duty-schedules", next);
    }
    baselines[resource.id] = await contentHash(canonicalJson(resource));
    await setStoreValue(key, baselines);
    count++;
  }
  return count;
}
