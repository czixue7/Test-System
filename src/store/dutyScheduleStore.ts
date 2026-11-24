import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { DutySchedule, DutyShift, DutyShiftType, JsonDutyScheduleData, SharedDutySnapshot, SharedDutyState } from '../types';
import { getStoreValue, setStoreValue } from '../utils/tauriStore';
import { initialSharedAnnotations, queueSharedAnnotations, sharedDutyReference } from '../utils/sharedDutyAnnotations';

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

// 将字符串班次类型规范化为 DutyShiftType
export function normalizeShiftType(raw?: string): DutyShiftType {
  if (!raw) return 'allday';
  const s = raw.toLowerCase().trim();
  if (s === 'morning' || s === '早班' || s === '早') return 'morning';
  if (s === 'noon' || s === '中班' || s === '中') return 'noon';
  if (s === 'night' || s === '晚班' || s === '晚' || s === '夜班' || s === '夜') return 'night';
  return 'allday';
}

// 把原始 JSON 数据转换成带 id 的 DutyShift 数组
export function buildShifts(raw: JsonDutyScheduleData): DutyShift[] {
  return (raw.shifts || []).map((s) => ({
    id: generateId(),
    date: s.date,
    shiftType: normalizeShiftType(s.shiftType),
    startTime: s.startTime,
    endTime: s.endTime,
    tasks: Array.isArray(s.tasks) ? s.tasks : (s.tasks ? [String(s.tasks)] : []),
    personInCharge: s.personInCharge,
    notes: s.notes,
    group: s.group
  }));
}

interface DutyScheduleState {
  duties: DutySchedule[];
  isLoaded: boolean;
  loadDuties: () => Promise<void>;
  importDuty: (duty: Omit<DutySchedule, 'id' | 'createdAt' | 'updatedAt'>) => string;
  importDutyWithSha: (
    duty: Omit<DutySchedule, 'id' | 'createdAt' | 'updatedAt'>,
    sha: string,
    filename: string
  ) => string;
  updateDuty: (id: string, updates: Partial<DutySchedule>, basis?: DutySchedule) => void;
  receiveSharedDuty: (id: string, filename: string, snapshot: SharedDutySnapshot, batch?: { id: string; conflict: boolean }) => void;
  setSharedDutyError: (id: string, filename: string, error: string) => void;
  resolveSharedDutyConflict: (id: string, keepLocal: boolean) => void;
  /** 应用发布源的新版本：保存新数据，并以发布版本作为后续标注比对基准 */
  applyRemoteDuty: (
    id: string,
    updates: Partial<DutySchedule>,
    sha: string,
    published: Pick<DutySchedule, 'drills' | 'roles'>
  ) => void;
  deleteDuty: (id: string) => void;
  getDuty: (id: string) => DutySchedule | undefined;
}

const DUTY_STORAGE_KEY = 'duty-schedules';

const saveDuties = async (duties: DutySchedule[]) => {
  await setStoreValue(DUTY_STORAGE_KEY, duties);
};

export const useDutyScheduleStore = create<DutyScheduleState>()(
  persist(
    (set, get) => ({
      duties: [],
      isLoaded: false,

      loadDuties: async () => {
        // 已由 zustand persist 从 localStorage 恢复的值班表
        const existingDuties = get().duties;
        const loadedDuties = await getStoreValue<DutySchedule[]>(DUTY_STORAGE_KEY, []);

        // 合并：以 tauriStore 中的数据为主
        const map = new Map<string, DutySchedule>();
        for (const d of existingDuties) map.set(d.id, d);
        for (const d of loadedDuties) map.set(d.id, d);

        const merged = Array.from(map.values());
        // 若 tauriStore 为空但 localStorage 有数据，则回写
        if (loadedDuties.length === 0 && existingDuties.length > 0) {
          await saveDuties([...existingDuties]);
        }
        set({ duties: merged, isLoaded: true });
      },

      importDuty: (dutyData) => {
        const id = generateId();
        const now = new Date().toISOString();
        const newDuty: DutySchedule = {
          ...dutyData,
          sourceDrills: dutyData.drills ?? [],
          sourceRoles: dutyData.roles ?? [],
          id,
          createdAt: now,
          updatedAt: now
        };
        set((state) => {
          const newDuties = [...state.duties, newDuty];
          saveDuties(newDuties);
          return { duties: newDuties };
        });
        return id;
      },

      importDutyWithSha: (dutyData, sha, filename) => {
        const id = generateId();
        const now = new Date().toISOString();
        const newDuty: DutySchedule = {
          ...dutyData,
          id,
          sourceSha: sha,
          sourceFilename: filename,
          sourceDrills: dutyData.drills,
          sourceRoles: dutyData.roles,
          createdAt: now,
          updatedAt: now
        };
        set((state) => {
          const newDuties = [...state.duties, newDuty];
          saveDuties(newDuties);
          return { duties: newDuties };
        });
        return id;
      },

      updateDuty: (id, updates, basis) => {
        set((state) => {
          const newDuties = state.duties.map((d) => {
            if (d.id !== id) return d;
            if (sharedDutyReference(d.sourceFilename) && ['drills', 'roles', 'shifts'].some(key => key in updates)) {
              const shared = d.sharedAnnotations ?? initialSharedAnnotations(d);
              const next = queueSharedAnnotations(d, updates, shared, basis);
              const { drills: _drills, roles: _roles, shifts: _shifts, ...metadata } = updates;
              return next === d.sharedAnnotations && !Object.keys(metadata).length ? d
                : { ...d, ...metadata, sharedAnnotations: next, updatedAt: new Date().toISOString() };
            }
            return { ...d, ...updates, locallyEdited: true, updatedAt: new Date().toISOString() };
          });
          saveDuties(newDuties);
          return { duties: newDuties };
        });
      },

      receiveSharedDuty: (id, filename, snapshot, batch) => {
        updateShared(id, filename, (d, current) => {
          const shared = current ?? initialSharedAnnotations(d);
          const nextSnapshot = !shared.snapshot || snapshot.revision > shared.snapshot.revision ? snapshot : shared.snapshot;
          const finished = batch && shared.pending[0]?.id === batch.id;
          const pending = finished && !batch.conflict ? shared.pending.slice(1) : shared.pending;
          const conflict = finished ? batch.conflict : shared.conflict;
          if (current && nextSnapshot === shared.snapshot && pending === shared.pending && conflict === shared.conflict && !shared.error) return current;
          return { snapshot: nextSnapshot, pending, conflict };
        });
      },

      setSharedDutyError: (id, filename, error) => {
        updateShared(id, filename, (_d, shared) => {
          if (shared?.error === error) return shared;
          // Keep any offline edits even when the endpoint cannot be reached yet.
          return { ...(shared ?? { pending: [] }), error };
        });
      },

      resolveSharedDutyConflict: (id, keepLocal) => {
        const duty = get().getDuty(id);
        if (!duty?.sourceFilename) return;
        updateShared(id, duty.sourceFilename, (_d, shared) => {
          if (!shared?.conflict || !shared.snapshot || !shared.pending[0]) return shared;
          const [first, ...remaining] = shared.pending;
          const expected = (key: string) => shared.snapshot!.entries[key]?.version ?? null;
          const pending = keepLocal ? [{ ...first, changes: Object.fromEntries(
            Object.entries(first.changes).map(([key, change]) => [key, { ...change, expected: expected(key) }]),
          ) }, ...remaining] : remaining;
          return { ...shared, pending, conflict: false, error: undefined };
        });
      },

      applyRemoteDuty: (id, updates, sha, published) => {
        set((state) => {
          const newDuties = state.duties.map((d) =>
            d.id === id
              ? {
                  ...d,
                  ...updates,
                  sourceSha: sha,
                  sourceDrills: published.drills,
                  sourceRoles: published.roles,
                  updatedAt: new Date().toISOString()
                }
              : d
          );
          saveDuties(newDuties);
          return { duties: newDuties };
        });
      },

      deleteDuty: (id) => {
        set((state) => {
          const newDuties = state.duties.filter((d) => d.id !== id);
          saveDuties(newDuties);
          return { duties: newDuties };
        });
      },

      getDuty: (id) => get().duties.find((d) => d.id === id)
    }),
    {
      name: DUTY_STORAGE_KEY,
      storage: createJSONStorage(() => localStorage)
    }
  )
);

function updateShared(
  id: string,
  filename: string,
  update: (duty: DutySchedule, state?: SharedDutyState) => SharedDutyState | undefined,
) {
  const state = useDutyScheduleStore.getState();
  const duty = state.getDuty(id);
  if (!duty || duty.sourceFilename !== filename) return;
  const shared = update(duty, duty.sharedAnnotations ?? initialSharedAnnotations(duty));
  if (!shared || shared === duty.sharedAnnotations) return;
  const duties = state.duties.map(item => item.id === id ? { ...item, sharedAnnotations: shared } : item);
  useDutyScheduleStore.setState({ duties });
  void saveDuties(duties);
}
