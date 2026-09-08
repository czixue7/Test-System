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

export interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
}

interface ChatState {
  conversations: Conversation[];
  activeConversationId: string | null;
  /** 新建对话（可选传入标题），返回新会话 id 并切换为激活会话 */
  createConversation: (title?: string) => string;
  /** 删除指定会话；若删除的是当前激活会话，自动切换到最近一个会话 */
  deleteConversation: (id: string) => void;
  /** 切换到指定会话 */
  switchConversation: (id: string) => void;
  /** 向当前激活会话追加消息（无激活会话时自动创建） */
  addMessage: (msg: Omit<ChatMessage, 'id' | 'createdAt'>) => string;
  /** 更新当前激活会话中指定消息内容 */
  updateMessage: (id: string, content: string) => void;
  /** 清空当前激活会话的全部消息 */
  clearMessages: () => void;
  /** 删除所有会话 */
  clearAllConversations: () => void;
}

const CHAT_STORAGE_KEY = 'knowledge-chat';
const CHAT_STORAGE_VERSION = 2;

const genId = () => Date.now().toString(36) + Math.random().toString(36).substr(2, 6);

const nowIso = () => new Date().toISOString();

// 旧版数据结构（单会话 messages 数组）迁移为多会话
interface LegacyChatState {
  messages?: ChatMessage[];
}

const migrateLegacy = (persisted: unknown): Partial<ChatState> | undefined => {
  const p = persisted as LegacyChatState | null | undefined;
  if (p && Array.isArray(p.messages) && !Array.isArray((p as Partial<ChatState>).conversations)) {
    const msgs = p.messages;
    const id = genId();
    const firstUser = msgs.find((m) => m.role === 'user');
    const conv: Conversation = {
      id,
      title: firstUser ? firstUser.content.replace(/\s+/g, ' ').slice(0, 20) : '对话',
      messages: msgs,
      createdAt: msgs[0]?.createdAt || nowIso(),
      updatedAt: msgs[msgs.length - 1]?.createdAt || nowIso(),
    };
    return { conversations: [conv], activeConversationId: id };
  }
  return p as Partial<ChatState> | undefined;
};

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      conversations: [],
      activeConversationId: null,

      createConversation: (title) => {
        const id = genId();
        const conv: Conversation = {
          id,
          title: title?.trim() || '新对话',
          messages: [],
          createdAt: nowIso(),
          updatedAt: nowIso(),
        };
        set((state) => ({
          conversations: [...state.conversations, conv],
          activeConversationId: id,
        }));
        return id;
      },

      deleteConversation: (id) => {
        const { conversations, activeConversationId } = get();
        const next = conversations.filter((c) => c.id !== id);
        let nextActive = activeConversationId;
        if (activeConversationId === id) {
          // 删除当前激活会话：优先切到下一个（按列表顺序），否则空
          const idx = conversations.findIndex((c) => c.id === id);
          nextActive = next[idx]?.id ?? next[idx - 1]?.id ?? null;
        }
        set({ conversations: next, activeConversationId: nextActive });
      },

      switchConversation: (id) => {
        if (get().conversations.some((c) => c.id === id)) {
          set({ activeConversationId: id });
        }
      },

      addMessage: (msg) => {
        let convId = get().activeConversationId;
        // 无激活会话时自动创建（以用户首条提问为标题）
        if (!convId || !get().conversations.some((c) => c.id === convId)) {
          const title = msg.role === 'user' ? msg.content.replace(/\s+/g, ' ').slice(0, 20) : '对话';
          convId = get().createConversation(title);
        }
        const id = genId();
        const now = nowIso();
        const message: ChatMessage = { ...msg, id, createdAt: now };
        set((state) => ({
          conversations: state.conversations.map((c) =>
            c.id === convId
              ? { ...c, messages: [...c.messages, message], updatedAt: now }
              : c
          ),
        }));
        return id;
      },

      updateMessage: (id, content) => {
        const convId = get().activeConversationId;
        if (!convId) return;
        set((state) => ({
          conversations: state.conversations.map((c) =>
            c.id === convId
              ? {
                  ...c,
                  messages: c.messages.map((m) => (m.id === id ? { ...m, content } : m)),
                  updatedAt: nowIso(),
                }
              : c
          ),
        }));
      },

      clearMessages: () => {
        const convId = get().activeConversationId;
        if (!convId) return;
        set((state) => ({
          conversations: state.conversations.map((c) =>
            c.id === convId ? { ...c, messages: [], updatedAt: nowIso() } : c
          ),
        }));
      },

      clearAllConversations: () => set({ conversations: [], activeConversationId: null }),
    }),
    {
      name: CHAT_STORAGE_KEY,
      version: CHAT_STORAGE_VERSION,
      storage: createJSONStorage(() => localStorage),
      migrate: (persisted, version) => {
        if (version < 2) {
          return migrateLegacy(persisted) as ChatState;
        }
        return persisted as ChatState;
      },
    }
  )
);
