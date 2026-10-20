import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  DataSourceEntry,
  defaultSources,
  validateSource,
} from "../utils/sourceConfig";
export type { DataSourceEntry, DataSourceKind } from "../utils/sourceConfig";
export type SyncKind = "banks" | "knowledge" | "summaries" | "chat" | "duty";
export type SyncFlags = Record<SyncKind, boolean>;
interface DataSourceState {
  sources: DataSourceEntry[];
  syncSourceId: string | null;
  url: string;
  token: string;
  space: string;
  sync: SyncFlags;
  lastSync: string;
  lastError: string;
  syncing: boolean;
  updatesEnabled: boolean;
  setUpdatesEnabled: (enabled: boolean) => void;
  saveSource: (entry: DataSourceEntry) => void;
  deleteSource: (id: string) => void;
  setSourceEnabled: (id: string, enabled: boolean) => void;
  moveSource: (id: string, direction: -1 | 1) => void;
  selectSyncSource: (id: string | null) => void;
  setSpace: (space: string) => void;
  configure: (url: string, token: string, space: string) => void;
  setSync: (kind: SyncKind, enabled: boolean) => void;
}
function selected(sources: DataSourceEntry[], id: string | null) {
  const entry = sources.find(
    (s) => s.id === id && s.enabled && s.kind === "service",
  );
  return {
    syncSourceId: entry?.id ?? null,
    url: entry?.url ?? "",
    token: entry?.token ?? "",
  };
}
export const useDataSourceStore = create<DataSourceState>()(
  persist(
    (set, get) => ({
      sources: defaultSources(),
      syncSourceId: null,
      url: "",
      token: "",
      space: crypto.randomUUID(),
      sync: { banks: false, knowledge: false, summaries: false, chat: false, duty: false },
      lastSync: "",
      lastError: "",
      syncing: false,
      updatesEnabled: true,
      setUpdatesEnabled: (updatesEnabled) => set({ updatesEnabled }),
      saveSource: (entry) => {
        const clean = validateSource(entry);
        set((state) => {
          const sources = state.sources.some((s) => s.id === clean.id)
            ? state.sources.map((s) => (s.id === clean.id ? clean : s))
            : [...state.sources, clean];
          return {
            sources,
            ...selected(sources, state.syncSourceId),
            lastError: "",
          };
        });
      },
      deleteSource: (id) =>
        set((state) => {
          const sources = state.sources.filter((s) => s.id !== id);
          return {
            sources,
            ...selected(sources, state.syncSourceId),
            lastError: "",
          };
        }),
      setSourceEnabled: (id, enabled) =>
        set((state) => {
          const sources = state.sources.map((s) =>
            s.id === id ? { ...s, enabled } : s,
          );
          return {
            sources,
            ...selected(sources, state.syncSourceId),
            lastError: "",
          };
        }),
      moveSource: (id, direction) =>
        set((state) => {
          const sources = [...state.sources];
          const i = sources.findIndex((s) => s.id === id),
            j = i + direction;
          if (i < 0 || j < 0 || j >= sources.length) return {};
          [sources[i], sources[j]] = [sources[j], sources[i]];
          return { sources };
        }),
      selectSyncSource: (id) =>
        set((state) => ({
          ...selected(state.sources, id),
          lastSync: "",
          lastError: "",
        })),
      setSpace: (space) => {
        if (!/^[a-zA-Z0-9_-]{1,100}$/.test(space))
          throw new Error("同步空间 ID 只能包含字母、数字、下划线和短横线");
        set({ space, lastSync: "", lastError: "" });
      },
      configure: (url, token, space) => {
        if (!url) {
          const active = get().syncSourceId;
          if (active) get().setSourceEnabled(active, false);
          get().selectSyncSource(null);
          get().setSpace(space);
          return;
        }
        const current = get();
        const id =
          current.sources.find((s) => s.kind === "service" && s.url === url)
            ?.id ??
          current.syncSourceId ??
          crypto.randomUUID();
        get().saveSource({
          id,
          name: "电脑服务",
          kind: "service",
          url,
          token,
          enabled: true,
        });
        get().selectSyncSource(id);
        get().setSpace(space);
      },
      setSync: (kind, enabled) =>
        set((state) => ({ sync: { ...state.sync, [kind]: enabled } })),
    }),
    {
      name: "data-source-settings",
      version: 1,
      migrate: (saved) => saved as DataSourceState,
      partialize: (state) => ({
        sources: state.sources,
        syncSourceId: state.syncSourceId,
        space: state.space,
        sync: state.sync,
        lastSync: state.lastSync,
        updatesEnabled: state.updatesEnabled,
      }),
      merge: (saved, current) => {
        const state = (saved ?? {}) as Partial<DataSourceState>;
        const sources = Array.isArray(state.sources)
          ? state.sources.filter(
              (s) =>
                s &&
                typeof s.id === "string" &&
                ["gitee", "github", "service"].includes(s.kind) &&
                typeof s.url === "string",
            )
          : [...defaultSources()];
        let id = state.syncSourceId ?? null;
        if (!Array.isArray(state.sources) && state.url) {
          id = "legacy-service";
          sources.push({
            id,
            name: "电脑服务",
            kind: "service",
            url: state.url,
            token: state.token ?? "",
            enabled: true,
          });
        }
        return {
          ...current,
          ...state,
          syncing: false,
          lastError: "",
          updatesEnabled: typeof state.updatesEnabled === "boolean" ? state.updatesEnabled : true,
          sources,
          ...selected(sources, id),
          sync: { ...current.sync, ...state.sync },
        };
      },
    },
  ),
);
export function enabledSources(): DataSourceEntry[] {
  return useDataSourceStore.getState().sources.filter((s) => s.enabled);
}
export function sourcesFingerprint(): string {
  return JSON.stringify(enabledSources());
}
export function updateSourcesFingerprint(): string {
  return JSON.stringify({ enabled: useDataSourceStore.getState().updatesEnabled, sources: enabledSources() });
}
