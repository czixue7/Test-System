import assert from 'node:assert/strict';

const data = new Map<string, string>();
const storage = {
  getItem: (key: string) => data.get(key) ?? null,
  setItem: (key: string, value: string) => { data.set(key, value); },
  removeItem: (key: string) => { data.delete(key); },
};
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
storage.setItem('settings-storage', JSON.stringify({ state: {
  apiKey: 'legacy-key', apiModel: 'legacy-model', apiEndpoint: 'https://legacy.test/v1/chat/completions',
  gradingMode: 'ai', apiProvider: 'legacy', apiPassword: 'legacy-password',
}, version: 0 }));
const { useSettingsStore: store } = await import('../src/store/settingsStore');
const { apiGradingService } = await import('../src/utils/apiGradingService');
assert.equal(store.getState().aiProfiles.length, 1);
assert.equal(store.getState().activeAIProfileId, 'legacy-api');
assert.equal(store.getState().apiKey, 'legacy-key');
assert.equal(store.getState().aiProfiles[0].apiPassword, 'legacy-password');
console.log('✓ 旧配置迁移保留全部字段');

const second = store.getState().saveAIProfile({ name: '第二个 AI', apiKey: 'key-2', apiEndpoint: 'https://second.test', apiModel: 'model-2', apiProvider: '', apiPassword: '' });
assert.equal(store.getState().aiProfiles.length, 2);
assert.equal(store.getState().apiKey, 'legacy-key');
store.getState().activateAIProfile(second);
assert.equal(apiGradingService.getConfig()?.apiKey, 'key-2');
assert.equal(store.getState().apiKey, 'key-2');
assert.equal(store.getState().apiModel, 'model-2');
assert.equal(store.getState().apiEndpoint, 'https://second.test');
store.getState().saveAIProfile({ ...store.getState().aiProfiles[0], apiKey: 'edited-legacy' }, 'legacy-api');
assert.equal(store.getState().apiKey, 'key-2');
store.getState().saveAIProfile({ ...store.getState().aiProfiles[1], apiModel: 'edited-model' }, second);
assert.equal(store.getState().apiModel, 'edited-model');
await store.persist.rehydrate();
assert.equal(store.getState().activeAIProfileId, second);
assert.equal(store.getState().apiKey, 'key-2');
assert.equal(store.getState().apiModel, 'edited-model');
console.log('✓ 新增、快捷切换、编辑、持久化恢复一致');

store.getState().deleteAIProfile(second);
assert.equal(store.getState().activeAIProfileId, 'legacy-api');
assert.equal(store.getState().apiKey, 'edited-legacy');
store.getState().deleteAIProfile('legacy-api');
assert.equal(store.getState().activeAIProfileId, null);
assert.equal(store.getState().apiKey, null);
assert.equal(apiGradingService.isConfigured(), false);
await store.persist.rehydrate();
assert.equal(store.getState().aiProfiles.length, 0);
const first = store.getState().saveAIProfile({ name: '新的配置', apiKey: 'new', apiModel: 'new-model', apiEndpoint: 'https://new.test', apiProvider: '', apiPassword: '' });
assert.equal(store.getState().activeAIProfileId, first);
assert.equal(store.getState().apiKey, 'new');
console.log('✓ 删除当前配置自动回退，全部删除清空，首次新增自动启用');
