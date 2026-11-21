import type { DutyDrill, DutyRoleAssignment, DutySchedule } from '../types';
import { useDutyScheduleStore } from '../store/dutyScheduleStore';
import { useToastStore } from '../components/Toast';
import { fetchDutyIndex, findDutyInIndex } from './dutyScheduleIndex';
import { downloadPublishedDuty } from './publishedDuty';

type PublishedDuty = Omit<DutySchedule, 'id' | 'createdAt' | 'updatedAt'>;

const drillKey = (item: DutyDrill) => `${item.date}|${item.group}`;
const roleKey = (item: DutyRoleAssignment) => `${item.date}|${item.group}|${item.shiftType || ''}`;
const sameEntry = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

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

/** 用发布源数据覆盖班次，同时保留用户自己改过的演练与岗位标注。 */
export function mergePublishedDuty(local: DutySchedule, published: PublishedDuty): Partial<DutySchedule> {
  const drills = mergeAnnotations(published.drills, local.drills, local.sourceDrills, drillKey);
  const roles = mergeAnnotations(published.roles, local.roles, local.sourceRoles, roleKey);
  return {
    name: published.name,
    description: published.description,
    shifts: published.shifts,
    drills: drills.length ? drills : undefined,
    roles: roles.length ? roles : undefined
  };
}

export interface DutyAutoUpdateResult {
  updated: number;
  failed: number;
}

let running: Promise<DutyAutoUpdateResult> | null = null;

/** 自动检查已下载值班表的发布版本，有更新时直接覆盖班次并保留用户标注。 */
export function autoUpdateDuties(): Promise<DutyAutoUpdateResult> {
  if (!running) running = run();
  return running;
}

async function run(): Promise<DutyAutoUpdateResult> {
  const candidates = useDutyScheduleStore
    .getState()
    .duties.filter((d) => d.sourceSha && d.sourceFilename && d.sourceType);
  if (!candidates.length) return { updated: 0, failed: 0 };

  let index;
  try {
    index = await fetchDutyIndex();
  } catch (error) {
    console.warn('[DutyAutoUpdate] 获取值班表索引失败:', error);
    return { updated: 0, failed: 0 };
  }
  if (!index) return { updated: 0, failed: 0 };

  const updatedNames: string[] = [];
  let failed = 0;

  for (const duty of candidates) {
    const item = findDutyInIndex(index, duty.sourceFilename!, duty.sourceType!);
    if (!item || !duty.sourceSha) continue;
    // SHA 算法不同无法比较，按无更新处理
    if (duty.sourceSha.length !== item.sha.length || duty.sourceSha === item.sha) continue;

    try {
      const published = await downloadPublishedDuty(item);
      const merged = mergePublishedDuty(duty, published);
      useDutyScheduleStore.getState().applyRemoteDuty(duty.id, merged, item.sha, {
        drills: published.drills,
        roles: published.roles
      });
      updatedNames.push(duty.name);
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
