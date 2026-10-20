import { DutySchedule, DutyIndex, DutyIndexItem } from '../types';
import { fetchConfiguredIndex } from './sourceCatalog';

/**
 * 获取值班表索引文件
 * 合并已启用来源的静态值班表索引和动态目录，同仓库镜像去重。
 */
export async function fetchDutyIndex(): Promise<DutyIndex | null> {
  try { return await fetchConfiguredIndex('duty'); }
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
    if (filename.startsWith('service:') || filename.startsWith('repo:')) return d.sourceFilename === filename;
    if (d.name === dutyName) return true;
    if (d.sourceFilename === filename) return true;
    return false;
  });

  if (!existingDuty) {
    return { exists: false, hasUpdate: false, isBuiltIn: false };
  }

  // 没有 sourceSha 的旧数据，视为无更新
  if (!existingDuty.sourceSha) {
    return { exists: true, hasUpdate: false, isBuiltIn: false };
  }

  // 如果 SHA 长度不同，说明使用了不同的哈希算法，无法比较，视为无更新
  const hasUpdate =
    existingDuty.sourceSha.length === remoteSha.length &&
    existingDuty.sourceSha !== remoteSha;

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

  const hasUpdate =
    duty.sourceSha.length === remoteDuty.sha.length &&
    remoteDuty.sha !== duty.sourceSha;

  return { hasUpdate, remoteSha: remoteDuty.sha };
}
