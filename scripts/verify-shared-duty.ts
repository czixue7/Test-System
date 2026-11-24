import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import type { DutyDrill, SharedDutyBatch, SharedDutySnapshot } from '../src/types';

const storage = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
  removeItem: (key: string) => storage.delete(key),
} });
Object.defineProperty(globalThis, 'window', { configurable: true, value: new EventTarget() });
Object.defineProperty(globalThis, 'document', { configurable: true, value: Object.assign(new EventTarget(), {
  visibilityState: 'visible',
}) });

const { useDataSourceStore } = await import('../src/store/dataSourceStore');
const { useDutyScheduleStore } = await import('../src/store/dutyScheduleStore');
const { dutyWithSharedAnnotations } = await import('../src/utils/sharedDutyAnnotations');
const { startSharedDutySync } = await import('../src/utils/sharedDutySync');
const base = 'https://service.test/prefix';
const token = 'shared-duty-test-token';
useDataSourceStore.getState().configure(base, token, 'unused-private-space');
const filename = `service:${encodeURIComponent(base)}:duty/排班表.xlsx`;
const store = useDutyScheduleStore.getState();
const drill = (date: string, name: string): DutyDrill => ({ date, group: 'C', name });
const day = '2026-11-28';
const referenceDrill = drill(day, '参考表');
const referenceDrills = [referenceDrill, drill(day, '参考表第二项')];
const schedule = { name: '排班表', shifts: [], drills: referenceDrills, sourceType: 'user' as const };
const leftId = store.importDutyWithSha(schedule, 'a'.repeat(64), filename);
const rightId = store.importDutyWithSha(schedule, 'a'.repeat(64), filename);
const raw = (id: string) => store.getDuty(id)!;
const displayed = (id: string) => dutyWithSharedAnnotations(raw(id));
const waitUntil = async (condition: () => boolean) => {
  const deadline = Date.now() + 8000;
  while (!condition()) {
    assert(Date.now() < deadline, '共享同步没有在测试期限内完成');
    await delay(10);
  }
};

let snapshot: SharedDutySnapshot = { revision: 0, entries: {} };
const waiters = new Set<(value: Response) => void>();
const accepted = new Set<string>();
let loseNextWriteResponse = false;
globalThis.fetch = (async (input, init) => {
  const url = new URL(String(input));
  assert.equal(url.origin + '/prefix', base);
  assert.equal(new Headers(init?.headers).get('Authorization'), `Bearer ${token}`);
  assert(!url.pathname.includes('unused-private-space'));
  if (init?.method === 'PUT') {
    const batch = JSON.parse(String(init.body)) as SharedDutyBatch;
    if (accepted.has(batch.id)) return Response.json(snapshot);
    if (Object.entries(batch.changes).some(([key, change]) => (snapshot.entries[key]?.version ?? null) !== change.expected)) {
      return Response.json(snapshot, { status: 409 });
    }
    snapshot = { revision: snapshot.revision + 1, entries: { ...snapshot.entries } };
    for (const [key, change] of Object.entries(batch.changes)) snapshot.entries[key] = { version: batch.id, value: change.value };
    accepted.add(batch.id);
    for (const resolve of waiters) resolve(Response.json(snapshot));
    waiters.clear();
    if (loseNextWriteResponse) {
      loseNextWriteResponse = false;
      throw new Error('connection reset');
    }
    return Response.json(snapshot);
  }
  const requested = url.pathname.match(/\/watch\/(\d+)\//);
  if (requested && Number(requested[1]) === snapshot.revision) {
    return new Promise<Response>(resolve => waiters.add(resolve));
  }
  return Response.json(snapshot);
}) as typeof fetch;

let stop = startSharedDutySync();
try {
  await waitUntil(() => waiters.size === 2);
  assert.deepEqual(displayed(leftId).drills, referenceDrills);
  const staleEditor = displayed(rightId);
  store.updateDuty(leftId, { drills: [drill(day, '甲端修改')] });
  await waitUntil(() => displayed(rightId).drills?.[0]?.name === '甲端修改' && !raw(leftId).sharedAnnotations?.pending.length);

  store.updateDuty(rightId, { drills: [drill(day, '乙端旧编辑器修改')] }, staleEditor);
  await waitUntil(() => raw(rightId).sharedAnnotations?.conflict === true);
  assert.equal(displayed(leftId).drills?.[0]?.name, '甲端修改');
  store.resolveSharedDutyConflict(rightId, false);
  assert.equal(displayed(rightId).drills?.[0]?.name, '甲端修改');

  stop();
  for (const resolve of waiters) resolve(new Response(null, { status: 204 }));
  waiters.clear();
  store.updateDuty(rightId, { drills: [...(displayed(rightId).drills ?? []), drill('2026-11-29', '离线标注')] });
  assert.equal(raw(rightId).sharedAnnotations?.pending.length, 1);
  assert(storage.get('exam-store:duty-schedules')?.includes('离线标注'), '离线队列须持久化');
  loseNextWriteResponse = true;
  stop = startSharedDutySync();
  await waitUntil(() => displayed(leftId).drills?.some(item => item.name === '离线标注') === true);
  await waitUntil(() => raw(rightId).sharedAnnotations?.pending.length === 0);
  assert.equal(snapshot.revision, 2, '提交响应丢失时重试同一批次，不重复写入');
  store.updateDuty(leftId, { drills: (displayed(leftId).drills ?? []).filter(item => item.date !== day) });
  await waitUntil(() => displayed(rightId).drills?.every(item => item.date !== day) === true);
  assert.deepEqual(raw(leftId).drills, referenceDrills);
  assert.deepEqual(raw(rightId).drills, referenceDrills);
  console.log('✓ 共享排班：两端订阅、并发冲突、离线暂存、幂等重试、删除标注及保留参考表');
} finally {
  stop();
  for (const resolve of waiters) resolve(new Response(null, { status: 204 }));
}
