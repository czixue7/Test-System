import assert from 'node:assert/strict';
const saved = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: (key: string) => saved.get(key) ?? null,
  setItem: (key: string, value: string) => saved.set(key, value), removeItem: (key: string) => saved.delete(key),
} });
(globalThis as any).window = new EventTarget();
const { useSettingsStore: settings } = await import('../src/store/settingsStore');
const { useKnowledgeStore: knowledge } = await import('../src/store/knowledgeStore');
const { useQuestionBankStore: banks } = await import('../src/store/questionBankStore');
const { getOrCreateSummary } = await import('../src/utils/knowledgeSummary');
const now = new Date().toISOString();
knowledge.setState({ items: Array.from({ length: 6 }, (_, index) => ({ id: `note-${index}`, title: `note-${index}`, category: '', content: `${index}:` + '内容'.repeat(2900), createdAt: now, updatedAt: now })) });
banks.setState({ banks: [{ id: 'bank', name: 'bank', createdAt: now, updatedAt: now, questions: Array.from({ length: 6 }, (_, index) => ({ id: `question-${index}`, type: 'subjective' as const, question: `${index}:` + '题目'.repeat(2900), correctAnswer: 'answer', score: 1, category: '', difficulty: 'easy' as const })) }] });
const profile = { name: 'summary', apiKey: 'synthetic-a', apiModel: 'model', apiEndpoint: 'https://api-a.test', apiProvider: '', apiPassword: '' };
const id = settings.getState().saveAIProfile(profile);
let active = 0, peak = 0, failChunk = false, merges = 0;
let requests: { url: string; auth: string; prompt: string }[] = [];
globalThis.fetch = (async (input: any, init: any) => {
  const prompt = JSON.parse(init.body).messages[0].content as string;
  const record = { url: String(input), auth: init.headers.Authorization, prompt };
  requests.push(record); active++; peak = Math.max(peak, active);
  await new Promise(resolve => setTimeout(resolve, 8));
  active--;
  if (prompt.startsWith('以下是')) merges++;
  else if (failChunk) { failChunk = false; return new Response('synthetic failure', { status: 500 }); }
  return Response.json({ choices: [{ message: { content: prompt.startsWith('以下是') ? 'merged summary' : 'chunk summary' } }] });
}) as typeof fetch;
const originalLog = console.log, originalWarn = console.warn, originalError = console.error;
console.log = console.warn = console.error = () => {};
try {
  const progress: number[] = [];
  await Promise.all([
    getOrCreateSummary('knowledge', undefined, undefined, (done, _, phase) => { if (phase === 'summarize') progress.push(done); }, true),
    getOrCreateSummary('questionBank', undefined, undefined, undefined, true),
  ]);
  assert.equal(peak, 2, 'different summary types must share the default API budget');
  assert.equal(merges, 2);
  assert.deepEqual(progress, [1, 2, 3, 4, 5, 6]);
  for (const limit of [1, 3]) {
    settings.getState().saveAIProfile({ ...profile, concurrency: limit }, id);
    requests = []; peak = 0;
    await getOrCreateSummary('knowledge', undefined, undefined, undefined, true);
    assert.equal(peak, limit);
    assert.equal(requests.length, 7, 'all six chunks and their merge must complete');
  }
  requests = []; peak = 0; failChunk = true;
  await getOrCreateSummary('knowledge', undefined, undefined, undefined, true);
  assert(peak <= 3, 'a rejected request must release the slot');
  assert(requests.at(-1)!.prompt.includes('内容'), 'failed chunks must reach the merge as original content');
  requests = [];
  const task = getOrCreateSummary('knowledge', undefined, undefined, undefined, true);
  while (!requests.length) await new Promise(resolve => setTimeout(resolve, 1));
  settings.getState().saveAIProfile({ ...profile, apiEndpoint: 'https://api-b.test', apiKey: 'synthetic-b' });
  settings.getState().activateAIProfile(settings.getState().aiProfiles.at(-1)!.id);
  await task;
  assert(requests.every(record => record.url === profile.apiEndpoint && record.auth === `Bearer ${profile.apiKey}`), 'switching profiles must not mix credentials within a queued summary');
  await settings.persist.rehydrate();
  assert.equal(settings.getState().aiProfiles.find(profile => profile.id === id)?.concurrency, 3);
} finally { console.log = originalLog; console.warn = originalWarn; console.error = originalError; }
console.log('✓ 生产总结分块与合并：默认/自定义并发限制、跨类型共用额度、失败释放、进度完整、切换 API 不串配置');
