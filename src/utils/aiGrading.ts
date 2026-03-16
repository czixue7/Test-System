import { calculateSimilarity, normalizeText } from './similarity';
import { apiGradingService } from './apiGradingService';
import { useSettingsStore } from '../store/settingsStore';
import { GradingProvider, BlankResult } from '../types';

export type GradingMode = 'ai' | 'fixed' | 'ai-fallback';

export interface AIGradingResult {
  score: number;
  isCorrect: 0 | 1 | 2;
  similarity?: number;
  feedback?: string;
  gradingMode: GradingMode;
  explanation?: string;
  blankResults?: BlankResult[];
}

export interface FastPreCheckResult {
  shouldSkipAI: boolean;
  result?: AIGradingResult;
}

export interface BatchGradingItem {
  questionId: string;
  userAnswer: string | string[];
  correctAnswer: string | string[];
  maxScore: number;
  question?: string;
  allowDisorder?: boolean;
  questionType?: 'fill-in-blank' | 'subjective';
}

export interface BatchGradingResult {
  questionId: string;
  result: AIGradingResult;
}

const INVALID_ANSWER_KEYWORDS = ['不知道', '不会', '不确定', '没学过', '不了解', '不清楚', '不会写', ''];

function getGradingProvider(): GradingProvider {
  return useSettingsStore.getState().gradingProvider;
}

function getAPIConfig(): { apiKey: string | null; apiModel: string } {
  const state = useSettingsStore.getState();
  return {
    apiKey: state.apiKey,
    apiModel: state.apiModel,
  };
}

export async function isModelReady(): Promise<boolean> {
  const provider = getGradingProvider();
  if (provider === 'api') {
    const config = getAPIConfig();
    if (config.apiKey) {
      apiGradingService.setConfig({
        apiKey: config.apiKey,
        model: config.apiModel,
      });
    }
    return apiGradingService.isConfigured();
  }
  return false;
}

export async function autoLoadLastModel(): Promise<boolean> {
  // WebLLM已移除，此函数保留用于兼容
  return false;
}

function normalizeForFillBlank(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[，。！？；：""''、,.!?;:"'、\-—…·～～《》【】（）()\[\]（）]/g, '')
    .trim();
}

function generateFillBlankExplanation(
  userAnswer: string,
  correctAnswer: string,
  isCorrect: boolean
): string {
  if (isCorrect) {
    return `你的答案「${userAnswer}」与标准答案「${correctAnswer}」完全一致。`;
  } else {
    const normalizedUser = normalizeForFillBlank(userAnswer);
    const normalizedCorrect = normalizeForFillBlank(correctAnswer);

    if (normalizedUser === normalizedCorrect) {
      return `你的答案「${userAnswer}」与标准答案「${correctAnswer}」含义相同，但表述略有差异（如标点、空格等）。`;
    } else {
      return `你的答案「${userAnswer}」与标准答案「${correctAnswer}」不一致。请检查是否有错别字、遗漏或多余的内容。`;
    }
  }
}

function generateSubjectiveExplanation(
  _userAnswer: string,
  _correctAnswer: string,
  similarity: number,
  score: number,
  maxScore: number
): string {
  const percentage = Math.round(similarity * 100);

  if (similarity >= 1) {
    return `你的答案与标准答案完全一致，获得了满分 ${maxScore} 分。`;
  } else if (similarity >= 0.8) {
    return `你的答案与标准答案相似度为 ${percentage}%，基本正确但表述略有差异。获得 ${score}/${maxScore} 分。建议对比标准答案，看看有哪些细节可以改进。`;
  } else if (similarity >= 0.6) {
    return `你的答案与标准答案相似度为 ${percentage}%，部分正确但存在一些差异。获得 ${score}/${maxScore} 分。建议仔细阅读标准答案，理解关键知识点。`;
  } else if (similarity >= 0.3) {
    return `你的答案与标准答案相似度为 ${percentage}%，内容有较大差异。获得 ${score}/${maxScore} 分。建议重新学习相关知识点，并对比标准答案找出差距。`;
  } else {
    return `你的答案与标准答案相似度为 ${percentage}%，内容差异较大。获得 ${score}/${maxScore} 分。建议认真学习相关知识点，理解题目要求后再作答。`;
  }
}

function fallbackSubjective(
  userAnswer: string,
  correctAnswer: string,
  maxScore: number,
  question?: string
): AIGradingResult {
  const similarity = calculateSimilarity(userAnswer, correctAnswer);

  let isCorrect: 0 | 1 | 2;
  if (similarity >= 0.9) {
    isCorrect = 2;
  } else if (similarity >= 0.6) {
    isCorrect = 1;
  } else {
    isCorrect = 0;
  }

  let score: number;
  if (similarity >= 1) {
    score = maxScore;
  } else if (similarity >= 0.6) {
    score = Math.round(maxScore * similarity);
  } else {
    score = 0;
  }

  let feedback: string;
  if (similarity >= 1) {
    feedback = '答案完全正确（固定判题）';
  } else if (similarity >= 0.8) {
    feedback = '答案基本正确，表述略有差异（固定判题）';
  } else if (similarity >= 0.6) {
    feedback = '答案部分正确，但存在一些差异（固定判题）';
  } else {
    feedback = '答案不正确或差异较大（固定判题）';
  }

  const explanation = generateSubjectiveExplanation(userAnswer, correctAnswer, similarity, score, maxScore);

  return {
    score,
    isCorrect,
    similarity,
    gradingMode: 'fixed',
    feedback,
    explanation: question
      ? `【固定判题模式】\n题目：${question}\n\n${explanation}`
      : `【固定判题模式】\n${explanation}`,
  };
}

async function generateWithProvider(prompt: string, maxTokens: number): Promise<string> {
  const provider = getGradingProvider();

  if (provider === 'api') {
    const config = getAPIConfig();
    if (!config.apiKey) {
      throw new Error('API密钥未配置');
    }
    apiGradingService.setConfig({
      apiKey: config.apiKey,
      model: config.apiModel,
    });
    return apiGradingService.callAPI(prompt, maxTokens);
  }

  throw new Error('WebLLM已移除，请使用API判题模式');
}

async function generateWithProviderStream(
  prompt: string,
  maxTokens: number,
  onChunk: (chunk: string) => void
): Promise<string> {
  const provider = getGradingProvider();

  if (provider === 'api') {
    const config = getAPIConfig();
    if (!config.apiKey) {
      throw new Error('API密钥未配置');
    }
    apiGradingService.setConfig({
      apiKey: config.apiKey,
      model: config.apiModel,
    });
    return apiGradingService.gradeWithStream(prompt, maxTokens, {
      onChunk,
      onComplete: () => {},
    });
  }

  throw new Error('WebLLM已移除，请使用API判题模式');
}

export function fastPreCheck(
  userAnswer: string | string[],
  correctAnswer: string | string[],
  maxScore: number,
  questionType: 'fill-in-blank' | 'subjective'
): FastPreCheckResult {
  const userAnswersArray = Array.isArray(userAnswer) ? userAnswer : [userAnswer];
  const correctAnswersArray = Array.isArray(correctAnswer) ? correctAnswer : [correctAnswer];

  const userAnswerText = userAnswersArray.join('');
  const correctAnswerText = correctAnswersArray.join('');

  const normalizedUser = normalizeText(userAnswerText);
  const normalizedCorrect = normalizeText(correctAnswerText);

  const trimmedUser = userAnswerText.trim();

  if (INVALID_ANSWER_KEYWORDS.some(keyword => trimmedUser === keyword)) {
    console.log('[AI判题] 快速预检：检测到无效答案，返回0分');
    return {
      shouldSkipAI: true,
      result: {
        score: 0,
        isCorrect: 0,
        gradingMode: 'fixed',
        feedback: '答案无效：未提供有效回答',
        explanation: '你的答案为无效内容（如"不知道"、"不会"等），未获得分数。请认真作答。',
      },
    };
  }

  if (normalizedUser === normalizedCorrect && normalizedUser !== '') {
    console.log('[AI判题] 快速预检：完全匹配，返回满分');
    return {
      shouldSkipAI: true,
      result: {
        score: maxScore,
        isCorrect: 2,
        similarity: 1,
        gradingMode: 'fixed',
        feedback: '答案完全正确（快速预检）',
        explanation: questionType === 'fill-in-blank'
          ? `你的答案「${userAnswersArray.join('、')}」与标准答案完全一致。`
          : '你的答案与标准答案完全一致，获得了满分。',
      },
    };
  }

  const similarity = calculateSimilarity(userAnswerText, correctAnswerText);
  if (similarity > 0.95) {
    console.log(`[AI判题] 快速预检：高相似度(${similarity.toFixed(3)})，返回满分`);
    return {
      shouldSkipAI: true,
      result: {
        score: maxScore,
        isCorrect: 2,
        similarity,
        gradingMode: 'fixed',
        feedback: '答案完全正确（快速预检）',
        explanation: questionType === 'fill-in-blank'
          ? `你的答案「${userAnswersArray.join('、')}」与标准答案高度相似（${Math.round(similarity * 100)}%）。`
          : `你的答案与标准答案高度相似（${Math.round(similarity * 100)}%），获得了满分。`,
      },
    };
  }

  console.log(`[AI判题] 快速预检：未触发快速通道，继续AI判题 (相似度: ${similarity.toFixed(3)})`);
  return { shouldSkipAI: false };
}

export async function gradeFillBlank(
  userAnswer: string,
  correctAnswer: string,
  maxScore: number,
  question?: string,
  allowDisorder?: boolean
): Promise<AIGradingResult | null> {
  const result = await gradeFillBlankQuestion(
    [userAnswer],
    [correctAnswer],
    maxScore,
    question,
    allowDisorder
  );
  return result;
}

export async function gradeFillBlankQuestion(
  userAnswers: string[],
  correctAnswers: string[],
  maxScore: number,
  question?: string,
  allowDisorder?: boolean
): Promise<AIGradingResult | null> {
  const preCheck = fastPreCheck(userAnswers, correctAnswers, maxScore, 'fill-in-blank');
  if (preCheck.shouldSkipAI && preCheck.result) {
    console.log('[AI判题] 填空题：快速预检通过，跳过AI判题');
    return preCheck.result;
  }

  const provider = getGradingProvider();
  const apiReady = apiGradingService.isConfigured();
  const isReady = provider === 'api' ? apiReady : false;

  console.log(`[AI判题] 填空题 - 判题提供者: ${provider}, API模型状态: ${apiReady}`);
  console.log(`[AI判题] 题目: ${question || '（填空题）'}`);
  console.log(`[AI判题] 标准答案: ${correctAnswers.join('、')}`);
  console.log(`[AI判题] 用户答案: ${userAnswers.join('、')}`);
  console.log(`[AI判题] 允许乱序: ${allowDisorder ? '是' : '否'}`);

  if (provider === 'fixed' || !isReady) {
    console.log('[AI判题] 使用固定判题');
    return fallbackFillBlank(userAnswers, correctAnswers, maxScore, question, allowDisorder);
  }

  // 构建单题 prompt（融合乱序和顺序模式的特点）
  const prompt = buildFillBlankPrompt(userAnswers, correctAnswers, maxScore, question, allowDisorder);

  console.log('[AI判题] 发送Prompt到AI...');

  try {
    const response = await generateWithProvider(prompt, 500);
    return parseFillBlankResponse(response, userAnswers, correctAnswers, maxScore, question);
  } catch (error) {
    console.error('[AI判题] AI判题失败，降级到固定规则:', error);
    return fallbackFillBlank(userAnswers, correctAnswers, maxScore, question, allowDisorder, true);
  }
}

function buildFillBlankPrompt(
  userAnswers: string[],
  correctAnswers: string[],
  maxScore: number,
  question?: string,
  allowDisorder?: boolean
): string {
  const scorePerBlank = (maxScore / correctAnswers.length).toFixed(1);
  
  if (allowDisorder) {
    const answersComparison = userAnswers.map((user, index) => {
      const userStr = user || '';
      const displayUser = userStr.trim() === '' ? '(未填写)' : userStr;
      return `第${index + 1}空：用户答案「${displayUser}」`;
    }).join('\n');

    return `你是一位严格的考试评分助手。请根据题目内容和参考答案，客观判断用户的填空答案是否正确。

【题目】
${question || '（填空题）'}

【标准答案集合】（答案可以填在任意空，只要内容正确即可）
${correctAnswers.map((a, i) => `${i + 1}. ${a}`).join('\n')}

【用户答案】
${answersComparison}

【重要 - 乱序模式判题规则】
本题支持答案乱序！这意味着：
- 用户填写的答案不需要对应特定的空位
- 只要用户答案存在于【标准答案集合】中，无论填在哪个位置，都算正确
- 每个标准答案只能被匹配一次

【评分规则 - 必须严格遵守】
1. 判题方式：检查每个用户答案是否存在于【标准答案集合】中
2. 正确的标准：用户答案与标准答案完全一致（忽略大小写和空格）
3. 以下情况一律判为错误：
   - 答案为"不知道"、"不会"、"不确定"等表示不知道的词汇
   - 答案为空、未填写、填写"(未填写)"
   - 答案不存在于【标准答案集合】中
   - 答案与任何标准答案都不匹配（如"123"与"主机房"）
4. 计分方式：每空${scorePerBlank}分，匹配成功的空才得分
5. 【重要】最终判断标准：
   - "正确"：所有空的答案都存在于标准答案集合中（全部正确）
   - "部分正确"：至少有一个空的答案存在于标准答案集合中，但不是全部（部分正确）
   - "错误"：没有任何一个空的答案存在于标准答案集合中（全部错误）

【返回格式 - 必须严格按以下格式，不要省略任何部分】
得分：X/${maxScore}分
判断：正确/部分正确/错误
逐空分析：
${correctAnswers.map((_, i) => `- 第${i + 1}空：正确/错误`).join('\n')}
综合解析：20字以内`;
  } else {
    const answersComparison = correctAnswers.map((correct, index) => {
      const user = userAnswers[index] || '';
      const displayUser = user.trim() === '' ? '(未填写)' : user;
      return `第${index + 1}空：标准答案「${correct}」vs 用户答案「${displayUser}」`;
    }).join('\n');

    return `你是一位严格的考试评分助手。请根据题目内容和参考答案，客观判断用户的填空答案是否正确。

【题目】
${question || '（填空题）'}

【答案对比】（必须按顺序匹配）
${answersComparison}

【重要 - 顺序模式判题规则】
本题必须按顺序答题！这意味着：
- 第1空的答案必须对应第1个标准答案
- 第2空的答案必须对应第2个标准答案
- 以此类推，位置不对应即为错误

【评分规则 - 必须严格遵守】
1. 判题方式：按位置逐一比较，第N空必须匹配第N个标准答案
2. 正确的标准：同一位置的用户答案与标准答案完全一致（忽略大小写和空格）
3. 以下情况一律判为错误：
   - 答案为"不知道"、"不会"、"不确定"等表示不知道的词汇
   - 答案为空、未填写、填写"(未填写)"
   - 答案与对应位置的标准答案不一致
   - 答案内容完全偏离（如"123"与"主机房"）
4. 计分方式：每空${scorePerBlank}分，位置匹配且内容正确的空才得分
5. 【重要】最终判断标准：
   - "正确"：所有空的答案都与对应位置的标准答案一致（全部正确）
   - "部分正确"：至少有一个空的答案正确，但不是全部（部分正确）
   - "错误"：没有任何一个空的答案正确（全部错误）

【返回格式 - 必须严格按以下格式，不要省略任何部分】
得分：X/${maxScore}分
判断：正确/部分正确/错误
逐空分析：
${correctAnswers.map((_, i) => `- 第${i + 1}空：正确/错误`).join('\n')}
综合解析：20字以内`;
  }
}

function parseFillBlankResponse(
  response: string,
  userAnswers: string[],
  correctAnswers: string[],
  maxScore: number,
  question?: string
): AIGradingResult {
  console.log('[AI判题] AI原始响应:', response);

  if (response.includes('Generation stopped') || response.includes('exceeding max_tokens') || response.length < 20) {
    console.warn('[AI判题] AI响应被截断或异常，降级到精确匹配');
    throw new Error('AI响应被截断');
  }

  const scoreMatch = response.match(/得分[：:]\s*(\d+)/);
  const judgmentMatch = response.match(/判断[：:]\s*(正确|部分正确|错误)/);
  const explanationMatch = response.match(/综合解析[：:]([\s\S]+)/);

  let score = scoreMatch ? Math.min(parseInt(scoreMatch[1], 10), maxScore) : 0;
  let isCorrect: 0 | 1 | 2 = 0;

  if (judgmentMatch) {
    if (judgmentMatch[1] === '正确') {
      isCorrect = 2;
    } else if (judgmentMatch[1] === '部分正确') {
      isCorrect = 1;
    } else {
      isCorrect = 0;
    }
  } else {
    if (score >= maxScore) {
      isCorrect = 2;
    } else if (score > 0) {
      isCorrect = 1;
    } else {
      isCorrect = 0;
    }
  }

  let explanation = explanationMatch ? explanationMatch[1].trim() : '';
  if (!explanation) {
    explanation = generateFillBlankExplanation(userAnswers.join('、'), correctAnswers.join('、'), isCorrect === 2);
  }

  // 解析逐空分析
  const blankResults: BlankResult[] = [];
  const analysisMatch = response.match(/逐空分析[：:]([\s\S]+?)(?=综合解析|$)/);
  
  if (analysisMatch) {
    const analysisText = analysisMatch[1];
    for (let i = 0; i < correctAnswers.length; i++) {
      const blankPattern = new RegExp(`第${i + 1}空[：:]\\s*(正确|错误)`);
      const blankMatch = analysisText.match(blankPattern);
      const isBlankCorrect = blankMatch ? blankMatch[1] === '正确' : false;
      blankResults.push({
        userAnswer: userAnswers[i] || '',
        correctAnswer: correctAnswers[i],
        isCorrect: isBlankCorrect
      });
    }
  } else {
    // 默认按位置匹配
    for (let i = 0; i < correctAnswers.length; i++) {
      const correctAns = correctAnswers[i];
      const userAns = userAnswers[i] || '';
      const normalizedCorrect = correctAns.toLowerCase().trim();
      const normalizedUser = userAns.toLowerCase().trim();
      const isBlankCorrect = normalizedCorrect === normalizedUser;
      blankResults.push({
        userAnswer: userAns,
        correctAnswer: correctAns,
        isCorrect: isBlankCorrect
      });
    }
  }

  return {
    score,
    isCorrect,
    gradingMode: 'ai',
    feedback: isCorrect === 2 ? `API判题：${score}分` : `API判题：${score}分（部分正确）`,
    explanation: `【综合解析】\n${explanation}`,
    blankResults
  };
}

function fallbackFillBlank(
  userAnswers: string[],
  correctAnswers: string[],
  maxScore: number,
  question?: string,
  allowDisorder?: boolean,
  isAIFallback: boolean = false
): AIGradingResult {
  let totalScore = 0;
  let correctCount = 0;
  const scorePerBlank = maxScore / correctAnswers.length;
  const blankResults: BlankResult[] = [];

  if (allowDisorder) {
    const correctAnswerSet = new Set(correctAnswers.map(a => a.toLowerCase().trim()));
    
    for (let i = 0; i < correctAnswers.length; i++) {
      const userAns = userAnswers[i] || '';
      const normalizedUser = userAns.toLowerCase().trim();
      const isBlankCorrect = correctAnswerSet.has(normalizedUser) && normalizedUser !== '';
      
      totalScore += isBlankCorrect ? scorePerBlank : 0;
      if (isBlankCorrect) correctCount++;

      let matchedCorrectAnswer: string;
      if (isBlankCorrect) {
        matchedCorrectAnswer = correctAnswers.find(a => a.toLowerCase().trim() === normalizedUser) || '';
      } else {
        matchedCorrectAnswer = correctAnswers[i] || '';
      }

      blankResults.push({
        userAnswer: userAns,
        correctAnswer: matchedCorrectAnswer,
        isCorrect: isBlankCorrect
      });
    }
  } else {
    for (let i = 0; i < correctAnswers.length; i++) {
      const correctAns = correctAnswers[i];
      const userAns = userAnswers[i] || '';
      const normalizedCorrect = correctAns.toLowerCase().trim();
      const normalizedUser = userAns.toLowerCase().trim();
      const isBlankCorrect = normalizedCorrect === normalizedUser;

      totalScore += isBlankCorrect ? scorePerBlank : 0;
      if (isBlankCorrect) correctCount++;

      blankResults.push({
        userAnswer: userAns,
        correctAnswer: correctAns,
        isCorrect: isBlankCorrect
      });
    }
  }

  let isCorrect: 0 | 1 | 2;
  if (correctCount === correctAnswers.length) {
    isCorrect = 2;
  } else if (correctCount > 0) {
    isCorrect = 1;
  } else {
    isCorrect = 0;
  }

  return {
    score: Math.round(totalScore),
    isCorrect,
    gradingMode: isAIFallback ? 'ai-fallback' : 'fixed',
    feedback: isCorrect === 2 
      ? (isAIFallback ? 'AI降级判题：全部正确' : '固定判题：全部正确')
      : isCorrect === 1 
        ? (isAIFallback ? 'AI降级判题：部分答案不正确' : '固定判题：部分答案不正确')
        : (isAIFallback ? 'AI降级判题：全部错误' : '固定判题：全部错误'),
    explanation: `【${isAIFallback ? 'AI降级判题模式' : '固定判题模式'}】\n标准答案：${correctAnswers.join('、')}\n你的答案：${userAnswers.join('、')}`,
    blankResults
  };
}

export async function gradeSubjective(
  userAnswer: string,
  correctAnswer: string,
  maxScore: number,
  question?: string
): Promise<AIGradingResult | null> {
  const preCheck = fastPreCheck(userAnswer, correctAnswer, maxScore, 'subjective');
  if (preCheck.shouldSkipAI && preCheck.result) {
    console.log('[AI判题] 主观题：快速预检通过，跳过AI判题');
    return preCheck.result;
  }

  const provider = getGradingProvider();
  const apiReady = apiGradingService.isConfigured();
  const isReady = provider === 'api' ? apiReady : false;

  console.log('[AI判题] 主观题 - 判题提供者:', provider);

  if (provider === 'fixed' || !isReady) {
    console.log('[AI判题] 使用固定规则判题');
    return fallbackSubjective(userAnswer, correctAnswer, maxScore, question);
  }

  const prompt = buildSubjectivePrompt(userAnswer, correctAnswer, maxScore, question);

  console.log('[AI判题] 发送Prompt到AI...');

  try {
    const response = await generateWithProvider(prompt, 600);
    return parseSubjectiveResponse(response, userAnswer, correctAnswer, maxScore, question);
  } catch (error) {
    console.error('[AI判题] AI判题失败，降级到相似度计算:', error);
    const fallback = fallbackSubjective(userAnswer, correctAnswer, maxScore, question);
    fallback.gradingMode = 'ai-fallback';
    fallback.feedback = (fallback.feedback || '').replace('固定判题', 'AI降级判题');
    return fallback;
  }
}

function buildSubjectivePrompt(
  userAnswer: string,
  correctAnswer: string,
  maxScore: number,
  question?: string
): string {
  return `你是一位严格的考试评分助手。请根据题目和参考答案，客观评估用户的主观题答案。

【题目】
${question || '（主观题）'}

【参考答案】
${correctAnswer}

【用户答案】
${userAnswer}

【评分规则 - 必须严格遵守】
1. 得分范围：0-${maxScore}分，根据答案质量给出合理分数
2. 评分标准（语义相似度判断）：
   - ${maxScore}分（语义相似度≥90%）：答案与参考答案完全一致或表达完全相同的概念，只有极为接近的答案才能得满分
   - ${Math.round(maxScore * 0.8)}-${Math.round(maxScore * 0.9)}分（语义相似度80%-89%）：答案基本正确，但表述不够完整或有 minor 遗漏
   - ${Math.round(maxScore * 0.7)}-${Math.round(maxScore * 0.79)}分（语义相似度70%-79%）：答案部分正确，包含了部分要点，但不能算完全正确
   - ${Math.round(maxScore * 0.3)}-${Math.round(maxScore * 0.69)}分（语义相似度30%-69%）：答案与题目相关但偏离重点，或包含较多错误
   - 0-${Math.round(maxScore * 0.2)}分（语义相似度<30%）：答案错误、与题目无关或表示不知道
3. 以下情况一律给低分（0-${Math.round(maxScore * 0.2)}分）：
   - 答案为"不知道"、"不会"、"不确定"、"没学过"等
   - 答案为空或仅填写无意义内容
   - 答案与题目完全无关
4. 严格判断原则：
   - 语义相似度≥90%才能算"正确"（isCorrect=true）
   - 语义相似度70%-89%只能算"部分正确"，不能算完全正确
   - 不要宽容判断，必须语义极为接近参考答案才算高分

【返回格式 - 必须严格按以下格式】
得分：X（0-${maxScore}之间的整数）
是否正确：是/否（${maxScore}分才算"是"，否则"否"）
评价：20字以内
综合解析：20字以内`;
}

function parseSubjectiveResponse(
  response: string,
  userAnswer: string,
  correctAnswer: string,
  maxScore: number,
  question?: string
): AIGradingResult {
  console.log('[AI判题] AI原始响应:', response);

  if (response.includes('Generation stopped') || response.includes('exceeding max_tokens') || response.length < 20) {
    console.warn('[AI判题] AI响应被截断或异常，降级到相似度计算');
    throw new Error('AI响应被截断');
  }

  const scoreMatch = response.match(/得分[：:]\s*(\d+)/);
  const correctMatch = response.match(/是否正确[：:]\s*(是|否|yes|no)/i);
  const feedbackMatch = response.match(/评价[：:]\s*(.+)/);
  const explanationMatch = response.match(/综合解析[：:]\s*\n?([\s\S]+?)(?=\n\n|$)/);

  let score = 0;
  let isCorrect: 0 | 1 | 2 = 0;
  let feedback = 'AI判题完成';

  if (scoreMatch) {
    score = Math.min(parseInt(scoreMatch[1], 10), maxScore);
  }

  if (correctMatch) {
    const correctValue = correctMatch[1].toLowerCase();
    if (correctValue === '是' || correctValue === 'yes') {
      isCorrect = 2;
    } else if (score > 0) {
      isCorrect = 1;
    } else {
      isCorrect = 0;
    }
  } else {
    if (score >= maxScore * 0.9) {
      isCorrect = 2;
    } else if (score > 0) {
      isCorrect = 1;
    } else {
      isCorrect = 0;
    }
  }

  if (feedbackMatch) {
    feedback = feedbackMatch[1].trim();
  }

  let explanation = explanationMatch
    ? explanationMatch[1].trim()
    : generateSubjectiveExplanation(userAnswer, correctAnswer, score / maxScore, score, maxScore);

  return {
    score,
    isCorrect,
    gradingMode: 'ai',
    feedback: `${feedback}（API判题）`,
    explanation: question
      ? `【综合解析】\n${explanation}`
      : `【综合解析】\n${explanation}`,
  };
}

// ==================== 批量判题（融合后的两种Prompt）====================

export async function gradeBatch(
  items: BatchGradingItem[]
): Promise<BatchGradingResult[]> {
  if (items.length === 0) {
    return [];
  }

  console.log(`[AI批量判题] 开始批量判题，共 ${items.length} 道题`);

  const results: BatchGradingResult[] = [];
  const aiNeededItems: { item: BatchGradingItem; index: number }[] = [];

  // 第一步：快速预检
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const userAnswersArray = Array.isArray(item.userAnswer) ? item.userAnswer : [item.userAnswer];
    const correctAnswersArray = Array.isArray(item.correctAnswer) ? item.correctAnswer : [item.correctAnswer];
    const questionType = item.questionType || 'fill-in-blank';

    const preCheck = fastPreCheck(userAnswersArray, correctAnswersArray, item.maxScore, questionType);

    if (preCheck.shouldSkipAI && preCheck.result) {
      console.log(`[AI批量判题] 题目 ${item.questionId} 通过快速预检，跳过AI判题`);
      results.push({
        questionId: item.questionId,
        result: preCheck.result,
      });
    } else {
      console.log(`[AI批量判题] 题目 ${item.questionId} 需要AI判题`);
      aiNeededItems.push({ item, index: i });
    }
  }

  if (aiNeededItems.length === 0) {
    console.log('[AI批量判题] 所有题目都通过快速预检，无需AI判题');
    return results;
  }

  // 第二步：检查AI是否可用
  const provider = getGradingProvider();
  const apiReady = apiGradingService.isConfigured();
  const isReady = provider === 'api' ? apiReady : false;

  if (provider === 'fixed' || !isReady) {
    console.log('[AI批量判题] 模型未就绪，使用固定规则判题');
    for (const { item } of aiNeededItems) {
      const userAnswersArray = Array.isArray(item.userAnswer) ? item.userAnswer : [item.userAnswer];
      const correctAnswersArray = Array.isArray(item.correctAnswer) ? item.correctAnswer : [item.correctAnswer];
      const questionType = item.questionType || 'fill-in-blank';

      if (questionType === 'subjective') {
        const userAnswerText = userAnswersArray.join('');
        const correctAnswerText = correctAnswersArray.join('');
        const fallback = fallbackSubjective(userAnswerText, correctAnswerText, item.maxScore, item.question);
        results.push({
          questionId: item.questionId,
          result: fallback,
        });
      } else {
        const fallback = fallbackFillBlank(userAnswersArray, correctAnswersArray, item.maxScore, item.question, item.allowDisorder);
        results.push({
          questionId: item.questionId,
          result: fallback,
        });
      }
    }
    return results;
  }

  // 第三步：分离填空题和主观题
  const fillBlankItems = aiNeededItems.filter(({ item }) => (item.questionType || 'fill-in-blank') === 'fill-in-blank');
  const subjectiveItems = aiNeededItems.filter(({ item }) => item.questionType === 'subjective');

  // 处理填空题批量
  if (fillBlankItems.length > 0) {
    const fillBlankResults = await gradeFillBlankBatchInternal(fillBlankItems);
    results.push(...fillBlankResults);
  }

  // 处理主观题批量
  if (subjectiveItems.length > 0) {
    const subjectiveResults = await gradeSubjectiveBatchInternal(subjectiveItems);
    results.push(...subjectiveResults);
  }

  console.log(`[AI批量判题] 批量判题完成，共 ${results.length} 道题`);
  return results;
}

// 批量填空题判题（融合乱序和顺序模式）
async function gradeFillBlankBatchInternal(
  items: { item: BatchGradingItem; index: number }[]
): Promise<BatchGradingResult[]> {
  const results: BatchGradingResult[] = [];

  // 生成融合后的批量prompt
  const questionsPrompt = items.map(({ item }, idx) => {
    const userAnswersArray = Array.isArray(item.userAnswer) ? item.userAnswer : [item.userAnswer];
    const correctAnswersArray = Array.isArray(item.correctAnswer) ? item.correctAnswer : [item.correctAnswer];
    const scorePerBlank = (item.maxScore / correctAnswersArray.length).toFixed(1);

    if (item.allowDisorder) {
      const answersComparison = userAnswersArray.map((user, index) => {
        const userStr = (user as string) || '';
        const displayUser = userStr.trim() === '' ? '(未填写)' : userStr;
        return `第${index + 1}空：用户答案「${displayUser}」`;
      }).join('\n');

      return `
【题目${idx + 1}】
题目ID: ${item.questionId}
题型: 填空题（乱序模式）
题目内容: ${item.question || '（填空题）'}
标准答案集合:
${correctAnswersArray.map((a, i) => `${i + 1}. ${a}`).join('\n')}
用户答案:
${answersComparison}
每空分值: ${scorePerBlank}分
满分: ${item.maxScore}分
判题规则: 检查每个用户答案是否存在于标准答案集合中，存在即正确，与位置无关
---`;
    } else {
      const answersComparison = correctAnswersArray.map((correct, index) => {
        const user = (userAnswersArray[index] as string) || '';
        const displayUser = user.trim() === '' ? '(未填写)' : user;
        return `第${index + 1}空：标准答案「${correct}」vs 用户答案「${displayUser}」`;
      }).join('\n');

      return `
【题目${idx + 1}】
题目ID: ${item.questionId}
题型: 填空题（顺序模式）
题目内容: ${item.question || '（填空题）'}
答案对比:
${answersComparison}
每空分值: ${scorePerBlank}分
满分: ${item.maxScore}分
判题规则: 按位置逐一比较，第N空必须匹配第N个标准答案
---`;
    }
  }).join('\n');

  const batchPrompt = `你是一位严格的考试评分助手。请根据题目内容和参考答案，客观判断用户的填空答案是否正确。

【批量判题说明】
以下包含 ${items.length} 道填空题，每道题都明确标注了判题模式（乱序/顺序），请严格按照对应模式判题。

${questionsPrompt}

【通用评分规则 - 必须严格遵守】
1. 判题方式根据每道题标注的模式确定：
   - 乱序模式：检查用户答案是否存在于标准答案集合中，与位置无关
   - 顺序模式：按位置逐一比较，第N空必须匹配第N个标准答案
2. 正确的标准：用户答案与标准答案完全一致（忽略大小写和空格）
3. 以下情况一律判为错误：
   - 答案为"不知道"、"不会"、"不确定"等表示不知道的词汇
   - 答案为空、未填写、填写"(未填写)"
   - 答案不存在于标准答案集合中（乱序模式）或与对应位置标准答案不一致（顺序模式）
   - 答案与任何标准答案都不匹配（如"123"与"主机房"）
4. 计分方式：只有正确的空才得分
5. 【重要】最终判断标准（适用于所有题目）：
   - "正确"：所有空的答案都正确（全部正确）
   - "部分正确"：至少有一个空的答案正确，但不是全部（部分正确）
   - "错误"：没有任何一个空的答案正确（全部错误）

【返回格式 - 必须严格按以下格式，每道题独立输出】
${items.map(({ item }, idx) => {
  const correctAnswersArray = Array.isArray(item.correctAnswer) ? item.correctAnswer : [item.correctAnswer];
  const modeHint = item.allowDisorder ? '（乱序模式）' : '（顺序模式）';
  return `
【题目${idx + 1}结果】
题目ID: ${item.questionId}
判题模式: ${item.allowDisorder ? '乱序模式' : '顺序模式'}
得分：X/${item.maxScore}分
判断：正确/部分正确/错误
逐空分析${modeHint}：
${correctAnswersArray.map((_, i) => `- 第${i + 1}空：正确/错误`).join('\n')}
综合解析：20字以内`;
}).join('\n')}

请确保返回所有 ${items.length} 道题的评分结果，并严格按照每道题标注的判题模式进行判断。`;

  console.log('[AI批量判题-填空题] 发送批量prompt到AI');

  try {
    const response = await generateWithProvider(batchPrompt, 1000 + items.length * 200);
    console.log('[AI批量判题-填空题] AI响应内容:', response.substring(0, 500) + '...');

    // 解析批量响应
    for (let idx = 0; idx < items.length; idx++) {
      const { item } = items[idx];
      const userAnswersArray = Array.isArray(item.userAnswer) ? item.userAnswer : [item.userAnswer];
      const correctAnswersArray = Array.isArray(item.correctAnswer) ? item.correctAnswer : [item.correctAnswer];

      try {
        const resultPattern = new RegExp(
          `【题目${idx + 1}结果】[\\s\\S]*?题目ID:\\s*${item.questionId}[\\s\\S]*?(?=(【题目${idx + 2}结果】|$))`,
          'i'
        );
        const resultMatch = response.match(resultPattern);
        const resultText = resultMatch ? resultMatch[0] : response;

        const scoreMatch = resultText.match(/得分[：:]\s*(\d+)/);
        const judgmentMatch = resultText.match(/判断[：:]\s*(正确|部分正确|错误)/);
        const explanationMatch = resultText.match(/综合解析[：:]([\s\S]+?)(?=(【题目|$))/);

        let score = scoreMatch ? Math.min(parseInt(scoreMatch[1], 10), item.maxScore) : 0;
        let isCorrect: 0 | 1 | 2 = 0;

        if (judgmentMatch) {
          if (judgmentMatch[1] === '正确') {
            isCorrect = 2;
          } else if (judgmentMatch[1] === '部分正确') {
            isCorrect = 1;
          } else {
            isCorrect = 0;
          }
        } else {
          if (score >= item.maxScore) {
            isCorrect = 2;
          } else if (score > 0) {
            isCorrect = 1;
          } else {
            isCorrect = 0;
          }
        }

        let explanation = explanationMatch ? explanationMatch[1].trim() : '';
        if (!explanation) {
          explanation = generateFillBlankExplanation(userAnswersArray.join('、'), correctAnswersArray.join('、'), isCorrect === 2);
        }

        // 生成 blankResults
        const blankResults: BlankResult[] = [];
        if (item.allowDisorder) {
          const correctAnswerSet = new Set(correctAnswersArray.map(a => a.toLowerCase().trim()));
          
          for (let i = 0; i < correctAnswersArray.length; i++) {
            const userAns = userAnswersArray[i] || '';
            const normalizedUser = userAns.toLowerCase().trim();
            const isBlankCorrect = correctAnswerSet.has(normalizedUser) && normalizedUser !== '';
            
            let matchedCorrectAnswer: string;
            if (isBlankCorrect) {
              matchedCorrectAnswer = correctAnswersArray.find(a => a.toLowerCase().trim() === normalizedUser) || '';
            } else {
              matchedCorrectAnswer = correctAnswersArray[i] || '';
            }

            blankResults.push({
              userAnswer: userAns,
              correctAnswer: matchedCorrectAnswer,
              isCorrect: isBlankCorrect
            });
          }
        } else {
          for (let i = 0; i < correctAnswersArray.length; i++) {
            const correctAns = correctAnswersArray[i];
            const userAns = userAnswersArray[i] || '';
            const normalizedCorrect = correctAns.toLowerCase().trim();
            const normalizedUser = userAns.toLowerCase().trim();
            const isBlankCorrect = normalizedCorrect === normalizedUser;

            blankResults.push({
              userAnswer: userAns,
              correctAnswer: correctAns,
              isCorrect: isBlankCorrect
            });
          }
        }

        results.push({
          questionId: item.questionId,
          result: {
            score,
            isCorrect,
            gradingMode: 'ai',
            feedback: isCorrect === 2 ? `API判题：${score}分` : `API判题：${score}分（部分正确）`,
            explanation: `【综合解析】\n${explanation}`,
            blankResults
          },
        });

        console.log(`[AI批量判题-填空题] 题目 ${item.questionId} 评分完成: ${score}/${item.maxScore}`);
      } catch (error) {
        console.error(`[AI批量判题-填空题] 解析题目 ${item.questionId} 结果失败:`, error);
        const fallback = fallbackFillBlank(userAnswersArray, correctAnswersArray, item.maxScore, item.question, item.allowDisorder, true);
        results.push({
          questionId: item.questionId,
          result: fallback,
        });
      }
    }
  } catch (error) {
    console.error('[AI批量判题-填空题] AI批量判题失败，降级到固定规则:', error);
    for (const { item } of items) {
      const userAnswersArray = Array.isArray(item.userAnswer) ? item.userAnswer : [item.userAnswer];
      const correctAnswersArray = Array.isArray(item.correctAnswer) ? item.correctAnswer : [item.correctAnswer];
      const fallback = fallbackFillBlank(userAnswersArray, correctAnswersArray, item.maxScore, item.question, item.allowDisorder, true);
      results.push({
        questionId: item.questionId,
        result: fallback,
      });
    }
  }

  return results;
}

// 批量主观题判题
async function gradeSubjectiveBatchInternal(
  items: { item: BatchGradingItem; index: number }[]
): Promise<BatchGradingResult[]> {
  const results: BatchGradingResult[] = [];

  const questionsPrompt = items.map(({ item }, idx) => {
    const userAnswerText = Array.isArray(item.userAnswer) ? item.userAnswer.join('\n') : item.userAnswer;
    const correctAnswerText = Array.isArray(item.correctAnswer) ? item.correctAnswer.join('\n') : item.correctAnswer;

    return `
【题目${idx + 1}】
题目ID: ${item.questionId}
题型: 主观题
题目内容: ${item.question || '（主观题）'}
参考答案: ${correctAnswerText}
用户答案: ${userAnswerText}
满分: ${item.maxScore}分
---`;
  }).join('\n');

  const batchPrompt = `你是一位严格的考试评分助手。请根据题目和参考答案，客观评估用户的主观题答案。

【批量判题说明】
以下包含 ${items.length} 道主观题，请逐题评分并返回结果。

${questionsPrompt}

【评分规则 - 必须严格遵守】
1. 得分范围：根据每道题的满分给出合理分数
2. 评分标准：
   - 满分：答案与参考答案完全一致或表达完全相同的概念
   - 80%-99%：答案基本正确，但表述不够完整或有 minor 遗漏
   - 60%-79%：答案部分正确，包含了部分要点
   - 30%-59%：答案与题目相关但偏离重点
   - 0-29%：答案错误、与题目无关或表示不知道
3. 以下情况一律给低分：
   - 答案为"不知道"、"不会"、"不确定"、"没学过"等
   - 答案为空或仅填写无意义内容
   - 答案与题目完全无关
4. 相似度判断：只有当用户答案表达了与参考答案相同的核心概念时才给高分

【返回格式 - 必须严格按以下格式，每道题独立输出】
${items.map(({ item }, idx) => `
【题目${idx + 1}结果】
题目ID: ${item.questionId}
得分：X（0-${item.maxScore}之间的整数）
是否正确：是/否（${item.maxScore}分才算"是"，否则"否"）
评价：20字以内
综合解析：20字以内`).join('\n')}

请确保返回所有 ${items.length} 道题的评分结果。`;

  console.log('[AI批量判题-主观题] 发送批量prompt到AI');

  try {
    const response = await generateWithProvider(batchPrompt, 800 + items.length * 300);
    console.log('[AI批量判题-主观题] AI响应内容:', response.substring(0, 500) + '...');

    for (let idx = 0; idx < items.length; idx++) {
      const { item } = items[idx];
      const userAnswerText = Array.isArray(item.userAnswer) ? item.userAnswer.join('') : item.userAnswer;
      const correctAnswerText = Array.isArray(item.correctAnswer) ? item.correctAnswer.join('') : item.correctAnswer;

      try {
        const resultPattern = new RegExp(
          `【题目${idx + 1}结果】[\\s\\S]*?题目ID:\\s*${item.questionId}[\\s\\S]*?(?=(【题目${idx + 2}结果】|$))`,
          'i'
        );
        const resultMatch = response.match(resultPattern);
        const resultText = resultMatch ? resultMatch[0] : response;

        const scoreMatch = resultText.match(/得分[：:]\s*(\d+)/);
        const correctMatch = resultText.match(/是否正确[：:]\s*(是|否|yes|no)/i);
        const feedbackMatch = resultText.match(/评价[：:]\s*(.+)/);
        const explanationMatch = resultText.match(/综合解析[：:]\s*\n?([\s\S]+?)(?=\n\n【题目|$)/);

        let score = 0;
        let isCorrect: 0 | 1 | 2 = 0;
        let feedback = 'AI判题完成';

        if (scoreMatch) {
          score = Math.min(parseInt(scoreMatch[1], 10), item.maxScore);
        }

        if (correctMatch) {
          const correctValue = correctMatch[1].toLowerCase();
          if (correctValue === '是' || correctValue === 'yes') {
            isCorrect = 2;
          } else if (score > 0) {
            isCorrect = 1;
          } else {
            isCorrect = 0;
          }
        } else {
          if (score >= item.maxScore * 0.9) {
            isCorrect = 2;
          } else if (score > 0) {
            isCorrect = 1;
          } else {
            isCorrect = 0;
          }
        }

        if (feedbackMatch) {
          feedback = feedbackMatch[1].trim();
        }

        let explanation = explanationMatch
          ? explanationMatch[1].trim()
          : generateSubjectiveExplanation(userAnswerText, correctAnswerText, score / item.maxScore, score, item.maxScore);

        results.push({
          questionId: item.questionId,
          result: {
            score,
            isCorrect,
            gradingMode: 'ai',
            feedback: `${feedback}（API判题）`,
            explanation: item.question
              ? `【综合解析】\n${explanation}`
              : `【综合解析】\n${explanation}`,
          },
        });

        console.log(`[AI批量判题-主观题] 题目 ${item.questionId} 评分完成: ${score}/${item.maxScore}`);
      } catch (error) {
        console.error(`[AI批量判题-主观题] 解析题目 ${item.questionId} 结果失败:`, error);
        const userAnswerText = Array.isArray(item.userAnswer) ? item.userAnswer.join('') : item.userAnswer;
        const correctAnswerText = Array.isArray(item.correctAnswer) ? item.correctAnswer.join('') : item.correctAnswer;
        const fallback = fallbackSubjective(userAnswerText, correctAnswerText, item.maxScore, item.question);
        fallback.gradingMode = 'ai-fallback';
        fallback.feedback = (fallback.feedback || '').replace('固定判题', 'AI降级判题');
        results.push({
          questionId: item.questionId,
          result: fallback,
        });
      }
    }
  } catch (error) {
    console.error('[AI批量判题-主观题] AI批量判题失败，降级到固定规则:', error);
    for (const { item } of items) {
      const userAnswerText = Array.isArray(item.userAnswer) ? item.userAnswer.join('') : item.userAnswer;
      const correctAnswerText = Array.isArray(item.correctAnswer) ? item.correctAnswer.join('') : item.correctAnswer;
      const fallback = fallbackSubjective(userAnswerText, correctAnswerText, item.maxScore, item.question);
      fallback.gradingMode = 'ai-fallback';
      fallback.feedback = (fallback.feedback || '').replace('固定判题', 'AI降级判题');
      results.push({
        questionId: item.questionId,
        result: fallback,
      });
    }
  }

  return results;
}

// 流式批量判题回调接口
export interface StreamGradingCallbacks {
  onQuestionComplete?: (questionId: string, result: AIGradingResult) => void;
  onComplete?: (results: BatchGradingResult[]) => void;
  onError?: (error: Error) => void;
}

// 流式批量判题 - 使用非流式实现但提供流式回调接口
export async function gradeBatchWithStream(
  items: BatchGradingItem[],
  callbacks?: StreamGradingCallbacks
): Promise<BatchGradingResult[]> {
  console.log(`[AI流式判题] 开始批量判题，共 ${items.length} 道题`);

  const results = await gradeBatch(items);

  // 触发回调
  for (const result of results) {
    callbacks?.onQuestionComplete?.(result.questionId, result.result);
  }

  callbacks?.onComplete?.(results);
  return results;
}
