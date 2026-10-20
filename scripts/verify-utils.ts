/**
 * 工具函数回归测试：哈希比较（M4）、汉字数字转换（M28）、分类关键词匹配（M29）。
 * 运行：npm run test:utils
 */
const { compareSha, shaIndicatesUpdate } = await import('../src/utils/bankIndex');
const { chineseToNumber, lowerToUpper, removeSpaces } = await import('../src/utils/noteConverter');
const { autoDetectCategory } = await import('../src/utils/knowledgeParser');

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

const section = (t: string) => console.log(`\n${t}`);

// =====================================================================
section('M4 — 哈希比较（修复「第一周考题」更新检测永久失效）');

const SHA1_FIRST_WEEK = 'b64eb605cc22b439c5a00bee19d149a82bd58fa1'; // 40 位（真实数据）
const SHA256_SOMETHING = '180bee9682fabc3cab639a47e6a63d2f82a85f5e47d9b30c6ce638ecc84abebb'; // 64 位

check('同一哈希 → same', () => {
  eq(compareSha(SHA256_SOMETHING, SHA256_SOMETHING), 'same');
});

check('同算法不同哈希 → different', () => {
  eq(compareSha('a'.repeat(64), 'b'.repeat(64)), 'different');
});

check('长度不同（40 vs 64）→ incomparable（旧实现当成「没变」）', () => {
  eq(compareSha(SHA1_FIRST_WEEK, SHA256_SOMETHING), 'incomparable');
});

check('任一侧缺失 → missing', () => {
  eq(compareSha(undefined, SHA256_SOMETHING), 'missing');
  eq(compareSha(SHA256_SOMETHING, undefined), 'missing');
  eq(compareSha(null, null), 'missing');
});

check('shaIndicatesUpdate：different / incomparable 视为有更新', () => {
  eq(shaIndicatesUpdate('same'), false, 'same');
  eq(shaIndicatesUpdate('missing'), false, 'missing');
  eq(shaIndicatesUpdate('different'), true, 'different');
  eq(shaIndicatesUpdate('incomparable'), true, 'incomparable');
});

// =====================================================================
section('M28 — 汉字数字转换不得破坏普通词语');

check('「一般」不被改成「1般」', () => {
  eq(chineseToNumber('一般情况下需检查'), '一般情况下需检查');
});

check('「十分重要」不被改成「10分重要」', () => {
  eq(chineseToNumber('十分重要'), '十分重要');
});

check('「一带一路」不被改成「1带1路」', () => {
  eq(chineseToNumber('一带一路'), '一带一路');
});

check('「十有八九」「一起」「一样」「一致」「一定」保持不变', () => {
  eq(chineseToNumber('十有八九'), '十有八九');
  eq(chineseToNumber('一起处理'), '一起处理');
  eq(chineseToNumber('一样的要求'), '一样的要求');
  eq(chineseToNumber('保持一致'), '保持一致');
  eq(chineseToNumber('一定检查'), '一定检查');
});

check('「第十项」「统一」保持不变（片段前是汉字）', () => {
  eq(chineseToNumber('第十项'), '第十项');
  eq(chineseToNumber('统一管理'), '统一管理');
});

check('真正的数量表达正常转换', () => {
  eq(chineseToNumber('三台水泵'), '3台水泵');
  eq(chineseToNumber('二十三个'), '23个');
  eq(chineseToNumber('十三'), '13');
  eq(chineseToNumber('五条'), '5条');
  eq(chineseToNumber('十'), '10');
});

check('纯单位串（千万/十万）保持不变', () => {
  eq(chineseToNumber('千万注意'), '千万注意');
});

check('lowerToUpper 处理全角字母', () => {
  eq(lowerToUpper('ａｂｃ abc'), 'ABC ABC');
});

check('removeSpaces 处理制表符与 NBSP，保留换行', () => {
  eq(removeSpaces('a\tb\u00a0c\nd'), 'abc\nd');
});

// =====================================================================
section('M29 — 分类关键词按词边界匹配');

check('英文单词内部的 ups 不再误命中「配电」', () => {
  // backups / groups / startups 里都含 ups
  eq(autoDetectCategory('定时检查服务器 backups 任务', '与网络交换机状态'), '弱电');
});

check('真正出现 UPS 时仍命中「配电」', () => {
  eq(autoDetectCategory('UPS 电池后备时间', '检查 UPS 蓄电池组'), '配电');
});

check('中文关键词照常命中', () => {
  eq(autoDetectCategory('制冷系统', '冷冻水供水温度'), '暖通');
  eq(autoDetectCategory('消防检查', '灭火器压力'), '消防');
});

check('无关键词时返回空分类', () => {
  eq(autoDetectCategory('随便的标题', '随便的内容 xyz'), '');
});

// =====================================================================
section('知识总结历史版本 — 去除指纹校验，仅「空/规则版本/用户点击」三条生成途径');

const {
  SUMMARY_DOC_VERSION,
  pickActiveVersion,
  resolveSummaryAction,
  removeVersionFromHistory,
  normalizeHistory,
  legacyContentOf,
  migrateLegacyHistory,
} = await import('../src/utils/knowledgeSummary');

type Ver = { id: string; version: string; content: string; createdAt: number };
const mkVersion = (id: string, version = SUMMARY_DOC_VERSION): Ver => ({
  id,
  version,
  content: `content-${id}`,
  createdAt: 0,
});

check('文档规则版本固定为 v1', () => {
  eq(SUMMARY_DOC_VERSION, 'v1');
});

check('pickActiveVersion：空历史返回 null', () => {
  eq(pickActiveVersion([], null), null);
});

check('pickActiveVersion：无 activeId 时回退到最新一条', () => {
  const h = [mkVersion('a'), mkVersion('b')];
  eq(pickActiveVersion(h, null)?.id, 'b');
});

check('pickActiveVersion：activeId 命中时返回该条', () => {
  const h = [mkVersion('a'), mkVersion('b')];
  eq(pickActiveVersion(h, 'a')?.id, 'a');
});

check('pickActiveVersion：activeId 失效时回退到最新一条', () => {
  const h = [mkVersion('a'), mkVersion('b')];
  eq(pickActiveVersion(h, 'missing')?.id, 'b');
});

check('resolveSummaryAction：历史为空 → generate（首次）', () => {
  eq(resolveSummaryAction([], null, 'v1', false), 'generate');
});

check('resolveSummaryAction：版本一致且未强制 → use-cache（不再比对内容指纹）', () => {
  const h = [mkVersion('a')];
  eq(resolveSummaryAction(h, null, 'v1', false), 'use-cache');
});

check('resolveSummaryAction：版本不一致（软件更新）→ generate', () => {
  const h = [mkVersion('a', 'v0')];
  eq(resolveSummaryAction(h, null, 'v1', false), 'generate');
});

check('resolveSummaryAction：用户强制重新生成 → generate', () => {
  const h = [mkVersion('a')];
  eq(resolveSummaryAction(h, 'a', 'v1', true), 'generate');
});

check('removeVersionFromHistory：删除非当前版本，当前项不变', () => {
  const r = removeVersionFromHistory([mkVersion('a'), mkVersion('b')], 'a', 'b');
  eq(r.history.map((x) => x.id), ['b']);
  eq(r.activeId, 'b');
});

check('removeVersionFromHistory：删除当前版本，回退到剩余最新一条', () => {
  const r = removeVersionFromHistory([mkVersion('a'), mkVersion('b')], 'b', 'b');
  eq(r.history.map((x) => x.id), ['a']);
  eq(r.activeId, 'a');
});

check('removeVersionFromHistory：删除最后一条，activeId 置空', () => {
  const r = removeVersionFromHistory([mkVersion('a')], 'a', 'a');
  eq(r.history.length, 0);
  eq(r.activeId, null);
});

// =====================================================================
section('历史版本归一化与旧数据迁移 — 修复「重新生成后历史记录消失」');

check('normalizeHistory：非数组一律返回空数组（不抛错、不误删历史）', () => {
  eq(normalizeHistory(null), []);
  eq(normalizeHistory(undefined), []);
  eq(normalizeHistory({ content: 'x' }), []);
  eq(normalizeHistory('raw'), []);
});

check('normalizeHistory：剔除缺 id / 内容为空的脏条目', () => {
  const dirty = [mkVersion('a'), { id: '', content: 'x' }, { id: 'b', content: '' }, null, 42, mkVersion('c')];
  eq(normalizeHistory(dirty).map((v) => v.id), ['a', 'c']);
});

check('normalizeHistory：按 id 去重，保留首次出现', () => {
  const dup = [{ ...mkVersion('a'), createdAt: 2 }, { ...mkVersion('a'), createdAt: 1 }, mkVersion('b')];
  const out = normalizeHistory(dup);
  eq(out.length, 2);
  eq([...out.map((v) => v.id)].sort(), ['a', 'b']);
  eq(out.find((v) => v.id === 'a')?.createdAt, 2);
});

check('normalizeHistory：按生成时间升序排列（决定「当前版本」回退顺序）', () => {
  const h = [
    { ...mkVersion('c'), createdAt: 300 },
    { ...mkVersion('a'), createdAt: 100 },
    { ...mkVersion('b'), createdAt: 200 },
  ];
  eq(normalizeHistory(h).map((v) => v.id), ['a', 'b', 'c']);
  eq(pickActiveVersion(normalizeHistory(h), null)?.id, 'c');
});

check('normalizeHistory：缺失版本号时补当前文档规则号', () => {
  const out = normalizeHistory([{ id: 'a', content: 'c', createdAt: 1 }]);
  eq(out[0].version, SUMMARY_DOC_VERSION);
});

check('normalizeHistory：脏数据归一化后不丢条目（稳定幂等）', () => {
  const cleaned = normalizeHistory([mkVersion('a'), mkVersion('b')]);
  eq(normalizeHistory(cleaned).map((v) => v.id), ['a', 'b']);
});

check('legacyContentOf：兼容旧缓存结构 { content, signature }', () => {
  eq(legacyContentOf({ content: '旧总结正文', signature: 'abc' }), '旧总结正文');
});

check('legacyContentOf：兼容直接存字符串，其余情况返回空串', () => {
  eq(legacyContentOf('纯字符串历史'), '纯字符串历史');
  eq(legacyContentOf(null), '');
  eq(legacyContentOf({ signature: 'abc' }), '');
});

check('migrateLegacyHistory：已有历史时绝不覆盖', () => {
  const h = [mkVersion('a')];
  const out = migrateLegacyHistory({ content: '旧缓存' }, h, 1700000000000);
  eq(out.map((v) => v.id), ['a']);
});

check('migrateLegacyHistory：历史为空时把旧缓存迁移为第一条版本', () => {
  const out = migrateLegacyHistory({ content: '旧总结正文', signature: 'sig' }, [], 1700000000000);
  eq(out.length, 1);
  eq(out[0].content, '旧总结正文');
  eq(out[0].version, SUMMARY_DOC_VERSION);
  eq(out[0].createdAt, 1700000000000);
});

check('migrateLegacyHistory：迁移结果可被 normalizeHistory 稳定保留', () => {
  const out = migrateLegacyHistory({ content: '旧总结正文' }, [], 1700000000000);
  eq(normalizeHistory(out).length, 1);
});

check('migrateLegacyHistory：无旧缓存时不产生幽灵版本', () => {
  eq(migrateLegacyHistory(null, []), []);
  eq(migrateLegacyHistory({ content: '   ' }, []).length, 0);
});

// =====================================================================
console.log(`\n${'='.repeat(64)}`);
console.log(`通过 ${passed} 项，失败 ${failures.length} 项`);
if (failures.length > 0) {
  console.log('\n失败明细：');
  failures.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
  process.exit(1);
}
console.log('全部通过 ✅');
