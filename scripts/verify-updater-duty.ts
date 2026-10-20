import assert from 'node:assert/strict';
import { swapPersonnel } from '../src/pages/duty/SwapPersonnelModal';

const shifts = [
  { id: 'a', date: '2026-10-01', group: 'A', personInCharge: 'Alice', shiftType: 'night' as const, tasks: [] },
  { id: 'b', date: '2026-10-02', group: 'B', personInCharge: 'Bob', shiftType: 'night' as const, tasks: [] },
  { id: 'c', date: '2026-10-05', group: 'A', personInCharge: 'Carol', shiftType: 'night' as const, tasks: [] },
];
const once = swapPersonnel(shifts, [['a', 'b']]);
const twice = swapPersonnel(once, [['a', 'c']]);
assert.equal(twice[0].personInCharge, 'Carol');
assert.equal(twice[0].originGroup, undefined);
assert.equal(twice[2].personInCharge, 'Bob');
assert.equal(twice[2].originGroup, 'B');
assert.equal(twice[2].originDate, '2026-10-02');
const reversed = swapPersonnel(once, [['a', 'b']]);
assert.equal(reversed[0].originGroup, undefined);
assert.equal(reversed[1].originGroup, undefined);
assert.equal(reversed[0].personInCharge, 'Alice');
console.log('✓ 连续交换保留真实来源，换回原组后清除跨组标记');

let callbackId = 0;
const calls: Array<{ id: string; filename: string; resolve: (path: string) => void; reject: (error: unknown) => void }> = [];
let cancelledId = '';
const nativeRelease = {
  latest_version: '0.5.0', version_hash: '20261014', source: 'gitee',
  assets: [{ name: 'universal.apk', browser_download_url: 'https://example.test/current.apk' }],
  fallback_assets: [],
};
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { userAgent: 'Android arm64', platform: 'Linux aarch64' } });
const internals = {
  transformCallback: () => ++callbackId,
  invoke: (command: string, args: any) => {
    if (command === 'download_apk') return new Promise<string>((resolve, reject) => calls.push({ id: args.downloadId, filename: args.filename, resolve, reject }));
    if (command === 'cancel_apk_download') { cancelledId = args.downloadId; return Promise.resolve(); }
    if (command === 'fetch_remote_text') return Promise.resolve(JSON.stringify(args.url.includes('gitee') ? {
      releases: [{ tag: { name: `v${nativeRelease.latest_version}` }, release: { description: `hash:${nativeRelease.version_hash}`, attach_files: nativeRelease.assets.map(asset => ({ name: asset.name, cli_download_url: asset.browser_download_url })) } }],
    } : [{ tag_name: `v${nativeRelease.latest_version}`, body: `hash:${nativeRelease.version_hash}`, assets: nativeRelease.assets }]));
    throw new Error(command);
  },
};
(globalThis as any).window = { __TAURI_INTERNALS__: internals };
const { useUpdaterStore } = await import('../src/store/updaterStore');
useUpdaterStore.setState({ updateInfo: { hasUpdate: true, latestVersion: '0.5.0', versionHash: '20261014', message: '', downloadUrl: 'https://example.test/current.apk', fallbackDownloadUrl: 'https://example.test/mirror.apk' } });
const first = useUpdaterStore.getState().startDownload();
await useUpdaterStore.getState().startDownload();
assert.equal(calls.length, 1);
const cancel = useUpdaterStore.getState().cancelDownload();
await useUpdaterStore.getState().startDownload();
assert.equal(calls.length, 1, '取消清理结束前禁止重试');
assert.equal(cancelledId, calls[0].id);
calls[0].reject('下载已取消');
await Promise.all([first, cancel]);
assert.equal(calls.length, 1, '取消后不得继续尝试备用源');
assert.equal(useUpdaterStore.getState().downloadStatus, 'idle');
console.log('✓ 取消调用原生命令，等待清理后才能重试，不再触发备用下载');
const second = useUpdaterStore.getState().startDownload();
assert.equal(calls.length, 2);
assert.notEqual(calls[0].id, calls[1].id);
assert.match(calls[1].filename, /20261014/);
calls[1].resolve('/cache/complete.apk');
await second;
await useUpdaterStore.getState().startDownload();
await useUpdaterStore.getState().checkForUpdate();
useUpdaterStore.getState().resetState();
assert.equal(calls.length, 2);
assert.equal(useUpdaterStore.getState().downloadedFilePath, '/cache/complete.apk');
assert.equal(useUpdaterStore.getState().downloadStatus, 'downloaded');
console.log('✓ 完整安装包经重复点击、重新检查、重置操作后仍保留');

delete (globalThis as any).window.__TAURI_INTERNALS__;
let githubVersion = '0.5.0';
let githubHash = '20261014';
globalThis.fetch = (async (url: string) => Response.json(url.includes('gitee') ? {
  releases: [{ tag: { name: 'v0.5.0' }, release: { description: 'hash:20261014', attach_files: [{ name: 'universal.apk', cli_download_url: 'https://example.test/gitee.apk' }] } }],
} : [{ tag_name: `v${githubVersion}`, body: `hash:${githubHash}`, assets: [{ name: 'universal.apk', browser_download_url: 'https://example.test/github.apk' }] }])) as any;
const { checkUpdate } = await import('../src/utils/updater');
const same = await checkUpdate();
assert.equal(same.source, 'gitee');
assert.equal(same.fallbackDownloadUrl, 'https://example.test/github.apk');
githubVersion = '0.4.2';
const older = await checkUpdate();
assert.equal(older.source, 'gitee');
assert.equal(older.fallbackDownloadUrl, undefined);
githubVersion = '0.5.0';
githubHash = '20261015';
const newer = await checkUpdate();
assert.equal(newer.source, 'github');
assert.equal(newer.fallbackDownloadUrl, undefined);
console.log('✓ 同版本同构建优先 Gitee；旧版本/不同构建不能作备用源；更高构建优先');
