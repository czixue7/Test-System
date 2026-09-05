import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { KnowledgeSearchSource } from '../types';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  source: KnowledgeSearchSource;
  createdAt: string;
}

interface ChatState {
  messages: ChatMessage[];
  addMessage: (msg: Omit<ChatMessage, 'id' | 'createdAt'>) => string;
  updateMessage: (id: string, content: string) => void;
  deleteMessage: (id: string) => void;
  clearMessages: () => void;
}

const CHAT_STORAGE_KEY = 'knowledge-chat';

export const useChatStore = create<ChatState>()(
  persist(
    (set) => ({
      messages: [],

      addMessage: (msg) => {
        const id = Date.now().toString(36) + Math.random().toString(36).substr(2);
        const now = new Date().toISOString();
        set((state) => ({
          messages: [...state.messages, { ...msg, id, createdAt: now }],
        }));
        return id;
      },

      updateMessage: (id, content) => {
        set((state) => ({
          messages: state.messages.map((m) => (m.id === id ? { ...m, content } : m)),
        }));
      },

      deleteMessage: (id) => {
        set((state) => ({ messages: state.messages.filter((m) => m.id !== id) }));
      },

      clearMessages: () => set({ messages: [] }),
    }),
    {
      name: CHAT_STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
    }
  )
);
