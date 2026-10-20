/**
 * 值班表解析器统一出口
 *
 * 文件划分（一种表格解析方式 = 一份代码文件）：
 *   - types.ts             公共类型与解析器接口
 *   - shared.ts            公共纯函数（文本判定 / 日期识别 / 姓名提取）
 *   - workbookParser.ts    Excel 工作簿协调器（遍历工作表并分发）
 *   - matrixTableParser.ts 矩阵排班表解析
 *   - roleTableParser.ts   岗位（角色）排班表解析
 *   - drillTableParser.ts  演练抽检计划表解析
 *   - jsonTableParser.ts   JSON 值班表解析（与表格解析完全独立）
 */
export { parseDutyExcelFile, findSheetParser, sheetParsers } from './workbookParser';
export { parseJsonDutyText } from './jsonTableParser';
export { matrixTableParser } from './matrixTableParser';
export { roleTableParser } from './roleTableParser';
export { drillTableParser, parseDrillSheet, isDrillSheet } from './drillTableParser';
export { isRestShiftText, mapShiftTextToType, extractYearMonth } from './shared';
export type {
  DutyParseResult,
  DutyParsePreview,
  DutySheetParser,
  SheetParseContext,
  SheetParseOutput
} from './types';
