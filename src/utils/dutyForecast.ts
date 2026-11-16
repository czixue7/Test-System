/**
 * 值班表推算工具
 * 根据已有排班，排除调休班次，判断各班组基准轮转规律（白→夜→休→休，4 天周期），
 * 自动循环生成未来/全年排班。
 */
import { DutyRoleAssignment, DutyRolePost, DutyShift, DutyShiftType } from '../types';
import { dutyPostKind, roleShiftCategory } from './dutyRoleEdits';

// 日期字符串 → 绝对天数（UTC，避免时区影响）
function dateToDayNumber(dateStr: string): number {
  const parts = String(dateStr).split('-').map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) return NaN;
  return Math.round(Date.UTC(parts[0], parts[1] - 1, parts[2]) / 86400000);
}

// 绝对天数 → 日期字符串
function dayNumberToDate(dn: number): string {
  const d = new Date(dn * 86400000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// 班次 → 白 / 夜 / 休 三类
function shiftToType(s: DutyShift): '白' | '夜' | '休' {
  const t = (s.tasks || []).join('');
  // 非当班（休/请假/离职等）
  if (/休|假|离|事|回资产|入职|培训/.test(t)) return '休';
  if (s.shiftType === 'night' || t.includes('夜')) return '夜';
  return '白';
}

interface ForecastModel {
  groupPhase: Map<string, number>;      // group -> 白班相位（dayNumber % 4）
  groupMembers: Map<string, Set<string>>; // group -> 成员名集合
  groups: string[];
}

// 提取班组的白班相位和成员（核心模型，排除调休）
function buildModel(shifts: DutyShift[]): ForecastModel {
  const groups = new Set<string>();
  const groupMembers = new Map<string, Set<string>>();
  for (const s of shifts) {
    if (!s.group) continue;
    groups.add(s.group);
    if (s.personInCharge) {
      if (!groupMembers.has(s.group)) groupMembers.set(s.group, new Set());
      groupMembers.get(s.group)!.add(s.personInCharge);
    }
  }
  if (groups.size === 0) throw new Error('无班组数据，无法推算（请确认排班表含 A/B/C/D 班组）');

  // 按班组聚合每天状态（多数投票，排除少数调休）
  const raw = new Map<string, Map<number, Record<'白' | '夜' | '休', number>>>();
  for (const s of shifts) {
    if (!s.group) continue;
    const dn = dateToDayNumber(s.date);
    if (isNaN(dn)) continue;
    const type = shiftToType(s);
    if (!raw.has(s.group)) raw.set(s.group, new Map());
    const dayMap = raw.get(s.group)!;
    if (!dayMap.has(dn)) dayMap.set(dn, { 白: 0, 夜: 0, 休: 0 });
    dayMap.get(dn)![type]++;
  }

  // 判断每个班组的白班相位（白班日的 dayNumber % 4，取众数）
  const groupPhase = new Map<string, number>();
  for (const group of groups) {
    const dayMap = raw.get(group);
    if (!dayMap) continue;
    const phaseCount = new Map<number, number>();
    for (const [dn, cnt] of dayMap) {
      if (cnt.白 > 0 && cnt.白 >= cnt.夜 && cnt.白 >= cnt.休) {
        const p = ((dn % 4) + 4) % 4;
        phaseCount.set(p, (phaseCount.get(p) || 0) + 1);
      }
    }
    let bestP = 0;
    let bestN = -1;
    for (const [p, n] of phaseCount) {
      if (n > bestN) { bestN = n; bestP = p; }
    }
    groupPhase.set(group, bestP);
  }

  return { groupPhase, groupMembers, groups: Array.from(groups) };
}

// 生成某一天（绝对天数）的值班 shifts
function generateDay(model: ForecastModel, dn: number, seqRef: { n: number }): DutyShift[] {
  const p = ((dn % 4) + 4) % 4;
  const dateStr = dayNumberToDate(dn);
  const result: DutyShift[] = [];

  for (const group of model.groups) {
    const pg = model.groupPhase.get(group);
    if (pg === undefined) continue;

    let type: '白' | '夜' | '休';
    if (pg === p) type = '白';
    else if ((pg + 1) % 4 === p) type = '夜';
    else type = '休';

    const members = model.groupMembers.get(group);
    if (!members) continue;

    for (const name of members) {
      result.push({
        id: `fc-${dn}-${group}-${seqRef.n++}`,
        date: dateStr,
        shiftType: (type === '夜' ? 'night' : type === '白' ? 'morning' : 'allday') as DutyShiftType,
        tasks: type === '白' ? ['白'] : type === '夜' ? ['夜'] : ['休'],
        personInCharge: name,
        group
      });
    }
  }
  return result;
}

export interface ForecastResult {
  shifts: DutyShift[];
  roles: DutyRoleAssignment[]; // 延续岗位划分（做表 / 休息 / 巡检轮换）
  fromDate: string;   // 推算起始日期（最后一天 + 1）
  endDate: string;    // 推算截止日期
  totalDays: number;  // 推算天数
  groups: string[];   // 参与推算的班组
}

// 岗位划分的延续模型：全部从已有岗位表反推，不写死人员姓名。
interface RoleModel {
  group: string;
  leader?: string;
  leaderLabel?: string;
  patrolNames: string[];   // 巡检列顺序
  patrolLast: string[];    // 最后一个班次各巡检列的人员
  reportCycle: string[];   // 做表人员轮换顺序
  reportLast: string;      // 最后一个班次的做表人员
  restSets: string[][];    // 观察到的两组轮休名单
  restLast: string[];      // 最后一个班次的轮休人员
}

const postText = (name: string) => (name || '').replace(/^副岗位\s*/, '').trim();
const setKey = (people: string[]) => [...people].sort().join('|');
const byDate = (a: DutyRoleAssignment, b: DutyRoleAssignment) => a.date.localeCompare(b.date);

// 从已有岗位划分里提取每个班组（白/夜分开）的轮换规律
function buildRoleModels(roles: DutyRoleAssignment[]): RoleModel[] {
  const byGroup = new Map<string, DutyRoleAssignment[]>();
  for (const role of roles) {
    const key = `${role.group}|${roleShiftCategory(role.shiftType)}`;
    byGroup.set(key, [...(byGroup.get(key) || []), role]);
  }

  const models: RoleModel[] = [];
  for (const list of byGroup.values()) {
    const sorted = [...list].sort(byDate);
    const last = sorted[sorted.length - 1];

    const patrolPosts = last.posts.filter((p) => dutyPostKind(p.name) === 'patrol');
    const reportCycle: string[] = [];
    for (const role of sorted) {
      for (const post of role.posts) {
        if (dutyPostKind(post.name) !== 'report' || !post.person) continue;
        if (!reportCycle.includes(post.person)) reportCycle.push(post.person);
      }
    }

    // 轮休名单只有两组，从最近几行里取，避免把历史临时调整当成规律
    const restSets: string[][] = [];
    for (const role of [...sorted].reverse()) {
      const rest = role.posts.filter((p) => dutyPostKind(p.name) === 'rest').map((p) => p.person);
      if (rest.length && !restSets.some((s) => setKey(s) === setKey(rest))) restSets.push(rest);
      if (restSets.length === 2) break;
    }

    if (!patrolPosts.length || reportCycle.length === 0) continue;
    models.push({
      group: last.group,
      leader: last.leader,
      leaderLabel: last.leaderLabel,
      patrolNames: patrolPosts.map((p) => postText(p.name)),
      patrolLast: patrolPosts.map((p) => p.person),
      reportCycle,
      reportLast: last.posts.find((p) => dutyPostKind(p.name) === 'report')?.person || '',
      restSets,
      restLast: last.posts.filter((p) => dutyPostKind(p.name) === 'rest').map((p) => p.person),
    });
  }
  return models;
}

// 按规律为未来的夜班生成岗位划分：做表顺延一人、轮休换到另一组、巡检区域整体左移一位。
// 输出的岗位始终按「最后一个班次的人员顺序」排列：轮换的是巡检区域标签，
// 人员行位置保持固定，避免名单在表格里逐日跳动。
function forecastRoles(models: RoleModel[], forecastShifts: DutyShift[]): DutyRoleAssignment[] {
  const nights = new Map<string, string[]>();
  for (const shift of forecastShifts) {
    if (shift.shiftType !== 'night' || !shift.group) continue;
    const list = nights.get(shift.group) || [];
    if (!list.includes(shift.date)) list.push(shift.date);
    nights.set(shift.group, list);
  }

  const out: DutyRoleAssignment[] = [];
  for (const model of models) {
    const dates = (nights.get(model.group) || []).sort();
    if (!dates.length) continue;

    let patrol = [...model.patrolLast];
    let rest = [...model.restLast];
    let reportIndex = model.reportCycle.indexOf(model.reportLast);
    const personOrder = new Map<string, number>();
    model.patrolLast.forEach((person, index) => {
      if (person && !personOrder.has(person)) personOrder.set(person, index);
    });

    for (const date of dates) {
      reportIndex = (reportIndex + 1) % model.reportCycle.length;
      const report = model.reportCycle[reportIndex];

      if (model.restSets.length > 1) {
        const other = model.restSets.find((s) => setKey(s) !== setKey(rest));
        if (other) rest = [...other];
      }
      patrol = [...patrol.slice(1), patrol[0]];

      const posts: DutyRolePost[] = [
        ...model.patrolNames.map((name, i) => ({ name, person: patrol[i] || '', kind: 'patrol' as const })),
        { name: '做表', person: report, kind: 'report' as const },
        ...rest.map((person) => ({ name: '休息', person, kind: 'rest' as const })),
      ].filter((post) => post.person).sort((a, b) =>
        (personOrder.get(a.person) ?? Number.MAX_SAFE_INTEGER) - (personOrder.get(b.person) ?? Number.MAX_SAFE_INTEGER));

      out.push({
        date,
        group: model.group,
        shiftType: 'night',
        leader: model.leader,
        leaderLabel: model.leaderLabel,
        posts,
      });
    }
  }
  return out;
}

/**
 * 按已有岗位划分的规律，为「最后一个岗位划分日期之后」的夜班生成岗位划分。
 * 导入 Excel 补全全年班次时使用，避免出现有班次却没有做表/休息的情况。
 */
export function continueDutyRoles(roles: DutyRoleAssignment[], futureShifts: DutyShift[]): DutyRoleAssignment[] {
  if (!roles.length) return [];
  const lastRoleDate = roles.reduce((max, role) => (role.date > max ? role.date : max), roles[0].date);
  const laterShifts = futureShifts.filter((shift) => shift.date > lastRoleDate);
  if (!laterShifts.length) return [];
  return forecastRoles(buildRoleModels(roles), laterShifts);
}

/**
 * 根据已有排班推算未来排班
 * @param shifts 已有排班（含班组 group 字段）
 * @param endDate 推算截止日期（YYYY-MM-DD）
 * @param roles 已有岗位划分，用于延续做表 / 轮休 / 巡检轮换
 */
export function generateDutyForecast(shifts: DutyShift[], endDate: string, roles: DutyRoleAssignment[] = []): ForecastResult {
  const model = buildModel(shifts);

  const validDays = shifts.map(s => dateToDayNumber(s.date)).filter(d => !isNaN(d));
  if (validDays.length === 0) throw new Error('无有效日期数据');
  const lastDay = Math.max(...validDays);
  const endDay = dateToDayNumber(endDate);
  if (isNaN(endDay)) throw new Error('截止日期无效');
  if (endDay <= lastDay) {
    return { shifts: [], roles: [], fromDate: '', endDate, totalDays: 0, groups: model.groups };
  }

  const forecast: DutyShift[] = [];
  const seqRef = { n: 0 };
  for (let dn = lastDay + 1; dn <= endDay; dn++) {
    forecast.push(...generateDay(model, dn, seqRef));
  }

  return {
    shifts: forecast,
    roles: forecastRoles(buildRoleModels(roles), forecast),
    fromDate: dayNumberToDate(lastDay + 1),
    endDate,
    totalDays: endDay - lastDay,
    groups: model.groups
  };
}

/**
 * 根据已有排班（参考）推算并填满整年的值班表。
 * 已有排班日期保留原样（含调休），缺失日期按轮转规律推算。
 * @param shifts 已有排班（如某一个月）
 * @param year 目标年份（如 2026）
 * @returns 补全的推算 shifts（不含已有日期）
 */
export function fillFullYear(shifts: DutyShift[], year: number): DutyShift[] {
  const model = buildModel(shifts);

  const yearStart = dateToDayNumber(`${year}-01-01`);
  const yearEnd = dateToDayNumber(`${year}-12-31`);
  if (isNaN(yearStart) || isNaN(yearEnd)) throw new Error('年份无效');

  // 已有日期集合（这些日期保留原样，不推算）
  const existingDates = new Set<string>(shifts.map(s => s.date));

  const generated: DutyShift[] = [];
  const seqRef = { n: 0 };
  for (let dn = yearStart; dn <= yearEnd; dn++) {
    const dateStr = dayNumberToDate(dn);
    if (existingDates.has(dateStr)) continue; // 已有日期跳过
    generated.push(...generateDay(model, dn, seqRef));
  }

  return generated;
}
