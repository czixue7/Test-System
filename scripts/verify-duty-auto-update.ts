import assert from 'node:assert/strict';

const saved = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: (key: string) => saved.get(key) ?? null,
  setItem: (key: string, value: string) => saved.set(key, value),
  removeItem: (key: string) => saved.delete(key),
} });
(globalThis as any).window = new EventTarget();
const { mergePublishedDuty } = await import('../src/utils/dutyAutoUpdate');

const shift = (date: string) => ({ id: date, date, shiftType: 'night', tasks: ['夜'], personInCharge: '甲', group: 'C' });
const base = {
  id: 'local', name: '排班表', createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z',
  shifts: [shift('2026-11-01')],
  drills: [
    { date: '2026-11-01', group: 'C', name: '旧演练A' },
    { date: '2026-11-02', group: 'C', name: '旧演练B' },
    { date: '2026-11-03', group: 'C', name: '旧演练C' },
  ],
  roles: [
    { date: '2026-11-01', group: 'C', shiftType: 'night', posts: [] },
    { date: '2026-11-02', group: 'C', shiftType: 'night', posts: [] },
  ],
  sourceDrills: [
    { date: '2026-11-01', group: 'C', name: '旧演练A' },
    { date: '2026-11-02', group: 'C', name: '旧演练B' },
    { date: '2026-11-03', group: 'C', name: '旧演练C' },
  ],
  sourceRoles: [
    { date: '2026-11-01', group: 'C', shiftType: 'night', posts: [] },
    { date: '2026-11-02', group: 'C', shiftType: 'night', posts: [] },
  ],
};
const local = { ...structuredClone(base), locallyEdited: true };
// 用户改过 A、删掉 C；B / 岗位未改，应跟随远端
local.drills = [
  { date: '2026-11-01', group: 'C', name: '本地改过的演练A' },
  { date: '2026-11-02', group: 'C', name: '旧演练B' },
];
local.roles = [
  { date: '2026-11-01', group: 'C', shiftType: 'night', posts: [{ name: '柴发', person: '本地人员', kind: 'patrol' }] },
  { date: '2026-11-02', group: 'C', shiftType: 'night', posts: [] },
];
const published = {
  name: '排班表', shifts: [shift('2026-11-04')],
  drills: [
    { date: '2026-11-01', group: 'C', name: '远端新演练A' },
    { date: '2026-11-02', group: 'C', name: '远端新演练B' },
    { date: '2026-11-03', group: 'C', name: '远端新演练C' },
    { date: '2026-11-04', group: 'C', name: '远端新增演练D' },
  ],
  roles: [
    { date: '2026-11-01', group: 'C', shiftType: 'night', posts: [{ name: '柴发', person: '远端人员', kind: 'patrol' }] },
    { date: '2026-11-02', group: 'C', shiftType: 'night', posts: [{ name: '柴发', person: '远端人员2', kind: 'patrol' }] },
  ],
} as any;

const merged = mergePublishedDuty(local as any, published);
assert.equal(merged.shifts?.[0].date, '2026-11-04', '班次应整体覆盖为发布版本');
const drills = new Map((merged.drills || []).map(item => [`${item.date}|${item.group}`, item.name]));
assert.equal(drills.get('2026-11-01|C'), '本地改过的演练A', '用户改过的标注应保留');
assert.equal(drills.get('2026-11-02|C'), '远端新演练B', '用户未改的条目应跟随发布版本');
assert(!drills.has('2026-11-03|C'), '用户删除过的标注不应恢复');
assert.equal(drills.get('2026-11-04|C'), '远端新增演练D', '发布版本新增的标注应导入');
const roles = new Map((merged.roles || []).map(item => [`${item.date}|${item.group}|${item.shiftType}`, item.posts[0]?.person]));
assert.equal(roles.get('2026-11-01|C|night'), '本地人员', '用户改过的岗位标注应保留');
assert.equal(roles.get('2026-11-02|C|night'), '远端人员2', '用户未改的岗位应跟随发布版本');

// 旧记录没有发布基准时：本地标注优先，不能因自动更新丢失
const legacyMerged = mergePublishedDuty({ ...base, locallyEdited: true, sourceDrills: undefined, sourceRoles: undefined } as any, published);
assert.equal(legacyMerged.drills?.filter(item => item.date === '2026-11-01')[0].name, '旧演练A');
assert.equal(legacyMerged.drills?.filter(item => item.date === '2026-11-04')[0].name, '远端新增演练D');
const legacyUnedited = mergePublishedDuty({ ...base, sourceDrills: undefined, sourceRoles: undefined } as any, published);
assert.deepEqual(legacyUnedited.roles, published.roles, '未编辑的旧排班应采用发布的巡检人员和分区');

// 旧数据没有来源标记时，按名称唯一匹配发布版本完成认领
const { findPublishedDuty } = await import('../src/utils/dutyScheduleIndex');
const index = {
  version: '1', generatedAt: '',
  systemDuties: [],
  userDuties: [{
    name: '排班表', filename: 'service:abc:排班表.xlsx', sha: 'a'.repeat(64),
    size: 1, updatedAt: 1, downloadUrl: '', sourceId: 'svc',
  }],
} as any;
const adopted = findPublishedDuty(index, { name: '排班表' } as any);
assert.equal(adopted?.item.filename, 'service:abc:排班表.xlsx', '无来源标记的旧表应按唯一名称认领');
assert.equal(adopted?.source, 'user');
const ambiguous = {
  ...index,
  userDuties: [...index.userDuties, { ...index.userDuties[0], filename: 'service:xyz:排班表.xlsx' }],
};
assert.equal(findPublishedDuty(ambiguous, { name: '排班表' } as any), null, '同名发布版本不唯一时不应认领');
assert.equal(
  findPublishedDuty(ambiguous, { name: '排班表', sourceFilename: 'service:xyz:排班表.xlsx', sourceType: 'user' } as any)?.item.filename,
  'service:xyz:排班表.xlsx',
  '已有来源标记时按文件名精确匹配',
);

console.log('✓ 值班表自动更新：覆盖班次、保留用户改过/删除的标注、未改条目跟随发布版本');
console.log('✓ 旧值班表认领：名称唯一时匹配发布版本，同名多条不误替换，已有来源标记按文件名匹配');
