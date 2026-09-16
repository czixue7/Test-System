/**
 * 知识库导入解析器
 * 支持 Excel（标题/分类/内容列）、JSON、纯文本等格式。
 */
import * as XLSX from 'xlsx';
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

// 解析 Excel
async function parseExcel(file: File): Promise<KnowledgeDraft[]> {
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { type: 'array', cellDates: false });
  const items: KnowledgeDraft[] = [];

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
    if (!rows.length) continue;

    // 找表头行
    let headerRow = -1;
    for (let r = 0; r < Math.min(5, rows.length); r++) {
      const joined = (rows[r] || []).map((c) => String(c ?? '').trim()).join('|');
      if (joined.includes('标题') || joined.includes('内容') || joined.includes('分类')) {
        headerRow = r;
        break;
      }
    }

    // 确定列索引
    let titleCol = -1;
    let categoryCol = -1;
    let contentCol = -1;
    if (headerRow >= 0) {
      const header = (rows[headerRow] || []).map((c) => String(c ?? '').trim());
      header.forEach((h, i) => {
        if (h.includes('标题') || h.includes('题目') || h.includes('名称')) titleCol = i;
        if (h.includes('分类') || h.includes('类别') || h.includes('专业')) categoryCol = i;
        if (h.includes('内容') || h.includes('正文') || h.includes('说明')) contentCol = i;
      });
    }
    const startRow = headerRow >= 0 ? headerRow + 1 : 0;
    if (titleCol < 0 && contentCol < 0) {
      titleCol = 0;
      categoryCol = 1;
      contentCol = 2;
    }

    for (let r = startRow; r < rows.length; r++) {
      const row = rows[r] || [];
      const title = titleCol >= 0 ? String(row[titleCol] ?? '').trim() : '';
      const category = categoryCol >= 0 ? String(row[categoryCol] ?? '').trim() : '';
      const content = contentCol >= 0 ? String(row[contentCol] ?? '').trim() : '';

      const finalTitle = title || content.slice(0, 30);
      const finalContent = content || title;
      if (!finalContent) continue;

      items.push({
        title: finalTitle,
        category: category || autoDetectCategory(finalTitle, finalContent),
        content: finalContent,
      });
    }
  }

  if (items.length === 0) throw new Error('未在 Excel 中识别到知识内容');
  return items;
}

// 解析文本
async function parseText(file: File): Promise<KnowledgeDraft[]> {
  const text = await file.text();
  if (!text.trim()) throw new Error('文件为空');
  const title = file.name.replace(/\.[^.]+$/, '');
  return [{ title, category: autoDetectCategory(title, text), content: text }];
}

// 解析 JSON
async function parseJson(file: File): Promise<KnowledgeDraft[]> {
  const text = await file.text();
  const data = JSON.parse(text);
  const arr = Array.isArray(data) ? data : [data];
  return arr
    .map((item: any) => {
      const title = String(item.title ?? item.name ?? '').trim();
      const content = String(item.content ?? item.body ?? item.text ?? '').trim();
      const category = String(item.category ?? '').trim();
      return {
        title: title || content.slice(0, 30),
        category: category || autoDetectCategory(title, content),
        content: content || title,
      };
    })
    .filter((i) => i.content);
}

// 统一入口
export async function parseKnowledgeFile(file: File): Promise<KnowledgeDraft[]> {
  const ext = file.name.split('.').pop()?.toLowerCase();
  if (ext === 'xlsx' || ext === 'xls') return parseExcel(file);
  if (ext === 'json') return parseJson(file);
  return parseText(file);
}
