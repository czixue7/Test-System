/**
 * 矩阵式排班表 Excel 解析器
 * 支持格式参考：世纪珑腾数据中心D7排班表..xlsx
 *
 * 典型结构：
 *   R1-2  (合并) 标题："XX排班表（2026年10月）" → 从中提取年月
 *   R3   表头第1行：序号 | 职务-姓名 | 1 | 2 | 3 | ... | 31
 *   R4   表头第2行：(合并) | (合并) | 周四| 周五| 周六| ...
 *   R5+  数据行：   1 | 机房经理-夏冬 | 休 | 白 | 白 | ...
 */
import * as XLSX from 'xlsx';
import { DutySchedule, DutyShift, DutyShiftType, JsonDutyScheduleData, DutyDrill } from '../types';
import { parseDrillSheet, isDrillSheet } from './drillParser';
import { fillFullYear } from './dutyForecast';

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

export interface ExcelParseResult {
  schedule: Omit<DutySchedule, 'id' | 'createdAt' | 'updatedAt'>;
  preview: {
    totalPeople: number;
    totalDays: number;
    totalShifts: number;
    dateRange: string;
    shiftDistribution: Record<string, number>;
  };
}

// 日期列描述（含可选完整日期信息）
interface ParsedDateCol {
  colIdx: number;
  day: number;
  year?: number;
  month?: number;
}

// 检测某一行是否为日期表头行；返回日期列数组，或 null
// 支持两种格式：
//   完整日期：2022/2/1、2022/2/2 ...（旧格式）
//   数字日期：1、2、3 ... 30（新格式）
function detectDateHeader(row: any[]): ParsedDateCol[] | null {
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
function extractGroupFromName(name: string): string | null {
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
function extractPersonName(name: string, isFullDateFormat: boolean): string {
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
function extractYearMonthFromTitleRows(rows: any[][]): { year: number; month: number; scheduleName: string } | null {
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

function formatDateStr(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * 解析排班表 Excel 文件（支持多 sheet、多种日期表头格式、多段式表头）
 * @param file 上传的 .xlsx/.xls 文件
 */
export async function parseDutyExcelFile(file: File): Promise<ExcelParseResult> {
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { type: 'array', cellDates: false });

  const allShifts: DutyShift[] = [];
  const allDrills: DutyDrill[] = [];
  const personSet = new Set<string>();
  const shiftCountByType: Record<string, number> = {};
  const parsedSheets: string[] = [];
  let minDateStr = '';
  let maxDateStr = '';
  let drillSheetName: string | null = null;
  let drillSheetRows: any[][] | null = null;

  const defaultYear = new Date().getFullYear();
  const defaultMonth = new Date().getMonth() + 1;
  const baseName = file.name.replace(/\.xlsx?$/i, '');

  // 遍历所有工作表
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    if (!ws) continue;
    const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
    if (!rows.length) continue;

    // 优先判断是否为演练计划 sheet（含"演练场景"表头）
    // 演练表:表名含「工程师抽检」即候选;多张时取最后一张(通常为最新版本,避免历史版本重复合并)
    if (isDrillSheet(rows)) {
      if (sheetName.includes('工程师抽检')) {
        drillSheetName = sheetName;
        drillSheetRows = rows;
      }
      continue;
    }

    // 找出该 sheet 中所有日期表头行（支持多段式，如旧格式上半月/下半月）
    const headerRows: number[] = [];
    for (let r = 0; r < rows.length; r++) {
      if (detectDateHeader(rows[r])) headerRows.push(r);
    }
    if (headerRows.length === 0) continue; // 非排班表，跳过（如人员名单 sheet）

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

    let sheetShiftCount = 0;

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
        personSet.add(personName);

        for (const dc of dateCols) {
          const rawShift = String(row[dc.colIdx] ?? '').trim();
          const type = mapShiftTextToType(rawShift);
          if (!type) continue;

          const dateStr = formatDateStr(year, month, dc.day);
          allShifts.push({
            id: `xls-${sheetName}-${r}-${dc.colIdx}-${Math.random().toString(36).slice(2, 7)}`,
            date: dateStr,
            shiftType: type,
            tasks: [rawShift],
            personInCharge: personName,
            group: currentGroup
          });
          shiftCountByType[type] = (shiftCountByType[type] || 0) + 1;
          sheetShiftCount++;

          if (!minDateStr || dateStr < minDateStr) minDateStr = dateStr;
          if (!maxDateStr || dateStr > maxDateStr) maxDateStr = dateStr;
        }
      }
    }

    if (sheetShiftCount > 0) parsedSheets.push(sheetName);
  }

  // 解析演练计划 sheet(取最后一张表名含「工程师抽检」的演练表)
  if (drillSheetRows) {
    const drills = parseDrillSheet(drillSheetRows, defaultYear);
    if (drills.length > 0) {
      allDrills.push(...drills);
      parsedSheets.push(`${drillSheetName}(演练)`);
    }
  }

  if (allShifts.length === 0) throw new Error('未在文件中识别到任何排班数据');

  // 自动预测值班排表，填满这一年（值班表只是参考，推算全年 1-12 月）
  const year = Number(allShifts[0].date.slice(0, 4)) || defaultYear;
  try {
    const fullYearShifts = fillFullYear(allShifts, year);
    if (fullYearShifts.length > 0) {
      allShifts.push(...fullYearShifts);
    }
  } catch (err) {
    console.warn('[dutyParser] 全年排班推算失败，保留原始排班:', err);
  }

  const dateRange = minDateStr && maxDateStr ? `${minDateStr} ~ ${maxDateStr}` : '';

  return {
    schedule: {
      name: baseName,
      description: `Excel 导入：${parsedSheets.length} 个工作表（${parsedSheets.join('、')}），${personSet.size} 人`,
      shifts: allShifts,
      drills: allDrills.length > 0 ? allDrills : undefined
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

/**
 * 解析 JSON 格式值班表（原有逻辑，保留以兼容）
 */
export function parseJsonDutyText(text: string, fileName: string): ExcelParseResult {
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
    notes: s.notes
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
