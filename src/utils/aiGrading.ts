import { calculateSimilarity, normalizeText } from './similarity';
import { modelLoader } from './modelLoader';
import { apiGradingService } from './apiGradingService';
import { useSettingsStore } from '../store/settingsStore';
import { GradingProvider, BlankResult } from '../types';

export type GradingMode = 'ai' | 'fixed' | 'ai-fallback';

export interface AIGradingResult {
  score: number;
  isCorrect: 0 | 1 | 2; // 0=错误, 1=部分正确, 2=正确
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
}

export interface BatchGradingResult {
  questionId: string;
  result: AIGradingResult;
}

const INVALID_ANSWER_KEYWORDS = ['不知道', '不会', '不确定', '没学过', '不了解', '不清楚', '不会写', ''];

function getGradingProvider(): GradingProvider {
  return useSettingsStore.getState().gradingProvider;
}

function getAPIConfig(): { apiKey: string | null; apiModel: string; apiEndpoint: string } {
  const state = useSettingsStore.getState();
  return {
    apiKey: state.apiKey,
    apiModel: state.apiModel,
    apiEndpoint: state.apiEndpoint,
  };
}

export async function checkModelAvailability(): Promise<boolean> {
  const provider = getGradingProvider();
  if (provider === 'api') {
    // 先设置API配置
    const config = getAPIConfig();
    if (config.apiKey) {
      apiGradingService.setConfig({
        apiKey: config.apiKey,
        model: config.apiModel,
        endpoint: config.apiEndpoint || undefined,
      });
    }
    return apiGradingService.isConfigured();
  }
  return modelLoader.isModelReady();
}

export async function isModelReady(): Promise<boolean> {
  const provider = getGradingProvider();
  if (provider === 'api') {
    // 先设置API配置
    const config = getAPIConfig();
    if (config.apiKey) {
      apiGradingService.setConfig({
        apiKey: config.apiKey,
        model: config.apiModel,
        endpoint: config.apiEndpoint || undefined,
      });
    }
    return apiGradingService.isConfigured();
  }
  return modelLoader.isModelReady();
}

export async function initializeModel(
  modelId: string,
  onProgress?: (progress: number, status: string) => void
): Promise<boolean> {
  try {
    return await modelLoader.loadModel(modelId, onProgress);
  } catch (error) {
    console.error('模型初始化失败:', error);
    return false;
  }
}

export async function unloadModel(): Promise<void> {
  await modelLoader.unloadModel();
}

export async function autoLoadLastModel(
  onProgress?: (progress: number, status: string) => void
): Promise<boolean> {
  console.log('[aiGrading] 尝试自动加载上次使用的模型...');
  const result = await modelLoader.autoLoadLastModel(onProgress);
  if (result) {
    console.log('[aiGrading] 自动加载模型成功');
  } else {
    console.log('[aiGrading] 自动加载模型失败或没有上次使用的模型');
  }
  return result;
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

  // 根据相似度确定 isCorrect: 0=错误, 1=部分正确, 2=正确
  let isCorrect: 0 | 1 | 2;
  if (similarity >= 0.9) {
    isCorrect = 2; // 正确
  } else if (similarity >= 0.6) {
    isCorrect = 1; // 部分正确
  } else {
    isCorrect = 0; // 错误
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
      endpoint: config.apiEndpoint || undefined,
    });
    return apiGradingService.callAPI(prompt, maxTokens);
  }
  
  return modelLoader.generate(prompt, { maxTokens, temperature: 0.1 });
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
        isCorrect: 0, // 错误
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
        isCorrect: 2, // 正确
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
        isCorrect: 2, // 正确
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
  const webllmReady = modelLoader.isModelReady();
  const apiReady = apiGradingService.isConfigured();

  const isReady = provider === 'api' ? apiReady : webllmReady;

  console.log(`[AI判题] 填空题 - 判题提供者: ${provider}, 模型状态: WebLLM=${webllmReady}, API=${apiReady}`);
  console.log(`[AI判题] 题目: ${question || '（填空题）'}`);
  console.log(`[AI判题] 标准答案: ${correctAnswers.join('、')}`);
  console.log(`[AI判题] 用户答案: ${userAnswers.join('、')}`);
  console.log(`[AI判题] 允许乱序: ${allowDisorder ? '是' : '否'}`);

  if (provider === 'fixed' || !isReady) {
    console.log('[AI判题] 使用固定判题');
    let totalScore = 0;
    let correctCount = 0;
    const scorePerBlank = maxScore / correctAnswers.length;
    const blankResults: BlankResult[] = [];

    if (allowDisorder) {
      // 乱序模式：检查每个用户答案是否存在于正确答案集合中
      const correctAnswerSet = new Set(correctAnswers.map(a => a.toLowerCase().trim()));

      for (let i = 0; i < correctAnswers.length; i++) {
        const userAns = userAnswers[i] || '';
        const normalizedUser = userAns.toLowerCase().trim();
        
        // 检查用户答案是否在正确答案集合中
        const isBlankCorrect = correctAnswerSet.has(normalizedUser) && normalizedUser !== '';
        
        if (isBlankCorrect) {
          correctCount++;
          totalScore += scorePerBlank;
        }

        // 找到对应的正确答案（用于显示）
        let matchedCorrectAnswer: string;
        if (isBlankCorrect) {
          // 答案正确：显示匹配到的正确答案
          matchedCorrectAnswer = correctAnswers.find(a => a.toLowerCase().trim() === normalizedUser) || '';
        } else {
          // 答案错误：显示该位置的标准答案（用于提示用户）
          matchedCorrectAnswer = correctAnswers[i] || '';
        }

        blankResults.push({
          userAnswer: userAns,
          correctAnswer: matchedCorrectAnswer,
          isCorrect: isBlankCorrect
        });
      }

      // 根据 correctCount 确定 isCorrect: 0=错误, 1=部分正确, 2=正确
      let isCorrect: 0 | 1 | 2;
      if (correctCount === correctAnswers.length) {
        isCorrect = 2; // 全部正确
      } else if (correctCount > 0) {
        isCorrect = 1; // 部分正确
      } else {
        isCorrect = 0; // 全部错误
      }

      return {
        score: Math.round(totalScore),
        isCorrect,
        gradingMode: 'fixed',
        feedback: isCorrect === 2 ? '固定判题：全部正确' : isCorrect === 1 ? `固定判题：部分正确（${correctCount}/${correctAnswers.length}）` : '固定判题：全部错误',
        explanation: `【固定判题模式】\n标准答案：${correctAnswers.join('、')}\n你的答案：${userAnswers.join('、')}`,
        blankResults
      };
    } else {
      // 顺序模式：按位置匹配
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

      // 根据 correctCount 确定 isCorrect: 0=错误, 1=部分正确, 2=正确
      let isCorrect: 0 | 1 | 2;
      if (correctCount === correctAnswers.length) {
        isCorrect = 2; // 全部正确
      } else if (correctCount > 0) {
        isCorrect = 1; // 部分正确
      } else {
        isCorrect = 0; // 全部错误
      }

      return {
        score: Math.round(totalScore),
        isCorrect,
        gradingMode: 'fixed',
        feedback: isCorrect === 2 ? '固定判题：全部正确' : isCorrect === 1 ? '固定判题：部分答案不正确' : '固定判题：全部错误',
        explanation: `【固定判题模式】\n标准答案：${correctAnswers.join('、')}\n你的答案：${userAnswers.join('、')}`,
        blankResults
      };
    }
  }

  // 根据是否允许乱序，生成不同的Prompt模板
  let prompt: string;
  
  if (allowDisorder) {
    // 乱序模式Prompt
    const answersComparison = correctAnswers.map((_, index) => {
      const user = userAnswers[index] || '';
      const displayUser = user.trim() === '' ? '(未填写)' : user;
      return `第${index + 1}空：用户答案「${displayUser}」`;
    }).join('\n');

    prompt = `你是一位严格的考试评分助手。请根据题目内容和参考答案，客观判断用户的填空答案是否正确。

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
4. 计分方式：每空${(maxScore / correctAnswers.length).toFixed(1)}分，匹配成功的空才得分
5. 【重要】最终判断标准：
   - "正确"：所有空的答案都存在于标准答案集合中（全部正确）
   - "部分正确"：至少有一个空的答案存在于标准答案集合中，但不是全部（部分正确）
   - "错误"：没有任何一个空的答案存在于标准答案集合中（全部错误）

【返回格式 - 必须严格按以下格式，不要省略任何部分】
得分：X/${maxScore}分
判断：正确/部分正确/错误
逐空分析：
${correctAnswers.map((_, i) => `- 第${i + 1}空：正确/错误，用户答案「xxx」是否存在于标准答案集合中，具体说明`).join('\n')}
综合解析：简要分析用户答题情况，指出错误原因（如果有），给出学习建议`;
  } else {
    // 顺序模式Prompt
    const answersComparison = correctAnswers.map((correct, index) => {
      const user = userAnswers[index] || '';
      const displayUser = user.trim() === '' ? '(未填写)' : user;
      return `第${index + 1}空：标准答案「${correct}」vs 用户答案「${displayUser}」`;
    }).join('\n');

    prompt = `你是一位严格的考试评分助手。请根据题目内容和参考答案，客观判断用户的填空答案是否正确。

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
4. 计分方式：每空${(maxScore / correctAnswers.length).toFixed(1)}分，位置匹配且内容正确的空才得分

【返回格式 - 必须严格按以下格式，不要省略任何部分】
得分：X/${maxScore}分
判断：正确/部分正确/错误
逐空分析：
${correctAnswers.map((_, i) => `- 第${i + 1}空：正确/错误，用户答案「xxx」与标准答案「xxx」是否一致，具体说明`).join('\n')}
综合解析：简要分析用户答题情况，指出错误原因（如果有），给出学习建议`;
  }

  console.log('[AI判题] =======================================');
  console.log('[AI判题] 开始 AI 判题流程');
  console.log('[AI判题] =======================================');
  console.log(`[AI判题] 判题提供者: ${provider}`);
  console.log(`[AI判题] 题目内容: ${question || '（填空题）'}`);
  console.log(`[AI判题] 标准答案: [${correctAnswers.map((a, i) => `空${i+1}:${a}`).join(', ')}]`);
  console.log(`[AI判题] 用户答案: [${userAnswers.map((a, i) => `空${i+1}:${a || '(空)'}`).join(', ')}]`);
  console.log(`[AI判题] 允许乱序: ${allowDisorder ? '是' : '否'}`);
  console.log(`[AI判题] 题目满分: ${maxScore}分`);
  console.log(`[AI判题] 每空分值: ${(maxScore / correctAnswers.length).toFixed(1)}分`);
  console.log('[AI判题] ---------------------------------------');
  console.log('[AI判题] 发送给 AI 的 Prompt:');
  console.log(prompt);
  console.log('[AI判题] ---------------------------------------');

  try {
    console.log(`[AI判题] 调用 ${provider} 生成...`);
    const response = await generateWithProvider(prompt, 500);

    console.log('[AI判题] ---------------------------------------');
    console.log('[AI判题] AI 原始响应内容:');
    console.log(response);
    console.log('[AI判题] ---------------------------------------');

    if (response.includes('Generation stopped') || response.includes('exceeding max_tokens') || response.length < 20) {
      console.warn('[AI判题] AI 响应被截断或异常，降级到精确匹配');
      throw new Error('AI 响应被截断');
    }

    console.log('[AI判题] 开始解析 AI 响应...');

    const scoreMatch = response.match(/得分[：:]\s*(\d+)/);
    const judgmentMatch = response.match(/判断[：:]\s*(正确|部分正确|错误)/);
    const analysisMatch = response.match(/逐空分析[：:]([\s\S]+?)(?=综合解析|$)/);
    const explanationMatch = response.match(/综合解析[：:]([\s\S]+)/);

    console.log('[AI判题] 正则匹配结果:');
    console.log(`[AI判题]   - 得分匹配: ${scoreMatch ? scoreMatch[1] + '分' : '未匹配'}`);
    console.log(`[AI判题]   - 判断匹配: ${judgmentMatch ? judgmentMatch[1] : '未匹配'}`);
    console.log(`[AI判题]   - 逐空分析匹配: ${analysisMatch ? '是' : '否'}`);
    console.log(`[AI判题]   - 综合解析匹配: ${explanationMatch ? '是' : '否'}`);

    let score = scoreMatch ? Math.min(parseInt(scoreMatch[1], 10), maxScore) : 0;
    let isCorrect: 0 | 1 | 2 = 0;

    if (judgmentMatch) {
      // 根据判断字段确定 isCorrect: 0=错误, 1=部分正确, 2=正确
      if (judgmentMatch[1] === '正确') {
        isCorrect = 2;
      } else if (judgmentMatch[1] === '部分正确') {
        isCorrect = 1;
      } else {
        isCorrect = 0;
      }
      console.log(`[AI判题] 根据判断字段确定结果: ${judgmentMatch[1]} -> isCorrect=${isCorrect}`);
    } else {
      // 没有判断字段时，根据得分判断
      if (score >= maxScore) {
        isCorrect = 2; // 满分
      } else if (score > 0) {
        isCorrect = 1; // 部分得分
      } else {
        isCorrect = 0; // 0分
      }
      console.log(`[AI判题] 根据得分判断结果: ${score}分 -> isCorrect=${isCorrect}`);
    }

    let explanation = '';

    if (explanationMatch) {
      explanation = explanationMatch[1].trim();
      console.log('[AI判题] 已提取综合解析内容');
    }

    if (!explanation) {
      explanation = generateFillBlankExplanation(userAnswers.join('、'), correctAnswers.join('、'), isCorrect === 2);
      console.log('[AI判题] 使用默认解析模板');
    }

    console.log('[AI判题] ---------------------------------------');
    console.log(`[AI判题] 最终判题结果:`);
    console.log(`[AI判题]   - 得分: ${score}/${maxScore}`);
    console.log(`[AI判题]   - 是否正确: ${isCorrect}`);
    console.log(`[AI判题]   - 判题模式: ${provider === 'api' ? 'API智能判题' : 'WebLLM智能判题'}`);
    console.log('[AI判题] ---------------------------------------');

    // 解析逐空分析，生成 blankResults
    const blankResults: BlankResult[] = [];
    if (allowDisorder) {
      // 乱序模式：检查每个用户答案是否存在于正确答案集合中
      const correctAnswerSet = new Set(correctAnswers.map(a => a.toLowerCase().trim()));
      
      for (let i = 0; i < correctAnswers.length; i++) {
        const userAns = userAnswers[i] || '';
        const normalizedUser = userAns.toLowerCase().trim();
        
        // 检查用户答案是否在正确答案集合中
        const isBlankCorrect = correctAnswerSet.has(normalizedUser) && normalizedUser !== '';
        
        // 找到对应的正确答案（用于显示）
        let matchedCorrectAnswer: string;
        if (isBlankCorrect) {
          // 答案正确：显示匹配到的正确答案
          matchedCorrectAnswer = correctAnswers.find(a => a.toLowerCase().trim() === normalizedUser) || '';
        } else {
          // 答案错误：显示该位置的标准答案（用于提示用户）
          matchedCorrectAnswer = correctAnswers[i] || '';
        }

        blankResults.push({
          userAnswer: userAns,
          correctAnswer: matchedCorrectAnswer,
          isCorrect: isBlankCorrect
        });
      }
    } else {
      // 顺序模式：按位置匹配
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
        // 如果没有逐空分析，使用简单比较
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
    }

    const result: AIGradingResult = {
      score,
      isCorrect,
      gradingMode: 'ai',
      feedback: isCorrect === 2 ? `${provider === 'api' ? 'API' : 'WebLLM'}判题：${score}分` : `${provider === 'api' ? 'API' : 'WebLLM'}判题：${score}分（部分正确）`,
      explanation: `【综合解析】\n${explanation}`,
      blankResults
    };

    console.log('[AI判题] 完整判题结果对象:', result);
    console.log('[AI判题] =======================================');
    console.log('[AI判题] AI 判题流程结束');
    console.log('[AI判题] =======================================');
    return result;
  } catch (error) {
    console.error('[AI判题] =======================================');
    console.error('[AI判题] AI判题失败，降级到固定规则判题');
    console.error('[AI判题] 错误信息:', error);
    console.error('[AI判题] =======================================');

    let totalScore = 0;
    let correctCount = 0;
    const scorePerBlank = maxScore / correctAnswers.length;
    const blankResults: BlankResult[] = [];

    console.log('[AI判题] 开始固定规则判题:');
    
    if (allowDisorder) {
      // 乱序模式：检查每个用户答案是否存在于正确答案集合中
      const correctAnswerSet = new Set(correctAnswers.map(a => a.toLowerCase().trim()));
      
      for (let i = 0; i < correctAnswers.length; i++) {
        const userAns = userAnswers[i] || '';
        const normalizedUser = userAns.toLowerCase().trim();
        
        // 检查用户答案是否在正确答案集合中
        const isBlankCorrect = correctAnswerSet.has(normalizedUser) && normalizedUser !== '';
        
        console.log(`[AI判题]   空${i+1}: 「${userAns}」-> ${isBlankCorrect ? '正确' : '错误'}`);

        totalScore += isBlankCorrect ? scorePerBlank : 0;
        if (isBlankCorrect) correctCount++;

        // 找到对应的正确答案（用于显示）
        let matchedCorrectAnswer: string;
        if (isBlankCorrect) {
          // 答案正确：显示匹配到的正确答案
          matchedCorrectAnswer = correctAnswers.find(a => a.toLowerCase().trim() === normalizedUser) || '';
        } else {
          // 答案错误：显示该位置的标准答案（用于提示用户）
          matchedCorrectAnswer = correctAnswers[i] || '';
        }

        blankResults.push({
          userAnswer: userAns,
          correctAnswer: matchedCorrectAnswer,
          isCorrect: isBlankCorrect
        });
      }
    } else {
      // 顺序模式：按位置匹配
      for (let i = 0; i < correctAnswers.length; i++) {
        const correctAns = correctAnswers[i];
        const userAns = userAnswers[i] || '';

        const normalizedCorrect = correctAns.toLowerCase().trim();
        const normalizedUser = userAns.toLowerCase().trim();
        const isBlankCorrect = normalizedCorrect === normalizedUser;

        console.log(`[AI判题]   空${i+1}: 「${userAns}」vs「${correctAns}」-> ${isBlankCorrect ? '正确' : '错误'}`);

        totalScore += isBlankCorrect ? scorePerBlank : 0;
        if (isBlankCorrect) correctCount++;

        blankResults.push({
          userAnswer: userAns,
          correctAnswer: correctAns,
          isCorrect: isBlankCorrect
        });
      }
    }

    // 根据 correctCount 确定 isCorrect: 0=错误, 1=部分正确, 2=正确
    let isCorrect: 0 | 1 | 2;
    if (correctCount === correctAnswers.length) {
      isCorrect = 2; // 全部正确
    } else if (correctCount > 0) {
      isCorrect = 1; // 部分正确
    } else {
      isCorrect = 0; // 全部错误
    }

    const fallbackResult = {
      score: Math.round(totalScore),
      isCorrect,
      gradingMode: 'ai-fallback' as const,
      feedback: isCorrect === 2 ? 'AI降级判题：全部正确' : isCorrect === 1 ? 'AI降级判题：部分答案不正确' : 'AI降级判题：全部错误',
      explanation: `【AI降级判题模式】\n标准答案：${correctAnswers.join('、')}\n你的答案：${userAnswers.join('、')}`,
      blankResults
    };

    console.log('[AI判题] 降级判题结果:', fallbackResult);
    console.log('[AI判题] =======================================');
    return fallbackResult;
  }
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
  const webllmReady = modelLoader.isModelReady();
  const apiReady = apiGradingService.isConfigured();

  const isReady = provider === 'api' ? apiReady : webllmReady;

  console.log('[AI判题] =======================================');
  console.log('[AI判题] 开始主观题 AI 判题流程');
  console.log('[AI判题] =======================================');
  console.log(`[AI判题] 判题提供者: ${provider}`);
  console.log(`[AI判题] 模型状态: WebLLM=${webllmReady}, API=${apiReady}`);
  console.log(`[AI判题] 题目内容: ${question || '（主观题）'}`);
  console.log(`[AI判题] 标准答案: ${correctAnswer}`);
  console.log(`[AI判题] 用户答案: ${userAnswer}`);
  console.log(`[AI判题] 题目满分: ${maxScore}分`);

  if (provider === 'fixed' || !isReady) {
    console.log('[AI判题] 使用固定规则判题');
    return fallbackSubjective(userAnswer, correctAnswer, maxScore, question);
  }

  const prompt = `你是一位严格的考试评分助手。请根据题目和参考答案，客观评估用户的主观题答案。

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
评价：简短评价（如：答案完整准确/答案基本正确但不够详细/答案部分正确/答案与题目无关等）
综合解析：
1. 题目分析：说明题目考查的知识点和核心概念
2. 答案要点分析：逐条对比用户答案与参考答案，说明哪些要点答对了、哪些遗漏了
3. 关联分析：分析用户答案与题目要求的相关性，解释为什么得这个分数
4. 解析建议：结合题目和参考答案，给出具体的改进建议和学习指导`;

  console.log('[AI判题] ---------------------------------------');
  console.log('[AI判题] 发送给 AI 的 Prompt:');
  console.log(prompt);
  console.log('[AI判题] ---------------------------------------');

  try {
    console.log(`[AI判题] 调用 ${provider} 生成...`);
    const response = await generateWithProvider(prompt, 600);

    console.log('[AI判题] ---------------------------------------');
    console.log('[AI判题] AI 原始响应内容:');
    console.log(response);
    console.log('[AI判题] ---------------------------------------');

    if (response.includes('Generation stopped') || response.includes('exceeding max_tokens') || response.length < 20) {
      console.warn('[AI判题] AI 响应被截断或异常，降级到相似度计算');
      throw new Error('AI 响应被截断');
    }

    console.log('[AI判题] 开始解析 AI 响应...');

    const scoreMatch = response.match(/得分[：:]\s*(\d+)/);
    const correctMatch = response.match(/是否正确[：:]\s*(是|否|yes|no)/i);
    const feedbackMatch = response.match(/评价[：:]\s*(.+)/);
    const explanationMatch = response.match(/综合解析[：:]\s*\n?([\s\S]+?)(?=\n\n|$)/);

    console.log('[AI判题] 正则匹配结果:');
    console.log(`[AI判题]   - 得分匹配: ${scoreMatch ? scoreMatch[1] + '分' : '未匹配'}`);
    console.log(`[AI判题]   - 是否正确匹配: ${correctMatch ? correctMatch[1] : '未匹配'}`);
    console.log(`[AI判题]   - 评价匹配: ${feedbackMatch ? '是' : '否'}`);
    console.log(`[AI判题]   - 详细解析匹配: ${explanationMatch ? '是' : '否'}`);

    let score = 0;
    let isCorrect: 0 | 1 | 2 = 0;
    let feedback = 'AI判题完成';

    if (scoreMatch) {
      score = Math.min(parseInt(scoreMatch[1], 10), maxScore);
      console.log(`[AI判题] 提取得分: ${score}分`);
    } else {
      console.warn('[AI判题] 未能匹配得分，使用默认0分');
    }

    if (correctMatch) {
      const correctValue = correctMatch[1].toLowerCase();
      // "是" = 正确(2)，"否"且得分>0 = 部分正确(1)，"否"且得分=0 = 错误(0)
      if (correctValue === '是' || correctValue === 'yes') {
        isCorrect = 2;
      } else if (score > 0) {
        isCorrect = 1;
      } else {
        isCorrect = 0;
      }
      console.log(`[AI判题] 根据"是否正确"字段: ${correctMatch[1]} -> isCorrect=${isCorrect}`);
    } else {
      // 根据得分判断: 0=错误, 1=部分正确, 2=正确
      if (score >= maxScore * 0.9) {
        isCorrect = 2; // 正确
      } else if (score > 0) {
        isCorrect = 1; // 部分正确
      } else {
        isCorrect = 0; // 错误
      }
      console.log(`[AI判题] 根据得分判断: ${score}分 -> isCorrect=${isCorrect}`);
    }

    if (feedbackMatch) {
      feedback = feedbackMatch[1].trim();
      console.log(`[AI判题] 提取评价: ${feedback}`);
    }

    let explanation = explanationMatch
      ? explanationMatch[1].trim()
      : generateSubjectiveExplanation(userAnswer, correctAnswer, score / maxScore, score, maxScore);

    if (explanationMatch) {
      console.log('[AI判题] 已提取详细解析内容');
    } else {
      console.log('[AI判题] 使用默认解析模板');
    }

    console.log('[AI判题] ---------------------------------------');
    console.log(`[AI判题] 最终判题结果:`);
    console.log(`[AI判题]   - 得分: ${score}/${maxScore}`);
    console.log(`[AI判题]   - 是否正确: ${isCorrect}`);
    console.log(`[AI判题]   - 判题模式: ${provider === 'api' ? 'API智能判题' : 'WebLLM智能判题'}`);
    console.log(`[AI判题]   - 评价: ${feedback}`);
    console.log('[AI判题] ---------------------------------------');

    const result = {
      score,
      isCorrect,
      gradingMode: 'ai' as const,
      feedback: `${feedback}（${provider === 'api' ? 'API' : 'WebLLM'}判题）`,
      explanation: question
        ? `【综合解析】\n${explanation}`
        : `【综合解析】\n${explanation}`,
    };

    console.log('[AI判题] 完整判题结果对象:', result);
    console.log('[AI判题] =======================================');
    console.log('[AI判题] 主观题 AI 判题流程结束');
    console.log('[AI判题] =======================================');
    return result;
  } catch (error) {
    console.error('[AI判题] =======================================');
    console.error('[AI判题] AI判题失败，降级到相似度计算');
    console.error('[AI判题] 错误信息:', error);
    console.error('[AI判题] =======================================');
    const fallback = fallbackSubjective(userAnswer, correctAnswer, maxScore, question);
    fallback.gradingMode = 'ai-fallback';
    fallback.feedback = (fallback.feedback || '').replace('固定判题', 'AI降级判题');
    console.log('[AI判题] 降级判题结果:', fallback);
    return fallback;
  }
}

export function resetModelAvailability(): void {
}

export async function gradeFillBlankBatch(
  items: BatchGradingItem[]
): Promise<BatchGradingResult[]> {
  if (items.length === 0) {
    return [];
  }

  console.log(`[AI批量判题] 开始批量判题，共 ${items.length} 道填空题`);

  const results: BatchGradingResult[] = [];
  const aiNeededItems: { item: BatchGradingItem; index: number }[] = [];

  // 第一步：快速预检
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const userAnswersArray = Array.isArray(item.userAnswer) ? item.userAnswer : [item.userAnswer];
    const correctAnswersArray = Array.isArray(item.correctAnswer) ? item.correctAnswer : [item.correctAnswer];

    const preCheck = fastPreCheck(userAnswersArray, correctAnswersArray, item.maxScore, 'fill-in-blank');

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

  // 如果没有需要AI判题的题目，直接返回
  if (aiNeededItems.length === 0) {
    console.log('[AI批量判题] 所有题目都通过快速预检，无需AI判题');
    return results;
  }

  // 第二步：生成批量prompt
  const provider = getGradingProvider();
  const webllmReady = modelLoader.isModelReady();
  const apiReady = apiGradingService.isConfigured();
  const isReady = provider === 'api' ? apiReady : webllmReady;

  // 如果需要AI判题但模型未就绪，使用固定规则判题
  if (provider === 'fixed' || !isReady) {
    console.log('[AI批量判题] 模型未就绪，使用固定规则判题');
    for (const { item } of aiNeededItems) {
      const userAnswersArray = Array.isArray(item.userAnswer) ? item.userAnswer : [item.userAnswer];
      const correctAnswersArray = Array.isArray(item.correctAnswer) ? item.correctAnswer : [item.correctAnswer];

      let totalScore = 0;
      let correctCount = 0;
      const scorePerBlank = item.maxScore / correctAnswersArray.length;
      const blankResults: BlankResult[] = [];

      if (item.allowDisorder) {
        // 乱序模式：检查每个用户答案是否存在于正确答案集合中
        const correctAnswerSet = new Set(correctAnswersArray.map(a => a.toLowerCase().trim()));
        
        for (let i = 0; i < correctAnswersArray.length; i++) {
          const userAns = userAnswersArray[i] || '';
          const normalizedUser = userAns.toLowerCase().trim();
          
          // 检查用户答案是否在正确答案集合中
          const isBlankCorrect = correctAnswerSet.has(normalizedUser) && normalizedUser !== '';
          
          totalScore += isBlankCorrect ? scorePerBlank : 0;
          if (isBlankCorrect) correctCount++;

          // 找到对应的正确答案（用于显示）
          let matchedCorrectAnswer: string;
          if (isBlankCorrect) {
            // 答案正确：显示匹配到的正确答案
            matchedCorrectAnswer = correctAnswersArray.find(a => a.toLowerCase().trim() === normalizedUser) || '';
          } else {
            // 答案错误：显示该位置的标准答案（用于提示用户）
            matchedCorrectAnswer = correctAnswersArray[i] || '';
          }

          blankResults.push({
            userAnswer: userAns,
            correctAnswer: matchedCorrectAnswer,
            isCorrect: isBlankCorrect
          });
        }
      } else {
        // 顺序模式：按位置匹配
        for (let i = 0; i < correctAnswersArray.length; i++) {
          const correctAns = correctAnswersArray[i];
          const userAns = userAnswersArray[i] || '';
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

      // 根据 correctCount 确定 isCorrect: 0=错误, 1=部分正确, 2=正确
      let isCorrect: 0 | 1 | 2;
      if (correctCount === correctAnswersArray.length) {
        isCorrect = 2; // 全部正确
      } else if (correctCount > 0) {
        isCorrect = 1; // 部分正确
      } else {
        isCorrect = 0; // 全部错误
      }

      results.push({
        questionId: item.questionId,
        result: {
          score: Math.round(totalScore),
          isCorrect,
          gradingMode: 'fixed',
          feedback: isCorrect === 2 ? '固定判题：全部正确' : isCorrect === 1 ? '固定判题：部分答案不正确' : '固定判题：全部错误',
          explanation: `【固定判题模式】\n标准答案：${correctAnswersArray.join('、')}\n你的答案：${userAnswersArray.join('、')}`,
          blankResults
        },
      });
    }
    return results;
  }

  // 生成批量prompt - 每道题单独生成，区分乱序和顺序模式
  const questionsPrompt = aiNeededItems.map(({ item }, idx) => {
    const userAnswersArray = Array.isArray(item.userAnswer) ? item.userAnswer : [item.userAnswer];
    const correctAnswersArray = Array.isArray(item.correctAnswer) ? item.correctAnswer : [item.correctAnswer];

    if (item.allowDisorder) {
      // 乱序模式
      const answersComparison = userAnswersArray.map((user, index) => {
        const displayUser = (user as string).trim() === '' ? '(未填写)' : user;
        return `第${index + 1}空：用户答案「${displayUser}」`;
      }).join('\n');

      return `
【题目${idx + 1}】
题目ID: ${item.questionId}
判题模式: 乱序模式（答案可填在任意位置）
题目内容: ${item.question || '（填空题）'}
标准答案集合:
${correctAnswersArray.map((a, i) => `${i + 1}. ${a}`).join('\n')}
用户答案:
${answersComparison}
每空分值: ${(item.maxScore / correctAnswersArray.length).toFixed(1)}分
满分: ${item.maxScore}分
判题规则: 检查每个用户答案是否存在于标准答案集合中，存在即正确，与位置无关
---`;
    } else {
      // 顺序模式
      const answersComparison = correctAnswersArray.map((correct, index) => {
        const user = userAnswersArray[index] || '';
        const displayUser = (user as string).trim() === '' ? '(未填写)' : user;
        return `第${index + 1}空：标准答案「${correct}」vs 用户答案「${displayUser}」`;
      }).join('\n');

      return `
【题目${idx + 1}】
题目ID: ${item.questionId}
判题模式: 顺序模式（必须按位置匹配）
题目内容: ${item.question || '（填空题）'}
答案对比:
${answersComparison}
每空分值: ${(item.maxScore / correctAnswersArray.length).toFixed(1)}分
满分: ${item.maxScore}分
判题规则: 按位置逐一比较，第N空必须匹配第N个标准答案
---`;
    }
  }).join('\n');

  const batchPrompt = `你是一位严格的考试评分助手。请根据题目内容和参考答案，客观判断用户的填空答案是否正确。

【批量判题说明】
以下包含 ${aiNeededItems.length} 道填空题，每道题都明确标注了判题模式（乱序/顺序），请严格按照对应模式判题。

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
${aiNeededItems.map(({ item }, idx) => {
  const correctAnswersArray = Array.isArray(item.correctAnswer) ? item.correctAnswer : [item.correctAnswer];
  const modeHint = item.allowDisorder ? '（乱序模式：检查答案是否存在于标准答案集合中）' : '（顺序模式：按位置匹配）';
  return `
【题目${idx + 1}结果】
题目ID: ${item.questionId}
判题模式: ${item.allowDisorder ? '乱序模式' : '顺序模式'}
得分：X/${item.maxScore}分
判断：正确/部分正确/错误
逐空分析${modeHint}：
${correctAnswersArray.map((_, i) => `- 第${i + 1}空：正确/错误，具体说明`).join('\n')}
综合解析：简要分析用户答题情况，指出错误原因（如果有），给出学习建议`;
}).join('\n')}

请确保返回所有 ${aiNeededItems.length} 道题的评分结果，并严格按照每道题标注的判题模式进行判断。`;

  console.log('[AI批量判题] 发送批量prompt到AI');

  try {
    const response = await generateWithProvider(batchPrompt, 1000 + aiNeededItems.length * 200);

    console.log('[AI批量判题] AI响应内容:', response.substring(0, 500) + '...');

    // 解析批量响应
    for (let idx = 0; idx < aiNeededItems.length; idx++) {
      const { item } = aiNeededItems[idx];
      const userAnswersArray = Array.isArray(item.userAnswer) ? item.userAnswer : [item.userAnswer];
      const correctAnswersArray = Array.isArray(item.correctAnswer) ? item.correctAnswer : [item.correctAnswer];

      try {
        // 提取该题目的结果
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
          // 根据判断字段确定 isCorrect: 0=错误, 1=部分正确, 2=正确
          if (judgmentMatch[1] === '正确') {
            isCorrect = 2;
          } else if (judgmentMatch[1] === '部分正确') {
            isCorrect = 1;
          } else {
            isCorrect = 0;
          }
        } else {
          // 没有判断字段时，根据得分判断
          if (score >= item.maxScore) {
            isCorrect = 2; // 满分
          } else if (score > 0) {
            isCorrect = 1; // 部分得分
          } else {
            isCorrect = 0; // 0分
          }
        }

        let explanation = explanationMatch ? explanationMatch[1].trim() : '';
        if (!explanation) {
          explanation = generateFillBlankExplanation(userAnswersArray.join('、'), correctAnswersArray.join('、'), isCorrect === 2);
        }

        // 生成 blankResults
        const blankResults: BlankResult[] = [];
        if (item.allowDisorder) {
          // 乱序模式：检查每个用户答案是否存在于正确答案集合中
          const correctAnswerSet = new Set(correctAnswersArray.map(a => a.toLowerCase().trim()));
          
          for (let i = 0; i < correctAnswersArray.length; i++) {
            const userAns = userAnswersArray[i] || '';
            const normalizedUser = userAns.toLowerCase().trim();
            
            // 检查用户答案是否在正确答案集合中
            const isBlankCorrect = correctAnswerSet.has(normalizedUser) && normalizedUser !== '';
            
            // 找到对应的正确答案（用于显示）
            let matchedCorrectAnswer: string;
            if (isBlankCorrect) {
              // 答案正确：显示匹配到的正确答案
              matchedCorrectAnswer = correctAnswersArray.find(a => a.toLowerCase().trim() === normalizedUser) || '';
            } else {
              // 答案错误：显示该位置的标准答案（用于提示用户）
              matchedCorrectAnswer = correctAnswersArray[i] || '';
            }

            blankResults.push({
              userAnswer: userAns,
              correctAnswer: matchedCorrectAnswer,
              isCorrect: isBlankCorrect
            });
          }
        } else {
          // 顺序模式：按位置匹配
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
            feedback: isCorrect === 2 ? `${provider === 'api' ? 'API' : 'WebLLM'}判题：${score}分` : `${provider === 'api' ? 'API' : 'WebLLM'}判题：${score}分（部分正确）`,
            explanation: `【综合解析】\n${explanation}`,
            blankResults
          },
        });

        console.log(`[AI批量判题] 题目 ${item.questionId} 评分完成: ${score}/${item.maxScore}`);
      } catch (error) {
        console.error(`[AI批量判题] 解析题目 ${item.questionId} 结果失败:`, error);
        // 降级到固定规则
        let totalScore = 0;
        let correctCount = 0;
        const scorePerBlank = item.maxScore / correctAnswersArray.length;
        const blankResults: BlankResult[] = [];

        if (item.allowDisorder) {
          // 乱序模式：检查每个用户答案是否存在于正确答案集合中
          const correctAnswerSet = new Set(correctAnswersArray.map(a => a.toLowerCase().trim()));
          
          for (let i = 0; i < correctAnswersArray.length; i++) {
            const userAns = userAnswersArray[i] || '';
            const normalizedUser = userAns.toLowerCase().trim();
            
            // 检查用户答案是否在正确答案集合中
            const isBlankCorrect = correctAnswerSet.has(normalizedUser) && normalizedUser !== '';
            
            totalScore += isBlankCorrect ? scorePerBlank : 0;
            if (isBlankCorrect) correctCount++;

            // 找到对应的正确答案（用于显示）
            let matchedCorrectAnswer: string;
            if (isBlankCorrect) {
              // 答案正确：显示匹配到的正确答案
              matchedCorrectAnswer = correctAnswersArray.find(a => a.toLowerCase().trim() === normalizedUser) || '';
            } else {
              // 答案错误：显示该位置的标准答案（用于提示用户）
              matchedCorrectAnswer = correctAnswersArray[i] || '';
            }

            blankResults.push({
              userAnswer: userAns,
              correctAnswer: matchedCorrectAnswer,
              isCorrect: isBlankCorrect
            });
          }
        } else {
          // 顺序模式：按位置匹配
          for (let i = 0; i < correctAnswersArray.length; i++) {
            const correctAns = correctAnswersArray[i];
            const userAns = userAnswersArray[i] || '';
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

        // 根据 correctCount 确定 isCorrect: 0=错误, 1=部分正确, 2=正确
        let isCorrect: 0 | 1 | 2;
        if (correctCount === correctAnswersArray.length) {
          isCorrect = 2; // 全部正确
        } else if (correctCount > 0) {
          isCorrect = 1; // 部分正确
        } else {
          isCorrect = 0; // 全部错误
        }

        results.push({
          questionId: item.questionId,
          result: {
            score: Math.round(totalScore),
            isCorrect,
            gradingMode: 'ai-fallback',
            feedback: 'AI降级判题：解析失败，使用固定规则',
            explanation: `【AI降级判题模式】\n标准答案：${correctAnswersArray.join('、')}\n你的答案：${userAnswersArray.join('、')}`,
            blankResults
          },
        });
      }
    }
  } catch (error) {
    console.error('[AI批量判题] AI批量判题失败，降级到固定规则:', error);
    // 所有需要AI判题的题目降级到固定规则
    for (const { item } of aiNeededItems) {
      const userAnswersArray = Array.isArray(item.userAnswer) ? item.userAnswer : [item.userAnswer];
      const correctAnswersArray = Array.isArray(item.correctAnswer) ? item.correctAnswer : [item.correctAnswer];

      let totalScore = 0;
      let correctCount = 0;
      const scorePerBlank = item.maxScore / correctAnswersArray.length;
      const blankResults: BlankResult[] = [];

      if (item.allowDisorder) {
        // 乱序模式：检查每个用户答案是否存在于正确答案集合中
        const correctAnswerSet = new Set(correctAnswersArray.map(a => a.toLowerCase().trim()));
        
        for (let i = 0; i < correctAnswersArray.length; i++) {
          const userAns = userAnswersArray[i] || '';
          const normalizedUser = userAns.toLowerCase().trim();
          
          // 检查用户答案是否在正确答案集合中
          const isBlankCorrect = correctAnswerSet.has(normalizedUser) && normalizedUser !== '';
          
          totalScore += isBlankCorrect ? scorePerBlank : 0;
          if (isBlankCorrect) correctCount++;

          // 找到对应的正确答案（用于显示）
          let matchedCorrectAnswer: string;
          if (isBlankCorrect) {
            // 答案正确：显示匹配到的正确答案
            matchedCorrectAnswer = correctAnswersArray.find(a => a.toLowerCase().trim() === normalizedUser) || '';
          } else {
            // 答案错误：显示该位置的标准答案（用于提示用户）
            matchedCorrectAnswer = correctAnswersArray[i] || '';
          }

          blankResults.push({
            userAnswer: userAns,
            correctAnswer: matchedCorrectAnswer,
            isCorrect: isBlankCorrect
          });
        }
      } else {
        // 顺序模式：按位置匹配
        for (let i = 0; i < correctAnswersArray.length; i++) {
          const correctAns = correctAnswersArray[i];
          const userAns = userAnswersArray[i] || '';
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

      // 根据 correctCount 确定 isCorrect: 0=错误, 1=部分正确, 2=正确
      let isCorrect: 0 | 1 | 2;
      if (correctCount === correctAnswersArray.length) {
        isCorrect = 2; // 全部正确
      } else if (correctCount > 0) {
        isCorrect = 1; // 部分正确
      } else {
        isCorrect = 0; // 全部错误
      }

      results.push({
        questionId: item.questionId,
        result: {
          score: Math.round(totalScore),
          isCorrect,
          gradingMode: 'ai-fallback',
          feedback: 'AI降级判题：批量请求失败',
          explanation: `【AI降级判题模式】\n标准答案：${correctAnswersArray.join('、')}\n你的答案：${userAnswersArray.join('、')}`,
          blankResults
        },
      });
    }
  }

  console.log(`[AI批量判题] 批量判题完成，共 ${results.length} 道题`);
  return results;
}

export async function gradeSubjectiveBatch(
  items: BatchGradingItem[]
): Promise<BatchGradingResult[]> {
  if (items.length === 0) {
    return [];
  }

  console.log(`[AI批量判题] 开始批量判题，共 ${items.length} 道主观题`);

  const results: BatchGradingResult[] = [];
  const aiNeededItems: { item: BatchGradingItem; index: number }[] = [];

  // 第一步：快速预检
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const userAnswerText = Array.isArray(item.userAnswer) ? item.userAnswer.join('') : item.userAnswer;
    const correctAnswerText = Array.isArray(item.correctAnswer) ? item.correctAnswer.join('') : item.correctAnswer;

    const preCheck = fastPreCheck(userAnswerText, correctAnswerText, item.maxScore, 'subjective');

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

  // 如果没有需要AI判题的题目，直接返回
  if (aiNeededItems.length === 0) {
    console.log('[AI批量判题] 所有题目都通过快速预检，无需AI判题');
    return results;
  }

  // 第二步：生成批量prompt
  const provider = getGradingProvider();
  const webllmReady = modelLoader.isModelReady();
  const apiReady = apiGradingService.isConfigured();
  const isReady = provider === 'api' ? apiReady : webllmReady;

  // 如果需要AI判题但模型未就绪，使用固定规则判题
  if (provider === 'fixed' || !isReady) {
    console.log('[AI批量判题] 模型未就绪，使用固定规则判题');
    for (const { item } of aiNeededItems) {
      const userAnswerText = Array.isArray(item.userAnswer) ? item.userAnswer.join('') : item.userAnswer;
      const correctAnswerText = Array.isArray(item.correctAnswer) ? item.correctAnswer.join('') : item.correctAnswer;

      const fallback = fallbackSubjective(userAnswerText, correctAnswerText, item.maxScore, item.question);
      results.push({
        questionId: item.questionId,
        result: fallback,
      });
    }
    return results;
  }

  // 生成批量prompt
  const questionsPrompt = aiNeededItems.map(({ item }, idx) => {
    const userAnswerText = Array.isArray(item.userAnswer) ? item.userAnswer.join('\n') : item.userAnswer;
    const correctAnswerText = Array.isArray(item.correctAnswer) ? item.correctAnswer.join('\n') : item.correctAnswer;

    return `
【题目${idx + 1}】
题目ID: ${item.questionId}
题目内容: ${item.question || '（主观题）'}
参考答案: ${correctAnswerText}
用户答案: ${userAnswerText}
满分: ${item.maxScore}分
---`;
  }).join('\n');

  const batchPrompt = `你是一位严格的考试评分助手。请根据题目和参考答案，客观评估用户的主观题答案。

【批量判题说明】
以下包含 ${aiNeededItems.length} 道主观题，请逐题评分并返回结果。

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
${aiNeededItems.map(({ item }, idx) => `
【题目${idx + 1}结果】
题目ID: ${item.questionId}
得分：X（0-${item.maxScore}之间的整数）
是否正确：是/否（${item.maxScore}分才算"是"，否则"否"）
评价：简短评价（如：答案完整准确/答案基本正确但不够详细/答案部分正确/答案与题目无关等）
综合解析：
1. 题目分析：说明题目考查的知识点和核心概念
2. 答案要点分析：逐条对比用户答案与参考答案，说明哪些要点答对了、哪些遗漏了
3. 关联分析：分析用户答案与题目要求的相关性，解释为什么得这个分数
4. 解析建议：结合题目和参考答案，给出具体的改进建议和学习指导`).join('\n')}

请确保返回所有 ${aiNeededItems.length} 道题的评分结果。`;

  console.log('[AI批量判题] 发送批量prompt到AI');

  try {
    const response = await generateWithProvider(batchPrompt, 800 + aiNeededItems.length * 300);

    console.log('[AI批量判题] AI响应内容:', response.substring(0, 500) + '...');

    // 解析批量响应
    for (let idx = 0; idx < aiNeededItems.length; idx++) {
      const { item } = aiNeededItems[idx];
      const userAnswerText = Array.isArray(item.userAnswer) ? item.userAnswer.join('') : item.userAnswer;
      const correctAnswerText = Array.isArray(item.correctAnswer) ? item.correctAnswer.join('') : item.correctAnswer;

      try {
        // 提取该题目的结果
        const resultPattern = new RegExp(
          `【题目${idx + 1}结果】[\\s\\S]*?题目ID:\\s*${item.questionId}[\\s\\S]*?(?=(【题目${idx + 2}结果】|$))`,
          'i'
        );
        const resultMatch = response.match(resultPattern);
        const resultText = resultMatch ? resultMatch[0] : response;

        const scoreMatch = resultText.match(/得分[：:]\s*(\d+)/);
        const correctMatch = resultText.match(/是否正确[：:]\s*(是|否|yes|no)/i);
        const feedbackMatch = resultText.match(/评价[：:]\s*(.+)/);
        const explanationMatch = resultText.match(/综合解析[：:]\s*\n?([\s\S]+?)(?=\n\n【题目|$(?!\n))/);

        let score = 0;
        let isCorrect: 0 | 1 | 2 = 0;
        let feedback = 'AI判题完成';

        if (scoreMatch) {
          score = Math.min(parseInt(scoreMatch[1], 10), item.maxScore);
        }

        if (correctMatch) {
          const correctValue = correctMatch[1].toLowerCase();
          // "是" = 正确(2)，"否"且得分>0 = 部分正确(1)，"否"且得分=0 = 错误(0)
          if (correctValue === '是' || correctValue === 'yes') {
            isCorrect = 2;
          } else if (score > 0) {
            isCorrect = 1;
          } else {
            isCorrect = 0;
          }
        } else {
          // 根据得分判断: 0=错误, 1=部分正确, 2=正确
          if (score >= item.maxScore * 0.9) {
            isCorrect = 2; // 正确
          } else if (score > 0) {
            isCorrect = 1; // 部分正确
          } else {
            isCorrect = 0; // 错误
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
            feedback: `${feedback}（${provider === 'api' ? 'API' : 'WebLLM'}判题）`,
            explanation: item.question
              ? `【综合解析】\n${explanation}`
              : `【综合解析】\n${explanation}`,
          },
        });

        console.log(`[AI批量判题] 题目 ${item.questionId} 评分完成: ${score}/${item.maxScore}`);
      } catch (error) {
        console.error(`[AI批量判题] 解析题目 ${item.questionId} 结果失败:`, error);
        // 降级到固定规则
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
    console.error('[AI批量判题] AI批量判题失败，降级到固定规则:', error);
    // 所有需要AI判题的题目降级到固定规则
    for (const { item } of aiNeededItems) {
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

  console.log(`[AI批量判题] 批量判题完成，共 ${results.length} 道题`);
  return results;
}
