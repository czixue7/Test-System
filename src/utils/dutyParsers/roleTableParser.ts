/**
 * 岗位（角色）排班表解析器
 * 支持「夜班角色排班」这类按岗位拆分人员的表格。
 *
 * 典型结构：
 *   R0  标题："C组 · 夜班岗位角色排班表（2026年9月—12月）"
 *   R2  表头：日期 | 星期 | 班组 | 值班长 | 配电 | 柴发 | 暖通① | 暖通② | 规则位
 *   R3+ 数据：9/17 | 周四 | C班 | 徐森 | 廖孝鑫 | 董正午 | 欧武扬 | 祝坤 | 1
 *
 * 解析产物：DutyRoleAssignment[]（日期 + 班组 → 值班长 + 岗位划分）。
 * 「规律提取」「附录」等非数据行（日期无法识别）自动跳过。
 */
import { DutyRolePost, DutyShiftType } from '../../types';
import { DutySheetParser, SheetParseContext, SheetParseOutput, emptySheetOutput } from './types';
import { extractGroupFromName, formatDateStr, isRestShiftText, mapShiftTextToType } from './shared';

// 表头保留列（非岗位列）
const RESERVED_HEADERS = new Set([
  '日期', '星期', '班组', '班次', '班型', '值班长', '规则位', '备注', '说明', '序号'
]);

// 找到岗位表表头行：同一行同时出现「配电」「柴发」
function findRoleHeaderRow(rows: any[][]): number {
  for (let r = 0; r < Math.min(10, rows.length); r++) {
    const joined = (rows[r] || []).map((c) => String(c ?? '').trim());
    if (joined.includes('配电') && joined.includes('柴发')) return r;
  }
  return -1;
}

export function isRoleTable(ctx: SheetParseContext): boolean {
  return findRoleHeaderRow(ctx.rows) >= 0;
}

// 解析岗位表中的日期：支持 9/17、2026/9/17、9-17、2026-09-17、9月17日
function parseRoleDate(value: string): { year?: number; month: number; day: number } | null {
  const s = String(value ?? '').trim();
  let m = s.match(/^(\d{4})\s*[\/\-年.]\s*(\d{1,2})\s*[\/\-月.]\s*(\d{1,2})/);
  if (m) return { year: parseInt(m[1], 10), month: parseInt(m[2], 10), day: parseInt(m[3], 10) };
  m = s.match(/^(\d{1,2})\s*[\/\-月.]\s*(\d{1,2})/);
  if (m) return { month: parseInt(m[1], 10), day: parseInt(m[2], 10) };
  return null;
}

function parseRoleSheet(ctx: SheetParseContext): SheetParseOutput {
  const { rows, defaultYear } = ctx;
  const out = emptySheetOutput();

  const headerRowIdx = findRoleHeaderRow(rows);
  if (headerRowIdx < 0) return out;

  const header = (rows[headerRowIdx] || []).map((c) => String(c ?? '').trim());
  const idxOf = (name: string) => header.indexOf(name);
  const dateCol = idxOf('日期');
  const groupCol = idxOf('班组');
  const leaderCol = idxOf('值班长');
  const shiftCol = header.findIndex((h) => h === '班次' || h === '班型');
  if (dateCol < 0 || groupCol < 0) return out;

  // 岗位列 = 表头非保留列且非空
  const postCols: Array<{ col: number; name: string }> = [];
  for (let c = 0; c < header.length; c++) {
    const h = header[c];
    if (!h || RESERVED_HEADERS.has(h)) continue;
    postCols.push({ col: c, name: h });
  }
  if (postCols.length === 0) return out;

  // 默认班次：岗位表当前仅用于夜班；若有班次列则按值映射覆盖
  const defaultShift: DutyShiftType = 'night';

  let curYear = defaultYear;
  let prevMonth = 0;

  for (let r = headerRowIdx + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const dateCell = String(row[dateCol] ?? '').trim();
    const parsed = parseRoleDate(dateCell);
    if (!parsed) continue; // 说明/附录等非数据行

    // 跨年处理：月份回退视为进入下一年
    if (parsed.year) {
      curYear = parsed.year;
    } else if (prevMonth > 0 && parsed.month < prevMonth) {
      curYear++;
    }
    prevMonth = parsed.month;
    const year = parsed.year || curYear;

    const group = extractGroupFromName(String(row[groupCol] ?? '').trim());
    if (!group) continue;

    const leader = leaderCol >= 0 ? String(row[leaderCol] ?? '').trim() : '';

    let shiftType: DutyShiftType = defaultShift;
    if (shiftCol >= 0) {
      const t = mapShiftTextToType(String(row[shiftCol] ?? '').trim());
      if (t) shiftType = t;
    }

    const posts: DutyRolePost[] = [];
    for (const pc of postCols) {
      const person = String(row[pc.col] ?? '').trim();
      if (!person || isRestShiftText(person)) continue;
      posts.push({ name: pc.name, person });
    }
    if (posts.length === 0) continue;

    const date = formatDateStr(year, parsed.month, parsed.day);
    out.roles.push({
      date,
      group,
      shiftType,
      leader: leader || undefined,
      posts
    });

    if (leader) out.people.push(leader);
    for (const p of posts) out.people.push(p.person);
  }

  return out;
}

export const roleTableParser: DutySheetParser = {
  id: 'role',
  label: '岗位排班表',
  canHandle: isRoleTable,
  parse: parseRoleSheet
};
