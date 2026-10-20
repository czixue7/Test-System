import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { KnowledgeItem } from '../types';

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

interface KnowledgeState {
  items: KnowledgeItem[];
  categories: string[];          // 自定义分类（额外维护，与条目 category 字段合并展示）
  isLoaded: boolean;
  loadItems: () => void;
  importItems: (items: Omit<KnowledgeItem, 'id' | 'createdAt' | 'updatedAt'>[]) => number;
  addItem: (item: Omit<KnowledgeItem, 'id' | 'createdAt' | 'updatedAt'>) => string;
  updateItem: (id: string, updates: Partial<KnowledgeItem>) => void;
  deleteItem: (id: string) => void;
  addCategory: (name: string) => void;
  renameCategory: (oldName: string, newName: string) => void;
  deleteCategory: (name: string) => void;
}

const KNOWLEDGE_STORAGE_KEY = 'knowledge-base';

export const useKnowledgeStore = create<KnowledgeState>()(
  persist(
    (set, get) => ({
      items: [],
      categories: [],
      isLoaded: false,

      loadItems: () => {
        set({ isLoaded: true });
      },

      importItems: (newItems) => {
        const now = new Date().toISOString();
        const withId = newItems.map((item) => ({
          ...item,
          id: generateId(),
          createdAt: now,
          updatedAt: now,
        }));
        set((state) => ({ items: [...state.items, ...withId], isLoaded: true }));
        return withId.length;
      },

      addItem: (item) => {
        const id = generateId();
        const now = new Date().toISOString();
        set((state) => ({
          items: [...state.items, { ...item, id, createdAt: now, updatedAt: now }],
        }));
        return id;
      },

      updateItem: (id, updates) => {
        set((state) => ({
          items: state.items.map((item) =>
            item.id === id ? { ...item, ...updates, updatedAt: new Date().toISOString() } : item
          ),
        }));
      },

      deleteItem: (id) => {
        set((state) => ({ items: state.items.filter((item) => item.id !== id) }));
      },

      addCategory: (name) => {
        const n = name.trim();
        if (!n) return;
        set((state) =>
          state.categories.includes(n) ? state : { categories: [...state.categories, n] }
        );
      },

      renameCategory: (oldName, newName) => {
        const n = newName.trim();
        if (!n || oldName === n) return;
        set((state) => ({
          categories: state.categories.map((c) => (c === oldName ? n : c)),
          items: state.items.map((item) =>
            item.category === oldName ? { ...item, category: n } : item
          ),
        }));
      },

      deleteCategory: (name) => {
        set((state) => ({
          categories: state.categories.filter((c) => c !== name),
          items: state.items.map((item) =>
            item.category === name ? { ...item, category: '' } : item
          ),
        }));
      },
    }),
    {
      name: KNOWLEDGE_STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
    }
  )
);
