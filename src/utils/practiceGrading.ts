import type { Question, QuestionResult } from '../types';
import { getBlankAnswers, matchDisorderBlanks, matchOrderedBlanks } from './answerUtils';

/** 显示以本次逐空判题为准；旧固定规则记录可重算，AI 明细缺失时不另行判错。 */
export function getGradedBlankResults(question: Question, answer: string | string[] | undefined, result?: QuestionResult) {
  const correct = getBlankAnswers(question.correctAnswer);
  const user = Array.isArray(answer) ? answer : answer === undefined ? [] : [answer];
  const fixed = question.allowDisorder ? matchDisorderBlanks(user, correct) : matchOrderedBlanks(user, correct);
  return correct.map((text, index) => {
    const saved = result?.blankResults?.[index];
    if (saved) return saved;
    if (!result?.gradingMode || result.gradingMode !== 'ai') return fixed.blankResults[index];
    return { userAnswer: user[index] ?? '', correctAnswer: text, isCorrect: null };
  });
}
