/**
 * Excel 工作簿协调解析器
 * 遍历工作簿中的每个工作表，交给匹配的工作表解析器处理（一种表格解析方式对应一个解析器文件），
 * 汇总为一次导入结果。
 *
 * 解析顺序很重要：演练表 → 岗位表 → 矩阵排班表。
 *   - 演练表的「日期」行是连续数字（1..31），会被矩阵表误判，故必须先识别演练表；
 *   - 岗位表以「配电 + 柴发」同行为特征；
 *   - 两者都不匹配且含日期表头行的才是矩阵排班表；
 *   - 「规律提取」等说明表不匹配任何解析器，自动跳过。
 */
import * as XLSX from 'xlsx';
import { DutyDrill, DutyRoleAssignment, DutyShift } from '../../types';
import { DutyParseResult, DutySheetParser, SheetParseContext } from './types';
import { drillTableParser, parseDrillSheet } from './drillTableParser';
import { roleTableParser } from './roleTableParser';
import { matrixTableParser } from './matrixTableParser';
import { fillFullYear } from '../dutyForecast';

// 顺序即优先级
export const sheetParsers: DutySheetParser[] = [
  drillTableParser,
  roleTableParser,
  matrixTableParser
];

export function findSheetParser(ctx: SheetParseContext): DutySheetParser | undefined {
  return sheetParsers.find((p) => p.canHandle(ctx));
}

/**
 * 解析排班表 Excel 文件（支持多 sheet、多种日期表头格式、多段式表头）
 * @param file 上传的 .xlsx/.xls 文件
 */
export async function parseDutyExcelFile(file: File): Promise<DutyParseResult> {
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { type: 'array', cellDates: false });

  const allShifts: DutyShift[] = [];
  const allDrills: DutyDrill[] = [];
  const allRoles: DutyRoleAssignment[] = [];
  const personSet = new Set<string>();
  const shiftCountByType: Record<string, number> = {};
  const parsedSheets: string[] = [];
  let minDateStr = '';
  let maxDateStr = '';

  const defaultYear = new Date().getFullYear();
  const defaultMonth = new Date().getMonth() + 1;
  const baseName = file.name.replace(/\.xlsx?$/i, '');

  // 演练表候选：多张时取最后一张（通常为最新版本，避免历史版本重复合并）
  const drillCandidates: Array<{ sheetName: string; rows: any[][] }> = [];

  // 遍历所有工作表
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    if (!ws) continue;
    const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
    if (!rows.length) continue;

    const ctx: SheetParseContext = { rows, sheetName, defaultYear, defaultMonth };
    const parser = findSheetParser(ctx);
    if (!parser) continue; // 非排班/岗位/演练表（如「规律提取」），跳过

    // 演练表：延后统一处理（需取最后一张表名含「工程师抽检」的）
    if (parser.id === drillTableParser.id) {
      if (sheetName.includes('工程师抽检')) drillCandidates.push({ sheetName, rows });
      continue;
    }

    const out = parser.parse(ctx);

    if (out.shifts.length > 0) {
      for (const s of out.shifts) {
        allShifts.push(s);
        if (!minDateStr || s.date < minDateStr) minDateStr = s.date;
        if (!maxDateStr || s.date > maxDateStr) maxDateStr = s.date;
      }
      for (const [k, v] of Object.entries(out.shiftCountByType)) {
        shiftCountByType[k] = (shiftCountByType[k] || 0) + v;
      }
      parsedSheets.push(sheetName);
    }

    if (out.roles.length > 0) {
      allRoles.push(...out.roles);
      parsedSheets.push(`${sheetName}(岗位)`);
    }

    for (const p of out.people) personSet.add(p);
  }

  // 解析演练计划 sheet（取最后一张表名含「工程师抽检」的演练表）
  if (drillCandidates.length > 0) {
    const last = drillCandidates[drillCandidates.length - 1];
    const drills = parseDrillSheet(last.rows, defaultYear);
    if (drills.length > 0) {
      allDrills.push(...drills);
      parsedSheets.push(`${last.sheetName}(演练)`);
    }
  }

  if (allShifts.length === 0 && allRoles.length === 0) {
    throw new Error('未在文件中识别到任何排班数据');
  }

  // 自动预测值班排表，填满这一年（值班表只是参考，推算全年 1-12 月）
  if (allShifts.length > 0) {
    const year = Number(allShifts[0].date.slice(0, 4)) || defaultYear;
    try {
      const fullYearShifts = fillFullYear(allShifts, year);
      if (fullYearShifts.length > 0) {
        allShifts.push(...fullYearShifts);
        for (const s of fullYearShifts) {
          if (!minDateStr || s.date < minDateStr) minDateStr = s.date;
          if (!maxDateStr || s.date > maxDateStr) maxDateStr = s.date;
        }
      }
    } catch (err) {
      console.warn('[dutyParser] 全年排班推算失败，保留原始排班:', err);
    }
  }

  const dateRange = minDateStr && maxDateStr ? `${minDateStr} ~ ${maxDateStr}` : '';

  return {
    schedule: {
      name: baseName,
      description: `Excel 导入：${parsedSheets.length} 个工作表（${parsedSheets.join('、')}），${personSet.size} 人`,
      shifts: allShifts,
      drills: allDrills.length > 0 ? allDrills : undefined,
      roles: allRoles.length > 0 ? allRoles : undefined
    },
    preview: {
      totalPeople: personSet.size,
      totalDays: new Set(allShifts.map(s => s.date)).size,
      totalShifts: allShifts.length,
      dateRange,
      shiftDistribution: shiftCountByType
    }
  };
}
