/**
 * 矩阵式排班表解析器
 * 支持格式参考：世纪珑腾数据中心D7排班表..xlsx
 *
 * 典型结构：
 *   R1-2  (合并) 标题："XX排班表（2026年10月）" → 从中提取年月
 *   R3   表头第1行：序号 | 职务-姓名 | 1 | 2 | 3 | ... | 31
 *   R4   表头第2行：(合并) | (合并) | 周四| 周五| 周六| ...
 *   R5+  数据行：   1 | 机房经理-夏冬 | 休 | 白 | 白 | ...
 */
import { DutyShift } from '../../types';
import { DutySheetParser, SheetParseContext, SheetParseOutput, emptySheetOutput } from './types';
import {
  detectDateHeader,
  extractGroupFromName,
  extractPersonName,
  extractYearMonthFromTitleRows,
  formatDateStr,
  mapShiftTextToType
} from './shared';

export function isMatrixTable(ctx: SheetParseContext): boolean {
  return ctx.rows.some((row) => detectDateHeader(row) !== null);
}

function parseMatrixSheet(ctx: SheetParseContext): SheetParseOutput {
  const { rows, sheetName, defaultYear, defaultMonth } = ctx;
  const out = emptySheetOutput();

  // 找出该 sheet 中所有日期表头行（支持多段式，如旧格式上半月/下半月）
  const headerRows: number[] = [];
  for (let r = 0; r < rows.length; r++) {
    if (detectDateHeader(rows[r])) headerRows.push(r);
  }
  if (headerRows.length === 0) return out;

  // 提取年月：优先从完整日期表头，否则从标题
  let year = defaultYear;
  let month = defaultMonth;
  const firstHeader = detectDateHeader(rows[headerRows[0]])!;
  if (firstHeader[0].year && firstHeader[0].month) {
    year = firstHeader[0].year!;
    month = firstHeader[0].month!;
  } else {
    const fromTitle = extractYearMonthFromTitleRows(rows);
    if (fromTitle) { year = fromTitle.year; month = fromTitle.month; }
  }

  // 逐段解析（每个日期表头段：表头行 ~ 下一个表头行之间的数据行）
  for (let bi = 0; bi < headerRows.length; bi++) {
    const headerRowIdx = headerRows[bi];
    const nextHeaderRowIdx = bi + 1 < headerRows.length ? headerRows[bi + 1] : rows.length;
    const dateCols = detectDateHeader(rows[headerRowIdx])!;
    if (!dateCols.length) continue;

    // 人员列 = 第一个日期列的前一列
    const personColIdx = dateCols[0].colIdx - 1;
    if (personColIdx < 0) continue;

    const isFullDateFormat = !!dateCols[0].year;
    let currentGroup = ''; // 当前班组，空字符串为长白班

    for (let r = headerRowIdx + 1; r < nextHeaderRowIdx; r++) {
      const row = rows[r];
      if (!row || row.length === 0) continue;

      const personRaw = String(row[personColIdx] ?? '').trim();
      if (!personRaw) continue;
      // 过滤非数据行
      if (/^(合计|总计|备注|说明|序号|职务|星期|日期|人员)/.test(personRaw)) continue;

      const groupFromName = extractGroupFromName(personRaw);
      if (groupFromName) currentGroup = groupFromName;

      const personName = extractPersonName(personRaw, isFullDateFormat);
      if (!personName) continue;
      out.people.push(personName);

      for (const dc of dateCols) {
        const rawShift = String(row[dc.colIdx] ?? '').trim();
        const type = mapShiftTextToType(rawShift);
        if (!type) continue;

        const dateStr = formatDateStr(year, month, dc.day);
        out.shifts.push({
          id: `xls-${sheetName}-${r}-${dc.colIdx}-${Math.random().toString(36).slice(2, 7)}`,
          date: dateStr,
          shiftType: type,
          tasks: [rawShift],
          personInCharge: personName,
          group: currentGroup
        });
        out.shiftCountByType[type] = (out.shiftCountByType[type] || 0) + 1;
      }
    }
  }

  return out;
}

export const matrixTableParser: DutySheetParser = {
  id: 'matrix',
  label: '矩阵排班表',
  canHandle: isMatrixTable,
  parse: parseMatrixSheet
};
