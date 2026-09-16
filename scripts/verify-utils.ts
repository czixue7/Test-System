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
console.log(`\n${'='.repeat(64)}`);
console.log(`通过 ${passed} 项，失败 ${failures.length} 项`);
if (failures.length > 0) {
  console.log('\n失败明细：');
  failures.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
  process.exit(1);
}
console.log('全部通过 ✅');
