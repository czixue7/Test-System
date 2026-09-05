/**
 * 知识库/题库总结文件生成与缓存
 * 首次调用时用 AI 总结内容生成 markdown 总结文件（未配置 API 时降级为内容汇总），缓存本地，可导出。
 */
import { KnowledgeItem, QuestionBank, Question } from '../types';
import { getStoreValue, setStoreValue } from './tauriStore';
import { apiGradingService } from './apiGradingService';
import { useSettingsStore } from '../store/settingsStore';

export type SummaryType = 'knowledge' | 'questionBank' | 'combined';

const SUMMARY_LABEL: Record<SummaryType, string> = {
  knowledge: '知识库',
  questionBank: '题库',
  combined: '综合',
};

// 简单字符串 hash（用于判断内容是否变化）
function hashCode(str: string): string {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  }
  return h.toString(36);
}

// 提取题目答案文本
function answerText(q: Question): string {
  const a = q.correctAnswer;
  if (Array.isArray(a)) return a.join('；');
  if (typeof a === 'string') return a;
  if (a && typeof a === 'object' && 'text' in a) return (a as { text: string }).text;
  return '';
}

// 紧凑原文（用于 AI 输入）
function knowledgeRawText(items: KnowledgeItem[]): string {
  return items.map((i) => `【${i.title}】${i.content}`).join('\n');
}

function bankRawText(banks: QuestionBank[]): string {
  return banks
    .map((b) => `\n## ${b.name}\n${(b.questions || []).map((q, i) => `${i + 1}. ${q.question || ''} 答：${answerText(q)}`).join('\n')}`)
    .join('\n');
}

// 完整 markdown（AI 降级时使用）
function knowledgeMarkdown(items: KnowledgeItem[]): string {
  const lines: string[] = [`# 知识库总结`, '', `> 生成时间：${new Date().toLocaleString()}　|　共 ${items.length} 篇`, ''];
  const grouped = new Map<string, KnowledgeItem[]>();
  items.forEach((item) => {
    const cat = item.category || '未分类';
    if (!grouped.has(cat)) grouped.set(cat, []);
    grouped.get(cat)!.push(item);
  });
  for (const [cat, list] of Array.from(grouped.entries()).sort()) {
    lines.push(`## ${cat}`, '');
    list.forEach((item, i) => {
      lines.push(`### ${i + 1}. ${item.title}`, '', item.content, '');
    });
  }
  return lines.join('\n');
}

function bankMarkdown(banks: QuestionBank[]): string {
  const lines: string[] = [`# 题库总结`, '', `> 生成时间：${new Date().toLocaleString()}　|　共 ${banks.length} 个题库`, ''];
  banks.forEach((bank) => {
    lines.push(`## ${bank.name}`, '');
    (bank.questions || []).forEach((q, i) => {
      lines.push(`### ${i + 1}. ${q.question || '(无题目内容)'}`, '', `**答案**：${answerText(q) || '(无答案)'}`);
      if (q.explanation) lines.push('', `**解析**：${q.explanation}`);
      lines.push('');
    });
  });
  return lines.join('\n');
}

// 计算内容指纹（知识库 + 题库，确保新增/修改后签名变化）
function computeSignature(type: SummaryType, items: KnowledgeItem[], banks: QuestionBank[]): string {
  const k = items.map((i) => i.title + '|' + i.content).join('||');
  const q = banks.map((b) => (b.questions || []).map((x) => x.question + '|' + answerText(x)).join('|')).join('||');
  const base = type === 'knowledge' ? k : type === 'questionBank' ? q : k + '|||' + q;
  return hashCode(base);
}

// AI 总结
async function aiSummarize(type: SummaryType, rawText: string): Promise<string> {
  const config = useSettingsStore.getState();
  if (!config.apiKey) throw new Error('未配置 API Key');
  apiGradingService.setConfig({ apiKey: config.apiKey, model: config.apiModel });

  const label = SUMMARY_LABEL[type];
  const prompt = `请对以下${label}内容进行系统总结，按主题/分类提炼核心知识点、关键操作和注意事项，输出结构清晰的 Markdown 总结（含标题、分节、要点列表）。若内容较长，请抓取最重要的信息。\n\n${rawText.slice(0, 12000)}`;

  const result = await apiGradingService.callAPI(prompt, 3000);
  return `# ${label}总结（AI 生成）\n\n> 生成时间：${new Date().toLocaleString()}\n\n${result}`;
}

interface SummaryCache {
  content: string;
  signature: string;
}

// 获取或生成总结（带缓存，内容变化时重新生成）
export async function getOrCreateSummary(
  type: SummaryType,
  items: KnowledgeItem[],
  banks: QuestionBank[]
): Promise<{ content: string; generated: boolean }> {
  const key = `${type}-summary`;
  const signature = computeSignature(type, items, banks);

  const cached = await getStoreValue<SummaryCache | null>(key, null);
  if (cached && cached.signature === signature && cached.content) {
    return { content: cached.content, generated: false };
  }

  let content: string;
  try {
    const rawText =
      type === 'knowledge'
        ? knowledgeRawText(items)
        : type === 'questionBank'
          ? bankRawText(banks)
          : knowledgeRawText(items) + '\n' + bankRawText(banks);
    content = await aiSummarize(type, rawText);
  } catch (err) {
    console.warn('[总结] AI 总结失败，降级为内容汇总:', err);
    content =
      type === 'knowledge'
        ? knowledgeMarkdown(items)
        : type === 'questionBank'
          ? bankMarkdown(banks)
          : `# 综合总结（知识库 + 题库）\n\n> 生成时间：${new Date().toLocaleString()}\n\n---\n\n${knowledgeMarkdown(items)}\n\n---\n\n${bankMarkdown(banks)}`;
  }

  await setStoreValue(key, { content, signature });
  return { content, generated: true };
}

// 导出 markdown 文件（下载）
export function downloadSummary(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
