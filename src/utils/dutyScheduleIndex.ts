import { DutySchedule, DutyIndex, DutyIndexItem } from '../types';
import { contentsApiCandidates, fetchRemoteJson, repoFileCandidates } from './remoteRepo';

// 与题库一致的仓库，优先 Gitee，失败回退 GitHub
const USER_DUTY_PATH = 'Duty_schedule';

interface RepoContentItem {
  name: string;
  path: string;
  sha: string;
  type: 'file' | 'dir';
  download_url?: string;
}

/**
 * 动态获取 Duty_schedule 目录下所有用户值班表
 * 优先 Gitee，失败回退 GitHub；遍历子目录，找到 JSON 文件
 * （与题库 Question_bank 目录结构一致）
 */
async function fetchUserDutiesFromRepo(): Promise<DutyIndexItem[]> {
  const items: DutyIndexItem[] = [];

  try {
    const dirContents = await fetchRemoteJson<RepoContentItem[]>(
      contentsApiCandidates(USER_DUTY_PATH)
    );
    if (!Array.isArray(dirContents)) return items;

    const subDirs = dirContents.filter((item) => item.type === 'dir');

    for (const subDir of subDirs) {
      try {
        const subContents = await fetchRemoteJson<RepoContentItem[]>(
          contentsApiCandidates(subDir.path)
        );
        if (!Array.isArray(subContents)) continue;

        const jsonFile = subContents.find(
          (f) => f.type === 'file' && f.name.endsWith('.json')
        );

        if (jsonFile && jsonFile.download_url) {
          items.push({
            name: subDir.name,
            filename: jsonFile.name,
            downloadUrl: jsonFile.download_url,
            sha: jsonFile.sha
          });
        }
      } catch (err) {
        console.warn(`[dutyIndex] Failed to fetch sub-directory ${subDir.name}:`, err);
      }
    }
  } catch (error) {
    console.error('[dutyIndex] Error fetching user duties:', error);
  }

  return items;
}

/**
 * 获取值班表索引文件
 * 合并静态 duty-index.json 和动态获取的用户值班表（均优先 Gitee，失败回退 GitHub）
 */
export async function fetchDutyIndex(): Promise<DutyIndex | null> {
  try {
    // 1. 获取静态索引文件（优先 Gitee，失败回退 GitHub）
    let index: DutyIndex;
    try {
      index = await fetchRemoteJson<DutyIndex>(repoFileCandidates('duty-index.json'));
    } catch (error) {
      console.warn('[dutyIndex] Failed to fetch duty index, using empty defaults:', error);
      index = { systemDuties: [], userDuties: [] };
    }

    // 2. 动态获取 Duty_schedule 目录下的用户值班表
    const dynamicUserDuties = await fetchUserDutiesFromRepo();

    // 3. 合并用户值班表：动态获取的优先，静态索引中不重复的保留
    const dynamicNames = new Set(dynamicUserDuties.map((d) => d.filename));
    const staticOnly = index.userDuties.filter((d) => !dynamicNames.has(d.filename));
    index.userDuties = [...dynamicUserDuties, ...staticOnly];

    return index;
  } catch (error) {
    console.error('[dutyIndex] Error fetching duty index:', error);
    return null;
  }
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
