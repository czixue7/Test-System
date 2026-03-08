import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { ExamRecord, UserAnswer, Question } from '../types';
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
    maxScore: number
  ) => string;
  getRecord: (id: string) => ExamRecord | undefined;
  deleteRecord: (id: string) => void;
  clearRecords: () => void;
}

const saveRecords = async (records: ExamRecord[]) => {
  await setStoreValue('exam-records', records);
};

export const useRecordStore = create<RecordState>()(
  persist(
    (set, get) => ({
      records: [],
      isLoaded: false,
      
      loadRecords: async () => {
        const records = await getStoreValue<ExamRecord[]>('exam-records', []);
        set({ records, isLoaded: true });
      },
      
      addRecord: (bankId, bankName, questions, answers, duration, maxScore) => {
        const id = generateId();
        const now = new Date().toISOString();
        
        const totalScore = answers.reduce((sum, a) => sum + (a.score ?? 0), 0);
        
        const record: ExamRecord = {
          id,
          bankId,
          bankName,
          questions,
          answers,
          totalScore,
          maxScore: maxScore,
          percentage: maxScore > 0 ? Math.round((totalScore / maxScore) * 100) : 0,
          duration,
          startedAt: new Date(Date.now() - duration * 1000).toISOString(),
          finishedAt: now
        };
        
        set((state) => {
          const newRecords = [record, ...state.records];
          saveRecords(newRecords);
          return { records: newRecords };
        });
        
        return id;
      },
      
      getRecord: (id) => {
        return get().records.find((r) => r.id === id);
      },
      
      deleteRecord: (id) => {
        set((state) => {
          const newRecords = state.records.filter((r) => r.id !== id);
          saveRecords(newRecords);
          return { records: newRecords };
        });
      },
      
      clearRecords: () => {
        set({ records: [] });
        saveRecords([]);
      }
    }),
    {
      name: 'exam-records',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ records: state.records }),
    }
  )
);
