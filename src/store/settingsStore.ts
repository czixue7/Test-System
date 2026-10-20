import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { GradingProvider } from '../types';
import { apiGradingService } from '../utils/apiGradingService';

export type GradingMode = 'fixed' | 'ai';

export interface AIProfile {
  id: string;
  name: string;
  apiKey: string;
  apiModel: string;
  apiEndpoint: string;
  apiProvider: string;
  apiPassword: string;
}

const emptyApi = { apiKey: null, apiModel: '', apiEndpoint: '', apiProvider: '', apiPassword: '' };
const profileApi = (profile?: AIProfile) => profile ? {
  apiKey: profile.apiKey, apiModel: profile.apiModel, apiEndpoint: profile.apiEndpoint,
  apiProvider: profile.apiProvider, apiPassword: profile.apiPassword,
} : emptyApi;

interface SettingsState {
  aiProfiles: AIProfile[];
  activeAIProfileId: string | null;
  saveAIProfile: (profile: Omit<AIProfile, 'id'>, id?: string) => string;
  activateAIProfile: (id: string) => void;
  deleteAIProfile: (id: string) => void;
  gradingMode: GradingMode;
  gradingProvider: GradingProvider;
  apiKey: string | null;
  apiModel: string;
  apiEndpoint: string;
  apiProvider: string;
  apiPassword: string;
  vconsoleEnabled: boolean;
  setGradingMode: (mode: GradingMode) => void;
  setGradingProvider: (provider: GradingProvider) => void;
  setApiKey: (key: string | null) => void;
  setApiModel: (model: string) => void;
  setApiEndpoint: (endpoint: string) => void;
  setApiProvider: (provider: string) => void;
  setApiPassword: (password: string) => void;
  setVconsoleEnabled: (enabled: boolean) => void;
  resetApiConfig: () => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      aiProfiles: [],
      activeAIProfileId: null,
      saveAIProfile: (data, id) => {
        const profileId = id || crypto.randomUUID();
        const profile = { ...data, id: profileId };
        set(state => {
          const exists = state.aiProfiles.some(p => p.id === profileId);
          const activate = !state.activeAIProfileId || state.activeAIProfileId === profileId;
          return {
            aiProfiles: exists ? state.aiProfiles.map(p => p.id === profileId ? profile : p) : [...state.aiProfiles, profile],
            ...(activate ? { activeAIProfileId: profileId, ...profileApi(profile) } : {}),
          };
        });
        return profileId;
      },
      activateAIProfile: id => set(state => {
        const profile = state.aiProfiles.find(p => p.id === id);
        return profile ? { activeAIProfileId: id, ...profileApi(profile) } : {};
      }),
      deleteAIProfile: id => set(state => {
        const aiProfiles = state.aiProfiles.filter(p => p.id !== id);
        return {
          aiProfiles,
          ...(state.activeAIProfileId === id ? { activeAIProfileId: aiProfiles[0]?.id ?? null, ...profileApi(aiProfiles[0]) } : {}),
        };
      }),
      gradingMode: 'fixed',
      gradingProvider: 'api',
      apiKey: null,
      apiModel: '',
      apiEndpoint: '',
      apiProvider: '',
      apiPassword: '',
      vconsoleEnabled: false,
      setGradingMode: (mode) => set({ gradingMode: mode }),
      setGradingProvider: (provider) => set({ gradingProvider: provider }),
      setApiKey: (key) => set({ apiKey: key }),
      setApiModel: (model) => set({ apiModel: model }),
      setApiEndpoint: (endpoint) => set({ apiEndpoint: endpoint }),
      setApiProvider: (provider) => set({ apiProvider: provider }),
      setApiPassword: (password) => set({ apiPassword: password }),
      setVconsoleEnabled: (enabled) => set({ vconsoleEnabled: enabled }),
      resetApiConfig: () => set({
        aiProfiles: [],
        activeAIProfileId: null,
        apiKey: null,
        apiModel: '',
        apiEndpoint: '',
        apiProvider: '',
        apiPassword: '',
      }),
    }),
    {
      name: 'settings-storage',
      merge: (persisted, current) => {
        const state = { ...current, ...(persisted as Partial<SettingsState>) };
        if (!state.aiProfiles.length && (state.apiKey || state.apiEndpoint || state.apiModel)) {
          const profile: AIProfile = {
            id: 'legacy-api', name: '原有配置', apiKey: state.apiKey || '', apiModel: state.apiModel,
            apiEndpoint: state.apiEndpoint, apiProvider: state.apiProvider, apiPassword: state.apiPassword,
          };
          return { ...state, aiProfiles: [profile], activeAIProfileId: profile.id };
        }
        const active = state.aiProfiles.find(p => p.id === state.activeAIProfileId) ?? state.aiProfiles[0];
        return { ...state, activeAIProfileId: active?.id ?? null, ...profileApi(active) };
      },
    }
  )
);

// Keep all AI entry points in sync immediately after switching or deleting a profile.
function syncAPIConfig(state: SettingsState) {
  if (state.apiKey && state.apiModel && state.apiEndpoint) {
    apiGradingService.setConfig({ apiKey: state.apiKey, model: state.apiModel, endpoint: state.apiEndpoint });
  } else {
    apiGradingService.clearConfig();
  }
}
syncAPIConfig(useSettingsStore.getState());
useSettingsStore.subscribe(syncAPIConfig);
