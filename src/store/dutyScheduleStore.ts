import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { DutySchedule, DutyShift, DutyShiftType, JsonDutyScheduleData } from '../types';
import { getStoreValue, setStoreValue } from '../utils/tauriStore';

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
  updateDuty: (id: string, updates: Partial<DutySchedule>) => void;
  updateDutyWithSha: (
    id: string,
    updates: Partial<DutySchedule>,
    sha: string
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

      updateDuty: (id, updates) => {
        set((state) => {
          const newDuties = state.duties.map((d) =>
            d.id === id ? { ...d, ...updates, updatedAt: new Date().toISOString() } : d
          );
          saveDuties(newDuties);
          return { duties: newDuties };
        });
      },

      updateDutyWithSha: (id, updates, sha) => {
        set((state) => {
          const newDuties = state.duties.map((d) =>
            d.id === id
              ? { ...d, ...updates, sourceSha: sha, updatedAt: new Date().toISOString() }
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
