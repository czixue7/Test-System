/**
 * 岗位（角色）排班表解析器
 * 支持「夜班岗位角色排班」这类按标签拆分人员的表格。
 *
 * 典型结构：
 *   R0  标题："C组 · 夜班岗位角色排班表（2026年9月—12月）"
 *   R2  表头：日期 | 班组 | 班次 | 值班长 | (左)柴发+一层 | ... | 做表 | 休息
 *   R3+ 数据：9/17 | C | 夜 | 徐森 | 祝坤 | ... | 董正午 | 欧武扬、孙言超、廖孝鑫
 *
 * 解析产物：DutyRoleAssignment[]（日期 + 班组 → 值班长 + 标签划分）。
 * 标签只有三类：巡检区域（patrol）、做表（report）、休息（rest）；
 * 旧表里的配电 / 柴发 / 暖通上 / 暖通下 主岗位列不再作为标签。
 * 「规律提取」「附录」等非数据行（日期无法识别）自动跳过。
 */
import { DutyRolePost, DutyRolePostKind, DutyShiftType } from '../../types';
import { DutySheetParser, SheetParseContext, SheetParseOutput, emptySheetOutput } from './types';
import { extractGroupFromName, formatDateStr, isRestShiftText, mapShiftTextToType } from './shared';

// 表头保留列（非标签列）
const RESERVED_HEADERS = new Set([
  '日期', '星期', '班组', '班次', '班型', '值班长', '规则位', '备注', '说明', '序号'
]);

// 旧主岗位列：不再算作标签（巡检只保留区域列）
const LEGACY_MAIN_POSTS = new Set(['配电', '柴发', '暖通下', '暖通上', '暖通①', '暖通②']);

// 表头 → 标签类型；未命中即巡检区域
function headerKind(name: string): DutyRolePostKind {
  if (name === '做表') return 'report';
  if (name === '休息' || name === '休') return 'rest';
  return 'patrol';
}

// 一个单元格里可能写多人（「欧武扬、孙言超、廖孝鑫」）
function splitPeople(text: string): string[] {
  return String(text ?? '')
    .split(/[、,，;；\s/]+/)
    .map((item) => item.trim())
    .filter((item) => item && !isRestShiftText(item));
}

// 找到岗位表表头行：同时含「日期」和「值班长」，避免误判矩阵排班表 / 演练计划表
function findRoleHeaderRow(rows: any[][]): number {
  for (let r = 0; r < Math.min(10, rows.length); r++) {
    const joined = (rows[r] || []).map((c) => String(c ?? '').trim());
    if (joined.includes('日期') && joined.includes('值班长')) return r;
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

  // 标签列 = 表头非保留列且非空；去掉「副岗位」前缀，只保留标签本身
  const postCols: Array<{ col: number; name: string; kind: DutyRolePostKind }> = [];
  for (let c = 0; c < header.length; c++) {
    const h = header[c];
    if (!h || RESERVED_HEADERS.has(h) || LEGACY_MAIN_POSTS.has(h)) continue;
    const name = h.replace(/^副岗位\s*/, '').trim();
    if (!name) continue;
    postCols.push({ col: c, name, kind: headerKind(name) });
  }
  if (postCols.length === 0) return out;

  // 无班次列时保留历史默认值；有班次列则按表格映射。展示不按此字段限制白夜班。
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
      // 休息列一格可写多人，每个休息人员各生成一个标签
      const people = pc.kind === 'rest'
        ? splitPeople(String(row[pc.col] ?? ''))
        : splitPeople(String(row[pc.col] ?? '')).slice(0, 1);
      for (const person of people) posts.push({ name: pc.name, person, kind: pc.kind });
    }
    if (posts.length === 0 && !leader) continue;

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
