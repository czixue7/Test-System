import { calculateSimilarity } from './similarity';
import { modelLoader } from './modelLoader';

export type GradingMode = 'ai' | 'fixed' | 'ai-fallback';

export interface AIGradingResult {
  score: number;
  isCorrect: boolean;
  similarity?: number;
  feedback?: string;
  gradingMode: GradingMode;
  explanation?: string;
}

export async function checkModelAvailability(): Promise<boolean> {
  return modelLoader.isModelReady();
}

export async function isModelReady(): Promise<boolean> {
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

  const threshold = 0.6;
  const isCorrect = similarity >= threshold;

  let score: number;
  if (similarity >= 1) {
    score = maxScore;
  } else if (similarity >= threshold) {
    score = Math.round(maxScore * similarity);
  } else {
    score = 0;
  }

  let feedback: string;
  if (similarity >= 1) {
    feedback = '答案完全正确（固定判题）';
  } else if (similarity >= 0.8) {
    feedback = '答案基本正确，表述略有差异（固定判题）';
  } else if (similarity >= threshold) {
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
  const webllmReady = modelLoader.isModelReady();

  console.log(`[AI判题] 填空题 - 模型状态: WebLLM=${webllmReady}`);
  console.log(`[AI判题] 题目: ${question || '（填空题）'}`);
  console.log(`[AI判题] 标准答案: ${correctAnswers.join('、')}`);
  console.log(`[AI判题] 用户答案: ${userAnswers.join('、')}`);
  console.log(`[AI判题] 允许乱序: ${allowDisorder ? '是' : '否'}`);

  if (!webllmReady) {
    console.log('[AI判题] 模型未加载，使用固定判题');
    let totalScore = 0;
    let allCorrect = true;
    const scorePerBlank = maxScore / correctAnswers.length;

    for (let i = 0; i < correctAnswers.length; i++) {
      const correctAns = correctAnswers[i];
      const userAns = userAnswers[i] || '';

      const normalizedCorrect = correctAns.toLowerCase().trim();
      const normalizedUser = userAns.toLowerCase().trim();
      const isCorrect = normalizedCorrect === normalizedUser;

      totalScore += isCorrect ? scorePerBlank : 0;
      if (!isCorrect) allCorrect = false;
    }

    return {
      score: Math.round(totalScore),
      isCorrect: allCorrect,
      gradingMode: 'fixed',
      feedback: allCorrect ? '固定判题：全部正确' : '固定判题：部分答案不正确',
      explanation: `【固定判题模式】\n标准答案：${correctAnswers.join('、')}\n你的答案：${userAnswers.join('、')}`,
    };
  }

  const disorderHint = allowDisorder
    ? '【重要】本题答案顺序可以打乱，只要内容正确即可。'
    : '【重要】本题答案顺序必须一致。';

  const answersComparison = correctAnswers.map((correct, index) => {
    const user = userAnswers[index] || '';
    const displayUser = user.trim() === '' ? '(未填写)' : user;
    return `第${index + 1}空：标准答案「${correct}」vs 用户答案「${displayUser}」`;
  }).join('\n');

  const prompt = `你是一位严格的考试评分助手。请根据题目内容和参考答案，客观判断用户的填空答案是否正确。

【题目】
${question || '（填空题）'}

【答案对比】
${answersComparison}

${disorderHint}

【评分规则 - 必须严格遵守】
1. 每个空独立判断，只有完全正确或语义完全等价才算正确
2. 以下情况一律判为错误：
   - 答案为"不知道"、"不会"、"不确定"等表示不知道的词汇
   - 答案为空、未填写、填写"(未填写)"
   - 答案与标准答案含义不同
   - 答案与标准答案只是部分匹配
3. 语义相似性判断：只有当答案与标准答案表达的是完全相同的概念时才算正确
4. 计分方式：每空${(maxScore / correctAnswers.length).toFixed(1)}分，只有正确的空才得分

【返回格式 - 必须严格按以下格式，不要省略任何部分】
得分：X/${maxScore}分
判断：正确/部分正确/错误
逐空分析：
${correctAnswers.map((_, i) => `- 第${i + 1}空：正确/错误，具体说明原因`).join('\n')}
综合解析：简要分析用户答题情况，指出错误原因（如果有），给出学习建议`;

  console.log('[AI判题] =======================================');
  console.log('[AI判题] 开始 AI 判题流程');
  console.log('[AI判题] =======================================');
  console.log(`[AI判题] 模型状态: WebLLM=${webllmReady}`);
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
    console.log('[AI判题] 调用 WebLLM 模型生成...');
    const response = await modelLoader.generate(prompt, {
      maxTokens: 500,
      temperature: 0.1,
    });

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
    let isCorrect = false;

    if (judgmentMatch) {
      isCorrect = judgmentMatch[1] === '正确' || judgmentMatch[1] === '部分正确';
      console.log(`[AI判题] 根据判断字段确定结果: ${judgmentMatch[1]} -> isCorrect=${isCorrect}`);
    } else {
      isCorrect = score >= maxScore * 0.6;
      console.log(`[AI判题] 根据得分判断结果: ${score}分 >= ${maxScore * 0.6}分 -> isCorrect=${isCorrect}`);
    }

    let explanation = '';

    if (explanationMatch) {
      explanation = explanationMatch[1].trim();
      console.log('[AI判题] 已提取综合解析内容');
    }

    if (!explanation) {
      explanation = generateFillBlankExplanation(userAnswers.join('、'), correctAnswers.join('、'), isCorrect);
      console.log('[AI判题] 使用默认解析模板');
    }

    console.log('[AI判题] ---------------------------------------');
    console.log(`[AI判题] 最终判题结果:`);
    console.log(`[AI判题]   - 得分: ${score}/${maxScore}`);
    console.log(`[AI判题]   - 是否正确: ${isCorrect}`);
    console.log(`[AI判题]   - 判题模式: AI智能判题`);
    console.log('[AI判题] ---------------------------------------');

    const result: AIGradingResult = {
      score,
      isCorrect,
      gradingMode: 'ai',
      feedback: isCorrect ? `AI判题：${score}分` : `AI判题：${score}分（部分正确）`,
      explanation: `【综合解析】\n${explanation}`,
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
    let allCorrect = true;
    const scorePerBlank = maxScore / correctAnswers.length;

    console.log('[AI判题] 开始固定规则判题:');
    for (let i = 0; i < correctAnswers.length; i++) {
      const correctAns = correctAnswers[i];
      const userAns = userAnswers[i] || '';

      const normalizedCorrect = correctAns.toLowerCase().trim();
      const normalizedUser = userAns.toLowerCase().trim();
      const isCorrect = normalizedCorrect === normalizedUser;

      console.log(`[AI判题]   空${i+1}: 「${userAns}」vs「${correctAns}」-> ${isCorrect ? '正确' : '错误'}`);

      totalScore += isCorrect ? scorePerBlank : 0;
      if (!isCorrect) allCorrect = false;
    }

    const fallbackResult = {
      score: Math.round(totalScore),
      isCorrect: allCorrect,
      gradingMode: 'ai-fallback' as const,
      feedback: allCorrect ? 'AI降级判题：全部正确' : 'AI降级判题：部分答案不正确',
      explanation: `【AI降级判题模式】\n标准答案：${correctAnswers.join('、')}\n你的答案：${userAnswers.join('、')}`,
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
  const webllmReady = modelLoader.isModelReady();

  console.log('[AI判题] =======================================');
  console.log('[AI判题] 开始主观题 AI 判题流程');
  console.log('[AI判题] =======================================');
  console.log(`[AI判题] 模型状态: WebLLM=${webllmReady}`);
  console.log(`[AI判题] 题目内容: ${question || '（主观题）'}`);
  console.log(`[AI判题] 标准答案: ${correctAnswer}`);
  console.log(`[AI判题] 用户答案: ${userAnswer}`);
  console.log(`[AI判题] 题目满分: ${maxScore}分`);

  if (!webllmReady) {
    console.log('[AI判题] 模型未加载，使用固定规则判题');
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
2. 评分标准：
   - ${maxScore}分：答案与参考答案完全一致或表达完全相同的概念
   - ${Math.round(maxScore * 0.8)}-${maxScore - 1}分：答案基本正确，但表述不够完整或有 minor 遗漏
   - ${Math.round(maxScore * 0.6)}-${Math.round(maxScore * 0.7)}分：答案部分正确，包含了部分要点
   - ${Math.round(maxScore * 0.3)}-${Math.round(maxScore * 0.5)}分：答案与题目相关但偏离重点
   - 0-${Math.round(maxScore * 0.2)}分：答案错误、与题目无关或表示不知道
3. 以下情况一律给低分（0-${Math.round(maxScore * 0.2)}分）：
   - 答案为"不知道"、"不会"、"不确定"、"没学过"等
   - 答案为空或仅填写无意义内容
   - 答案与题目完全无关
4. 相似度判断：只有当用户答案表达了与参考答案相同的核心概念时才给高分

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
    console.log('[AI判题] 调用 WebLLM 模型生成...');
    const response = await modelLoader.generate(prompt, {
      maxTokens: 600,
      temperature: 0.2,
    });

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
    let isCorrect = false;
    let feedback = 'AI判题完成';

    if (scoreMatch) {
      score = Math.min(parseInt(scoreMatch[1], 10), maxScore);
      console.log(`[AI判题] 提取得分: ${score}分`);
    } else {
      console.warn('[AI判题] 未能匹配得分，使用默认0分');
    }

    if (correctMatch) {
      const correctValue = correctMatch[1].toLowerCase();
      isCorrect = correctValue === '是' || correctValue === 'yes';
      console.log(`[AI判题] 根据"是否正确"字段: ${correctMatch[1]} -> isCorrect=${isCorrect}`);
    } else {
      isCorrect = score >= maxScore * 0.6;
      console.log(`[AI判题] 根据得分判断: ${score}分 >= ${maxScore * 0.6}分 -> isCorrect=${isCorrect}`);
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
    console.log(`[AI判题]   - 判题模式: AI智能判题`);
    console.log(`[AI判题]   - 评价: ${feedback}`);
    console.log('[AI判题] ---------------------------------------');

    const result = {
      score,
      isCorrect,
      gradingMode: 'ai' as const,
      feedback: `${feedback}（AI判题）`,
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
  // 保留此函数以保持向后兼容
  // 模型状态现在由 modelLoader 管理
}
