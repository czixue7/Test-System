/**
 * 知识库 AI 解答服务
 * 根据数据源（知识库/题库/综合/纯AI）检索相关内容，构造 prompt 调用 AI 解答。
 */
import { apiGradingService } from './apiGradingService';
import { useSettingsStore } from '../store/settingsStore';
import { useKnowledgeStore } from '../store/knowledgeStore';
import { useQuestionBankStore } from '../store/questionBankStore';
import { KnowledgeSearchSource } from '../types';

// 提取查询关键词
function extractKeywords(query: string): string[] {
  return query
    .split(/[\s,，。;；、?!？！]+/)
    .map((k) => k.trim())
    .filter((k) => k.length > 0);
}

// 检索知识库相关内容
function searchKnowledgeItems(query: string, limit = 5): string[] {
  const items = useKnowledgeStore.getState().items;
  if (items.length === 0) return [];
  const lowerQuery = query.toLowerCase();
  const keywords = extractKeywords(query);

  return items
    .map((item) => {
      const text = (item.title + ' ' + item.content).toLowerCase();
      let score = 0;
      if (text.includes(lowerQuery)) score += 10;
      for (const k of keywords) {
        if (text.includes(k.toLowerCase())) score += 2;
      }
      return { item, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => `【${x.item.title}】${x.item.category ? `（${x.item.category}）` : ''}\n${x.item.content}`);
}

// 检索题库相关内容
function searchQuestionBank(query: string, limit = 5): string[] {
  const banks = useQuestionBankStore.getState().banks;
  const questions = banks.flatMap((b) => b.questions || []);
  if (questions.length === 0) return [];
  const lowerQuery = query.toLowerCase();
  const keywords = extractKeywords(query);

  return questions
    .map((q) => {
      const answer = Array.isArray(q.correctAnswer)
        ? q.correctAnswer.join('；')
        : typeof q.correctAnswer === 'string'
          ? q.correctAnswer
          : '';
      const text = `${q.question || ''} ${q.content || ''} ${answer} ${q.explanation || ''}`.toLowerCase();
      let score = 0;
      if (text.includes(lowerQuery)) score += 10;
      for (const k of keywords) {
        if (text.includes(k.toLowerCase())) score += 2;
      }
      return { q, answer, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => `【题目】${x.q.question}\n【答案】${x.answer}${x.q.explanation ? `\n【解析】${x.q.explanation}` : ''}`);
}

// 构建 prompt
export function buildKnowledgePrompt(
  query: string,
  source: KnowledgeSearchSource,
  summary?: string
): string {
  // 纯 AI：不检索内容，直接通用问答
  if (source === 'ai') {
    return `请回答以下问题，尽可能详细、准确：\n\n${query}`;
  }

  const sections: string[] = [];

  // 优先注入总结内容（为 AI 提供完整上下文，避免仅靠关键词匹配遗漏信息）
  if (summary) {
    sections.push(`【内容总结（优先参考）】\n${summary}`);
  }

  if (source === 'knowledge' || source === 'combined') {
    const knowledgeContext = searchKnowledgeItems(query);
    if (knowledgeContext.length > 0) {
      sections.push(`【知识库相关内容】\n${knowledgeContext.join('\n\n')}`);
    }
  }

  if (source === 'questionBank' || source === 'combined') {
    const questionContext = searchQuestionBank(query);
    if (questionContext.length > 0) {
      sections.push(`【题库相关题目】\n${questionContext.join('\n\n')}`);
    }
  }

  const contextText = sections.join('\n\n');

  if (!contextText) {
    return `以下问题在当前知识库/题库中未找到直接相关内容，请基于你的通用知识回答：\n\n${query}`;
  }

  return `请根据以下内容回答问题，优先参考"内容总结"部分，再结合相关题目/内容作答。若内容中没有相关信息，请明确说明"未找到相关内容"，不要编造。\n\n${contextText}\n\n【问题】\n${query}\n\n请给出准确、清晰的解答。`;
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
