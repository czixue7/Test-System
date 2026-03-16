import { create } from 'zustand';
import { ExamRecord, UserAnswer, Question, GradingMode } from '../types';
import { getStoreValue, setStoreValue } from '../utils/tauriStore';

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

interface RecordState {
  records: ExamRecord[];
  isLoaded: boolean;
  loadRecords: () => Promise<void>;
  addRecord: (
    bankId: string,
    bankName: string,
    questions: Question[],
    answers: UserAnswer[],
    duration: number,
    maxScore: number,
    gradingMode?: GradingMode
  ) => Promise<string>;
  getRecord: (id: string) => ExamRecord | undefined;
  deleteRecord: (id: string) => Promise<void>;
  clearRecords: () => Promise<void>;
}

const STORAGE_KEY = 'exam-records';

export const useRecordStore = create<RecordState>()(
  (set, get) => ({
    records: [],
    isLoaded: false,

    loadRecords: async () => {
      const records = await getStoreValue<ExamRecord[]>(STORAGE_KEY, []);
      set({ records, isLoaded: true });
    },

    addRecord: async (bankId, bankName, questions, answers, duration, maxScore, gradingMode) => {
      const id = generateId();
      const now = new Date().toISOString();

      const totalScore = answers.reduce((sum, a) => sum + (a.score ?? 0), 0);

      const aiFeedbacks = answers
        .filter(a => a.aiFeedback)
        .map(a => a.aiFeedback);

      let aiEvaluation: string | undefined;
      if (gradingMode === 'ai' && aiFeedbacks.length > 0) {
        const correctCount = answers.filter(a => a.isCorrect).length;
        const totalCount = answers.length;
        const percentage = Math.round((correctCount / totalCount) * 100);

        let evaluation = `本次考试使用 AI 判题，共 ${totalCount} 题，答对 ${correctCount} 题，正确率 ${percentage}%。`;

        if (percentage >= 90) {
          evaluation += ' 表现优秀，继续保持！';
        } else if (percentage >= 70) {
          evaluation += ' 表现良好，还有提升空间。';
        } else if (percentage >= 60) {
          evaluation += ' 刚好及格，需要加强练习。';
        } else {
          evaluation += ' 成绩不理想，建议复习后重试。';
        }

        aiEvaluation = evaluation;
      }

      const record: ExamRecord = {
        id,
        examId: bankId,
        examName: bankName,
        bankId,
        bankName,
        questions,
        answers,
        score: totalScore,
        totalScore,
        maxScore: maxScore,
        correctCount: answers.filter(a => a.isCorrect === true || a.isCorrect === 2).length,
        wrongCount: answers.filter(a => a.isCorrect === false || a.isCorrect === 0).length,
        unansweredCount: answers.filter(a => !a.answer || (Array.isArray(a.answer) && a.answer.length === 0)).length,
        timeSpent: duration,
        percentage: maxScore > 0 ? Math.round((totalScore / maxScore) * 100) : 0,
        duration,
        submittedAt: now,
        startedAt: new Date(Date.now() - duration * 1000).toISOString(),
        finishedAt: now,
        aiEvaluation,
        gradingMode
      };

      const newRecords = [record, ...get().records];
      await setStoreValue(STORAGE_KEY, newRecords);
      set({ records: newRecords });

      return id;
    },

    getRecord: (id) => {
      return get().records.find((r) => r.id === id);
    },

    deleteRecord: async (id) => {
      const newRecords = get().records.filter((r) => r.id !== id);
      await setStoreValue(STORAGE_KEY, newRecords);
      set({ records: newRecords });
    },

    clearRecords: async () => {
      await setStoreValue(STORAGE_KEY, []);
      set({ records: [] });
    }
  })
);
