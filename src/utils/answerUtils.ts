import { AnswerWithImages, AutomationStats, BlankResult, Question, UserAnswer } from '../types';
import { normalizeAnswer } from './answerNormalize';

export interface BlankMatchResult {
  blankResults: BlankResult[];
  correctCount: number;
}

/**
 * 乱序填空判分：用**可消费的多重集**匹配，每个标准答案只能被抵扣一次。
 *
 * 历史缺陷：旧实现只做集合成员判断（`Set.has`），命中的标准答案不消费，
 * 于是四个空全填「遥测」也能拿满分，与 prompt 里
 * 「每个标准答案只能被匹配一次」的规则自相矛盾。
 */
export function matchDisorderBlanks(userAnswers: string[], correctAnswers: string[]): BlankMatchResult {
  const pool = correctAnswers.map((text) => ({ text, norm: normalizeAnswer(text), used: false }));
  const blankResults: BlankResult[] = [];
  let correctCount = 0;

  for (let i = 0; i < correctAnswers.length; i++) {
    const userAns = userAnswers[i] ?? '';
    const normalizedUser = normalizeAnswer(userAns);

    let hitIndex = -1;
    if (normalizedUser !== '') {
      hitIndex = pool.findIndex((p) => !p.used && p.norm === normalizedUser);
    }

    const isBlankCorrect = hitIndex >= 0;
    if (isBlankCorrect) {
      pool[hitIndex].used = true;
      correctCount++;
    }

    blankResults.push({
      userAnswer: userAns,
      // 答对时显示真正匹配到的那个标准答案，答错时显示该位置的标准答案作为提示
      correctAnswer: isBlankCorrect ? pool[hitIndex].text : (correctAnswers[i] ?? ''),
      isCorrect: isBlankCorrect,
    });
  }

  return { blankResults, correctCount };
}

/**
 * 顺序填空判分：按位置逐一比较。
 * 注意要求用户答案标准化后非空 —— 否则「两个空都归一成空串」会被判为相等。
 */
export function matchOrderedBlanks(userAnswers: string[], correctAnswers: string[]): BlankMatchResult {
  const blankResults: BlankResult[] = [];
  let correctCount = 0;

  for (let i = 0; i < correctAnswers.length; i++) {
    const correctAns = correctAnswers[i] ?? '';
    const userAns = userAnswers[i] ?? '';
    const normalizedUser = normalizeAnswer(userAns);
    const isBlankCorrect = normalizedUser !== '' && normalizedUser === normalizeAnswer(correctAns);

    if (isBlankCorrect) correctCount++;

    blankResults.push({ userAnswer: userAns, correctAnswer: correctAns, isCorrect: isBlankCorrect });
  }

  return { blankResults, correctCount };
}

/** 由逐空结果推导三态：全对 = 2、部分对 = 1、全错 = 0 */
export function gradeFromBlankResults(blankResults: BlankResult[]): 0 | 1 | 2 {
  const correct = blankResults.filter((b) => b.isCorrect).length;
  if (blankResults.length > 0 && correct === blankResults.length) return 2;
  if (correct > 0) return 1;
  return 0;
}

export function isAnswerWithImages(answer: unknown): answer is AnswerWithImages {
  return typeof answer === 'object' && answer !== null && 'text' in answer;
}

/**
 * 把任意形态的答案收敛成字符串数组。
 * 用于填空题「有几个空」的判定与渲染，避免出现：
 * - 答案为字符串 → 界面一个输入框都不渲染（题目无法作答）
 * - 答案为 {text, images} → 同上
 */
export function getBlankAnswers(answer: Question['correctAnswer'] | string[] | string | undefined): string[] {
  if (Array.isArray(answer)) {
    const items = (answer as unknown[]).map((a: unknown) => {
      if (typeof a === 'string') return a;
      if (isAnswerWithImages(a)) return a.text ?? '';
      return a === null || a === undefined ? '' : String(a);
    });
    return items.length > 0 ? items : [''];
  }
  if (typeof answer === 'string') return [answer];
  if (isAnswerWithImages(answer)) return [answer.text ?? ''];
  return [''];
}

/**
 * 提取多选题的正确选项 id 列表。
 * 运行期收窄类型：`correctAnswer as string[]` 在答案为 {text, images} 时
 * 会让 `correct.includes(...)` 抛 TypeError 白屏。
 */
export function getMultipleChoiceIds(answer: Question['correctAnswer'] | undefined): string[] {
  if (Array.isArray(answer)) {
    return answer.filter((a): a is string => typeof a === 'string');
  }
  if (typeof answer === 'string') {
    return splitOptionIds(answer);
  }
  if (isAnswerWithImages(answer)) {
    return splitOptionIds(answer.text ?? '');
  }
  return [];
}

function splitOptionIds(text: string): string[] {
  return text
    .split(/[、,，;；\s/|]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * 答案是否为「空作答」。三态 isCorrect（0/1/2）下，
 * 空串、空数组、以及全是空串的数组都算未作答。
 */
export function isEmptyAnswer(answer: UserAnswer['answer'] | undefined): boolean {
  if (answer === undefined || answer === null) return true;
  if (Array.isArray(answer)) return answer.every((v) => String(v ?? '').trim() === '');
  return String(answer).trim() === '';
}

/**
 * 统一的对/错/未答统计口径。
 * Result / Records / recordStore 必须共用同一份实现，
 * 否则同一份记录在不同页面会显示不同的数字
 * （典型问题：把 isCorrect === 1 的「部分正确」计入「对」）。
 */
export function countAnswerStats(answers: UserAnswer[]): AutomationStats {
  let correct = 0;
  let partial = 0;
  let wrong = 0;
  let unanswered = 0;

  for (const a of answers) {
    const grade = normalizeGrade(a.isCorrect);
    if (isEmptyAnswer(a.answer)) {
      unanswered++;
      continue;
    }
    if (grade === 2) correct++;
    else if (grade === 1) partial++;
    else wrong++;
  }

  return { correct, partial, wrong, unanswered, total: answers.length };
}

/**
 * 归一化历史数据里的 isCorrect：兼容早期的 boolean 值，
 * 以及三态 0/1/2。
 */
export function normalizeGrade(value: UserAnswer['isCorrect']): 0 | 1 | 2 {
  if (value === true) return 2;
  if (value === false || value === undefined || value === null) return 0;
  if (value === 2) return 2;
  if (value === 1) return 1;
  return 0;
}
