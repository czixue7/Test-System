import { create } from 'zustand';
import { Question, ExamState, UserAnswer, QuestionResult, QuestionStatus, AnswerWithImages, BlankResult } from '../types';
import { calculateSubjectiveScore } from '../utils/similarity';
import { useSettingsStore } from './settingsStore';
import {
  gradeFillBlankQuestion,
  gradeSubjective,
  isModelReady,
  gradeBatchWithStream,
  BatchGradingItem
} from '../utils/aiGrading';

function isAnswerWithImages(answer: unknown): answer is AnswerWithImages {
  return typeof answer === 'object' && answer !== null && 'text' in answer;
}

function getAnswerTextForComparison(correctAnswer: string | string[] | AnswerWithImages): string {
  if (isAnswerWithImages(correctAnswer)) {
    return correctAnswer.text;
  }
  if (Array.isArray(correctAnswer)) {
    return correctAnswer.join(', ');
  }
  return String(correctAnswer);
}

interface ExamStore {
  examState: ExamState | null;
  startExam: (bankId: string, bankName: string, questions: Question[]) => void;
  setAnswer: (questionId: string, answer: string | string[]) => void;
  getAnswer: (questionId: string) => string | string[] | undefined;
  confirmAnswer: (questionId: string, useAI?: boolean) => Promise<void>;
  getResult: (questionId: string) => QuestionResult | undefined;
  setResult: (questionId: string, result: QuestionResult) => void;
  getQuestionStatus: (questionId: string) => QuestionStatus;
  nextQuestion: () => void;
  prevQuestion: () => void;
  goToQuestion: (index: number) => void;
  finishExam: (
    useAI?: boolean, 
    onProgress?: (current: number, total: number) => void,
    onQuestionGraded?: (questionId: string, result: QuestionResult) => void
  ) => Promise<UserAnswer[]>;
  resetExam: () => void;
  getCurrentQuestion: () => Question | undefined;
  getProgress: () => { answered: number; total: number };
  getStatistics: () => { correct: number; incorrect: number; totalScore: number; maxScore: number };
  isAllConfirmed: () => boolean;
}

const checkAnswer = (question: Question, answer: string | string[]): { isCorrect: 0 | 1 | 2; score: number; blankResults?: BlankResult[] } => {
  if (question.type === 'single-choice') {
    const isCorrect = answer === question.correctAnswer;
    return { isCorrect: isCorrect ? 2 : 0, score: isCorrect ? question.score : 0 };
  }

  if (question.type === 'multiple-choice') {
    const correctSet = new Set(question.correctAnswer as string[]);
    const userSet = new Set(answer as string[]);
    const isCorrect =
      correctSet.size === userSet.size &&
      [...correctSet].every((item) => userSet.has(item));
    return { isCorrect: isCorrect ? 2 : 0, score: isCorrect ? question.score : 0 };
  }

  if (question.type === 'fill-in-blank') {
    const rawCorrectAnswer = question.correctAnswer;
    const correctAnswers: string[] = Array.isArray(rawCorrectAnswer)
      ? rawCorrectAnswer.filter((a): a is string => typeof a === 'string')
      : (typeof rawCorrectAnswer === 'string' ? [rawCorrectAnswer] : []);
    const userAnswers = Array.isArray(answer)
      ? answer
      : [answer];

    if (correctAnswers.length === 0) {
      return { isCorrect: 0, score: 0 };
    }

    const allowDisorder = question.allowDisorder ?? false;

    let correctCount = 0;
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
    } else {
      // 顺序模式：按位置匹配
      for (let i = 0; i < correctAnswers.length; i++) {
        const correctAns = correctAnswers[i];
        const userAns = userAnswers[i] || '';

        const normalizedCorrect = correctAns.toLowerCase().trim();
        const normalizedUser = userAns.toLowerCase().trim();
        const isBlankCorrect = normalizedCorrect === normalizedUser;

        if (isBlankCorrect) {
          correctCount++;
        }

        blankResults.push({
          userAnswer: userAns,
          correctAnswer: correctAns,
          isCorrect: isBlankCorrect
        });
      }
    }

    const scorePerBlank = question.score / correctAnswers.length;
    const totalScore = Math.round(correctCount * scorePerBlank);
    
    // 根据 correctCount 确定 isCorrect: 0=错误, 1=部分正确, 2=正确
    let isCorrect: 0 | 1 | 2;
    if (correctCount === correctAnswers.length) {
      isCorrect = 2; // 全部正确
    } else if (correctCount > 0) {
      isCorrect = 1; // 部分正确
    } else {
      isCorrect = 0; // 全部错误
    }

    return { isCorrect, score: totalScore, blankResults };
  }

  if (question.type === 'subjective') {
    const result = calculateSubjectiveScore(
      answer as string,
      getAnswerTextForComparison(question.correctAnswer),
      question.score
    );
    // 根据相似度确定 isCorrect: 0=错误, 1=部分正确, 2=正确
    let isCorrect: 0 | 1 | 2;
    if (result.similarity >= 0.9) {
      isCorrect = 2; // 正确
    } else if (result.similarity >= 0.6) {
      isCorrect = 1; // 部分正确
    } else {
      isCorrect = 0; // 错误
    }
    return { isCorrect, score: result.score };
  }

  return { isCorrect: 0, score: 0 };
};

export const checkAnswerWithAI = async (
  question: Question,
  answer: string | string[],
  useAI: boolean = true
): Promise<{ isCorrect: 0 | 1 | 2; score: number; aiFeedback?: string; aiExplanation?: string; blankResults?: BlankResult[] }> => {
  if (question.type === 'single-choice') {
    const isCorrectBool = answer === question.correctAnswer;
    return { isCorrect: isCorrectBool ? 2 : 0, score: isCorrectBool ? question.score : 0 };
  }

  if (question.type === 'multiple-choice') {
    const correctSet = new Set(question.correctAnswer as string[]);
    const userSet = new Set(answer as string[]);
    const isCorrectBool =
      correctSet.size === userSet.size &&
      [...correctSet].every((item) => userSet.has(item));
    return { isCorrect: isCorrectBool ? 2 : 0, score: isCorrectBool ? question.score : 0 };
  }

  const gradingMode = useSettingsStore.getState().gradingMode;
  let aiEnabled = false;

  if (useAI && gradingMode === 'ai') {
    const ready = await isModelReady();
    if (ready) {
      aiEnabled = true;
    } else {
      const { autoLoadLastModel } = await import('../utils/aiGrading');
      const loaded = await autoLoadLastModel();
      if (loaded && await isModelReady()) {
        aiEnabled = true;
      }
    }
  }

  if (question.type === 'fill-in-blank') {
    const rawCorrectAnswer = question.correctAnswer;
    const correctAnswers: string[] = Array.isArray(rawCorrectAnswer)
      ? rawCorrectAnswer.filter((a): a is string => typeof a === 'string')
      : (typeof rawCorrectAnswer === 'string' ? [rawCorrectAnswer] : []);
    const userAnswers = Array.isArray(answer) ? answer : [answer];

    if (correctAnswers.length === 0) {
      return { isCorrect: 0, score: 0 };
    }

    if (aiEnabled) {
      const aiResult = await gradeFillBlankQuestion(
        userAnswers,
        correctAnswers,
        question.score,
        question.content,
        question.allowDisorder
      );

      if (aiResult !== null) {
        return {
          isCorrect: aiResult.isCorrect,
          score: aiResult.score,
          aiFeedback: aiResult.feedback,
          aiExplanation: aiResult.explanation,
          blankResults: aiResult.blankResults
        };
      }
    }

    // AI未启用，使用固定规则并生成blankResults
    const fixedResult = checkAnswer(question, answer);
    const blankResults: BlankResult[] = [];
    
    if (question.allowDisorder) {
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
    
    // 根据 blankResults 计算 isCorrect
    const correctCount = blankResults.filter(b => b.isCorrect).length;
    let isCorrect: 0 | 1 | 2;
    if (correctCount === blankResults.length) {
      isCorrect = 2; // 全部正确
    } else if (correctCount > 0) {
      isCorrect = 1; // 部分正确
    } else {
      isCorrect = 0; // 全部错误
    }
    
    return {
      ...fixedResult,
      isCorrect,
      blankResults
    };
  }

  if (question.type === 'subjective') {
    if (aiEnabled) {
      const correctAnswerText = getAnswerTextForComparison(question.correctAnswer);
      const aiResult = await gradeSubjective(answer as string, correctAnswerText, question.score);

      if (aiResult !== null) {
        return {
          isCorrect: aiResult.isCorrect,
          score: aiResult.score,
          aiFeedback: aiResult.feedback,
          aiExplanation: aiResult.explanation
        };
      }
    }

    const result = calculateSubjectiveScore(
      answer as string,
      getAnswerTextForComparison(question.correctAnswer),
      question.score
    );
    // 根据相似度确定 isCorrect: 0=错误, 1=部分正确, 2=正确
    let isCorrect: 0 | 1 | 2;
    if (result.similarity >= 0.9) {
      isCorrect = 2; // 正确
    } else if (result.similarity >= 0.6) {
      isCorrect = 1; // 部分正确
    } else {
      isCorrect = 0; // 错误
    }
    return { isCorrect, score: result.score };
  }

  return { isCorrect: 0, score: 0 };
};

export const useExamStore = create<ExamStore>((set, get) => ({
  examState: null,

  startExam: (bankId, bankName, questions) => {
    set({
      examState: {
        bankId,
        bankName,
        questions,
        currentIndex: 0,
        answers: new Map(),
        results: new Map(),
        startTime: Date.now(),
        isFinished: false
      }
    });
  },

  setAnswer: (questionId, answer) => {
    set((state) => {
      if (!state.examState) return state;
      const newAnswers = new Map(state.examState.answers);
      newAnswers.set(questionId, answer);
      return {
        examState: {
          ...state.examState,
          answers: newAnswers
        }
      };
    });
  },

  getAnswer: (questionId) => {
    return get().examState?.answers.get(questionId);
  },

  confirmAnswer: async (questionId, useAI = true) => {
    const state = get();
    if (!state.examState) return;

    const question = state.examState.questions.find(q => q.id === questionId);
    const answer = state.examState.answers.get(questionId);

    if (!question) return;

    const hasAnswered = answer !== undefined &&
      answer !== '' &&
      (!Array.isArray(answer) || answer.length > 0);

    let result: QuestionResult;

    if (!hasAnswered) {
      result = {
        answer: answer ?? '',
        isConfirmed: true,
        isCorrect: 0,
        score: 0
      };
    } else {
      const { isCorrect, score, aiFeedback, aiExplanation, blankResults } = await checkAnswerWithAI(question, answer, useAI);
      const gradingMode = useSettingsStore.getState().gradingMode;
      result = {
        answer,
        isConfirmed: true,
        isCorrect,
        score,
        aiFeedback,
        aiExplanation,
        gradingMode: gradingMode === 'ai' ? 'ai' : 'fixed',
        blankResults
      };
    }

    set((state) => {
      if (!state.examState) return state;
      const newResults = new Map(state.examState.results);
      newResults.set(questionId, result);
      return {
        examState: {
          ...state.examState,
          results: newResults
        }
      };
    });
  },

  getResult: (questionId) => {
    return get().examState?.results.get(questionId);
  },

  setResult: (questionId: string, result: QuestionResult) => {
    set((state) => {
      if (!state.examState) return state;
      const newResults = new Map(state.examState.results);
      newResults.set(questionId, result);
      return {
        examState: {
          ...state.examState,
          results: newResults
        }
      };
    });
  },

  getQuestionStatus: (questionId) => {
    const state = get();
    if (!state.examState) return 'unanswered';

    const result = state.examState.results.get(questionId);
    if (!result) return 'unanswered';

    return result.isCorrect ? 'correct' : 'incorrect';
  },

  nextQuestion: () => {
    set((state) => {
      if (!state.examState) return state;
      const nextIndex = Math.min(
        state.examState.currentIndex + 1,
        state.examState.questions.length - 1
      );
      return {
        examState: {
          ...state.examState,
          currentIndex: nextIndex
        }
      };
    });
  },

  prevQuestion: () => {
    set((state) => {
      if (!state.examState) return state;
      const prevIndex = Math.max(state.examState.currentIndex - 1, 0);
      return {
        examState: {
          ...state.examState,
          currentIndex: prevIndex
        }
      };
    });
  },

  goToQuestion: (index) => {
    set((state) => {
      if (!state.examState) return state;
      const clampedIndex = Math.max(0, Math.min(index, state.examState.questions.length - 1));
      return {
        examState: {
          ...state.examState,
          currentIndex: clampedIndex
        }
      };
    });
  },

  finishExam: async (
    useAI = true, 
    onProgress?: (current: number, total: number) => void,
    onQuestionGraded?: (questionId: string, result: QuestionResult) => void
  ) => {
    const state = get();
    if (!state.examState) return [];

    const gradingMode = useSettingsStore.getState().gradingMode;
    const isAIEnabled = useAI && gradingMode === 'ai';

    // 收集已确认的题目结果
    const confirmedAnswers: UserAnswer[] = [];
    const unconfirmedQuestions: Question[] = [];

    for (const question of state.examState.questions) {
      const result = state.examState.results.get(question.id);
      const answer = state.examState.answers.get(question.id);

      if (result) {
        // 已确认的题目，直接使用已有结果
        confirmedAnswers.push({
          questionId: question.id,
          answer: result.answer ?? '',
          score: result.score,
          isCorrect: result.isCorrect,
          aiFeedback: result.aiFeedback,
          aiExplanation: result.aiExplanation,
          gradingMode: result.gradingMode,
          blankResults: result.blankResults
        });
      } else if (answer !== undefined) {
        // 有答案但未确认的题目
        unconfirmedQuestions.push(question);
      } else {
        // 未作答的题目
        confirmedAnswers.push({
          questionId: question.id,
          answer: '',
          score: 0,
          isCorrect: 0
        });
      }
    }

    // 处理未确认的题目
    const unconfirmedAnswers: UserAnswer[] = [];
    let processedCount = 0;

    // 通知进度：已确认的题数
    onProgress?.(confirmedAnswers.length, state.examState.questions.length);

    if (unconfirmedQuestions.length > 0) {
      // 按题型分组
      const fillBlankQuestions: Question[] = [];
      const subjectiveQuestions: Question[] = [];
      const otherQuestions: Question[] = [];

      for (const question of unconfirmedQuestions) {
        if (question.type === 'fill-in-blank') {
          fillBlankQuestions.push(question);
        } else if (question.type === 'subjective') {
          subjectiveQuestions.push(question);
        } else {
          otherQuestions.push(question);
        }
      }

      // 处理选择题（使用原有逻辑）- 立即处理，不需要AI
      for (const question of otherQuestions) {
        const answer = state.examState.answers.get(question.id);
        if (answer !== undefined) {
          const { score, isCorrect } = checkAnswer(question, answer);
          const userAnswer: UserAnswer = {
            questionId: question.id,
            answer,
            score,
            isCorrect,
            gradingMode: 'fixed'
          };
          unconfirmedAnswers.push(userAnswer);
          
          // 立即回调通知该题目已判题完成
          const questionResult: QuestionResult = {
            answer,
            isConfirmed: true,
            isCorrect,
            score,
            gradingMode: 'fixed'
          };
          onQuestionGraded?.(question.id, questionResult);
          
          processedCount++;
          onProgress?.(confirmedAnswers.length + processedCount, state.examState.questions.length);
        }
      }

      // 检查AI是否可用
      let aiAvailable = false;
      if (isAIEnabled) {
        const ready = await isModelReady();
        if (ready) {
          aiAvailable = true;
        } else {
          const { autoLoadLastModel } = await import('../utils/aiGrading');
          const loaded = await autoLoadLastModel();
          if (loaded && await isModelReady()) {
            aiAvailable = true;
          }
        }
      }

      // 处理填空题 - 先使用固定判题，不全对则使用AI判题
      if (fillBlankQuestions.length > 0) {
        // 第一步：使用固定判题
        const fixedResults: Map<string, { score: number; isCorrect: 0 | 1 | 2; blankResults?: BlankResult[] }> = new Map();
        
        for (const question of fillBlankQuestions) {
          const answer = state.examState!.answers.get(question.id)!;
          const { score, isCorrect, blankResults } = checkAnswer(question, answer);
          fixedResults.set(question.id, { score, isCorrect, blankResults });
        }

        // 第二步：检查是否需要AI判题（有题目不全对且AI可用）
        const needsAIGrading = aiAvailable && fillBlankQuestions.some(q => {
          const result = fixedResults.get(q.id);
          return result && result.isCorrect !== 2; // 不是全对
        });

        if (needsAIGrading) {
          // 构建需要AI判题的项目（固定判题不全对的题目）
          const aiNeededItems: BatchGradingItem[] = fillBlankQuestions
            .filter(q => {
              const result = fixedResults.get(q.id);
              return result && result.isCorrect !== 2; // 只选择不全对的题目
            })
            .map(q => {
              const answer = state.examState!.answers.get(q.id)!;
              const rawCorrectAnswer = q.correctAnswer;
              const correctAnswers: string[] = Array.isArray(rawCorrectAnswer)
                ? rawCorrectAnswer.filter((a): a is string => typeof a === 'string')
                : (typeof rawCorrectAnswer === 'string' ? [rawCorrectAnswer] : []);
              const userAnswers = Array.isArray(answer) ? answer : [answer];

              return {
                questionId: q.id,
                userAnswer: userAnswers,
                correctAnswer: correctAnswers,
                maxScore: q.score,
                question: q.content,
                allowDisorder: q.allowDisorder
              };
            });

          try {
            // 使用流式批量判题
            const aiResults: Map<string, { score: number; isCorrect: 0 | 1 | 2; feedback?: string; explanation?: string; blankResults?: BlankResult[] }> = new Map();
            
            await gradeBatchWithStream(aiNeededItems, {
              onQuestionComplete: (questionId, aiResult) => {
                aiResults.set(questionId, {
                  score: aiResult.score,
                  isCorrect: aiResult.isCorrect,
                  feedback: aiResult.feedback,
                  explanation: aiResult.explanation,
                  blankResults: aiResult.blankResults
                });
              }
            });

            // 合并结果：固定判题全对的用固定结果，其他用AI结果（包括AI失败的也标记为AI降级判题）
            for (const question of fillBlankQuestions) {
              const answer = state.examState!.answers.get(question.id)!;
              const fixedResult = fixedResults.get(question.id)!;
              
              let finalResult;
              if (fixedResult.isCorrect === 2) {
                // 固定判题全对，使用固定结果
                finalResult = {
                  score: fixedResult.score,
                  isCorrect: fixedResult.isCorrect,
                  feedback: '固定判题：全部正确',
                  explanation: '【固定判题模式】\n答案完全正确',
                  blankResults: fixedResult.blankResults,
                  gradingMode: 'fixed' as const
                };
              } else {
                // 使用AI判题结果（无论AI是否成功，都标记为AI判题模式）
                const aiResult = aiResults.get(question.id);
                if (aiResult) {
                  // AI判题成功
                  finalResult = {
                    score: aiResult.score,
                    isCorrect: aiResult.isCorrect,
                    feedback: aiResult.feedback,
                    explanation: aiResult.explanation,
                    blankResults: aiResult.blankResults,
                    gradingMode: 'ai' as const
                  };
                } else {
                  // AI判题失败，使用固定结果但标记为AI降级判题
                  finalResult = {
                    score: fixedResult.score,
                    isCorrect: fixedResult.isCorrect,
                    feedback: 'AI降级判题：使用固定规则结果',
                    explanation: '【AI降级判题模式】\nAI判题失败，使用固定判题结果',
                    blankResults: fixedResult.blankResults,
                    gradingMode: 'ai-fallback' as const
                  };
                }
              }

              const userAnswer: UserAnswer = {
                questionId: question.id,
                answer,
                score: finalResult.score,
                isCorrect: finalResult.isCorrect,
                aiFeedback: finalResult.feedback,
                aiExplanation: finalResult.explanation,
                gradingMode: finalResult.gradingMode,
                blankResults: finalResult.blankResults
              };
              unconfirmedAnswers.push(userAnswer);
              
              const questionResult: QuestionResult = {
                answer,
                isConfirmed: true,
                isCorrect: finalResult.isCorrect,
                score: finalResult.score,
                aiFeedback: finalResult.feedback,
                aiExplanation: finalResult.explanation,
                gradingMode: finalResult.gradingMode,
                blankResults: finalResult.blankResults
              };
              onQuestionGraded?.(question.id, questionResult);
              
              processedCount++;
              onProgress?.(confirmedAnswers.length + processedCount, state.examState!.questions.length);
            }
          } catch (error) {
            console.error('[finishExam] 填空题AI判题失败，使用固定判题结果:', error);
            // 批量请求失败，但已调用AI，所以标记为AI降级判题
            for (const question of fillBlankQuestions) {
              const answer = state.examState!.answers.get(question.id)!;
              const fixedResult = fixedResults.get(question.id)!;
              
              // 全对的题目保持固定判题，其他标记为AI降级判题
              const isAllCorrect = fixedResult.isCorrect === 2;
              
              const userAnswer: UserAnswer = {
                questionId: question.id,
                answer,
                score: fixedResult.score,
                isCorrect: fixedResult.isCorrect,
                gradingMode: isAllCorrect ? 'fixed' : 'ai-fallback',
                blankResults: fixedResult.blankResults,
                aiFeedback: isAllCorrect ? undefined : 'AI降级判题：批量请求失败',
                aiExplanation: isAllCorrect ? undefined : '【AI降级判题模式】\nAI批量判题失败，使用固定判题结果'
              };
              unconfirmedAnswers.push(userAnswer);
              
              const questionResult: QuestionResult = {
                answer,
                isConfirmed: true,
                isCorrect: fixedResult.isCorrect,
                score: fixedResult.score,
                gradingMode: isAllCorrect ? 'fixed' : 'ai-fallback',
                blankResults: fixedResult.blankResults,
                aiFeedback: isAllCorrect ? undefined : 'AI降级判题：批量请求失败',
                aiExplanation: isAllCorrect ? undefined : '【AI降级判题模式】\nAI批量判题失败，使用固定判题结果'
              };
              onQuestionGraded?.(question.id, questionResult);
              
              processedCount++;
              onProgress?.(confirmedAnswers.length + processedCount, state.examState.questions.length);
            }
          }
        } else {
          // 不需要AI判题（全对或AI不可用），直接使用固定判题结果
          for (const question of fillBlankQuestions) {
            const answer = state.examState!.answers.get(question.id)!;
            const fixedResult = fixedResults.get(question.id)!;
            const userAnswer: UserAnswer = {
              questionId: question.id,
              answer,
              score: fixedResult.score,
              isCorrect: fixedResult.isCorrect,
              gradingMode: 'fixed',
              blankResults: fixedResult.blankResults
            };
            unconfirmedAnswers.push(userAnswer);
            
            const questionResult: QuestionResult = {
              answer,
              isConfirmed: true,
              isCorrect: fixedResult.isCorrect,
              score: fixedResult.score,
              gradingMode: 'fixed',
              blankResults: fixedResult.blankResults
            };
            onQuestionGraded?.(question.id, questionResult);
            
            processedCount++;
            onProgress?.(confirmedAnswers.length + processedCount, state.examState!.questions.length);
          }
        }
      }

      // 处理主观题 - 先使用固定判题，不全对则使用AI判题
      if (subjectiveQuestions.length > 0) {
        // 第一步：使用固定判题
        const fixedResults: Map<string, { score: number; isCorrect: 0 | 1 | 2; similarity: number }> = new Map();
        
        for (const question of subjectiveQuestions) {
          const answer = state.examState!.answers.get(question.id)!;
          const correctAnswerText = getAnswerTextForComparison(question.correctAnswer);
          const result = calculateSubjectiveScore(answer as string, correctAnswerText, question.score);
          let isCorrect: 0 | 1 | 2;
          if (result.similarity >= 0.9) {
            isCorrect = 2;
          } else if (result.similarity >= 0.6) {
            isCorrect = 1;
          } else {
            isCorrect = 0;
          }
          fixedResults.set(question.id, { score: result.score, isCorrect, similarity: result.similarity });
        }

        // 第二步：检查是否需要AI判题（有题目不全对且AI可用）
        const needsAIGrading = aiAvailable && subjectiveQuestions.some(q => {
          const result = fixedResults.get(q.id);
          return result && result.isCorrect !== 2; // 不是全对
        });

        if (needsAIGrading) {
          // 需要AI判题的题目（固定判题不全对的题目）
          const aiNeededQuestions = subjectiveQuestions.filter(q => {
            const result = fixedResults.get(q.id);
            return result && result.isCorrect !== 2;
          });

          // 逐题处理需要AI判题的题目
          const aiResults: Map<string, { score: number; isCorrect: 0 | 1 | 2; feedback?: string; explanation?: string }> = new Map();
          
          for (const question of aiNeededQuestions) {
            const answer = state.examState!.answers.get(question.id)!;
            const correctAnswerText = getAnswerTextForComparison(question.correctAnswer);

            try {
              const { gradeSubjective } = await import('../utils/aiGrading');
              const aiResult = await gradeSubjective(answer as string, correctAnswerText, question.score, question.content);

              if (aiResult) {
                aiResults.set(question.id, {
                  score: aiResult.score,
                  isCorrect: aiResult.isCorrect,
                  feedback: aiResult.feedback,
                  explanation: aiResult.explanation
                });
              }
            } catch (error) {
              console.error(`[finishExam] 主观题 ${question.id} AI判题失败:`, error);
              // AI判题失败，不设置结果，后续会使用固定判题结果
            }
            processedCount++;
            onProgress?.(confirmedAnswers.length + processedCount, state.examState!.questions.length);
          }

          // 合并结果：固定判题全对的用固定结果，其他用AI结果（包括AI失败的也标记为AI降级判题）
          for (const question of subjectiveQuestions) {
            const answer = state.examState!.answers.get(question.id)!;
            const fixedResult = fixedResults.get(question.id)!;
            
            let finalResult;
            if (fixedResult.isCorrect === 2) {
              // 固定判题全对，使用固定结果
              finalResult = {
                score: fixedResult.score,
                isCorrect: fixedResult.isCorrect,
                feedback: '固定判题：答案正确',
                explanation: '【固定判题模式】\n答案完全正确',
                gradingMode: 'fixed' as const
              };
            } else {
              // 使用AI判题结果（无论AI是否成功，都标记为AI判题模式）
              const aiResult = aiResults.get(question.id);
              if (aiResult) {
                // AI判题成功
                finalResult = {
                  score: aiResult.score,
                  isCorrect: aiResult.isCorrect,
                  feedback: aiResult.feedback,
                  explanation: aiResult.explanation,
                  gradingMode: 'ai' as const
                };
              } else {
                // AI判题失败，使用固定结果但标记为AI降级判题
                finalResult = {
                  score: fixedResult.score,
                  isCorrect: fixedResult.isCorrect,
                  feedback: 'AI降级判题：使用固定规则结果',
                  explanation: '【AI降级判题模式】\nAI判题失败，使用固定判题结果',
                  gradingMode: 'ai-fallback' as const
                };
              }
            }

            const userAnswer: UserAnswer = {
              questionId: question.id,
              answer,
              score: finalResult.score,
              isCorrect: finalResult.isCorrect,
              aiFeedback: finalResult.feedback,
              aiExplanation: finalResult.explanation,
              gradingMode: finalResult.gradingMode
            };
            unconfirmedAnswers.push(userAnswer);
            
            const questionResult: QuestionResult = {
              answer,
              isConfirmed: true,
              isCorrect: finalResult.isCorrect,
              score: finalResult.score,
              aiFeedback: finalResult.feedback,
              aiExplanation: finalResult.explanation,
              gradingMode: finalResult.gradingMode
            };
            onQuestionGraded?.(question.id, questionResult);
          }
        } else {
          // 不需要AI判题（全对或AI不可用），直接使用固定判题结果
          for (const question of subjectiveQuestions) {
            const answer = state.examState!.answers.get(question.id)!;
            const fixedResult = fixedResults.get(question.id)!;
            const userAnswer: UserAnswer = {
              questionId: question.id,
              answer,
              score: fixedResult.score,
              isCorrect: fixedResult.isCorrect,
              gradingMode: 'fixed'
            };
            unconfirmedAnswers.push(userAnswer);
            
            const questionResult: QuestionResult = {
              answer,
              isConfirmed: true,
              isCorrect: fixedResult.isCorrect,
              score: fixedResult.score,
              gradingMode: 'fixed'
            };
            onQuestionGraded?.(question.id, questionResult);
            
            processedCount++;
            onProgress?.(confirmedAnswers.length + processedCount, state.examState!.questions.length);
          }
        }
      }
    }

    // 合并所有结果
    const userAnswers = [...confirmedAnswers, ...unconfirmedAnswers];

    // 按题目ID排序，保持原有顺序
    const questionIdOrder = new Map<string, number>();
    state.examState.questions.forEach((q, index) => {
      questionIdOrder.set(q.id, index);
    });
    userAnswers.sort((a, b) => {
      return (questionIdOrder.get(a.questionId!) ?? 0) - (questionIdOrder.get(b.questionId!) ?? 0);
    });

    set((state) => ({
      examState: state.examState
        ? { ...state.examState, isFinished: true }
        : null
    }));

    return userAnswers;
  },

  resetExam: () => {
    set({ examState: null });
  },

  getCurrentQuestion: () => {
    const state = get();
    if (!state.examState) return undefined;
    return state.examState.questions[state.examState.currentIndex];
  },

  getProgress: () => {
    const state = get();
    if (!state.examState) return { answered: 0, total: 0 };
    return {
      answered: state.examState.results.size,
      total: state.examState.questions.length
    };
  },

  getStatistics: () => {
    const state = get();
    if (!state.examState) return { correct: 0, incorrect: 0, totalScore: 0, maxScore: 0 };

    let correct = 0;
    let incorrect = 0;
    let totalScore = 0;

    state.examState.results.forEach((result) => {
      if (result.isConfirmed) {
        if (result.isCorrect) {
          correct++;
        } else {
          incorrect++;
        }
        totalScore += result.score;
      }
    });

    const maxScore = state.examState.questions.reduce((sum, q) => sum + q.score, 0);

    return { correct, incorrect, totalScore, maxScore };
  },

  isAllConfirmed: () => {
    const state = get();
    if (!state.examState) return false;
    return state.examState.results.size === state.examState.questions.length;
  }
}));
