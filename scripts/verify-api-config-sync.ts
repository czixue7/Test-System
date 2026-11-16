import assert from 'node:assert/strict';
import { emptyAPIConfig, editAPIConfig, mergeAPIConfig, profilesFromAPIConfig, validateAPIConfig, APIProfile } from '../shared/apiConfigSync';
const profile: APIProfile = { id: 'original', name: '同名接口', apiKey: 'synthetic-key', apiModel: 'model', apiEndpoint: 'https://example.test', apiProvider: '', apiPassword: 'synthetic-password' };
const base = editAPIConfig(emptyAPIConfig(), [profile]);
assert.equal(profilesFromAPIConfig(base)[0].concurrency, 2, 'legacy profiles default to two requests');
const withLimit = editAPIConfig(base, [{ ...profile, concurrency: 5 }]);
assert.equal(profilesFromAPIConfig(mergeAPIConfig(base, withLimit))[0].concurrency, 5);
for (const invalid of [0, -1, 1.5, 33, '2', null]) {
  const value = structuredClone(base) as any;
  value.entries[0].value.concurrency = invalid;
  assert.throws(() => validateAPIConfig(value));
}
const left = editAPIConfig(base, [{ ...profile, apiKey: 'left-key' }]);
const right = editAPIConfig(base, [{ ...profile, apiKey: 'right-key' }]);
const combined = mergeAPIConfig(left, right);
assert.deepEqual(combined, mergeAPIConfig(right, left), 'merges must not depend on device order');
assert.equal(profilesFromAPIConfig(combined).length, 2);
assert.deepEqual(new Set(profilesFromAPIConfig(combined).map(p => p.apiKey)), new Set(['left-key', 'right-key']));
assert(profilesFromAPIConfig(combined).some(p => p.name.endsWith('（冲突副本）')));
assert.deepEqual(mergeAPIConfig(combined, left), combined, 'retries must not create more copies');
assert.deepEqual(mergeAPIConfig(combined, right), combined);
const third = editAPIConfig(base, [{ ...profile, apiKey: 'third-key' }]);
const mergedThird = mergeAPIConfig(combined, third);
const otherOrder = mergeAPIConfig(left, mergeAPIConfig(right, third));
assert.deepEqual(profilesFromAPIConfig(mergedThird), profilesFromAPIConfig(otherOrder), 'three writers preserve the same values');
assert.deepEqual(mergeAPIConfig(mergedThird, otherOrder), mergeAPIConfig(otherOrder, mergedThird), 'three writers converge after exchanging metadata');
const deleted = editAPIConfig(base, []);
assert.equal(profilesFromAPIConfig(mergeAPIConfig(deleted, base)).length, 0, 'stale device must not resurrect a deletion');
assert.equal(profilesFromAPIConfig(mergeAPIConfig(deleted, right))[0].apiKey, 'right-key', 'concurrent edit/delete preserves edit');
assert(!JSON.stringify(deleted).includes(profile.apiKey));
const cleared = editAPIConfig(combined, []);
assert.equal(profilesFromAPIConfig(mergeAPIConfig(cleared, combined)).length, 0, 'conflict copies also have deletion markers');
const sameNames = editAPIConfig(base, [profile, { ...profile, id: 'second' }]);
assert.equal(profilesFromAPIConfig(sameNames).length, 2, 'same name with distinct IDs remains separate');
assert.throws(() => validateAPIConfig({ schema: 1, entries: [{ ...base.entries[0], value: { ...profile, apiKey: 7 } }] }));
console.log('✓ API 配置合并：并发修改保留副本、重试稳定、三端收敛、删除不复活、同名不同 ID 独立');

const saved = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: (key: string) => saved.get(key) ?? null,
  setItem: (key: string, value: string) => saved.set(key, value),
  removeItem: (key: string) => saved.delete(key),
} });
(globalThis as any).window = new EventTarget();
const { useDataSourceStore: source } = await import('../src/store/dataSourceStore');
const { useSettingsStore: settings } = await import('../src/store/settingsStore');
const { syncDataNow } = await import('../src/utils/dataSync');
const { apiGradingService } = await import('../src/utils/apiGradingService');
source.getState().configure('https://controlled.test', 'synthetic-access-token', 'api-space');
let remote: any = { revision: 0, data: null };
let requests = 0;
let conflict = false, changeSource = false, editInFlight = false;
globalThis.fetch = (async (input: any, init: any = {}) => {
  requests++;
  assert(new URL(String(input)).pathname === '/api/v1/sync/api-space/config');
  assert.equal(init.headers.Authorization, 'Bearer synthetic-access-token');
  if (changeSource) { source.getState().setSpace('another-space'); return Response.json(remote); }
  if (init.method === 'PUT') {
    const body = JSON.parse(init.body);
    if (conflict) {
      conflict = false;
      remote = { revision: remote.revision + 1, data: editAPIConfig(remote.data, [...profilesFromAPIConfig(remote.data), { ...profile, id: 'concurrent-add' }]) };
      return Response.json(remote, { status: 409 });
    }
    assert.equal(body.baseRevision, remote.revision);
    remote = { revision: remote.revision + 1, data: body.data };
    if (editInFlight) {
      editInFlight = false;
      settings.getState().saveAIProfile({ ...settings.getState().aiProfiles[0], apiModel: 'pending-model' }, 'original');
    }
  }
  return Response.json(remote);
}) as typeof fetch;
settings.getState().saveAIProfile(profile, profile.id);
assert.equal(source.getState().sync.config, false);
window.dispatchEvent(new Event('online'));
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(requests, 0);
source.getState().setSync('config', true);
assert.equal(requests, 0, 'enabling sync must not send secrets automatically');
await syncDataNow('personal');
assert.equal(profilesFromAPIConfig(remote.data)[0].apiKey, profile.apiKey);
assert.equal(profilesFromAPIConfig(remote.data)[0].apiPassword, profile.apiPassword);
assert.equal(profilesFromAPIConfig(remote.data)[0].concurrency, 2);
const firstRevision = remote.revision;
await syncDataNow('personal');
assert.equal(remote.revision, firstRevision, 'unchanged config must not write another revision');
remote = { revision: remote.revision + 1, data: editAPIConfig(remote.data, [{ ...profile, apiKey: 'desk-key', apiModel: 'desk-model', concurrency: 4 }]) };
await syncDataNow('personal');
assert.equal(settings.getState().apiKey, 'desk-key');
assert.equal(settings.getState().apiConcurrency, 4);
assert.equal(apiGradingService.getConfig()?.model, 'desk-model');
settings.getState().saveAIProfile({ ...profile, apiKey: 'client-key' }, profile.id);
conflict = true;
await syncDataNow('personal');
assert.equal(profilesFromAPIConfig(remote.data).find(p => p.id === profile.id)?.apiKey, 'client-key');
assert(settings.getState().aiProfiles.some(p => p.id === 'concurrent-add'));
settings.getState().saveAIProfile({ ...profile, apiKey: 'before-pending' }, profile.id);
editInFlight = true;
await syncDataNow('personal');
assert.equal(settings.getState().aiProfiles.find(p => p.id === profile.id)?.apiModel, 'pending-model', 'in-flight local edits are retained');
await syncDataNow('personal');
assert.equal(profilesFromAPIConfig(remote.data).find(p => p.id === profile.id)?.apiModel, 'pending-model');
settings.getState().deleteAIProfile(profile.id);
await syncDataNow('personal');
assert(!profilesFromAPIConfig(remote.data).some(p => p.id === profile.id));
remote = { revision: remote.revision + 1, data: editAPIConfig(remote.data, []) };
await syncDataNow('personal');
assert.equal(settings.getState().aiProfiles.length, 0);
assert.equal(apiGradingService.isConfigured(), false);
await settings.persist.rehydrate();
assert.equal(settings.getState().aiProfiles.length, 0);
changeSource = true;
await assert.rejects(syncDataNow('personal'), /切换/);
assert.equal(settings.getState().aiProfiles.length, 0);
console.log('✓ 手动同步含 Key/密码双向往返、CAS 重试、在途编辑、激活状态、删除与持久化、空间切换停止应用');
