/**
 * 填空题答案标准化函数
 * 处理不影响答案正确性的格式差异：
 * 1. 全角转半角（Ａ→A, １→1, ，→,）
 * 2. 数学符号统一（×→*, ÷→/, −→-）
 * 3. 大小写统一
 * 4. 分隔符统一（/、，,|；; → /）
 * 5. 数字格式统一（去尾零：36.0→36, 36.50→36.5）
 * 6. 去除正号前缀、补全小数前0（.5→0.5）
 * 7. 去除首尾引号和简单括号
 * 8. 去除末尾标点
 * 9. 空格标准化
 */
export function normalizeAnswer(text: string): string {
  if (!text) return '';

  return text
    .replace(/[\uFF01-\uFF5E]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
    .replace(/\u3000/g, ' ')
    .replace(/[\u00D7\u2715\u2716\u2A2F]/g, '*')
    .replace(/\u00F7/g, '/')
    .replace(/\u2212/g, '-')
    .toLowerCase()
    .replace(/[、，,|；;]/g, '/')
    .replace(/\s*\/\s*/g, '/')
    .replace(/\/+/g, '/')
    .replace(/^\/+|\/+$/g, '')
    .replace(/^\+/, '')
    .replace(/^\./, '0.')
    .replace(/^-\./, '-0.')
    .replace(/(\d+)\.(\d+)/g, (_, intPart, decPart) => {
      const trimmed = decPart.replace(/0+$/, '');
      return trimmed ? `${intPart}.${trimmed}` : intPart;
    })
    .replace(/^["\u201C\u201D''\u2018\u2019]+|["\u201C\u201D''\u2018\u2019]+$/g, '')
    .replace(/^[(\uff08]([^()\uff08\uff09]+)[)\uff09]$/, '$1')
    .replace(/^\[([^\[\]]+)\]$/, '$1')
    .replace(/[\u3002.,\uff0c\uff1b\uff01\uff1f;!?]+$/g, '')
    .trim()
    .replace(/\s+/g, ' ');
}
