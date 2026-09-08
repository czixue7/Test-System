/**
 * 知识库 AI 解答服务
 * 策略：先获取 AI 生成的"知识总结"作为核心参考上下文（覆盖全部知识库/题库内容），
 * 再补充关键词检索到的具体题目/条目作为佐证，基于总结 + 检索结果回答用户问题，
 * 避免因关键词匹配不到而回答"未找到相关内容"。
 *
 * 检索说明：中文问句无天然分词，采用「英文/数字整词 + 停用词切分短语 + 中文 n-gram」
 * 三层关键词提取，避免整句匹配不上导致检索为空。
 */
import { apiGradingService } from './apiGradingService';
import { useSettingsStore } from '../store/settingsStore';
import { useKnowledgeStore } from '../store/knowledgeStore';
import { useQuestionBankStore } from '../store/questionBankStore';
import { KnowledgeSearchSource, Question } from '../types';

// 停用词（作为切分边界，不参与匹配）
const STOP_WORDS = new Set([
  '请问', '一下', '什么', '怎么', '如何', '哪些', '哪个', '一个', '的是',
  '是否', '可以', '需要', '知道', '告诉', '意思', '吗', '呢', '的', '了', '和', '与',
]);

interface Keyword {
  word: string;
  weight: number;
}

// 提取查询关键词（带权重）：英文/数字整词 > 停用词切分短语 > 中文 n-gram
function extractKeywords(query: string): Keyword[] {
  const parts = query
    .split(/[\s,，。;；、?!？！:：·]+/)
    .map((k) => k.trim())
    .filter(Boolean);

  const map = new Map<string, number>();
  const add = (w: string, weight: number) => {
    if (w.length < 2) return;
    map.set(w, Math.max(map.get(w) || 0, weight));
  };

  for (const p of parts) {
    // 1. 停用词切段 → 短语（如 "UPS电池后备时间怎么计算" → "UPS电池后备时间"、"计算"）
    let buf = '';
    const segs: string[] = [];
    for (const ch of p) {
      if (STOP_WORDS.has(ch)) {
        if (buf.length >= 2) segs.push(buf);
        buf = '';
      } else {
        buf += ch;
      }
    }
    if (buf.length >= 2) segs.push(buf);
    segs.forEach((s) => add(s, 4));

    // 2. 英文/数字整词（如 UPS、PUE、T4、GB50174），不切碎
    const en = p.match(/[A-Za-z0-9]{2,}/g);
    if (en) en.forEach((w) => add(w, 6));

    // 3. 中文 2-3 字 n-gram，兜底覆盖（低权重，避免碎片主导排序）
    const han = p.match(/[\u4e00-\u9fa5]+/g) || [];
    for (const h of han) {
      for (let n = 2; n <= 3; n++) {
        for (let i = 0; i + n <= h.length; i++) add(h.slice(i, i + n), 1);
      }
    }
  }

  return Array.from(map.entries()).map(([word, weight]) => ({ word, weight }));
}

// 计算文本相关度：整句包含权重最高，其次按词权重累加
function scoreText(text: string, query: string, keywords: Keyword[]): number {
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  let score = 0;
  if (lowerText.includes(lowerQuery)) score += 20;
  for (const k of keywords) {
    if (lowerText.includes(k.word.toLowerCase())) score += k.weight;
  }
  return score;
}

// 题目全文（题干 + 选项 + 答案 + 解析，扩大检索覆盖面）
function questionFullText(q: Question): string {
  const question = (q.question || '').trim() || (q.content || '').trim();
  const options = (q.options || []).map((o) => o.content).join(' ');
  const answer = Array.isArray(q.correctAnswer)
    ? q.correctAnswer.join('；')
    : typeof q.correctAnswer === 'string'
      ? q.correctAnswer
      : typeof q.correctAnswer === 'object' && q.correctAnswer && 'text' in q.correctAnswer
        ? (q.correctAnswer as { text: string }).text
        : '';
  return `${question} ${options} ${answer} ${q.explanation || ''}`;
}

// 检索知识库相关内容
function searchKnowledgeItems(query: string, limit = 6): string[] {
  const items = useKnowledgeStore.getState().items;
  if (items.length === 0) return [];
  const keywords = extractKeywords(query);
  if (keywords.length === 0) return [];

  return items
    .map((item) => {
      const text = `${item.title} ${item.content}`;
      const score = scoreText(text, query, keywords);
      return { item, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => `【${x.item.title}】${x.item.category ? `（${x.item.category}）` : ''}\n${x.item.content}`);
}

// 检索题库相关内容
function searchQuestionBank(query: string, limit = 6): string[] {
  const banks = useQuestionBankStore.getState().banks;
  const questions = banks.flatMap((b) => (b.questions || []).map((q) => ({ q, bankName: b.name })));
  if (questions.length === 0) return [];
  const keywords = extractKeywords(query);
  if (keywords.length === 0) return [];

  return questions
    .map(({ q, bankName }) => {
      const answer = Array.isArray(q.correctAnswer)
        ? q.correctAnswer.join('；')
        : typeof q.correctAnswer === 'string'
          ? q.correctAnswer
          : typeof q.correctAnswer === 'object' && q.correctAnswer && 'text' in q.correctAnswer
            ? (q.correctAnswer as { text: string }).text
            : '';
      const score = scoreText(questionFullText(q), query, keywords);
      return { q, bankName, answer, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => `【${x.bankName}】${x.q.question || x.q.content}\n【答案】${x.answer}${x.q.explanation ? `\n【解析】${x.q.explanation}` : ''}`);
}

// 构建 prompt
export function buildKnowledgePrompt(
  query: string,
  source: KnowledgeSearchSource,
  summary?: string
): string {
  const sections: string[] = [];

  // 总结内容优先注入（核心参考，覆盖全部知识库/题库）
  if (summary && summary.trim()) {
    sections.push(`【知识总结（核心参考，基于全部知识库/题库内容生成）】\n${summary}`);
  }

  if (source === 'knowledge' || source === 'combined') {
    const knowledgeContext = searchKnowledgeItems(query);
    if (knowledgeContext.length > 0) {
      sections.push(`【知识库相关条目】\n${knowledgeContext.join('\n\n')}`);
    }
  }

  if (source === 'questionBank' || source === 'combined') {
    const questionContext = searchQuestionBank(query);
    if (questionContext.length > 0) {
      sections.push(`【题库相关题目】\n${questionContext.join('\n\n')}`);
    }
  }

  // 无任何本地上下文（纯 AI 模式或内容为空）：直接通用问答
  if (sections.length === 0) {
    return `请回答以下问题，尽可能详细、准确：\n\n${query}`;
  }

  const contextText = sections.join('\n\n');

  return `你是一个专业的知识解答助手。请结合下面提供的参考资料回答用户问题。

参考资料：
${contextText}

回答要求：
1. 优先从【知识总结】中提取相关知识作答，该总结是对全部知识库/题库内容的系统提炼，覆盖了绝大部分知识点；
2. 若【知识库相关条目】或【题库相关题目】中有直接相关内容，请引用其中的关键信息作为佐证；
3. 参考材料未覆盖的细节，请结合你的专业知识补充完整，使答案完整可用；
4. 不要因为参考材料中没有出现与问题完全相同的表述就回答"未找到相关内容"——总结已覆盖全部内容，请尽力从总结中定位相关知识并作答；
5. 回答中请标注关键信息的来源（如"来自题库总结 / 来自某题库"），保持准确，不编造。

【问题】${query}

请给出准确、清晰、完整的解答。`;
}

// 调用 AI 解答（支持流式回调）
export async function searchKnowledgeAI(
  query: string,
  source: KnowledgeSearchSource,
  onChunk?: (chunk: string) => void,
  summary?: string
): Promise<string> {
  const config = useSettingsStore.getState();
  if (!config.apiKey) {
    throw new Error('请先在「我的 → 设置」中配置 API Key');
  }
  apiGradingService.setConfig({ apiKey: config.apiKey, model: config.apiModel });

  const prompt = buildKnowledgePrompt(query, source, summary);

  if (onChunk) {
    return apiGradingService.gradeWithStream(prompt, 2000, { onChunk });
  }
  return apiGradingService.callAPI(prompt, 2000);
}

/** 调用 AI 识别一段内容所属的分类（从现有分类中选择，或给出新分类名） */
export async function classifyContentWithAI(content: string, categories: string[]): Promise<string> {
  const config = useSettingsStore.getState();
  if (!config.apiKey) {
    throw new Error('请先在「我的 → 设置」中配置 API Key');
  }
  apiGradingService.setConfig({ apiKey: config.apiKey, model: config.apiModel });

  const categoryList = categories.length > 0 ? categories.join('、') : '（暂无分类，你可以新建）';
  const sample = content.length > 2000 ? content.slice(0, 2000) : content;

  const prompt = `你是数据中心运维知识库的内容分类助手。请判断下面这段内容属于哪个专业分类。

可选分类：${categoryList}
判断要求：
1. 优先从可选分类中选择最匹配的一个；
2. 如果内容明显不属于任何可选分类，给出一个新的简短分类名称（2-6 个字，如"安防"、"网络"）；
3. 只输出一个分类名称，不要输出任何其他文字、标点或解释。

内容：
"""${sample}"""`;

  try {
    const result = await apiGradingService.callAPI(prompt, 100);
    const name = (result || '').trim().replace(/["''""「」【】()（）\[\]。，,、\n]/g, '');
    if (!name) return '';
    // 与现有分类做包含匹配，避免 AI 输出相近变体时重复建分类
    const matched = categories.find((c) => c === name || c.includes(name) || name.includes(c));
    return matched || name.slice(0, 12);
  } catch (err) {
    throw err;
  }
}
