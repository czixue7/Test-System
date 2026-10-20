/**
 * 知识库导入解析器
 * 仅支持纯文本（.txt）与 Markdown（.md）格式。
 */
import { KnowledgeItem } from '../types';

type KnowledgeDraft = Omit<KnowledgeItem, 'id' | 'createdAt' | 'updatedAt'>;

/**
 * 关键词是否命中。
 * 拉丁/数字关键词必须按**词边界**匹配，否则短词会在英文单词内部误命中：
 * 'ups' 会命中 backups / groups / startups，'ahu'/'cdu'/'bms'/'pdu' 同理；
 * 且「配电」规则排在最前，一旦误命中就不会被后面的规则纠正。
 */
function matchesKeyword(text: string, keyword: string): boolean {
  if (/^[a-z0-9]+$/i.test(keyword)) {
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(text);
  }
  return text.includes(keyword);
}

// 根据文本关键词自动判断专业领域
export function autoDetectCategory(title: string, content: string): string {
  const text = (title + ' ' + content).toLowerCase();
  const rules: Array<{ category: string; keywords: string[] }> = [
    { category: '配电', keywords: ['配电', '市电', 'ups', '柴发', '变压器', '开关柜', '母线', 'pdu', '列头柜', '配电柜', '蓄电池'] },
    { category: '暖通', keywords: ['暖通', '制冷', '冷却', '冷源', '冷机', '冷冻', '空调', 'ahu', 'cdu', '水泵', '水冷', '水系统', '管道', '补水'] },
    { category: '弱电', keywords: ['弱电', 'bms', '监控', '安防', '门禁', '视频', '动环', '网络', '交换机', '服务器', '软件', '通讯'] },
    { category: '消防', keywords: ['消防', '火灾', '灭火', '喷淋', '烟感', '消防管网', '油罐', '可燃'] },
  ];
  for (const rule of rules) {
    if (rule.keywords.some((k) => matchesKeyword(text, k))) return rule.category;
  }
  return '';
}

// 解析文本
async function parseText(file: File): Promise<KnowledgeDraft[]> {
  const text = await file.text();
  if (!text.trim()) throw new Error('文件为空');
  const title = file.name.replace(/\.[^.]+$/, '');
  return [{ title, category: autoDetectCategory(title, text), content: text }];
}

// 统一入口：仅支持 .txt / .md
export async function parseKnowledgeFile(file: File): Promise<KnowledgeDraft[]> {
  const ext = file.name.split('.').pop()?.toLowerCase();
  if (ext !== 'txt' && ext !== 'md' && ext !== 'markdown') {
    throw new Error('仅支持导入 .txt / .md 文件');
  }
  return parseText(file);
}
