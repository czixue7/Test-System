/**
 * 演练抽检计划表解析器
 * 从演练计划 sheet 解析「日期 + 班组 → 演练名称」映射。
 *
 * 演练计划表结构（以"工程师抽检2026 (新)"为例）：
 *   R0  要求说明
 *   R1  班组循环表头：D A B C D A B C ...（参考，可有可无）
 *   R2  "序号 | 专业 | 演练场景 | 月份 | 6月 | ... | 7月 | ..."（月份为合并单元格）
 *   R3  "     |      |          | 日期 | 1 | 2 | 3 | ..."（也可能是 Excel 日期序列号，如 46235 = 2026-08-01）
 *   R4  "     |      |          | 星期 | ..."
 *   R5+ 数据行："1 | 配电 | 机柜单路失电 | 重要 | D | | B | ..."（单元格字母 = 该演练在该日期由该班组执行）
 */
import { DutyDrill } from '../../types';
import { DutySheetParser, SheetParseContext, SheetParseOutput, emptySheetOutput } from './types';

// Excel 日期序列号 → { year, month, day }（1970-01-01 的序列号为 25569）
function excelSerialToDate(serial: number): { year: number; month: number; day: number } | null {
  const dt = new Date(Math.round((serial - 25569) * 86400000));
  if (isNaN(dt.getTime())) return null;
  return { year: dt.getUTCFullYear(), month: dt.getUTCMonth() + 1, day: dt.getUTCDate() };
}

/**
 * 解析「日期」行单元格，兼容多种格式：
 *   - 纯日号（1..31）
 *   - Excel 日期序列号（>31，如 46235 → 2026-08-01），同时还原年/月
 *   - 日期字符串（2026/8/1、2026-08-01、2026年8月1日、8月1日 等）
 * 返回 { year?, month?, day }；无法识别时返回 null。
 */
function parseDateCell(raw: any): { year?: number; month?: number; day: number } | null {
  if (raw === null || raw === undefined) return null;

  if (typeof raw === 'number' && isFinite(raw)) {
    if (Number.isInteger(raw) && raw >= 1 && raw <= 31) return { day: raw };
    if (raw > 31) return excelSerialToDate(raw);
    return null;
  }

  const s = String(raw).trim();
  if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s)) return parseDateCell(Number(s));

  // 2026/8/1、2026-08-01、2026.8.1、2026年8月1日
  const m1 = s.match(/(\d{4})\s*[年/\-.]\s*(\d{1,2})\s*[月/\-.]\s*(\d{1,2})/);
  if (m1) return { year: +m1[1], month: +m1[2], day: +m1[3] };

  // 8月1日 / 8月1
  const m2 = s.match(/(\d{1,2})\s*月\s*(\d{1,2})/);
  if (m2) return { month: +m2[1], day: +m2[2] };

  // 8/1、8-1
  const m3 = s.match(/^(\d{1,2})\s*[/\-.]\s*(\d{1,2})$/);
  if (m3) return { month: +m3[1], day: +m3[2] };

  // 末尾数字作为「日」
  const m4 = s.match(/(\d{1,2})\s*日?\s*$/);
  if (m4) {
    const d = +m4[1];
    if (d >= 1 && d <= 31) return { day: d };
  }
  return null;
}

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
      const dd = parseDateCell(dateRow[c]);
      if (!dd) continue;

      const day = dd.day;
      const month = dd.month ?? info?.month;
      const year = dd.year ?? info?.year;
      if (!month || !year || !day || day < 1 || day > 31) continue;

      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
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
