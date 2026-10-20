import { create } from 'zustand';
import { ExamRecord, UserAnswer, Question, GradingMode } from '../types';
import { getStoreValue, setStoreValue } from '../utils/tauriStore';
import { countAnswerStats } from '../utils/answerUtils';

function generateId(): string {
  // 优先用 crypto.randomUUID：不依赖时间戳，
  // 避免同一毫秒内批量生成时碰撞（旧实现用 substr 且只有随机后缀兜底）
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return Date.now().toString(36) + Math.random().toString(36).substring(2);
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

      // 统一口径的三态统计：旧实现里「部分正确」既不算对也不算错，
      // 且 AI 评价文案把 isCorrect 为真值（含 1）的都算成答对，
      // 与 record 上的 correctCount（只算 === 2）互相矛盾。
      const stats = countAnswerStats(answers);

      const aiFeedbacks = answers
        .filter(a => a.aiFeedback)
        .map(a => a.aiFeedback);

      let aiEvaluation: string | undefined;
      if (gradingMode === 'ai' && aiFeedbacks.length > 0 && stats.total > 0) {
        const percentage = Math.round((stats.correct / stats.total) * 100);

        let evaluation = `本次考试使用 AI 判题，共 ${stats.total} 题，答对 ${stats.correct} 题，正确率 ${percentage}%。`;
        if (stats.partial > 0) {
          evaluation += ` 另有 ${stats.partial} 题部分正确。`;
        }

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
        correctCount: stats.correct,
        wrongCount: stats.wrong,
        unansweredCount: stats.unanswered,
        timeSpent: duration,
        percentage: maxScore > 0 ? Math.round((totalScore / maxScore) * 100) : 0,
        duration,
        submittedAt: now,
        startedAt: new Date(Date.now() - duration * 1000).toISOString(),
        finishedAt: now,
        aiEvaluation,
        gradingMode
      };

      // 在 set 回调内基于最新 state 追加，避免并发调用（例如重复交卷）丢更新
      let newRecords: ExamRecord[] = [];
      set((state) => {
        newRecords = [record, ...state.records];
        return { records: newRecords };
      });
      await setStoreValue(STORAGE_KEY, newRecords);

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
