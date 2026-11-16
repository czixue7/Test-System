import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as XLSX from 'xlsx';

const saved = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: (key: string) => saved.get(key) ?? null,
  setItem: (key: string, value: string) => saved.set(key, value),
  removeItem: (key: string) => saved.delete(key),
} });
(globalThis as any).window = new EventTarget();
const { useDataSourceStore: sources } = await import('../src/store/dataSourceStore');
const { useDutyScheduleStore: duties } = await import('../src/store/dutyScheduleStore');
const { downloadPublishedDuty } = await import('../src/utils/publishedDuty');
const { parseDutyExcelFile } = await import('../src/utils/dutyParsers');
const { fetchDutyIndex } = await import('../src/utils/dutyScheduleIndex');
const { syncDataNow } = await import('../src/utils/dataSync');
const { contentHash } = await import('../src/utils/questionBankSync');

const workbook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
  ['2026年10月排班表'], ['姓名', ...Array.from({ length: 31 }, (_, i) => `2026-10-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`)],
  ['C组-测试人员', ...Array.from({ length: 31 }, () => '夜')],
]), '2026年10月');
let binary = process.env.DUTY_EXCEL_FIXTURE
  ? new Uint8Array(await readFile(process.env.DUTY_EXCEL_FIXTURE))
  : new Uint8Array(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }));
let item = { name: '排班表', filename: 'duty/排班表.xlsx', downloadUrl: '/files/duty/排班表.xlsx', sha: await contentHash(binary) };
const base = 'https://controlled.test/prefix';
const token = 'controlled-test-token';
sources.getState().configure(base, token, 'unused-personal-space');
for (const entry of sources.getState().sources) if (entry.kind !== 'service') sources.getState().setSourceEnabled(entry.id, false);
duties.setState({ duties: [], isLoaded: true });
let requests: { url: string; init: RequestInit }[] = [];
globalThis.fetch = (async (input: any, init: RequestInit = {}) => {
  const url = String(input);
  requests.push({ url, init });
  assert.equal(new Headers(init.headers).get('Authorization'), `Bearer ${token}`);
  assert.equal(init.method ?? 'GET', 'GET');
  assert(!init.body && !url.includes('/sync/') && !url.includes('unused-personal-space'));
  if (url.endsWith('/duty-index.json')) return Response.json({ systemDuties: [], userDuties: [item] });
  assert(url.startsWith(`${base}/files/duty/`));
  return new Response(new Uint8Array(binary));
}) as typeof fetch;

const local = (await parseDutyExcelFile(new File([new Uint8Array(binary)], '排班表.xlsx'))).schedule;
const normalize = (schedule: typeof local) => ({ name: schedule.name, description: schedule.description,
  shifts: schedule.shifts.map(({ id: _, ...shift }) => shift), drills: schedule.drills, roles: schedule.roles });
const index = await fetchDutyIndex();
assert(index && index.userDuties.length === 1);
const downloaded = await downloadPublishedDuty(index.userDuties[0]);
assert.deepEqual(normalize(downloaded), normalize(local), 'Published Excel must parse identically to local import');
assert(downloaded.shifts.length > 0);
if (!process.env.DUTY_EXCEL_FIXTURE) {
  const october = downloaded.shifts.filter(s => s.date.startsWith('2026-10-'));
  assert.equal(october.length, 31, 'ISO date headers must retain all original daily records');
  assert(october.every(s => s.shiftType === 'night' && s.personInCharge === '测试人员' && s.group === 'C'));
}
sources.getState().setSync('duty', true);
await syncDataNow('public');
assert.equal(duties.getState().duties.length, 1);
assert.deepEqual(normalize(duties.getState().duties[0]), normalize(local));
assert.equal(duties.getState().duties[0].shifts.length, local.shifts.length);
requests = [];
await syncDataNow('public');
assert.equal(requests.length, 1, 'Unchanged Excel must only read the catalog');
assert.equal(duties.getState().duties.length, 1);

const xlsx = binary;
binary = new Uint8Array(XLSX.write(XLSX.read(xlsx, { type: 'array' }), { type: 'buffer', bookType: 'biff8' }));
const legacy = await downloadPublishedDuty({ ...item, filename: 'duty/排班表.xls', downloadUrl: `${base}/files/duty/排班表.xls`, sha: await contentHash(binary) }, token);
assert.deepEqual(normalize(legacy), normalize(local), 'Legacy .xls and .xlsx must use the same import semantics');
binary = xlsx;
const original = duties.getState().duties[0];
duties.getState().updateDuty(original.id, { name: '本机修改' });
const updatedWorkbook = XLSX.read(binary, { type: 'array' });
XLSX.utils.book_append_sheet(updatedWorkbook, XLSX.utils.aoa_to_sheet([['辅助说明']]), '发布校验说明');
binary = new Uint8Array(XLSX.write(updatedWorkbook, { type: 'buffer', bookType: 'xlsx' }));
item = { ...item, sha: await contentHash(binary) };
await syncDataNow('public');
assert.equal(duties.getState().duties.length, 2);
assert(duties.getState().duties.some(d => d.name === '本机修改（本机副本）'));
assert(duties.getState().duties.some(d => d.id === original.id && d.name === item.name));
// JSON remains supported, including drill and role metadata.
const data = { name: '新版值班表', shifts: [{ date: '2026-10-21', shiftType: '夜班', personInCharge: '测试人员' }],
  drills: [{ date: '2026-10-21', content: '测试演练' }], roles: [{ group: 'C', leader: '测试人员', posts: [] }] };
binary = new TextEncoder().encode(JSON.stringify(data));
item = { ...item, sha: await contentHash(binary) };
await assert.rejects(syncDataNow('public'), /识别|文件|Unsupported|格式/);
assert.equal(duties.getState().duties.length, 2, 'Malformed Excel must leave existing data untouched');
const jsonItem = { ...item, filename: 'duty/值班表.json', downloadUrl: `${base}/files/duty/值班表.json` };
const json = await downloadPublishedDuty(jsonItem, token);
assert.equal(json.shifts[0].shiftType, 'night');
assert.deepEqual(json.drills, data.drills);
assert.deepEqual(json.roles, data.roles);
await assert.rejects(downloadPublishedDuty({ ...jsonItem, sha: '0'.repeat(64) }, token), /完整性校验失败/);
assert(duties.getState().duties.some(d => d.name === '本机修改（本机副本）'));
console.log(`✓ Published Excel: ${local.shifts.length} shifts, ${local.drills?.length ?? 0} drills, ${local.roles?.length ?? 0} roles; local/remote parsing, authenticated GET, no sync storage, unchanged reuse and invalid-file protection`);
