import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { GradingProvider } from '../types';

export type GradingMode = 'fixed' | 'ai';

export type ModelState = 'not-downloaded' | 'downloading' | 'downloaded' | 'loading' | 'ready' | 'error';

interface SettingsState {
  gradingMode: GradingMode;
  gradingProvider: GradingProvider;
  modelAvailable: boolean;
  modelState: ModelState;
  modelLoadProgress: number;
  modelError: string | null;
  downloadedModelId: string | null;
  selectedModelId: string | null;
  apiKey: string | null;
  apiModel: string;
  apiEndpoint: string;
  vconsoleEnabled: boolean;
  setGradingMode: (mode: GradingMode) => void;
  setGradingProvider: (provider: GradingProvider) => void;
  setModelAvailable: (available: boolean) => void;
  setModelState: (state: ModelState) => void;
  setModelLoadProgress: (progress: number) => void;
  setModelError: (error: string | null) => void;
  setDownloadedModelId: (id: string | null) => void;
  setSelectedModelId: (id: string | null) => void;
  setApiKey: (key: string | null) => void;
  setApiModel: (model: string) => void;
  setApiEndpoint: (endpoint: string) => void;
  setVconsoleEnabled: (enabled: boolean) => void;
  resetModelState: () => void;
  resetApiConfig: () => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      gradingMode: 'fixed',
      gradingProvider: 'api',
      modelAvailable: false,
      modelState: 'not-downloaded',
      modelLoadProgress: 0,
      modelError: null,
      downloadedModelId: null,
      selectedModelId: null,
      apiKey: null,
      apiModel: 'glm-4-flash',
      apiEndpoint: '',
      vconsoleEnabled: false,
      setGradingMode: (mode) => set({ gradingMode: mode }),
      setGradingProvider: (provider) => set({ gradingProvider: provider }),
      setModelAvailable: (available) => set({ modelAvailable: available }),
      setModelState: (state) => set({ modelState: state }),
      setModelLoadProgress: (progress) => set({ modelLoadProgress: progress }),
      setModelError: (error) => set({ modelError: error }),
      setDownloadedModelId: (id) => set({ downloadedModelId: id }),
      setSelectedModelId: (id) => set({ selectedModelId: id }),
      setApiKey: (key) => set({ apiKey: key }),
      setApiModel: (model) => set({ apiModel: model }),
      setApiEndpoint: (endpoint) => set({ apiEndpoint: endpoint }),
      setVconsoleEnabled: (enabled) => set({ vconsoleEnabled: enabled }),
      resetModelState: () => set({
        modelState: 'not-downloaded',
        modelLoadProgress: 0,
        modelError: null,
      }),
      resetApiConfig: () => set({
        apiKey: null,
        apiModel: 'glm-4-flash',
        apiEndpoint: '',
      }),
    }),
    {
      name: 'settings-storage',
    }
  )
);
