import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import AboutAppCard from '../src/components/AboutAppCard';
import UpdateStageCard from '../src/components/UpdateStageCard';
import UpdateControl from '../src/components/UpdateControl';
import DebugConsoleTrigger from '../src/components/DebugConsoleTrigger';
import { createUpdateStage, resolveUpdateStage } from '../src/utils/updateStages';
import { getUpdateStageAction } from '../src/utils/updateActions';

const forbidden = ['duty-preview/', '../preview/', 'duty-page-preview:', 'PreviewPageSwitcher', '阶段预览', '阶段演示', '播放更新流程演示', '示例请求', '示例日志', '深色预览', '浅色预览', '未连接更新服务'];
const trigger = renderToStaticMarkup(<DebugConsoleTrigger visible errors={0} onOpen={() => {}} />);
assert.equal(trigger.replace(/<[^>]*>/g, ''), '', 'floating trigger must be icon-only');
assert.ok(trigger.includes('aria-label="打开调试控制台"'), 'icon-only trigger must retain an accessible name');
assert.equal(renderToStaticMarkup(<DebugConsoleTrigger visible={false} errors={0} onOpen={() => {}} />), '');
function walk(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(path.join(directory, entry.name)) : [path.join(directory, entry.name)]);
}
for (const file of walk('src').filter(file => /\.(?:ts|tsx|css)$/.test(file))) {
  const source = fs.readFileSync(file, 'utf8');
  for (const marker of forbidden) assert.ok(!source.includes(marker), `${file} contains preview-only marker ${marker}`);
}
if (fs.existsSync('dist')) for (const file of walk('dist').filter(file => /\.(?:js|css|html)$/.test(file))) {
  const source = fs.readFileSync(file, 'utf8');
  for (const marker of forbidden) assert.ok(!source.includes(marker), `${file} contains preview-only marker ${marker}`);
}
for (const compact of [false, true]) {
  const html = renderToStaticMarkup(<AboutAppCard version="0.4.4" build="20261019" compact={compact} />);
  assert.ok(html.includes('学习与值班助手') && html.includes('Gitee') && html.includes('GitHub'));
  assert.equal((html.match(/<li>/g) || []).length, 4);
}
for (const phase of ['idle', 'checking', 'available', 'downloading', 'ready', 'installing', 'permission', 'latest', 'cancelled', 'error'] as const) {
  const stage = createUpdateStage(phase, phase === 'downloading' ? {progress: 62} : {});
  const html = renderToStaticMarkup(<UpdateStageCard stage={stage} logs={['[12:00:00] 开始检查更新']} />);
  assert.ok(html.includes(stage.title));
  assert.equal(html.includes('role="progressbar"'), phase === 'downloading');
  assert.equal((html.match(/class="update-stage-step /g) || []).length, 4);
  assert.ok(!html.includes('update-stage-eyebrow'), 'redundant status heading must be absent');
  assert.ok(!html.includes('update-log-list'), 'collapsed logs must not render the full log list');
}
const checking = createUpdateStage('checking');
const closed = renderToStaticMarkup(<UpdateControl expanded={false} onStart={() => {}} stage={checking} logs={['hidden log']} />);
assert.ok(closed.includes('检查更新') && !closed.includes('aria-label="更新阶段"'), 'opening About starts with one check button');
const expanded = renderToStaticMarkup(<UpdateControl expanded onStart={() => {}} stage={checking} />);
assert.ok(expanded.includes('aria-label="更新阶段"') && /about-update-launch[^>]*disabled=""[^>]*aria-hidden="true"/.test(expanded), 'expanded card must replace and disable the launch button');
assert.equal(getUpdateStageAction(createUpdateStage('checking'))?.disabled, true);
assert.equal(getUpdateStageAction(createUpdateStage('installing'))?.disabled, true);
assert.equal(getUpdateStageAction(createUpdateStage('error', {step: 0}))?.kind, 'check');
assert.equal(getUpdateStageAction(createUpdateStage('error', {step: 1}))?.kind, 'download');
assert.equal(getUpdateStageAction(createUpdateStage('cancelled'))?.kind, 'download');
assert.equal(getUpdateStageAction(createUpdateStage('error', {step: 3}), true)?.kind, 'install', 'retained package must retry installation rather than download');
assert.equal(getUpdateStageAction(createUpdateStage('downloading')), null, 'download action is replaced by inline cancel');
const downloading = renderToStaticMarkup(<UpdateStageCard stage={createUpdateStage('downloading', {version: '0.4.5',progress: 62})} onCancel={() => {}} />);
assert.ok(/update-stage-title-line[\s\S]*v0\.4\.5/.test(downloading));
assert.ok(/update-stage-download[\s\S]*role="progressbar"[\s\S]*update-stage-cancel/.test(downloading), 'cancel must accompany the progress bar');
const cancelling = renderToStaticMarkup(<UpdateStageCard stage={createUpdateStage('downloading')} onCancel={() => {}} cancelling />);
assert.ok(/update-stage-cancel[^>]*disabled=""/.test(cancelling) && cancelling.includes('取消中'));
const errorCard = renderToStaticMarkup(<UpdateStageCard stage={createUpdateStage('error',{detail:'连接失败：请求超时'})} action={{label:'检查重试',onClick:()=>{}}} />);
assert.ok(errorCard.includes('连接失败：请求超时') && errorCard.includes('检查重试'), 'compact errors must retain the actual reason and retry action');
const base = { checkingUpdate: false, updateInfo: null, downloadStatus: 'idle' as const, downloadProgress: { downloaded: 0, total: 0, percentage: 0 }, logs: [] as string[] };
assert.equal(resolveUpdateStage({...base,checkingUpdate:true}).phase, 'checking');
assert.equal(resolveUpdateStage({...base,downloadStatus:'downloading',downloadProgress:{downloaded:1,total:2,percentage:140}}).progress,100);
assert.equal(resolveUpdateStage({...base,downloadStatus:'downloaded'}).phase, 'ready');
assert.equal(resolveUpdateStage({...base,downloadStatus:'downloaded',logs:['开始安装 APK','需要允许安装未知来源应用']}).phase, 'permission');
assert.equal(resolveUpdateStage({...base,downloadStatus:'downloaded',logs:['开始安装 APK','安装失败: 未能启动']}).phase, 'error');
assert.equal(resolveUpdateStage({...base,logs:['下载已取消，未完成文件已清理']}).phase, 'cancelled');
assert.equal(resolveUpdateStage({...base,logs:['下载失败: 超时','开始检查更新'],updateInfo:{hasUpdate:false,latestVersion:'0.4.4',message:'当前已是最新版本'}}).phase, 'latest');
const pkg = JSON.parse(fs.readFileSync('package.json','utf8'));
const tauri = JSON.parse(fs.readFileSync('src-tauri/tauri.conf.json','utf8'));
assert.equal(pkg.version,tauri.version);
console.log('PASS: production source/artifact preview exclusion, about layouts, 10 update stage renders, real state mapping and version consistency.');
