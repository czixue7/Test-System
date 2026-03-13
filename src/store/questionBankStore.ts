import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { QuestionBank, Question } from '../types';
import { getStoreValue, setStoreValue } from '../utils/tauriStore';
import { loadBuiltInBanks, isBuiltInBank } from '../utils/builtInBanks';

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

interface QuestionBankState {
  banks: QuestionBank[];
  isLoaded: boolean;
  loadBanks: () => Promise<void>;
  addBank: (bank: Omit<QuestionBank, 'id' | 'createdAt' | 'updatedAt'>) => string;
  updateBank: (id: string, updates: Partial<QuestionBank>) => void;
  updateBankWithSha: (id: string, updates: Partial<QuestionBank>, sha: string) => void;
  deleteBank: (id: string) => void;
  getBank: (id: string) => QuestionBank | undefined;
  addQuestion: (bankId: string, question: Omit<Question, 'id'>) => void;
  updateQuestion: (bankId: string, questionId: string, updates: Partial<Question>) => void;
  deleteQuestion: (bankId: string, questionId: string) => void;
  importBank: (bank: QuestionBank) => string;
  importBankWithSha: (bank: Omit<QuestionBank, 'id' | 'createdAt' | 'updatedAt'>, sha: string, filename: string) => string;
}

const saveUserBanks = async (banks: QuestionBank[]) => {
  const userBanks = banks.filter(bank => !isBuiltInBank(bank.id));
  await setStoreValue('question-banks', userBanks);
};

export const useQuestionBankStore = create<QuestionBankState>()(
  persist(
    (set, get) => ({
      banks: [],
      isLoaded: false,
      
      loadBanks: async () => {
        const builtInBanks = await loadBuiltInBanks();
        const userBanks = await getStoreValue<QuestionBank[]>('question-banks', []);
        
        await setStoreValue('built-in-banks', builtInBanks);
        
        const allBanks = [...builtInBanks, ...userBanks];
        set({ banks: allBanks, isLoaded: true });
      },
      
      addBank: (bankData) => {
        const id = generateId();
        const now = new Date().toISOString();
        const bank: QuestionBank = {
          ...bankData,
          id,
          createdAt: now,
          updatedAt: now
        };
        set((state) => {
          const newBanks = [...state.banks, bank];
          saveUserBanks(newBanks);
          return { banks: newBanks };
        });
        return id;
      },
      
      updateBank: (id, updates) => {
        if (isBuiltInBank(id)) {
          console.warn('Cannot update built-in bank');
          return;
        }
        set((state) => {
          const newBanks = state.banks.map((bank) =>
            bank.id === id
              ? { ...bank, ...updates, updatedAt: new Date().toISOString() }
              : bank
          );
          saveUserBanks(newBanks);
          return { banks: newBanks };
        });
      },
      
      updateBankWithSha: (id, updates, sha) => {
        if (isBuiltInBank(id)) {
          console.warn('Cannot update built-in bank');
          return;
        }
        set((state) => {
          const newBanks = state.banks.map((bank) =>
            bank.id === id
              ? { ...bank, ...updates, sourceSha: sha, updatedAt: new Date().toISOString() }
              : bank
          );
          saveUserBanks(newBanks);
          return { banks: newBanks };
        });
      },
      
      deleteBank: (id) => {
        if (isBuiltInBank(id)) {
          console.warn('Cannot delete built-in bank');
          return;
        }
        set((state) => {
          const newBanks = state.banks.filter((bank) => bank.id !== id);
          saveUserBanks(newBanks);
          return { banks: newBanks };
        });
      },
      
      getBank: (id) => {
        return get().banks.find((bank) => bank.id === id);
      },
      
      addQuestion: (bankId, questionData) => {
        if (isBuiltInBank(bankId)) {
          console.warn('Cannot add question to built-in bank');
          return;
        }
        const question: Question = {
          ...questionData,
          id: generateId()
        };
        set((state) => {
          const newBanks = state.banks.map((bank) =>
            bank.id === bankId
              ? {
                  ...bank,
                  questions: [...bank.questions, question],
                  updatedAt: new Date().toISOString()
                }
              : bank
          );
          saveUserBanks(newBanks);
          return { banks: newBanks };
        });
      },
      
      updateQuestion: (bankId, questionId, updates) => {
        if (isBuiltInBank(bankId)) {
          console.warn('Cannot update question in built-in bank');
          return;
        }
        set((state) => {
          const newBanks = state.banks.map((bank) =>
            bank.id === bankId
              ? {
                  ...bank,
                  questions: bank.questions.map((q) =>
                    q.id === questionId ? { ...q, ...updates } : q
                  ),
                  updatedAt: new Date().toISOString()
                }
              : bank
          );
          saveUserBanks(newBanks);
          return { banks: newBanks };
        });
      },
      
      deleteQuestion: (bankId, questionId) => {
        if (isBuiltInBank(bankId)) {
          console.warn('Cannot delete question from built-in bank');
          return;
        }
        set((state) => {
          const newBanks = state.banks.map((bank) =>
            bank.id === bankId
              ? {
                  ...bank,
                  questions: bank.questions.filter((q) => q.id !== questionId),
                  updatedAt: new Date().toISOString()
                }
              : bank
          );
          saveUserBanks(newBanks);
          return { banks: newBanks };
        });
      },
      
      importBank: (bank) => {
        const id = generateId();
        const now = new Date().toISOString();
        const newBank: QuestionBank = {
          ...bank,
          id,
          createdAt: now,
          updatedAt: now
        };
        set((state) => {
          const newBanks = [...state.banks, newBank];
          saveUserBanks(newBanks);
          return { banks: newBanks };
        });
        return id;
      },
      
      importBankWithSha: (bankData, sha, filename) => {
        const id = generateId();
        const now = new Date().toISOString();
        const newBank: QuestionBank = {
          ...bankData,
          id,
          sourceSha: sha,
          sourceFilename: filename,
          createdAt: now,
          updatedAt: now
        };
        set((state) => {
          const newBanks = [...state.banks, newBank];
          saveUserBanks(newBanks);
          return { banks: newBanks };
        });
        return id;
      }
    }),
    {
      name: 'question-banks',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ banks: state.banks.filter(bank => !isBuiltInBank(bank.id)) }),
    }
  )
);
