import { DutySchedule, DutyIndex, DutyIndexItem } from '../types';
import { fetchConfiguredIndex, IndexFetchOptions } from './sourceCatalog';

/**
 * 获取值班表索引文件
 * 合并已启用来源的静态值班表索引和动态目录，同仓库镜像去重。
 */
export async function fetchDutyIndex(options?: IndexFetchOptions): Promise<DutyIndex | null> {
  try { return await fetchConfiguredIndex('duty', options); }
  catch (error) { console.error('Failed to fetch configured index:', error); return null; }
}

/**
 * 从索引中查找值班表信息
 */
export function findDutyInIndex(
  index: DutyIndex,
  filename: string,
  source: 'system' | 'user'
): DutyIndexItem | undefined {
  const list = source === 'system' ? index.systemDuties : index.userDuties;
  return list.find((d) => d.filename === filename);
}

/**
 * 查找值班表对应的发布条目。
 * 有来源标记时按文件名精确匹配；旧数据没有来源标记时，仅在发布名称唯一时认领，
 * 避免把同名的自定义值班表误当成发布版本。
 */
export function findPublishedDuty(
  index: DutyIndex,
  duty: Pick<DutySchedule, 'name' | 'sourceFilename' | 'sourceType'>
): { item: DutyIndexItem; source: 'system' | 'user' } | null {
  if (duty.sourceFilename && duty.sourceType) {
    const item = findDutyInIndex(index, duty.sourceFilename, duty.sourceType);
    return item ? { item, source: duty.sourceType } : null;
  }
  const matches: { item: DutyIndexItem; source: 'system' | 'user' }[] = [
    ...index.systemDuties.map((item) => ({ item, source: 'system' as const })),
    ...index.userDuties.map((item) => ({ item, source: 'user' as const })),
  ].filter((entry) => entry.item.name === duty.name);
  return matches.length === 1 ? matches[0] : null;
}

export interface DutyStatus {
  exists: boolean;
  hasUpdate: boolean;
  isBuiltIn: boolean;
}

/**
 * 检查值班表状态（用于下载页面）
 */
export function checkDutyStatus(
  dutyName: string,
  remoteSha: string,
  filename: string,
  source: 'system' | 'user',
  localDuties: DutySchedule[]
): DutyStatus {
  const existingDuty = localDuties.find((d) => {
    if (!d.sourceFilename && d.name === dutyName) return true;
    if (filename.startsWith('service:') || filename.startsWith('repo:')) return d.sourceFilename === filename;
    if (d.name === dutyName) return true;
    if (d.sourceFilename === filename) return true;
    return false;
  });

  if (!existingDuty) {
    return { exists: false, hasUpdate: false, isBuiltIn: false };
  }

  // 没有来源标记的旧数据需要先认领发布来源，按有更新处理
  if (!existingDuty.sourceSha) {
    return { exists: true, hasUpdate: true, isBuiltIn: false };
  }

  // 哈希算法可能不同（仓库是 40 位 Git blob SHA-1、电脑服务是 64 位 SHA-256），
  // 不能用长度否定更新，否则旧 sha 永远对不上、点下载也不会刷新内容。
  // 只要值不同就按「需要刷新」处理，由下载流程拿到文件后按实际内容比对，
  // 内容一致时只更新 sha，不提示有更新。
  const hasUpdate = existingDuty.sourceSha !== remoteSha;

  return {
    exists: true,
    hasUpdate,
    isBuiltIn: false
  };
}

/**
 * 检查值班表是否有更新（用于管理页面）
 */
export function checkDutyUpdate(
  duty: DutySchedule,
  index: DutyIndex | null
): { hasUpdate: boolean; remoteSha: string | null } {
  if (!duty.sourceSha || !duty.sourceFilename || !index) {
    return { hasUpdate: false, remoteSha: null };
  }

  const remoteDuty = findDutyInIndex(index, duty.sourceFilename, duty.sourceType || 'user');

  if (!remoteDuty) {
    return { hasUpdate: false, remoteSha: null };
  }

  // 同 checkDutyStatus：值不同即视为需要刷新（哈希算法可能不同，不能只看长度）
  const hasUpdate = remoteDuty.sha !== duty.sourceSha;

  return { hasUpdate, remoteSha: remoteDuty.sha };
}
