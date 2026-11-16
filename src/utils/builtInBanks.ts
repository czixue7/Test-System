import { QuestionBank } from '../types';

export const BUILT_IN_BANK_PREFIX = 'built-in-';

// 应用不再内置系统题库：题库统一从数据来源获取。
// 保留 id 前缀判断，用于识别历史版本已写入本地存储的内置题库记录，
// 并从用户题库列表与持久化内容中排除它们。
export function isBuiltInBank(id: string): boolean {
  return id.startsWith(BUILT_IN_BANK_PREFIX);
}

export async function loadBuiltInBanks(): Promise<QuestionBank[]> {
  return [];
}
