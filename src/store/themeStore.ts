import { create } from 'zustand';

export type ThemeStyle = 'classic' | 'immersive';
export type Theme = 'light' | 'dark' | 'system';

interface ThemeStore {
  themeStyle: ThemeStyle;
  theme: Theme;
  setThemeStyle: (style: ThemeStyle) => void;
  setTheme: (theme: Theme) => void;
  initTheme: () => void;
}

const getSystemDark = (): boolean => {
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  }
  return false;
};

const getStoredTheme = (): Theme | null => {
  if (typeof window !== 'undefined') {
    const stored = localStorage.getItem('theme-preference');
    if (stored === 'light' || stored === 'dark' || stored === 'system') {
      return stored;
    }
  }
  return null;
};

const getStoredThemeStyle = (): ThemeStyle | null => {
  if (typeof window !== 'undefined') {
    const stored = localStorage.getItem('theme-style');
    if (stored === 'classic' || stored === 'immersive') {
      return stored;
    }
  }
  return null;
};

const applyTheme = (style: ThemeStyle, theme: Theme) => {
  if (typeof document !== 'undefined') {
    const root = document.documentElement;
    root.setAttribute('data-theme', style);
    const isDark = theme === 'dark' || (theme === 'system' && getSystemDark());
    root.classList.toggle('dark', isDark);
  }
};

let mediaQuery: MediaQueryList | null = null;
let mediaListener: ((e: MediaQueryListEvent) => void) | null = null;

export const useThemeStore = create<ThemeStore>((set, get) => ({
  // 默认：沉浸式布局主题 + 自适应系统深浅色
  themeStyle: 'immersive',
  theme: 'system',

  setThemeStyle: (style) => {
    localStorage.setItem('theme-style', style);
    applyTheme(style, get().theme);
    set({ themeStyle: style });
  },

  setTheme: (theme) => {
    localStorage.setItem('theme-preference', theme);
    applyTheme(get().themeStyle, theme);
    set({ theme });
  },

  initTheme: () => {
    const style = getStoredThemeStyle() || 'immersive';
    const storedTheme = getStoredTheme();
    const theme: Theme = storedTheme || 'system';
    applyTheme(style, theme);
    set({ themeStyle: style, theme });

    // 监听系统深浅色变化（仅跟随系统模式时生效）
    if (typeof window !== 'undefined' && window.matchMedia) {
      if (mediaQuery && mediaListener) {
        mediaQuery.removeEventListener('change', mediaListener);
      }
      mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      mediaListener = (e: MediaQueryListEvent) => {
        if (get().theme === 'system') {
          document.documentElement.classList.toggle('dark', e.matches);
        }
      };
      mediaQuery.addEventListener('change', mediaListener);
    }
  },
}));
