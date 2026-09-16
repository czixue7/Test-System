/**
 * 知识库/题库总结文件生成与缓存
 * 首次调用时用 AI 分段总结全部内容（不截断、不遗漏），缓存本地，可导出。
 * 内容过长时自动切分为多个知识块，逐块 AI 总结后再合并为完整总结。
 */
import { KnowledgeItem, QuestionBank, Question } from '../types';
import { getStoreValue, setStoreValue } from './tauriStore';
import { apiGradingService } from './apiGradingService';
import { useSettingsStore } from '../store/settingsStore';
import { useKnowledgeStore } from '../store/knowledgeStore';
import { useQuestionBankStore } from '../store/questionBankStore';

export type SummaryType = 'knowledge' | 'questionBank' | 'combined';

const SUMMARY_LABEL: Record<SummaryType, string> = {
  knowledge: '知识库',
  questionBank: '题库',
  combined: '综合',
};

// 单块输入字符上限（AI 单次总结的合理上下文长度，超过则自动切块，确保不丢内容）
const CHUNK_SIZE = 8000;

// 进度回调：done/total 为已处理块数，phase 为当前阶段
export type SummaryProgress = (done: number, total: number, phase: 'split' | 'summarize' | 'merge') => void;

// 简单字符串 hash（用于判断内容是否变化）
function hashCode(str: string): string {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  }
  return h.toString(36);
}

// 题目题干文本（兼容 question / content 两种字段，本项目题目内容在 content 中）
function questionText(q: Question): string {
  return (q.question || '').trim() || (q.content || '').trim();
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
  return items.map((i) => `【${i.title}】${i.category ? `（${i.category}）` : ''}${i.content}`).join('\n');
}

function bankRawText(banks: QuestionBank[]): string {
  return banks
    .map((b) =>
      `\n## ${b.name}\n${(b.questions || [])
        .map((q, i) => `${i + 1}. ${questionText(q)} 答：${answerText(q)}${q.explanation ? `（解析：${q.explanation}）` : ''}`)
        .join('\n')}`
    )
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
      lines.push(`### ${i + 1}. ${questionText(q) || '(无题目内容)'}`, '', `**答案**：${answerText(q) || '(无答案)'}`);
      if (q.explanation) lines.push('', `**解析**：${q.explanation}`);
      lines.push('');
    });
  });
  return lines.join('\n');
}

// 计算内容指纹（知识库 + 题库，确保新增/修改后签名变化）
// 附带格式版本：总结展示格式变化（如题库清单改为折叠块）或生成规则变化（如冲突优先级）时使旧缓存失效
const SUMMARY_FORMAT_VERSION = 5;
function computeSignature(type: SummaryType, items: KnowledgeItem[], banks: QuestionBank[]): string {
  // ⚠️ 指纹必须覆盖**所有进入 prompt 的字段**。
  // 旧实现只取 title+content 与题干+答案，但喂给 AI 的原文还包含知识条目的
  // category 和题目的 explanation —— 只改分类或只修解析时签名不变，
  // 于是命中旧缓存，并把过期内容当作「核心参考」注入 AI 问答。
  const k = items.map((i) => [i.title, i.category, i.content].join('|')).join('||');
  const q = banks
    .map((b) =>
      (b.questions || [])
        .map((x) => [questionText(x), answerText(x), x.explanation ?? '', x.category ?? '', x.difficulty ?? ''].join('|'))
        .join('|')
    )
    .join('||');
  const base = type === 'knowledge' ? k : type === 'questionBank' ? q : k + '|||' + q;
  return hashCode(SUMMARY_FORMAT_VERSION + '::' + base);
}

// ===== 分段总结 =====

// 将超过块大小的单元按行二次切分（避免单个大题库整体成块超出 AI 上下文）
function splitUnit(unit: string, chunkSize: number): string[] {
  if (unit.length <= chunkSize) return [unit];
  const lines = unit.split('\n');
  const out: string[] = [];
  let cur = '';
  for (const line of lines) {
    const next = cur ? cur + '\n' + line : line;
    if (next.length > chunkSize && cur) {
      out.push(cur);
      cur = line;
    } else {
      cur = next;
    }
  }
  if (cur) out.push(cur);
  return out;
}

// 将原始文本按知识单元切块（优先在题库/条目边界切，大单元再按行切，确保内容不丢）
function chunkRawText(rawText: string, chunkSize = CHUNK_SIZE): string[] {
  const trimmed = rawText.trim();
  if (!trimmed) return [];
  // 单元：题库以 "\n## " 开头，知识条目以 "【" 开头
  const units = trimmed
    .split(/\n(?=## |【)/)
    .map((u) => u.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let current = '';
  for (const unit of units) {
    // 单个单元超过块上限时先按行切分，避免超长块
    const pieces = splitUnit(unit, chunkSize);
    for (const piece of pieces) {
      const next = current ? current + '\n' + piece : piece;
      if (next.length > chunkSize && current) {
        chunks.push(current);
        current = piece;
      } else {
        current = next;
      }
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

// 单块 AI 总结
async function aiSummarizeChunk(index: number, total: number, label: string, chunkText: string): Promise<string> {
  const config = useSettingsStore.getState();
  if (!config.apiKey) throw new Error('未配置 API Key');
  apiGradingService.setConfig({ apiKey: config.apiKey, model: config.apiModel, endpoint: config.apiEndpoint });

  // 综合总结时声明冲突优先级：知识库为权威来源
  const conflictRule = label === '综合'
    ? '冲突处理：若本部分同时包含知识库内容（以【开头）与题库内容（以##开头），两者对同一知识点、参数或标准存在冲突时，一律以知识库内容为准（知识库为权威来源）。'
    : '';

  const prompt = `你是${label}整理助手。请对以下内容（第 ${index}/${total} 部分）进行系统总结：提炼核心知识点、关键数据（如温度范围、冗余等级、计算公式、设备参数、标准要求等必须保留）、操作要点和易错点，输出结构清晰的 Markdown（含小标题与要点列表）。要求：忠实于原文，不遗漏重要信息，不编造原文没有的内容。${conflictRule}\n\n${chunkText}`;

  const result = await apiGradingService.callAPI(prompt, 3000);
  return result.trim();
}

// 合并多块总结为一份完整总结
async function aiMergeSummaries(type: SummaryType, label: string, parts: string[]): Promise<string> {
  const config = useSettingsStore.getState();
  if (!config.apiKey) throw new Error('未配置 API Key');
  apiGradingService.setConfig({ apiKey: config.apiKey, model: config.apiModel, endpoint: config.apiEndpoint });

  const joined = parts.map((p, i) => `【第 ${i + 1} 部分】\n${p}`).join('\n\n');
  // 综合总结时声明冲突优先级：知识库为权威来源
  const conflictRule = type === 'combined'
    ? '冲突处理：知识库内容与题库内容对同一知识点、参数或标准存在冲突时，一律以知识库内容为准（知识库为权威来源）。'
    : '';
  const prompt = `以下是"${label}"各部分内容的 AI 总结。请将其整合成一份结构完整、条理清晰的整体知识总结：按主题/分类组织分节（Markdown），去除重复内容，保留全部关键数据和要点，不要遗漏任何部分中的重要信息，不要添加原文没有的内容。${conflictRule}\n\n${joined}`;

  const result = await apiGradingService.callAPI(prompt, 4000);
  return result.trim();
}

// 完整总结入口（分段 + 合并，覆盖全部内容不截断）
async function aiSummarize(type: SummaryType, rawText: string, onProgress?: SummaryProgress): Promise<string> {
  const label = SUMMARY_LABEL[type];
  const chunks = chunkRawText(rawText);
  if (chunks.length === 0) {
    return `# ${label}总结\n\n> 生成时间：${new Date().toLocaleString()}\n\n（当前无内容）`;
  }
  // 拆份完成：显示拆份阶段（① 拆份高亮，文字"内容已分为 X 份，即将开始总结..."）
  onProgress?.(0, chunks.length, 'split');

  const results: (string | undefined)[] = new Array(chunks.length);

  // 各块相互独立，并发执行；单块失败降级为该块原文，保证整体不缺失
  await Promise.all(
    chunks.map(async (chunk, i) => {
      try {
        results[i] = await aiSummarizeChunk(i + 1, chunks.length, label, chunk);
      } catch (err) {
        console.warn(`[总结] 第 ${i + 1}/${chunks.length} 块 AI 总结失败，降级为该块原文:`, err);
        results[i] = chunk;
      } finally {
        const done = results.filter(Boolean).length;
        // 第一个块完成后才切换到逐份总结阶段（② 高亮），确保①拆份阶段完整显示
        onProgress?.(done, chunks.length, done > 0 ? 'summarize' : 'split');
      }
    })
  );

  const parts = results.filter((r): r is string => Boolean(r && r.trim()));
  let content: string;
  if (parts.length === 1) {
    content = parts[0];
  } else {
    try {
      onProgress?.(0, parts.length, 'merge');
      content = await aiMergeSummaries(type, label, parts);
      onProgress?.(parts.length, parts.length, 'merge');
    } catch (err) {
      console.warn('[总结] 合并总结失败，使用分块总结拼接:', err);
      content = parts.map((p, i) => `## 第 ${i + 1} 部分\n\n${p}`).join('\n\n---\n\n');
    }
  }

  return `# ${label}总结（AI 生成）\n\n${content}`;
}

interface SummaryCache {
  content: string;
  signature: string;
}

// 为总结内容附加覆盖范围说明（合并为单个可折叠框，默认收起，用户基本不需要查看）
function attachCoverage(type: SummaryType, content: string, items: KnowledgeItem[], banks: QuestionBank[]): string {
  const bankCount = banks.length;
  const questionCount = banks.reduce((s, b) => s + (b.questions || []).length, 0);
  const bankNames = banks.map((b) => b.name).filter(Boolean);
  const knowledgeCount = items.length;

  const hasBank = type === 'questionBank' || type === 'combined';
  const hasKnowledge = type === 'knowledge' || type === 'combined';
  if (!hasBank && !hasKnowledge) return content;

  // 生成时间（年月日 时分，不显示秒）
  const d = new Date();
  const timeStr = `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

  // 展开内容行（知识库在前，题库在后，最后题库清单）
  const detailLines: string[] = [];
  if (hasKnowledge) detailLines.push(`<p>覆盖知识库：${knowledgeCount} 篇</p>`);
  if (hasBank) detailLines.push(`<p>覆盖题库：${bankCount} 个，共 ${questionCount} 道题</p>`);
  if (hasBank && bankNames.length > 0) detailLines.push(`<p>题库清单：${bankNames.join('、')}</p>`);

  // 折叠框：summary 左右分布（左生成时间，右知识库/题库数 + 展开收起提示）
  const details = [
    '<details>',
    `<summary><span class="kb-summary-time">生成于 ${timeStr}</span><span class="kb-summary-count">${knowledgeCount} 知识库 / ${bankCount} 题库<span class="kb-collapsed">（点击展开）</span><span class="kb-expanded">（点击收起）</span></span></summary>`,
    '<div class="kb-details-content">',
    ...detailLines,
    '</div>',
    '</details>',
    ''
  ].join('\n');

  // 在首个标题行后插入折叠框
  const firstLine = content.split('\n')[0];
  const rest = content.slice(firstLine.length);
  return `${firstLine}\n\n${details}${rest}`;
}

// 同一签名的生成任务复用在途 Promise。
// 大题库一次总结要 N 个并发块请求 + 1 次合并、耗时数分钟；期间每次提问都会
// 调用 getOrCreateSummary。旧实现没有任何互斥，会并发跑多份完整总结
// （API 费用与 429 限流风险成倍放大，多轮 onProgress 还会互相清掉进度条）。
const inflightSummaries = new Map<string, Promise<{ content: string; generated: boolean }>>();

// 获取或生成总结（带缓存，内容变化时重新生成；force=true 强制忽略缓存重新生成）
export async function getOrCreateSummary(
  type: SummaryType,
  _items?: KnowledgeItem[],
  _banks?: QuestionBank[],
  onProgress?: SummaryProgress,
  force = false
): Promise<{ content: string; generated: boolean }> {
  // 始终使用 store 最新数据，确保包含全部内置题库与用户题库。
  // 调用方传入的快照可能因异步加载时序而过期/不完整，故以 store 实时数据为准。
  const items = useKnowledgeStore.getState().items;
  const banks = useQuestionBankStore.getState().banks;

  const key = `${type}-summary`;
  const signature = computeSignature(type, items, banks);

  if (!force) {
    const cached = await getStoreValue<SummaryCache | null>(key, null);
    if (cached && cached.signature === signature && cached.content) {
      return { content: cached.content, generated: false };
    }
  } else {
    console.log(`[总结] 强制重新生成 ${type} 总结`);
  }

  const inflightKey = `${key}::${signature}::${force ? 'force' : 'auto'}`;
  const running = inflightSummaries.get(inflightKey);
  if (running) {
    console.log(`[总结] 复用进行中的生成任务: ${inflightKey}`);
    return running;
  }

  const task = (async (): Promise<{ content: string; generated: boolean }> => {
    let content: string;
    let degraded = false;

    try {
      const rawText =
        type === 'knowledge'
          ? knowledgeRawText(items)
          : type === 'questionBank'
            ? bankRawText(banks)
            : knowledgeRawText(items) + '\n' + bankRawText(banks);
      content = await aiSummarize(type, rawText, onProgress);
    } catch (err) {
      degraded = true;
      console.warn('[总结] AI 总结失败，降级为内容汇总:', err);
      content =
        type === 'knowledge'
          ? knowledgeMarkdown(items)
          : type === 'questionBank'
            ? bankMarkdown(banks)
            : `# 综合总结（知识库 + 题库）\n\n> 生成时间：${new Date().toLocaleString()}\n\n---\n\n${knowledgeMarkdown(items)}\n\n---\n\n${bankMarkdown(banks)}`;
    }

    content = attachCoverage(type, content, items, banks);

    if (degraded) {
      // ⚠️ 降级产物（原文拼接）**不写缓存**。
      // 旧实现把它当成正常结果缓存：用户之后配好 API Key 再点「查看知识总结」，
      // 因为签名没变会一直命中这份降级文档，只能靠「重新生成」自救。
      console.warn('[总结] 本次为降级结果，不写入缓存（下次会自动重试）');
    } else {
      await setStoreValue(key, { content, signature });
    }

    return { content, generated: true };
  })();

  inflightSummaries.set(inflightKey, task);
  try {
    return await task;
  } finally {
    inflightSummaries.delete(inflightKey);
  }
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
