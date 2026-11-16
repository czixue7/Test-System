import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { GradingProvider } from '../types';
import { apiGradingService } from '../utils/apiGradingService';
import { APIProfile, APIConfigDocument, emptyAPIConfig, editAPIConfig, mergeAPIConfig, profilesFromAPIConfig, apiConcurrency } from '../../shared/apiConfigSync';

export type GradingMode = 'fixed' | 'ai';

export type AIProfile = APIProfile;

/** 每轮出题数量的允许区间 */
export const QUESTIONS_PER_ROUND_MIN = 1;
export const QUESTIONS_PER_ROUND_MAX = 200;
export const DEFAULT_QUESTIONS_PER_ROUND = 20;

/** 把任意输入收敛成合法的每轮题量 */
export const normalizeQuestionsPerRound = (value: number): number => {
  if (!Number.isFinite(value)) return DEFAULT_QUESTIONS_PER_ROUND;
  return Math.min(QUESTIONS_PER_ROUND_MAX, Math.max(QUESTIONS_PER_ROUND_MIN, Math.floor(value)));
};

const emptyApi = { apiKey: null, apiModel: '', apiEndpoint: '', apiProvider: '', apiPassword: '', apiConcurrency: 2 };
const profileApi = (profile?: AIProfile) => profile ? {
  apiKey: profile.apiKey, apiModel: profile.apiModel, apiEndpoint: profile.apiEndpoint,
  apiProvider: profile.apiProvider, apiPassword: profile.apiPassword,
  apiConcurrency: apiConcurrency(profile.concurrency),
} : emptyApi;

interface SettingsState {
  aiProfiles: AIProfile[];
  apiSyncDocument: APIConfigDocument;
  applySyncedAPIConfig: (doc: APIConfigDocument) => void;
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
  apiConcurrency: number;
  vconsoleEnabled: boolean;
  // ===== 练题出题设置（顺序练题 / 模拟考试共用） =====
  questionsPerRound: number;
  avoidRepeatQuestions: boolean;
  // 题库 id -> 已做过的题目 id；开启「避免重复做题」时用于过滤
  doneQuestionIds: Record<string, string[]>;
  setQuestionsPerRound: (count: number) => void;
  setAvoidRepeatQuestions: (avoid: boolean) => void;
  markQuestionsDone: (bankId: string, questionIds: string[]) => void;
  resetDoneQuestions: (bankId?: string) => void;
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
      apiSyncDocument: emptyAPIConfig(),
      applySyncedAPIConfig: doc => set(state => {
        const apiSyncDocument = mergeAPIConfig(state.apiSyncDocument, doc);
        const aiProfiles = profilesFromAPIConfig(apiSyncDocument);
        const active = aiProfiles.find(profile => profile.id === state.activeAIProfileId) ?? aiProfiles[0];
        return { apiSyncDocument, aiProfiles, activeAIProfileId: active?.id ?? null, ...profileApi(active) };
      }),
      activeAIProfileId: null,
      saveAIProfile: (data, id) => {
        const profileId = id || crypto.randomUUID();
        const profile = { ...data, concurrency: apiConcurrency(data.concurrency), id: profileId };
        set(state => {
          const exists = state.aiProfiles.some(p => p.id === profileId);
          const activate = !state.activeAIProfileId || state.activeAIProfileId === profileId;
          const aiProfiles = exists ? state.aiProfiles.map(p => p.id === profileId ? profile : p) : [...state.aiProfiles, profile];
          return {
            aiProfiles,
            apiSyncDocument: editAPIConfig(state.apiSyncDocument, aiProfiles),
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
          apiSyncDocument: editAPIConfig(state.apiSyncDocument, aiProfiles),
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
      apiConcurrency: 2,
      vconsoleEnabled: false,
      questionsPerRound: DEFAULT_QUESTIONS_PER_ROUND,
      avoidRepeatQuestions: true,
      doneQuestionIds: {},
      setQuestionsPerRound: (count) => set({ questionsPerRound: normalizeQuestionsPerRound(count) }),
      setAvoidRepeatQuestions: (avoid) => set({ avoidRepeatQuestions: avoid }),
      markQuestionsDone: (bankId, questionIds) => set(state => {
        if (!bankId || questionIds.length === 0) return {};
        const current = state.doneQuestionIds[bankId] ?? [];
        const merged = Array.from(new Set([...current, ...questionIds]));
        if (merged.length === current.length) return {};
        return { doneQuestionIds: { ...state.doneQuestionIds, [bankId]: merged } };
      }),
      resetDoneQuestions: (bankId) => set(state => {
        if (!bankId) return { doneQuestionIds: {} };
        const next = { ...state.doneQuestionIds };
        delete next[bankId];
        return { doneQuestionIds: next };
      }),
      setGradingMode: (mode) => set({ gradingMode: mode }),
      setGradingProvider: (provider) => set({ gradingProvider: provider }),
      setApiKey: (key) => set({ apiKey: key }),
      setApiModel: (model) => set({ apiModel: model }),
      setApiEndpoint: (endpoint) => set({ apiEndpoint: endpoint }),
      setApiProvider: (provider) => set({ apiProvider: provider }),
      setApiPassword: (password) => set({ apiPassword: password }),
      setVconsoleEnabled: (enabled) => set({ vconsoleEnabled: enabled }),
      resetApiConfig: () => set(state => ({
        aiProfiles: [],
        apiSyncDocument: editAPIConfig(state.apiSyncDocument, []),
        activeAIProfileId: null,
        apiKey: null,
        apiModel: '',
        apiEndpoint: '',
        apiProvider: '',
        apiPassword: '',
        apiConcurrency: 2,
      })),
    }),
    {
      name: 'settings-storage',
      merge: (persisted, current) => {
        const state = { ...current, ...(persisted as Partial<SettingsState>) };
        // 旧版本存档没有练题设置：缺失/损坏时回落到默认值
        state.questionsPerRound = normalizeQuestionsPerRound(state.questionsPerRound);
        if (!state.doneQuestionIds || typeof state.doneQuestionIds !== 'object') {
          state.doneQuestionIds = {};
        }
        if (!state.aiProfiles.length && (state.apiKey || state.apiEndpoint || state.apiModel)) {
          const profile: AIProfile = {
            id: 'legacy-api', name: '原有配置', apiKey: state.apiKey || '', apiModel: state.apiModel,
            apiEndpoint: state.apiEndpoint, apiProvider: state.apiProvider, apiPassword: state.apiPassword, concurrency: apiConcurrency(state.apiConcurrency),
          };
          return { ...state, ...profileApi(profile), aiProfiles: [profile], activeAIProfileId: profile.id, apiSyncDocument: editAPIConfig(state.apiSyncDocument, [profile]) };
        }
        state.aiProfiles = state.aiProfiles.map(profile => ({ ...profile, concurrency: apiConcurrency(profile.concurrency) }));
        const active = state.aiProfiles.find(p => p.id === state.activeAIProfileId) ?? state.aiProfiles[0];
        return { ...state, apiSyncDocument: editAPIConfig(state.apiSyncDocument, state.aiProfiles), activeAIProfileId: active?.id ?? null, ...profileApi(active) };
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
