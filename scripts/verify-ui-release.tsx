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
import GradingResultCard from '../src/components/GradingResultCard';
import { getGradedBlankResults } from '../src/utils/practiceGrading';
import type { Question, QuestionResult } from '../src/types';
import { imageThumbnailTransform } from '../src/utils/imageViewerTransition';

assert.equal(imageThumbnailTransform({ left: 24, top: 100, width: 240, height: 120 }, 1000, 500, 1000, 800), 'translate3d(calc(-50% + -356px), calc(-50% + -240px), 0) scale(0.26666666666666666, 0.26666666666666666)');
assert.equal(imageThumbnailTransform({ left: 20, top: 30, width: 50, height: 100 }, 500, 1000, 400, 800), 'translate3d(calc(-50% + -155px), calc(-50% + -320px), 0) scale(0.1388888888888889, 0.1388888888888889)');
assert.equal(imageThumbnailTransform({ left: 0, top: 0, width: 0, height: 100 }, 100, 100, 400, 800), null);

const fillQuestion: Question = { id: 'card-fill', type: 'fill-in-blank', question: '填空', correctAnswer: ['供配电', '制冷', '网络'], score: 3, category: '', difficulty: 'easy' };
const semanticResult: QuestionResult = { isCorrect: 1, score: 2, gradingMode: 'ai', blankResults: [
  { userAnswer: '配电系统', correctAnswer: '供配电', isCorrect: true },
  { userAnswer: '制冷', correctAnswer: '制冷', isCorrect: true },
  { userAnswer: '<script>123</script>', correctAnswer: '网络', isCorrect: false },
] };
const semanticRows = getGradedBlankResults(fillQuestion, ['配电系统', '制冷', '<script>123</script>'], semanticResult);
assert.equal(semanticRows[0].isCorrect, true, 'AI semantic judgment must not be replaced by exact matching');
assert.equal(getGradedBlankResults(fillQuestion, ['供配电'], { isCorrect: 1, score: 1, gradingMode: 'ai' })[0].isCorrect, null, 'missing AI detail must remain unknown');
const duplicateQuestion = { ...fillQuestion, allowDisorder: true };
assert.deepEqual(getGradedBlankResults(duplicateQuestion, ['供配电', '供配电', '网络'], { isCorrect: 1, score: 2, gradingMode: 'fixed' }).map(row => row.isCorrect), [true, false, true], 'legacy fixed records must still consume disorder matches');
const card = (result: QuestionResult, question = fillQuestion) => renderToStaticMarkup(<GradingResultCard question={question} result={result} answer={result.blankResults?.map(row => row.userAnswer)} isConfirmed onOpenImages={() => {}} />);
const partialCard = card(semanticResult);
assert(partialCard.includes('grading-card--partial') && partialCard.includes('得分: 2/3') && partialCard.includes('AI智能判题'));
assert(partialCard.includes('2个空正确，1个空错误') && partialCard.includes('参考答案: 网络'));
assert(!partialCard.includes('<script>') && partialCard.includes('&lt;script&gt;'));
const fixedCard = card({ ...semanticResult, isCorrect: 2, score: 3, gradingMode: 'fixed', blankResults: fillQuestion.correctAnswer instanceof Array ? fillQuestion.correctAnswer.map(text => ({ userAnswer: text, correctAnswer: text, isCorrect: true })) : [] });
assert(fixedCard.includes('grading-card--correct') && fixedCard.includes('答案完全正确') && fixedCard.includes('固定规则判题'));
const fallbackCard = card({ ...semanticResult, isCorrect: 0, score: 0, gradingMode: 'ai-fallback', aiExplanation: '【AI降级判题模式】\n请求失败，使用固定规则' });
assert(fallbackCard.includes('grading-card--wrong') && fallbackCard.includes('固定规则判题（AI降级）') && (fallbackCard.match(/【AI降级判题模式】/g) || []).length === 1);
const imageCard = card({ isCorrect: 0, score: 0, gradingMode: 'fixed' }, { ...fillQuestion, type: 'subjective', correctAnswer: { text: '图解答案', images: ['data:image/png;base64,AA=='] }, explanation: '题目原解析' });
assert(imageCard.includes('放大参考答案图片1') && imageCard.includes('图解答案') && imageCard.includes('题目原解析'));

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
