import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { QuestionBank, Question, BankImageInfo } from '../types';
import { getStoreValue, setStoreValue } from '../utils/tauriStore';
import { loadBuiltInBanks, isBuiltInBank } from '../utils/builtInBanks';
import { fetchBankIndex } from '../utils/bankIndex';
import { sortByName, sortById } from '../utils/sortUtils';

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

interface QuestionBankState {
  banks: QuestionBank[];
  isLoaded: boolean;
  loadBanks: () => Promise<void>;
  addBank: (bank: Omit<QuestionBank, 'id' | 'createdAt' | 'updatedAt'>) => string;
  updateBank: (id: string, updates: Partial<QuestionBank>) => void;
  updateBankWithSha: (id: string, updates: Partial<QuestionBank>, sha: string, images?: BankImageInfo[]) => void;
  deleteBank: (id: string) => void;
  getBank: (id: string) => QuestionBank | undefined;
  addQuestion: (bankId: string, question: Omit<Question, 'id'>) => void;
  updateQuestion: (bankId: string, questionId: string, updates: Partial<Question>) => void;
  deleteQuestion: (bankId: string, questionId: string) => void;
  importBank: (bank: QuestionBank) => string;
  importBankWithSha: (bank: Omit<QuestionBank, 'id' | 'createdAt' | 'updatedAt'>, sha: string, filename: string, images?: BankImageInfo[]) => string;
}

const saveUserBanks = async (banks: QuestionBank[]) => {
  const userBanks = banks.filter(bank => !isBuiltInBank(bank.id));
  await setStoreValue('question-banks', userBanks);
};

// 保存内置题库的更新信息（如 sourceSha、images 等）
const BANK_UPDATES_KEY = 'built-in-bank-updates';

const saveBuiltInBankUpdates = async (banks: QuestionBank[]) => {
  const builtInBanks = banks.filter(bank => isBuiltInBank(bank.id));
  // 只保存需要持久化的字段
  const updates = builtInBanks.map(bank => ({
    id: bank.id,
    sourceSha: bank.sourceSha,
    images: bank.images,
    sourceFilename: bank.sourceFilename,
    sourceType: bank.sourceType
  }));
  await setStoreValue(BANK_UPDATES_KEY, updates);
};

const loadBuiltInBankUpdates = async (): Promise<Map<string, Partial<QuestionBank>>> => {
  const updates = await getStoreValue<Array<{id: string; sourceSha?: string; images?: BankImageInfo[]; sourceFilename?: string; sourceType?: 'system' | 'user'}>>(BANK_UPDATES_KEY, []);
  const map = new Map<string, Partial<QuestionBank>>();
  updates.forEach(update => {
    map.set(update.id, {
      sourceSha: update.sourceSha,
      images: update.images,
      sourceFilename: update.sourceFilename,
      sourceType: update.sourceType
    });
  });
  return map;
};

export const useQuestionBankStore = create<QuestionBankState>()(
  persist(
    (set, get) => ({
      banks: [],
      isLoaded: false,
      
      loadBanks: async () => {
        // 获取当前状态中已有的用户题库（可能由 zustand persist 从 localStorage 恢复）
        const existingUserBanks = get().banks.filter(bank => !isBuiltInBank(bank.id));
        
        // 并行加载本地数据，避免阻塞
        const [builtInBanks, loadedUserBanks, builtInUpdates] = await Promise.all([
          loadBuiltInBanks(),
          getStoreValue<QuestionBank[]>('question-banks', []),
          loadBuiltInBankUpdates()
        ]);
        
        // 合并用户题库：以加载的数据为主，与现有数据合并
        // 防止 tauriStore 为空时覆盖掉 zustand persist 已恢复的数据
        const userBankMap = new Map<string, QuestionBank>();
        
        // 先添加现有题库（作为后备）
        for (const bank of existingUserBanks) {
          userBankMap.set(bank.id, bank);
        }
        
        // 再用加载的题库覆盖（优先使用 tauriStore 的数据）
        for (const bank of loadedUserBanks) {
          userBankMap.set(bank.id, bank);
        }
        
        const mergedUserBanks = Array.from(userBankMap.values());
        
        // 如果加载的数据为空但现有数据有内容，将现有数据同步回 tauriStore
        if (loadedUserBanks.length === 0 && existingUserBanks.length > 0) {
          console.log('[loadBanks] tauriStore 中用户题库为空，从 localStorage 恢复并同步回 store');
          saveUserBanks([...existingUserBanks]);
        }
        
        // 先使用本地数据快速显示界面
        const mergedBuiltInBanks = builtInBanks.map(bank => {
          const updates = builtInUpdates.get(bank.id);
          if (updates) {
            return { ...bank, ...updates };
          }
          return bank;
        });
        
        // 内置题库按 id 字典序排序
        const sortBuiltInById = sortById<QuestionBank>;
        // 用户题库按名称字典序排序
        const sortUserByName = sortByName<QuestionBank>;
        
        const sortedBuiltInBanks = mergedBuiltInBanks.sort(sortBuiltInById);
        const sortedUserBanks = mergedUserBanks.sort(sortUserByName);
        
        const allBanks = [...sortedBuiltInBanks, ...sortedUserBanks];
        set({ banks: allBanks, isLoaded: true });
        
        // 在后台异步同步云端 SHA 和图片信息（不阻塞应用启动）
        setTimeout(async () => {
          try {
            const bankIndex = await fetchBankIndex();
            if (!bankIndex) return;
            
            let hasUpdates = false;
            const updatedBanks = mergedBuiltInBanks.map(bank => {
              const remoteBank = bankIndex.systemBanks.find(
                rb => rb.filename === bank.sourceFilename || rb.name === bank.name
              );
              
              if (!remoteBank) return bank;
              
              // 检查SHA是否不同（注意：不同长度的SHA无法比较，视为相同）
              const shaDifferent = bank.sourceSha !== remoteBank.sha && 
                                   bank.sourceSha && remoteBank.sha &&
                                   bank.sourceSha.length === remoteBank.sha.length;
              
              // 检查图片信息是否需要更新（本地没有但远程有，或者本地有但不同）
              const localImagesJson = bank.images ? JSON.stringify(bank.images) : '';
              const remoteImagesJson = remoteBank.images ? JSON.stringify(remoteBank.images) : '';
              const imagesDifferent = localImagesJson !== remoteImagesJson;
              
              if (shaDifferent || imagesDifferent) {
                hasUpdates = true;
                return { 
                  ...bank, 
                  sourceSha: remoteBank.sha,
                  images: remoteBank.images || bank.images,
                  sourceFilename: remoteBank.filename,
                  sourceType: 'system' as const
                };
              }
              return bank;
            });
            
            if (hasUpdates) {
              await saveBuiltInBankUpdates(updatedBanks);
              set({ banks: [...updatedBanks.sort(sortBuiltInById), ...sortedUserBanks] });
            }
          } catch (error) {
            console.error('后台同步题库 SHA 失败:', error);
          }
        }, 500);
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
      
      updateBankWithSha: (id, updates, sha, images) => {
        set((state) => {
          const newBanks = state.banks.map((bank) =>
            bank.id === id
              ? { ...bank, ...updates, sourceSha: sha, images, updatedAt: new Date().toISOString() }
              : bank
          );
          // 保存用户题库到存储
          if (!isBuiltInBank(id)) {
            saveUserBanks(newBanks);
          } else {
            // 内置题库更新时，保存更新信息以便下次加载时恢复
            saveBuiltInBankUpdates(newBanks);
          }
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
      
      importBankWithSha: (bankData, sha, filename, images) => {
        const id = generateId();
        const now = new Date().toISOString();
        const newBank: QuestionBank = {
          ...bankData,
          id,
          sourceSha: sha,
          sourceFilename: filename,
          images,
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
