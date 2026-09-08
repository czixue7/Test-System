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
 * 文本中汉字数字转阿拉伯数字。
 * 保护规则：只转换含个位数字字符的片段；纯单位串（千万/十万等成语性组合）保留；
 * 单独的"十/拾"按 10 处理。
 */
export function chineseToNumber(text: string): string {
  const re = /[零〇一二三四五六七八九十百千万亿两壹贰叁肆伍陆柒捌玖拾佰仟]+/g;
  return text.replace(re, (m) => {
    if (m === '十' || m === '拾') return '10';
    if (!hasDigitChar(m)) return m; // 千万/十万/百万 等程度词不转
    const v = parseChineseNumber(m);
    if (v === null || v > 999999999999) return m;
    return String(v);
  });
}

// ===== 英文小写 → 英文大写 =====

/** 文本中英文小写字母转大写（abc→ABC），不影响数字与中文 */
export function lowerToUpper(text: string): string {
  return text.replace(/[a-z]+/g, (m) => m.toUpperCase());
}

/** 去除空格（半角 + 全角），保留换行 */
export function removeSpaces(text: string): string {
  return text.replace(/[ \u3000]/g, '');
}

/** 按设置顺序应用全部转换 */
export function applyConversions(text: string, settings: NoteConvertSettings): string {
  let out = text;
  if (settings.lowerToUpper) out = lowerToUpper(out);
  if (settings.chineseToNumber) out = chineseToNumber(out);
  if (settings.removeSpaces) out = removeSpaces(out);
  return out;
}
