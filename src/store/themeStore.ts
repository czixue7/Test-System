import { create } from 'zustand';

export type Theme = 'light' | 'dark';

interface ThemeStore {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  initTheme: () => void;
}

const getSystemTheme = (): Theme => {
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return 'light';
};

const getStoredTheme = (): Theme | null => {
  if (typeof window !== 'undefined') {
    const stored = localStorage.getItem('theme-preference');
    if (stored === 'light' || stored === 'dark') {
      return stored;
    }
  }
  return null;
};

const applyTheme = (theme: Theme) => {
  if (typeof document !== 'undefined') {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }
};

export const useThemeStore = create<ThemeStore>((set) => ({
  theme: 'light',

  setTheme: (theme) => {
    localStorage.setItem('theme-preference', theme);
    applyTheme(theme);
    set({ theme });
  },

  initTheme: () => {
    const storedTheme = getStoredTheme();
    const theme = storedTheme || getSystemTheme();
    applyTheme(theme);
    set({ theme });

    if (typeof window !== 'undefined' && window.matchMedia) {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      const handleChange = (e: MediaQueryListEvent) => {
        if (!getStoredTheme()) {
          const newTheme = e.matches ? 'dark' : 'light';
          applyTheme(newTheme);
          set({ theme: newTheme });
        }
      };
      mediaQuery.addEventListener('change', handleChange);
    }
  },
}));
