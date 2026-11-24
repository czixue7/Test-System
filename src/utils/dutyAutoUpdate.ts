import type { DutyDrill, DutyRoleAssignment, DutySchedule } from '../types';
import { useDutyScheduleStore } from '../store/dutyScheduleStore';
import { useDataSourceStore } from '../store/dataSourceStore';
import { useToastStore } from '../components/Toast';
import { fetchDutyIndex, findPublishedDuty } from './dutyScheduleIndex';
import { downloadPublishedDuty } from './publishedDuty';
import { canonicalJson } from './dataSyncMerge';
import { dutyWithSharedAnnotations, preserveSharedAnnotations } from './sharedDutyAnnotations';

type PublishedDuty = Omit<DutySchedule, 'id' | 'createdAt' | 'updatedAt'>;
type DutyContent = Pick<DutySchedule, 'name' | 'description' | 'shifts' | 'drills' | 'roles'>;

const drillKey = (item: DutyDrill) => `${item.date}|${item.group}`;
const roleKey = (item: DutyRoleAssignment) => `${item.date}|${item.group}|${item.shiftType || ''}`;
const sameEntry = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);

/**
 * 以发布版本为基准合并用户标注：
 * - 本地改过（或新增）的条目保留，未被用户改动过的条目采用新发布的版本；
 * - 用户删除过的条目不会因为更新重新出现；
 * - 旧记录没有基准时无法判断改动，按本地优先保留，避免丢失用户标注。
 */
function mergeAnnotations<T>(
  published: T[] | undefined,
  local: T[] | undefined,
  baseline: T[] | undefined,
  key: (item: T) => string
): T[] {
  const merged = [...(published || [])];
  const localList = local || [];

  if (!baseline) {
    const positions = new Map(merged.map((item, index) => [key(item), index]));
    for (const item of localList) {
      const at = positions.get(key(item));
      if (at === undefined) {
        positions.set(key(item), merged.length);
        merged.push(item);
      } else {
        merged[at] = item;
      }
    }
    return merged;
  }

  const publishedBaseline = new Map(baseline.map((item) => [key(item), item]));
  const localMap = new Map(localList.map((item) => [key(item), item]));
  const result = merged.filter((item) => {
    const k = key(item);
    return !(publishedBaseline.has(k) && !localMap.has(k));
  });
  const positions = new Map(result.map((item, index) => [key(item), index]));

  for (const [k, localItem] of localMap) {
    const previous = publishedBaseline.get(k);
    if (previous && sameEntry(previous, localItem)) continue;
    const at = positions.get(k);
    if (at === undefined) {
      positions.set(k, result.length);
      result.push(localItem);
    } else {
      result[at] = localItem;
    }
  }
  return result;
}

/**
 * 判断发布内容与本地展示内容是否一致。
 * 解析文件时每次都会重新生成班次 id，直接比较会误判为“有更新”，
 * 因此序列化时丢弃所有 id 字段，并统一空数组与 undefined。
 */
export function sameDutyContent(
  local: DutySchedule,
  next: DutyContent
): boolean {
  const snapshot = (value: DutyContent) => canonicalJson({
    name: value.name,
    shifts: value.shifts.map(({ id: _id, ...shift }) => shift),
    drills: value.drills ?? [],
    roles: value.roles ?? [],
  });
  return snapshot(local) === snapshot(next);
}

/** 用发布源数据覆盖班次，同时保留用户自己改过的演练与岗位标注。 */
export function mergePublishedDuty(local: DutySchedule, published: PublishedDuty): DutyContent {
  const drills = local.locallyEdited && !local.sharedAnnotations
    ? mergeAnnotations(published.drills, local.drills, local.sourceDrills, drillKey)
    : published.drills;
  const roles = local.locallyEdited && !local.sharedAnnotations
    ? mergeAnnotations(published.roles, local.roles, local.sourceRoles, roleKey)
    : published.roles;
  return {
    name: published.name,
    description: published.description,
    shifts: published.shifts,
    drills: drills?.length ? drills : undefined,
    roles: roles?.length ? roles : undefined
  };
}

export interface DutyAutoUpdateResult {
  updated: number;
  failed: number;
}

export interface DutyAutoUpdateOptions {
  /** 只查询电脑服务来源，用于前台定时轮询 */
  quick?: boolean;
}

let running: Promise<DutyAutoUpdateResult> | null = null;

/** 自动检查已下载值班表的发布版本，有更新时直接覆盖班次并保留用户标注。 */
export function autoUpdateDuties(
  options: DutyAutoUpdateOptions = {}
): Promise<DutyAutoUpdateResult> {
  if (!running) {
    running = run(options).finally(() => {
      running = null;
    });
  }
  return running;
}

function hasServiceSource(): boolean {
  return useDataSourceStore
    .getState()
    .sources.some((source) => source.enabled && source.kind === 'service');
}

/**
 * 应用在前台时定时检查服务来源的值班表，切回前台立即检查一次。
 * 没有启用的电脑服务来源时不做轮询，避免反复请求 GitHub/Gitee。
 */
export function startDutyLiveSync(intervalMs = 60000): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => {};
  let stopped = false;
  const tick = () => {
    if (stopped || document.visibilityState !== 'visible' || !hasServiceSource()) return;
    void autoUpdateDuties({ quick: true });
  };
  const onVisible = () => {
    if (document.visibilityState === 'visible') tick();
  };
  const timer = window.setInterval(tick, intervalMs);
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('focus', onVisible);
  return () => {
    stopped = true;
    window.clearInterval(timer);
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('focus', onVisible);
  };
}

async function run(options: DutyAutoUpdateOptions): Promise<DutyAutoUpdateResult> {
  const candidates = useDutyScheduleStore.getState().duties;
  if (!candidates.length) return { updated: 0, failed: 0 };

  let index;
  try {
    index = await fetchDutyIndex(options.quick ? { serviceOnly: true } : undefined);
  } catch (error) {
    console.warn('[DutyAutoUpdate] 获取值班表索引失败:', error);
    return { updated: 0, failed: 0 };
  }
  if (!index) return { updated: 0, failed: 0 };

  const updatedNames: string[] = [];
  let failed = 0;

  for (const duty of candidates) {
    const match = findPublishedDuty(index, duty);
    if (!match) continue;
    const { item, source } = match;
    try {
      const store = useDutyScheduleStore.getState();
      const current = store.getDuty(duty.id);
      if (!current || current.sourceSha !== duty.sourceSha || current.sourceFilename !== duty.sourceFilename) continue;
      const binding = { sourceFilename: item.filename, sourceType: source };
      const refreshReference = !!(current.sharedAnnotations && current.locallyEdited);
      if (current.sourceSha && current.sourceSha === item.sha && !refreshReference) {
        // 旧版可能先记下了新哈希和基准，却仍显示旧岗位。用已保存的基准修复未编辑的表。
        if (current.locallyEdited) continue;
        const roles = current.sourceRoles ?? current.roles;
        const drills = current.sourceDrills ?? current.drills;
        const changed = !sameEntry(current.roles ?? [], roles ?? []) || !sameEntry(current.drills ?? [], drills ?? []);
        if (changed || current.sourceFilename !== item.filename || current.sourceType !== source) {
          store.applyRemoteDuty(current.id, { roles, drills, ...binding }, item.sha, {
            drills: current.sourceDrills, roles: current.sourceRoles
          });
        }
        if (changed && !current.sharedAnnotations) updatedNames.push(current.name);
        continue;
      }

      const published = await downloadPublishedDuty(item);
      const latest = store.getDuty(duty.id);
      if (!latest || latest.sourceSha !== current.sourceSha || latest.sourceFilename !== current.sourceFilename) continue;
      const shared = preserveSharedAnnotations(latest, item.filename);
      const merged = mergePublishedDuty({ ...latest, sharedAnnotations: shared }, published);
      const changed = !sameDutyContent(latest, merged);
      const displayChanged = shared ? !sameDutyContent(dutyWithSharedAnnotations(latest), dutyWithSharedAnnotations({
        ...latest, ...merged, sharedAnnotations: shared, sourceDrills: published.drills, sourceRoles: published.roles,
      })) : changed;
      store.applyRemoteDuty(latest.id, {
        ...(changed ? merged : { description: merged.description }),
        ...(shared ? { sharedAnnotations: shared, locallyEdited: false } : {}),
        ...binding
      }, item.sha, { drills: published.drills, roles: published.roles });
      if (displayChanged) updatedNames.push(merged.name);
    } catch (error) {
      failed++;
      console.warn(`[DutyAutoUpdate]「${duty.name}」自动更新失败:`, error);
    }
  }

  if (updatedNames.length) {
    useToastStore
      .getState()
      .addToast(`值班表「${updatedNames.join('、')}」已自动更新`, 'success', 5000);
  }
  return { updated: updatedNames.length, failed };
}
