/**
 * 值班表解析器公共类型
 * 每个「工作表类型 / 文件类型」对应一个独立解析器，实现 DutySheetParser 接口。
 */
import { DutySchedule, DutyShift, DutyDrill, DutyRoleAssignment } from '../../types';

// 解析预览统计
export interface DutyParsePreview {
  totalPeople: number;
  totalDays: number;
  totalShifts: number;
  dateRange: string;
  shiftDistribution: Record<string, number>;
}

// 一次导入解析的完整结果
export interface DutyParseResult {
  schedule: Omit<DutySchedule, 'id' | 'createdAt' | 'updatedAt'>;
  preview: DutyParsePreview;
}

// 解析上下文（每个工作表一份）
export interface SheetParseContext {
  rows: any[][];
  sheetName: string;
  defaultYear: number;
  defaultMonth: number;
}

// 单个工作表解析产物
export interface SheetParseOutput {
  shifts: DutyShift[];
  drills: DutyDrill[];
  roles: DutyRoleAssignment[];
  people: string[];
  shiftCountByType: Record<string, number>;
}

/**
 * 工作表解析器接口
 * 一种表格解析方式 = 一个实现该接口的文件。
 */
export interface DutySheetParser {
  id: string;      // 解析器标识，如 matrix / role / drill
  label: string;   // 中文名，用于描述与日志
  canHandle(ctx: SheetParseContext): boolean;
  parse(ctx: SheetParseContext): SheetParseOutput;
}

export function emptySheetOutput(): SheetParseOutput {
  return { shifts: [], drills: [], roles: [], people: [], shiftCountByType: {} };
}
