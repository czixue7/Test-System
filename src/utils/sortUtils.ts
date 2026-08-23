// 中文数字映射表
const CHINESE_NUMERALS: Record<string, number> = {
  '零': 0, '〇': 0, '一': 1, '二': 2, '两': 2, '三': 3, '四': 4,
  '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10,
  '百': 100, '千': 1000, '万': 10000, '亿': 100000000
};

/**
 * 解析中文数字字符串为数值
 * 支持：一、二、...、十、十一、二十、二十一、百、千、万 等
 */
function parseChineseNumeral(str: string): number | null {
  if (!str || str.length === 0) return null;
  
  // 检查是否全为中文数字字符
  for (const char of str) {
    if (!(char in CHINESE_NUMERALS)) {
      return null;
    }
  }
  
  // 简单中文数字（单个字符）
  if (str.length === 1) {
    return CHINESE_NUMERALS[str] ?? null;
  }
  
  // 处理"十"开头的数字（十一到十九）
  if (str.startsWith('十')) {
    if (str.length === 1) return 10;
    const unit = CHINESE_NUMERALS[str[1]];
    if (unit !== undefined && unit < 10) {
      return 10 + unit;
    }
    return null;
  }
  
  // 处理"X十"（二十、三十等）
  if (str.endsWith('十') && str.length === 2) {
    const tens = CHINESE_NUMERALS[str[0]];
    if (tens !== undefined && tens < 10) {
      return tens * 10;
    }
    return null;
  }
  
  // 处理"X十Y"（二十一、三十二等）
  const shiIndex = str.indexOf('十');
  if (shiIndex > 0 && shiIndex < str.length - 1) {
    const tensChar = str[shiIndex - 1];
    const unitChar = str[shiIndex + 1];
    const tens = CHINESE_NUMERALS[tensChar];
    const unit = CHINESE_NUMERALS[unitChar];
    if (tens !== undefined && tens < 10 && unit !== undefined && unit < 10) {
      return tens * 10 + unit;
    }
  }
  
  // 处理"百"级数字
  const baiIndex = str.indexOf('百');
  if (baiIndex > 0) {
    const hundreds = CHINESE_NUMERALS[str[baiIndex - 1]];
    if (hundreds !== undefined && hundreds < 10) {
      let result = hundreds * 100;
      const rest = str.slice(baiIndex + 1);
      if (rest.length > 0) {
        const restVal = parseChineseNumeral(rest);
        if (restVal !== null) {
          result += restVal;
        }
      }
      return result;
    }
  }
  
  return null;
}

/**
 * 判断字符是否为中文数字
 */
function isChineseNumeralChar(char: string): boolean {
  return char in CHINESE_NUMERALS;
}

/**
 * 判断字符是否为阿拉伯数字
 */
function isDigit(char: string): boolean {
  return char >= '0' && char <= '9';
}

/**
 * 判断字符是否为字母
 */
function isLetter(char: string): boolean {
  return (char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z');
}

/**
 * 从字符串的指定位置提取一段连续的同类型字符
 */
function extractSegment(str: string, startIndex: number): { segment: string; type: 'digit' | 'letter' | 'chinese-numeral' | 'other'; length: number } {
  if (startIndex >= str.length) {
    return { segment: '', type: 'other', length: 0 };
  }
  
  const firstChar = str[startIndex];
  
  if (isDigit(firstChar)) {
    // 阿拉伯数字段
    let end = startIndex;
    while (end < str.length && isDigit(str[end])) {
      end++;
    }
    return { segment: str.slice(startIndex, end), type: 'digit', length: end - startIndex };
  }
  
  if (isLetter(firstChar)) {
    // 字母段
    let end = startIndex;
    while (end < str.length && isLetter(str[end])) {
      end++;
    }
    return { segment: str.slice(startIndex, end), type: 'letter', length: end - startIndex };
  }
  
  if (isChineseNumeralChar(firstChar)) {
    // 中文数字段 - 尝试提取最大的中文数字
    let end = startIndex;
    while (end < str.length && isChineseNumeralChar(str[end])) {
      end++;
    }
    // 验证是否是有效的中文数字
    const numStr = str.slice(startIndex, end);
    if (parseChineseNumeral(numStr) !== null) {
      return { segment: numStr, type: 'chinese-numeral', length: end - startIndex };
    }
  }
  
  // 其他字符（包括普通汉字）
  return { segment: firstChar, type: 'other', length: 1 };
}

/**
 * 字典序比较函数
 * 规则：逐字对应，像查字典一样排序
 * - 数字（阿拉伯数字和中文数字）：从小到大（自然排序）
 * - 字母：从 A 到 Z（不区分大小写）
 * - 汉字和其他字符：按 Unicode 编码顺序 / 拼音字典序
 * - 字符类型优先级：数字 < 字母 < 汉字/其他
 */
export function dictionaryCompare(a: string, b: string): number {
  let i = 0;
  let j = 0;
  
  while (i < a.length && j < b.length) {
    const segA = extractSegment(a, i);
    const segB = extractSegment(b, j);
    
    // 如果两个都是数字类型，按数值比较
    if ((segA.type === 'digit' || segA.type === 'chinese-numeral') && 
        (segB.type === 'digit' || segB.type === 'chinese-numeral')) {
      const numA = segA.type === 'digit' 
        ? parseInt(segA.segment, 10) 
        : parseChineseNumeral(segA.segment) ?? 0;
      const numB = segB.type === 'digit' 
        ? parseInt(segB.segment, 10) 
        : parseChineseNumeral(segB.segment) ?? 0;
      
      if (numA !== numB) {
        return numA - numB;
      }
      i += segA.length;
      j += segB.length;
      continue;
    }
    
    // 如果两个都是字母，不区分大小写比较
    if (segA.type === 'letter' && segB.type === 'letter') {
      const cmp = segA.segment.toLowerCase().localeCompare(segB.segment.toLowerCase());
      if (cmp !== 0) {
        return cmp;
      }
      i += segA.length;
      j += segB.length;
      continue;
    }
    
    // 不同类型：数字 < 字母 < 其他
    const typeOrder = (type: string): number => {
      if (type === 'digit' || type === 'chinese-numeral') return 0;
      if (type === 'letter') return 1;
      return 2;
    };
    
    const orderA = typeOrder(segA.type);
    const orderB = typeOrder(segB.type);
    
    if (orderA !== orderB) {
      return orderA - orderB;
    }
    
    // 同类型其他字符，使用 localeCompare 比较（支持中文拼音排序）
    const cmp = segA.segment.localeCompare(segB.segment, 'zh-CN', { sensitivity: 'base' });
    if (cmp !== 0) {
      return cmp;
    }
    
    i += segA.length;
    j += segB.length;
  }
  
  // 一个字符串是另一个的前缀，短的排前面
  return a.length - b.length;
}

/**
 * 按名称进行字典序排序的比较器
 */
export function sortByName<T extends { name: string }>(a: T, b: T): number {
  return dictionaryCompare(a.name, b.name);
}

/**
 * 按 id 进行字典序排序的比较器
 */
export function sortById<T extends { id: string }>(a: T, b: T): number {
  return dictionaryCompare(a.id, b.id);
}
