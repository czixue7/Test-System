import type { DutyIndexItem, DutySchedule, JsonDutyScheduleData } from '../types';
import { buildShifts } from '../store/dutyScheduleStore';
import { parseDutyExcelFile } from './dutyParsers';
import { contentHash } from './questionBankSync';
import { fetchRemoteBytes, rawUrlCandidates } from './remoteRepo';
import { sourceRequestError } from './dataSourceRequest';

/** Download the published file itself; Excel uses the same parser as local import. */
export async function downloadPublishedDuty(
  item: Pick<DutyIndexItem, 'name' | 'filename' | 'downloadUrl' | 'sha'>,
  token?: string,
): Promise<Omit<DutySchedule, 'id' | 'createdAt' | 'updatedAt'>> {
  let bytes: ArrayBuffer;
  try { bytes = await fetchRemoteBytes(rawUrlCandidates(item.downloadUrl), token); }
  catch (error) { throw new Error(sourceRequestError(error)); }
  // Repository indexes can use Git blob SHA-1; service catalogs use raw SHA-256.
  if (/^[a-f0-9]{64}$/i.test(item.sha) && await contentHash(new Uint8Array(bytes)) !== item.sha.toLowerCase())
    throw new Error('公共资源完整性校验失败，请重新获取');
  const filename = item.filename.split(/[\\/]/).pop() || item.name;
  if (/\.xlsx?$/i.test(filename)) {
    const { schedule } = await parseDutyExcelFile(new File([bytes], filename));
    return { ...schedule, name: item.name || schedule.name };
  }
  let data: JsonDutyScheduleData;
  try { data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new Error('值班表 JSON 格式无效'); }
  if (!data || !Array.isArray(data.shifts) || !data.shifts.every(s => s && typeof s.date === 'string'))
    throw new Error('值班表格式无效，缺少有效班次');
  return { name: data.name || item.name, description: data.description,
    shifts: buildShifts(data), drills: data.drills, roles: data.roles };
}
