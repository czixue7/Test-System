/**
 * "帮我记"文本转换工具
 * 支持：汉字数字转阿拉伯数字（叁→3）、英文小写转大写（abc→ABC）、去除空格
 */

export interface NoteConvertSettings {
  chineseToNumber: boolean;   // 汉字转数字：叁→3
  lowerToUpper: boolean;      // 英文小写转大写：abc→ABC
  removeSpaces: boolean;      // 去除空格
}

export const DEFAULT_NOTE_CONVERT: NoteConvertSettings = {
  chineseToNumber: false,
  lowerToUpper: false,
  removeSpaces: false,
};

// ===== 汉字数字 → 阿拉伯数字 =====

const CHN_NUM: Record<string, number> = {
  零: 0, 〇: 0, 一: 1, 壹: 1, 二: 2, 贰: 2, 两: 2, 三: 3, 叁: 3,
  四: 4, 肆: 4, 五: 5, 伍: 5, 六: 6, 陆: 6, 七: 7, 柒: 7,
  八: 8, 捌: 8, 九: 9, 玖: 9,
};

const CHN_UNIT: Record<string, number> = {
  十: 10, 拾: 10, 百: 100, 佰: 100, 千: 1000, 仟: 1000, 万: 10000, 亿: 100000000,
};

/** 解析纯中文数字串（如"三百二十"）为整数，失败返回 null */
export function parseChineseNumber(str: string): number | null {
  if (!str) return null;
  let total = 0;      // 累计（万亿级）
  let section = 0;    // 当前小节
  let number = 0;     // 当前个位
  let seenDigit = false;
  for (const ch of str) {
    if (ch in CHN_NUM) {
      number = CHN_NUM[ch];
      seenDigit = true;
    } else if (ch in CHN_UNIT) {
      const u = CHN_UNIT[ch];
      if (u >= 10000) {
        // 万/亿 截断
        if (number === 0 && !seenDigit) number = 1;
        section = (section + number) * u;
        total += section;
        section = 0;
        number = 0;
        seenDigit = false;
      } else {
        // 十/百/千
        if (number === 0 && !seenDigit) number = 1;
        section += number * u;
        number = 0;
        seenDigit = false;
      }
    } else {
      return null;
    }
  }
  total += section + number;
  return total;
}

/** 片段是否包含个位数字字符（避免"千万""十万"等程度词被误转） */
function hasDigitChar(m: string): boolean {
  return /[零〇一二三四五六七八九两壹贰叁肆伍陆柒捌玖]/.test(m);
}

/**
 * 允许转换的「量词 / 单位」承接字。
 *
 * 采用白名单而不是黑名单：只有数字片段后面紧跟这些字（或已到片段边界）时才转换，
 * 从而避开 一般 / 一起 / 一样 / 一致 / 一切 / 一定 / 十分 / 一带一路 / 十有八九
 * 这类**词汇内部**的汉字数字。
 *
 * 故意不收「分」「时」：`十分`（很）比 `三分`（三分钟）常见得多，
 * 把「十分重要」改成「10分重要」是不可逆的内容损坏，
 * 而「三分钟」不转换只是漏转，仍可读。
 */
const MEASURE_CHARS = '台个只件条项次遍倍度米吨层号班组人天年月日周秒伏安瓦百十';

/**
 * 文本中汉字数字转阿拉伯数字。
 */
export function chineseToNumber(text: string): string {
  const re = /[零〇一二三四五六七八九十百千万亿两壹贰叁肆伍陆柒捌玖拾佰仟]+/g;
  return text.replace(re, (m, offset: number, whole: string) => {
    const prev = offset > 0 ? whole[offset - 1] : '';
    const next = whole[offset + m.length] ?? '';

    // 片段前一个字符是汉字/字母 → 处于词内部（统一、第十、方案一…），不转换
    if (prev && /[\u4e00-\u9fa5A-Za-z]/.test(prev)) return m;
    // 片段后一个字符是汉字时，只有明确的量词/单位才转换
    if (next && /[\u4e00-\u9fa5]/.test(next) && !MEASURE_CHARS.includes(next)) return m;

    if (m === '十' || m === '拾') return '10';
    if (!hasDigitChar(m)) return m; // 千万/十万/百万 等程度词不转
    const v = parseChineseNumber(m);
    if (v === null || v > 999999999999) return m;
    return String(v);
  });
}

// ===== 英文小写 → 英文大写 =====

/**
 * 文本中英文小写字母转大写（abc→ABC），不影响数字与中文。
 * 全角字母（ａ-ｚ，常见于中文输入法）先转半角再大写，
 * 否则「ＡＢＣ」无法与 ASCII 的「ABC」比对。
 */
export function lowerToUpper(text: string): string {
  return text.replace(/[\uff41-\uff5a]|[a-z]+/g, (m) => {
    const halfWidth = m.replace(/[\uff41-\uff5a]/g, (ch) =>
      String.fromCharCode(ch.charCodeAt(0) - 0xfee0)
    );
    return halfWidth.toUpperCase();
  });
}

/** 去除空格（半角 + 全角 + 制表符 + NBSP），保留换行 */
export function removeSpaces(text: string): string {
  return text.replace(/[\t \u3000\u00a0]/g, '');
}

/** 按设置顺序应用全部转换 */
export function applyConversions(text: string, settings: NoteConvertSettings): string {
  let out = text;
  if (settings.lowerToUpper) out = lowerToUpper(out);
  if (settings.chineseToNumber) out = chineseToNumber(out);
  if (settings.removeSpaces) out = removeSpaces(out);
  return out;
}
