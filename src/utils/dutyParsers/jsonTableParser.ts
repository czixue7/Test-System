/**
 * JSON 值班表解析器
 * 与「表格」解析完全独立：表格走 workbookParser 协调的各工作表解析器，
 * JSON 走本文件，二者互不依赖。
 */
import { DutyShift, DutyShiftType, JsonDutyScheduleData } from '../../types';
import { DutyParseResult } from './types';

export function parseJsonDutyText(text: string, fileName: string): DutyParseResult {
  let data: JsonDutyScheduleData;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('JSON 格式无效');
  }
  if (!data.shifts || !Array.isArray(data.shifts)) {
    throw new Error('缺少 shifts 字段');
  }

  const shifts: DutyShift[] = data.shifts.map((s, i) => ({
    id: `json-${i}-${Math.random().toString(36).slice(2, 7)}`,
    date: s.date,
    shiftType: (s.shiftType as DutyShiftType) || 'allday',
    startTime: s.startTime,
    endTime: s.endTime,
    tasks: Array.isArray(s.tasks) ? s.tasks : s.tasks ? [String(s.tasks)] : [],
    personInCharge: s.personInCharge,
    notes: s.notes,
    group: s.group
  }));

  const personSet = new Set<string>();
  const shiftCountByType: Record<string, number> = {};
  let minDate = Infinity;
  let maxDate = 0;

  for (const s of shifts) {
    if (s.personInCharge) personSet.add(s.personInCharge);
    shiftCountByType[s.shiftType] = (shiftCountByType[s.shiftType] || 0) + 1;
    const d = new Date(s.date);
    const ts = d.getTime();
    if (!Number.isNaN(ts)) {
      minDate = Math.min(minDate, ts);
      maxDate = Math.max(maxDate, ts);
    }
  }

  const dateRange = minDate !== Infinity
    ? `${new Date(minDate).toISOString().slice(0, 10)} ~ ${new Date(maxDate).toISOString().slice(0, 10)}`
    : '';

  return {
    schedule: {
      name: data.name || fileName.replace(/\.[^.]+$/, ''),
      description: data.description || `JSON 导入（${personSet.size}人）`,
      shifts
    },
    preview: {
      totalPeople: personSet.size,
      totalDays: new Set(shifts.map(s => s.date)).size,
      totalShifts: shifts.length,
      dateRange,
      shiftDistribution: shiftCountByType
    }
  };
}
