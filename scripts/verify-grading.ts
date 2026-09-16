/**
 * 判题回归测试（无第三方依赖，用 node:test 风格的极简断言）。
 * 运行：npm run test:grading
 *
 * 这些用例覆盖的都是「用户答错却给满分 / 统计口径不一致」这类
 * **类型检查发现不了**的运行期缺陷，请勿删除。
 */

// ---- 让 zustand persist 能在 Node 下初始化 ----
const mem = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
  setItem: (k: string, v: string) => void mem.set(k, String(v)),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
  key: (i: number) => Array.from(mem.keys())[i] ?? null,
  get length() { return mem.size; },
};
(globalThis as any).window = globalThis;

const { normalizeText, calculateSimilarity, calculateSubjectiveScore, classifySubjective } =
  await import('../src/utils/similarity');
const { fastPreCheck, extractBatchBlock } = await import('../src/utils/aiGrading');
const { checkAnswerWithAI } = await import('../src/store/examStore');
const {
  getBlankAnswers,
  getMultipleChoiceIds,
  countAnswerStats,
  matchDisorderBlanks,
} = await import('../src/utils/answerUtils');

let passed = 0;
const failures: string[] = [];

function check(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures.push(`${name}\n      ${err instanceof Error ? err.message : String(err)}`);
    console.log(`  ✗ ${name}`);
  }
}

function eq(actual: unknown, expected: unknown, label = '') {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label}期望 ${e}，实际 ${a}`);
}

function ok(cond: boolean, label = '') {
  if (!cond) throw new Error(`${label}期望为真，实际为假`);
}

const section = (t: string) => console.log(`\n${t}`);

// =====================================================================
section('C1 — 相似度不得抹掉数字 / 空答案不得算作相似');
// =====================================================================
check('normalizeText 保留数字', () => {
  eq(normalizeText('RS232'), 'rs232');
  eq(normalizeText('7°C-21°C'), '7°c21°c');
});

check('RS485 与 RS232 不再被判为相同', () => {
  ok(calculateSimilarity('RS485', 'RS232') < 1, '相似度应小于 1');
});

check('纯数字答案 123 vs 456 相似度为 0（曾误判为 1 → 满分）', () => {
  eq(calculateSimilarity('123', '456'), 0);
});

check('两个空字符串相似度为 0（曾在空值检查前返回 1）', () => {
  eq(calculateSimilarity('', ''), 0);
  eq(calculateSimilarity('。', '，'), 0);
});

check('主观题 GB50174-2007 vs GB50174-2017 不给满分', () => {
  const r = calculateSubjectiveScore('GB50174-2007', 'GB50174-2017', 10);
  ok(r.score < 10, `得分应小于满分，实际 ${r.score}`);
});

check('classifySubjective：只有满分才算「正确」', () => {
  eq(classifySubjective(10, 10), 2);
  eq(classifySubjective(9, 10), 1);
  eq(classifySubjective(0, 10), 0);
  eq(classifySubjective(0, 0), 0);
});

// =====================================================================
section('C2 — 填空题快速预检必须逐空比较，不得拼接');
// =====================================================================
const twoBlanks = ['动环监控系统DCIM', '楼宇自控系统BA'];

check('每空各填一个 → 走快速通道并给满分', () => {
  const r = fastPreCheck([...twoBlanks], twoBlanks, 4, 'fill-in-blank');
  eq(r.shouldSkipAI, true);
  eq(r.result?.score, 4);
  eq(r.result?.isCorrect, 2);
});

check('两个答案全塞进第 1 空 → 不得走快速通道（曾判 4/4 满分）', () => {
  const r = fastPreCheck(['动环监控系统DCIM楼宇自控系统BA', ''], twoBlanks, 4, 'fill-in-blank');
  eq(r.shouldSkipAI, false);
});

check('错误切分（把答案劈开）→ 不得走快速通道', () => {
  const r = fastPreCheck(['7°C-21°C12°C', '-27°C'], ['7°C-21°C', '12°C-27°C'], 4, 'fill-in-blank');
  eq(r.shouldSkipAI, false);
});

check('单空完全一致 / 仅有末尾标点差异 → 给满分', () => {
  eq(fastPreCheck(['主机房'], ['主机房'], 2, 'fill-in-blank').shouldSkipAI, true);
  eq(fastPreCheck(['主机房。'], ['主机房'], 2, 'fill-in-blank').shouldSkipAI, true);
});

check('单空但数字不同 → 不得给满分', () => {
  eq(fastPreCheck(['RS485'], ['RS232'], 2, 'fill-in-blank').shouldSkipAI, false);
});

check('无效答案仍判 0 分', () => {
  const r = fastPreCheck(['不知道'], ['主机房'], 2, 'fill-in-blank');
  eq(r.shouldSkipAI, true);
  eq(r.result?.score, 0);
});

check('主观题：数字不同不得给满分', () => {
  eq(fastPreCheck('GB50174-2007', 'GB50174-2017', 10, 'subjective').shouldSkipAI, false);
});

// =====================================================================
section('C3 — 乱序填空：每个标准答案只能抵扣一次');
// =====================================================================
check('matchDisorderBlanks：重复填同一答案只计 1 次', () => {
  const r = matchDisorderBlanks(['遥测', '遥测', '遥测', '遥测'], ['遥测', '遥信', '遥控', '遥调']);
  eq(r.correctCount, 1);
  eq(r.blankResults.map((b) => (b.isCorrect ? '对' : '错')).join(''), '对错错错');
});

check('matchDisorderBlanks：各填一个正确答案 → 全对', () => {
  const r = matchDisorderBlanks(['遥控', '遥调', '遥测', '遥信'], ['遥测', '遥信', '遥控', '遥调']);
  eq(r.correctCount, 4);
});

const fourYao = {
  id: 'q-siyao',
  type: 'fill-in-blank' as const,
  question: '四遥',
  content: '四遥包含：______、______、______、______',
  correctAnswer: ['遥测', '遥信', '遥控', '遥调'],
  score: 8,
  category: 'default',
  difficulty: 'medium' as const,
  allowDisorder: true,
};

// =====================================================================
section('C4 — 批量判题解析不得回退成整段响应');
// =====================================================================
check('定位到题目块时只返回该块', () => {
  const response = [
    '【题目1结果】',
    '题目ID: q1',
    '得分：3/4分',
    '判断：部分正确',
    '【题目2结果】',
    '题目ID: q2',
    '得分：4/4分',
    '判断：正确',
  ].join('\n');

  const block1 = extractBatchBlock(response, 'q1');
  ok(block1.includes('得分：3/4分'), 'q1 应取到 3/4');
  ok(!block1.includes('4/4'), 'q1 不应包含 q2 的内容');

  const block2 = extractBatchBlock(response, 'q2');
  ok(block2.includes('得分：4/4分'), 'q2 应取到 4/4');
});

check('定位不到题目时必须抛错（曾静默套用第 1 题分数）', () => {
  const response = '【题目1结果】\n题目ID: q1\n得分：4/4分';
  let threw = false;
  try {
    extractBatchBlock(response, 'q-missing');
  } catch {
    threw = true;
  }
  ok(threw, '应抛出异常以触发降级');
});

check('题目 id 含正则元字符时也能精确匹配（不注入正则）', () => {
  const response = '题目ID: q.(1)+\n得分：2/4分\n';
  const block = extractBatchBlock(response, 'q.(1)+');
  ok(block.includes('得分：2/4分'), '应正确取出该块');
});

// =====================================================================
section('M8 — 对/部分正确/错/未答 统计口径统一');
// =====================================================================
check('三态统计不再把「部分正确」算成「对」', () => {
  const stats = countAnswerStats([
    { answer: 'A', isCorrect: 2 },
    { answer: 'B', isCorrect: 1 },
    { answer: 'C', isCorrect: 0 },
    { answer: '', isCorrect: 0 },
  ] as any);
  eq(stats, { correct: 1, partial: 1, wrong: 1, unanswered: 1, total: 4 });
});

check('兼容历史 boolean isCorrect', () => {
  const stats = countAnswerStats([
    { answer: 'A', isCorrect: true },
    { answer: 'B', isCorrect: false },
  ] as any);
  eq(stats.correct, 1);
  eq(stats.wrong, 1);
});

check('空数组答案算未作答', () => {
  const stats = countAnswerStats([{ answer: [], isCorrect: 0 }, { answer: [''], isCorrect: 0 }] as any);
  eq(stats.unanswered, 2);
});

// =====================================================================
section('M2/M6 — 答案形态收敛（填空输入框 / 多选选项 id）');
// =====================================================================
check('getBlankAnswers 支持 字符串 / 数组 / {text,images}', () => {
  eq(getBlankAnswers('主机房'), ['主机房']);
  eq(getBlankAnswers(['a', 'b']), ['a', 'b']);
  eq(getBlankAnswers({ text: '仅文本', images: [] } as any), ['仅文本']);
});

check('getMultipleChoiceIds 支持 数组 / {text,images}（曾 as string[] 抛 TypeError）', () => {
  eq(getMultipleChoiceIds(['A', 'C']), ['A', 'C']);
  eq(getMultipleChoiceIds({ text: 'A、C', images: [] } as any), ['A', 'C']);
  eq(getMultipleChoiceIds(undefined), []);
});

// =====================================================================
// 需要 await 的端到端用例
// =====================================================================
section('C3 端到端（checkAnswerWithAI 固定判题）');

const asyncChecks: Array<[string, () => Promise<void>]> = [
  [
    '四个空全填「遥测」→ 2/8 部分正确（曾 8/8 满分）',
    async () => {
      const r = await checkAnswerWithAI(fourYao as any, ['遥测', '遥测', '遥测', '遥测'], false);
      eq(r.score, 2, '得分');
      eq(r.isCorrect, 1, 'isCorrect');
      eq(r.blankResults?.map((b) => (b.isCorrect ? '对' : '错')).join(''), '对错错错');
    },
  ],
  [
    '四个空各填一个正确答案 → 8/8 全对',
    async () => {
      const r = await checkAnswerWithAI(fourYao as any, ['遥测', '遥信', '遥控', '遥调'], false);
      eq(r.score, 8, '得分');
      eq(r.isCorrect, 2, 'isCorrect');
    },
  ],
  [
    '乱序模式漏填两空 → 4/8 部分正确',
    async () => {
      const r = await checkAnswerWithAI(fourYao as any, ['遥测', '遥信'], false);
      eq(r.score, 4, '得分');
      eq(r.isCorrect, 1, 'isCorrect');
    },
  ],
  [
    '顺序填空数字答错 → 0 分（曾 2/2 满分）',
    async () => {
      const q = {
        id: 'q-rs',
        type: 'fill-in-blank' as const,
        question: '串口',
        content: '电脑只能识别串口通讯中的：______端口。',
        correctAnswer: ['RS232'],
        score: 2,
        category: 'default',
        difficulty: 'medium' as const,
      };
      const r = await checkAnswerWithAI(q as any, ['RS485'], false);
      eq(r.score, 0, '得分');
      eq(r.isCorrect, 0, 'isCorrect');
    },
  ],
  [
    '顺序填空完全正确 → 满分',
    async () => {
      const q = {
        id: 'q-rs2',
        type: 'fill-in-blank' as const,
        question: '串口',
        content: '电脑只能识别串口通讯中的：______端口。',
        correctAnswer: ['RS232'],
        score: 2,
        category: 'default',
        difficulty: 'medium' as const,
      };
      const r = await checkAnswerWithAI(q as any, ['RS232'], false);
      eq(r.score, 2, '得分');
      eq(r.isCorrect, 2, 'isCorrect');
    },
  ],
  [
    '多选题答案为 {text,images} 时不再抛错',
    async () => {
      const q = {
        id: 'q-mc',
        type: 'multiple-choice' as const,
        question: '多选',
        content: '选出正确的',
        options: [
          { id: 'A', content: 'a' },
          { id: 'B', content: 'b' },
          { id: 'C', content: 'c' },
        ],
        correctAnswer: { text: 'A、C', images: [] },
        score: 4,
        category: 'default',
        difficulty: 'medium' as const,
      };
      const r = await checkAnswerWithAI(q as any, ['A', 'C'], false);
      eq(r.isCorrect, 2, 'isCorrect');
      eq(r.score, 4, '得分');
    },
  ],
];

for (const [name, fn] of asyncChecks) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures.push(`${name}\n      ${err instanceof Error ? err.message : String(err)}`);
    console.log(`  ✗ ${name}`);
  }
}

// =====================================================================
console.log(`\n${'='.repeat(64)}`);
console.log(`通过 ${passed} 项，失败 ${failures.length} 项`);
if (failures.length > 0) {
  console.log('\n失败明细：');
  failures.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
  process.exit(1);
}
console.log('全部通过 ✅');
