import { create } from 'zustand';
import type { SummaryVersion } from '../utils/knowledgeSummary';

export type SummaryPhase = 'split' | 'summarize' | 'merge';
export interface SummaryProgress {
  done: number;
  total: number;
  phase: SummaryPhase;
}
export type SummaryViewMode = 'content' | 'progress';

/**
 * 知识总结全局状态
 * 不 persist：总结内容为运行时临时产物，软件关闭后不保留（历史版本已持久化在 tauriStore 中）
 * 全局存储的目的：切换 tab 卸载 KnowledgeBase 组件时，后台生成不中断、状态不丢失
 */
interface KnowledgeSummaryState {
  summaryContent: string;
  summaryProgress: SummaryProgress | null;
  summaryViewMode: SummaryViewMode;
  summaryRunning: boolean;
  summaryScrollTop: number;
  summaryHistory: SummaryVersion[];
  summaryActiveId: string | null;
  setSummaryContent: (content: string) => void;
  setSummaryProgress: (progress: SummaryProgress | null) => void;
  setSummaryViewMode: (mode: SummaryViewMode) => void;
  setSummaryRunning: (running: boolean) => void;
  setSummaryScrollTop: (scrollTop: number) => void;
  setSummaryHistory: (history: SummaryVersion[]) => void;
  setSummaryActiveId: (id: string | null) => void;
  resetSummary: () => void;
}

export const useKnowledgeSummaryStore = create<KnowledgeSummaryState>((set) => ({
  summaryContent: '',
  summaryProgress: null,
  summaryViewMode: 'content',
  summaryRunning: false,
  summaryScrollTop: 0,
  summaryHistory: [],
  summaryActiveId: null,
  setSummaryContent: (content) => set({ summaryContent: content }),
  setSummaryProgress: (progress) => set({ summaryProgress: progress }),
  setSummaryViewMode: (mode) => set({ summaryViewMode: mode }),
  setSummaryRunning: (running) => set({ summaryRunning: running }),
  setSummaryScrollTop: (scrollTop) => set({ summaryScrollTop: scrollTop }),
  setSummaryHistory: (history) => set({ summaryHistory: history }),
  setSummaryActiveId: (id) => set({ summaryActiveId: id }),
  resetSummary: () => set({
    summaryContent: '',
    summaryProgress: null,
    summaryViewMode: 'content',
    summaryRunning: false,
    summaryScrollTop: 0,
    summaryHistory: [],
    summaryActiveId: null,
  }),
}));
