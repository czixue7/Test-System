/**
 * 演练抽检计划表解析器
 * 从演练计划 sheet 解析「日期 + 班组 → 演练名称」映射。
 *
 * 演练计划表结构（以"工程师抽检2026 (新)"为例）：
 *   R0  要求说明
 *   R1  班组循环表头：D A B C D A B C ...（参考，可有可无）
 *   R2  "序号 | 专业 | 演练场景 | 月份 | 6月 | ... | 7月 | ..."（月份为合并单元格）
 *   R3  "     |      |          | 日期 | 1 | 2 | 3 | ..."
 *   R4  "     |      |          | 星期 | ..."
 *   R5+ 数据行："1 | 配电 | 机柜单路失电 | 重要 | D | | B | ..."（单元格字母 = 该演练在该日期由该班组执行）
 */
import { DutyDrill } from '../../types';
import { DutySheetParser, SheetParseContext, SheetParseOutput, emptySheetOutput } from './types';

// 定位表头行（含"序号"和"演练场景"）
function findHeaderRow(rows: any[][]): number {
  for (let r = 0; r < Math.min(10, rows.length); r++) {
    const joined = (rows[r] || []).map(c => String(c ?? '').trim()).join('|');
    if (joined.includes('序号') && joined.includes('演练场景')) return r;
  }
  return -1;
}

/**
 * 解析单个演练计划 sheet
 * @param rows sheet 的二维数组
 * @param defaultYear 默认年份（用于没有年份信息时）
 */
export function parseDrillSheet(rows: any[][], defaultYear: number): DutyDrill[] {
  const headerRow = findHeaderRow(rows);
  if (headerRow < 0) return [];

  const headerData = rows[headerRow] || [];
  // 日期行 = 表头行下一行（含"日期"）
  const dateRowIdx = headerRow + 1;
  const dateRow = rows[dateRowIdx] || [];

  // 解析每列的月份（向前填充，处理跨年）
  const monthCols: Array<{ month: number; year: number } | null> = [];
  let curMonth = 0;
  let curYear = defaultYear;
  for (let c = 4; c < headerData.length; c++) {
    const s = String(headerData[c] ?? '').trim();
    const m = s.match(/(\d{1,2})\s*月/);
    if (m) {
      const newMonth = parseInt(m[1], 10);
      if (curMonth > 0 && newMonth < curMonth) curYear++; // 月份回退 → 跨年
      curMonth = newMonth;
    }
    monthCols[c] = curMonth > 0 ? { month: curMonth, year: curYear } : null;
  }

  const drills: DutyDrill[] = [];
  const seen = new Set<string>();

  // 遍历数据行（表头 + 日期行 + 星期行 之后）
  for (let r = dateRowIdx + 2; r < rows.length; r++) {
    const row = rows[r] || [];
    const scene = String(row[2] ?? '').trim();
    if (!scene) continue;

    for (let c = 4; c < row.length; c++) {
      const v = String(row[c] ?? '').trim();
      if (!/^[A-D]$/.test(v)) continue; // 只有 A/B/C/D 字母表示班组

      const info = monthCols[c];
      const day = Number(String(dateRow[c] ?? '').trim());
      if (!info || !info.month || !day || day < 1 || day > 31) continue;

      const dateStr = `${info.year}-${String(info.month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const key = `${dateStr}|${v}|${scene}`;
      if (seen.has(key)) continue;
      seen.add(key);

      drills.push({ date: dateStr, group: v, name: scene });
    }
  }

  return drills;
}

// 判断一个 sheet 是否为演练计划表（含"演练场景"表头）
export function isDrillSheet(rows: any[][]): boolean {
  return findHeaderRow(rows) >= 0;
}

function parseDrill(ctx: SheetParseContext): SheetParseOutput {
  const out = emptySheetOutput();
  out.drills = parseDrillSheet(ctx.rows, ctx.defaultYear);
  return out;
}

export const drillTableParser: DutySheetParser = {
  id: 'drill',
  label: '演练抽检计划表',
  canHandle: (ctx) => isDrillSheet(ctx.rows),
  parse: parseDrill
};
