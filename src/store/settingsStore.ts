import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { GradingProvider } from '../types';

export type GradingMode = 'fixed' | 'ai';

interface SettingsState {
  gradingMode: GradingMode;
  gradingProvider: GradingProvider;
  apiKey: string | null;
  apiModel: string;
  apiProvider: string;
  apiPassword: string;
  vconsoleEnabled: boolean;
  setGradingMode: (mode: GradingMode) => void;
  setGradingProvider: (provider: GradingProvider) => void;
  setApiKey: (key: string | null) => void;
  setApiModel: (model: string) => void;
  setApiProvider: (provider: string) => void;
  setApiPassword: (password: string) => void;
  setVconsoleEnabled: (enabled: boolean) => void;
  resetApiConfig: () => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      gradingMode: 'fixed',
      gradingProvider: 'api',
      apiKey: null,
      apiModel: '',
      apiProvider: '',
      apiPassword: '',
      vconsoleEnabled: false,
      setGradingMode: (mode) => set({ gradingMode: mode }),
      setGradingProvider: (provider) => set({ gradingProvider: provider }),
      setApiKey: (key) => set({ apiKey: key }),
      setApiModel: (model) => set({ apiModel: model }),
      setApiProvider: (provider) => set({ apiProvider: provider }),
      setApiPassword: (password) => set({ apiPassword: password }),
      setVconsoleEnabled: (enabled) => set({ vconsoleEnabled: enabled }),
      resetApiConfig: () => set({
        apiKey: null,
        apiModel: '',
        apiProvider: '',
        apiPassword: '',
      }),
    }),
    {
      name: 'settings-storage',
    }
  )
);
