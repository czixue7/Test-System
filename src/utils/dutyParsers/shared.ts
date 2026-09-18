/**
 * 值班表解析公共工具
 * 各解析器共享的文本判定 / 日期识别 / 姓名提取等纯函数。
 */
import { DutyShiftType } from '../../types';

// 判断班次文本是否为「非当班」状态（休息/请假/离职等），这些不显示为"当班"
export function isRestShiftText(text: string): boolean {
  const s = String(text ?? '').trim();
  if (!s) return false;
  if (['休', '休息', '无', '空', '—', '--', '/', '\\'].includes(s)) return true;
  // 请假 / 离职 / 其他非当班状态
  if (/^(年假|事假|病假|调休|离职|回资产|入职|请假|培训|婚假|产假)/.test(s)) return true;
  return false;
}

// 从班次单元格文本 → DutyShiftType
export function mapShiftTextToType(text: string): DutyShiftType | null {
  if (!text) return null;
  const s = String(text).trim();
  if (!s || s === '-' || s === '/' || s === '\\') return null;

  // 非当班状态 → allday（生成 record，tasks 带原文本，前端据此标注休息/请假）
  if (isRestShiftText(s)) return 'allday';

  // 早班 / 白班（含"常白班"）
  if (s.includes('白') || s.includes('早') || s.toLowerCase() === 'morning') return 'morning';
  // 夜班 / 晚班
  if (s.includes('夜') || s.includes('晚') || s.toLowerCase() === 'night') return 'night';
  // 中班
  if (s.includes('中') || s.toLowerCase() === 'noon') return 'noon';
  // 全天 / 班（单字"班"视为全天）
  if (s.includes('全天') || s === '班' || s.toLowerCase() === 'allday') return 'allday';

  // 兜底：有内容就当全天
  return 'allday';
}

// 从标题文本提取年月
export function extractYearMonth(title: string): { year: number; month: number } | null {
  if (!title) return null;
  // 中文格式：2026年10月
  const cn = title.match(/(\d{4})\s*年\s*(\d{1,2})\s*月/);
  if (cn) return { year: parseInt(cn[1], 10), month: parseInt(cn[2], 10) };
  // 英文格式：2026-10 / 2026/10 / October 2026
  const iso = title.match(/(\d{4})[-/\s]+(\d{1,2})/);
  if (iso) return { year: parseInt(iso[1], 10), month: parseInt(iso[2], 10) };
  return null;
}

export function formatDateStr(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// 日期列描述（含可选完整日期信息）
export interface ParsedDateCol {
  colIdx: number;
  day: number;
  year?: number;
  month?: number;
}

// 检测某一行是否为日期表头行；返回日期列数组，或 null
// 支持两种格式：
//   完整日期：2022/2/1、2022/2/2 ...（旧格式）
//   数字日期：1、2、3 ... 30（新格式）
export function detectDateHeader(row: any[]): ParsedDateCol[] | null {
  if (!row || row.length === 0) return null;

  // 方式1：完整日期 YYYY/M/D
  const fullDates: ParsedDateCol[] = [];
  for (let c = 0; c < row.length; c++) {
    const s = String(row[c] ?? '').trim();
    const m = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})/);
    if (m) {
      fullDates.push({ colIdx: c, day: parseInt(m[3], 10), year: parseInt(m[1], 10), month: parseInt(m[2], 10) });
    } else if (fullDates.length > 0) {
      break; // 连续日期中断
    }
  }
  if (fullDates.length >= 3) return fullDates;

  // 方式2：数字日期 1~31
  const nums: ParsedDateCol[] = [];
  for (let c = 0; c < row.length; c++) {
    const s = String(row[c] ?? '').trim();
    const n = Number(s);
    if (s !== '' && Number.isInteger(n) && n >= 1 && n <= 31) {
      nums.push({ colIdx: c, day: n });
    } else if (nums.length > 0) {
      break;
    }
  }
  // 至少 5 个连续递增数字
  let consec = 1;
  for (let i = 1; i < nums.length; i++) {
    if (nums[i].day === nums[i - 1].day + 1) consec++;
    else consec = 1;
    if (consec >= 5) return nums;
  }
  return null;
}

// 从人员名提取班组字母（A/B/C/D），支持两种格式：
//   前缀：A班值班长-XXX、B值班长-XXX、A班-XXX（"班"字可选，兼容"B值班长"笔误）
//   括号：伍桄乐（A班）电、车雷（D班）暖
export function extractGroupFromName(name: string): string | null {
  const s = String(name ?? '').trim();
  const prefix = s.match(/^([A-D])\s*班?/);
  if (prefix) return prefix[1];
  const bracket = s.match(/[（(]\s*([A-D])\s*班\s*[)）]/);
  if (bracket) return bracket[1];
  return null;
}

// 从人员名提取姓名
//   isFullDateFormat=true（旧格式）：取括号前部分作为名字，去空格
//   isFullDateFormat=false（新格式）：拆分 "-" 取最后一段
export function extractPersonName(name: string, isFullDateFormat: boolean): string {
  const s = String(name ?? '').trim();
  if (isFullDateFormat) {
    const idx = s.search(/[（(]/);
    const base = idx >= 0 ? s.slice(0, idx) : s;
    return base.replace(/\s+/g, '');
  }
  let n = s;
  if (n.includes('-') || n.includes('—') || n.includes('·')) {
    const parts = n.split(/[-—·]/);
    n = parts[parts.length - 1].trim();
  }
  return n.replace(/\s+/g, '');
}

// 从标题行（前3行）提取年月和排班表名
export function extractYearMonthFromTitleRows(rows: any[][]): { year: number; month: number; scheduleName: string } | null {
  for (let r = 0; r < Math.min(3, rows.length); r++) {
    for (const cell of rows[r] || []) {
      const s = String(cell ?? '').trim();
      if (s && s.includes('年') && s.includes('月')) {
        const ym = extractYearMonth(s);
        if (ym) {
          return { year: ym.year, month: ym.month, scheduleName: s.replace(/[（(].*?[)）]/g, '').trim() };
        }
      }
    }
  }
  return null;
}
