import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { NoteConvertSettings, DEFAULT_NOTE_CONVERT } from '../utils/noteConverter';

interface NoteStoreState {
  /** "帮我记"转换设置 */
  convertSettings: NoteConvertSettings;
  /** 上次使用的分类（便于下次快速选择） */
  lastCategory: string;
  setConvertSettings: (settings: NoteConvertSettings) => void;
  setLastCategory: (category: string) => void;
}

export const useNoteStore = create<NoteStoreState>()(
  persist(
    (set) => ({
      convertSettings: { ...DEFAULT_NOTE_CONVERT },
      lastCategory: '',
      setConvertSettings: (settings) => set({ convertSettings: settings }),
      setLastCategory: (category) => set({ lastCategory: category }),
    }),
    {
      name: 'note-store',
    }
  )
);
