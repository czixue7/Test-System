import { Question, QuestionBank, JsonBankData, JsonQuestionData, QuestionType, AnswerWithImages } from '../types';

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

function validateQuestionType(type: string): type is QuestionType {
  return ['fill-in-blank', 'single-choice', 'multiple-choice', 'subjective'].includes(type);
}

function isAnswerWithImages(answer: unknown): answer is AnswerWithImages {
  return typeof answer === 'object' && answer !== null && 'text' in answer;
}

function validateQuestion(question: JsonQuestionData, index: number): { valid: boolean; error?: string } {
  if (!question.content || typeof question.content !== 'string') {
    return { valid: false, error: `题目 ${index + 1}: 缺少题目内容` };
  }
  
  if (!validateQuestionType(question.type)) {
    return { valid: false, error: `题目 ${index + 1}: 无效的题目类型 "${question.type}"` };
  }
  
  if (question.type === 'single-choice' || question.type === 'multiple-choice') {
    if (!question.options || !Array.isArray(question.options) || question.options.length < 2) {
      return { valid: false, error: `题目 ${index + 1}: 选择题至少需要2个选项` };
    }
    
    for (let i = 0; i < question.options.length; i++) {
      if (!question.options[i].id || !question.options[i].content) {
        return { valid: false, error: `题目 ${index + 1}: 选项 ${i + 1} 缺少id或内容` };
      }
    }
  }
  
  if (!question.correctAnswer) {
    return { valid: false, error: `题目 ${index + 1}: 缺少正确答案` };
  }
  
  if (isAnswerWithImages(question.correctAnswer)) {
    if (!question.correctAnswer.text || typeof question.correctAnswer.text !== 'string') {
      return { valid: false, error: `题目 ${index + 1}: 带图片的答案缺少文本内容` };
    }
  }
  
  if (question.type === 'multiple-choice') {
    if (!Array.isArray(question.correctAnswer) && !isAnswerWithImages(question.correctAnswer)) {
      return { valid: false, error: `题目 ${index + 1}: 多选题答案必须是数组` };
    }
  }
  
  if (question.type === 'single-choice' && Array.isArray(question.correctAnswer)) {
    return { valid: false, error: `题目 ${index + 1}: 单选题答案必须是字符串` };
  }
  
  if (question.type === 'fill-in-blank') {
    if (!Array.isArray(question.correctAnswer) && typeof question.correctAnswer !== 'string' && !isAnswerWithImages(question.correctAnswer)) {
      return { valid: false, error: `题目 ${index + 1}: 填空题答案必须是字符串或数组` };
    }
  }
  
  return { valid: true };
}

export function validateJsonBank(data: unknown): { valid: boolean; error?: string } {
  if (!data || typeof data !== 'object') {
    return { valid: false, error: '无效的JSON数据' };
  }
  
  const bankData = data as JsonBankData;
  
  if (!bankData.name || typeof bankData.name !== 'string') {
    return { valid: false, error: '缺少题库名称' };
  }
  
  if (!bankData.questions || !Array.isArray(bankData.questions) || bankData.questions.length === 0) {
    return { valid: false, error: '题库必须包含至少一道题目' };
  }
  
  for (let i = 0; i < bankData.questions.length; i++) {
    const result = validateQuestion(bankData.questions[i], i);
    if (!result.valid) {
      return result;
    }
  }
  
  return { valid: true };
}

export function convertJsonToBank(data: JsonBankData): QuestionBank {
  const now = new Date().toISOString();

  const questions: Question[] = data.questions.map(q => ({
    id: generateId(),
    type: q.type as QuestionType,
    question: q.question,
    content: q.content,
    options: q.options?.map(opt => ({
      id: opt.id,
      content: opt.content
    })),
    correctAnswer: q.correctAnswer,
    score: q.score ?? 10,
    category: q.category ?? 'default',
    difficulty: (q.difficulty as 'easy' | 'medium' | 'hard') ?? 'medium',
    explanation: q.explanation,
    allowDisorder: q.allowDisorder
  }));

  return {
    id: generateId(),
    name: data.name,
    description: data.description,
    questions,
    createdAt: now,
    updatedAt: now
  };
}

export function parseJsonFile(content: string): { success: boolean; data?: JsonBankData; error?: string } {
  try {
    const parsed = JSON.parse(content);
    return { success: true, data: parsed };
  } catch (e) {
    return { success: false, error: 'JSON格式错误: ' + (e as Error).message };
  }
}

export function exportBankToJson(bank: QuestionBank): string {
  return JSON.stringify({
    name: bank.name,
    description: bank.description,
    questions: bank.questions.map(q => ({
      type: q.type,
      content: q.content,
      options: q.options,
      correctAnswer: q.correctAnswer,
      score: q.score,
      explanation: q.explanation
    }))
  }, null, 2);
}
