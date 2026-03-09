import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type GradingMode = 'fixed' | 'ai';

export type ModelState = 'not-downloaded' | 'downloading' | 'downloaded' | 'loading' | 'ready' | 'error';

interface SettingsState {
  gradingMode: GradingMode;
  modelAvailable: boolean;
  modelState: ModelState;
  modelLoadProgress: number;
  modelError: string | null;
  downloadedModelId: string | null;
  selectedModelId: string | null;
  setGradingMode: (mode: GradingMode) => void;
  setModelAvailable: (available: boolean) => void;
  setModelState: (state: ModelState) => void;
  setModelLoadProgress: (progress: number) => void;
  setModelError: (error: string | null) => void;
  setDownloadedModelId: (id: string | null) => void;
  setSelectedModelId: (id: string | null) => void;
  resetModelState: () => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      gradingMode: 'fixed',
      modelAvailable: false,
      modelState: 'not-downloaded',
      modelLoadProgress: 0,
      modelError: null,
      downloadedModelId: null,
      selectedModelId: null,
      setGradingMode: (mode) => set({ gradingMode: mode }),
      setModelAvailable: (available) => set({ modelAvailable: available }),
      setModelState: (state) => set({ modelState: state }),
      setModelLoadProgress: (progress) => set({ modelLoadProgress: progress }),
      setModelError: (error) => set({ modelError: error }),
      setDownloadedModelId: (id) => set({ downloadedModelId: id }),
      setSelectedModelId: (id) => set({ selectedModelId: id }),
      resetModelState: () => set({
        modelState: 'not-downloaded',
        modelLoadProgress: 0,
        modelError: null,
      }),
    }),
    {
      name: 'settings-storage',
    }
  )
);
