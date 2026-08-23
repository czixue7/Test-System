import type { Store } from '@tauri-apps/plugin-store';

const isTauri = (): boolean => {
  return typeof window !== 'undefined' && '__TAURI__' in window;
};

let store: Store | null = null;
let storePromise: Promise<Store | null> | null = null;
let storeInitialized = false;

async function getStoreInstance(): Promise<Store | null> {
  if (store) return store;

  if (!storePromise) {
    storePromise = (async () => {
      try {
        const { Store: StoreClass } = await import('@tauri-apps/plugin-store');
        // 使用应用数据目录存储，确保移动端有写入权限
        store = await StoreClass.load('exam-store.json');
        storeInitialized = true;
        console.log('[tauriStore] Store initialized successfully');
        return store;
      } catch (error) {
        console.error('[tauriStore] Failed to initialize store:', error);
        storeInitialized = false;
        return null;
      }
    })();
  }

  return storePromise;
}

// 降级方案：使用 localStorage
function getLocalStorageKey(key: string): string {
  return `exam-store:${key}`;
}

// 检查是否在移动端的 WebView 环境中
const isMobileWebView = (): boolean => {
  if (typeof window === 'undefined') return false;
  const userAgent = window.navigator.userAgent.toLowerCase();
  return /android|iphone|ipad|ipod/.test(userAgent);
};

export async function getStoreValue<T>(key: string, defaultValue: T): Promise<T> {
  // 如果不是 Tauri 环境，使用 localStorage
  if (!isTauri()) {
    try {
      const item = localStorage.getItem(getLocalStorageKey(key));
      if (item !== null) {
        return JSON.parse(item) as T;
      }
    } catch (e) {
      console.error('[tauriStore] Failed to read from localStorage:', e);
    }
    return defaultValue;
  }

  // Tauri 环境：优先使用 store 插件
  try {
    const s = await getStoreInstance();
    if (s) {
      const value = await s.get<T>(key);
      if (value !== null && value !== undefined) {
        // 同时备份到 localStorage，防止 store 文件丢失
        try {
          localStorage.setItem(getLocalStorageKey(key), JSON.stringify(value));
        } catch (e) {
          // 忽略 localStorage 写入错误
        }
        return value;
      }
    }
  } catch (error) {
    console.error('[tauriStore] Failed to read from store:', error);
  }

  // 如果 store 读取失败，尝试从 localStorage 恢复
  try {
    const item = localStorage.getItem(getLocalStorageKey(key));
    if (item !== null) {
      console.log('[tauriStore] Recovered from localStorage');
      return JSON.parse(item) as T;
    }
  } catch (e) {
    // 忽略错误
  }

  return defaultValue;
}

export async function setStoreValue<T>(key: string, value: T): Promise<void> {
  // 始终保存到 localStorage 作为备份
  try {
    localStorage.setItem(getLocalStorageKey(key), JSON.stringify(value));
  } catch (e) {
    console.error('[tauriStore] Failed to save to localStorage:', e);
  }

  // 如果不是 Tauri 环境，只使用 localStorage
  if (!isTauri()) {
    return;
  }

  // Tauri 环境：同时保存到 store 插件
  try {
    const s = await getStoreInstance();
    if (s) {
      await s.set(key, value);
      await s.save();
      console.log('[tauriStore] Saved to store:', key);
    } else {
      console.warn('[tauriStore] Store not available, data only saved to localStorage');
    }
  } catch (error) {
    console.error('[tauriStore] Failed to save to store:', error);
    // 即使 store 保存失败，localStorage 已经保存了，所以不抛出错误
  }
}

export async function removeStoreValue(key: string): Promise<void> {
  // 从 localStorage 删除
  try {
    localStorage.removeItem(getLocalStorageKey(key));
  } catch (e) {
    console.error('[tauriStore] Failed to remove from localStorage:', e);
  }

  // 如果不是 Tauri 环境，只操作 localStorage
  if (!isTauri()) {
    return;
  }

  // Tauri 环境：同时从 store 删除
  try {
    const s = await getStoreInstance();
    if (s) {
      await s.delete(key);
      await s.save();
    }
  } catch (error) {
    console.error('[tauriStore] Failed to remove from store:', error);
  }
}

// 强制保存所有数据（在应用退出前调用）
export async function flushStore(): Promise<void> {
  if (!isTauri()) return;

  try {
    const s = await getStoreInstance();
    if (s) {
      await s.save();
      console.log('[tauriStore] Store flushed');
    }
  } catch (error) {
    console.error('[tauriStore] Failed to flush store:', error);
  }
}

// 检查 store 是否可用
export function isStoreAvailable(): boolean {
  return storeInitialized;
}
