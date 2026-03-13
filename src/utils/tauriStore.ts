import type { Store } from '@tauri-apps/plugin-store';

const isTauri = (): boolean => {
  return typeof window !== 'undefined' && '__TAURI__' in window;
};

let store: Store | null = null;
let storePromise: Promise<Store> | null = null;

async function getStoreInstance(): Promise<Store> {
  if (store) return store;
  
  if (!storePromise) {
    storePromise = (async () => {
      const { Store: StoreClass } = await import('@tauri-apps/plugin-store');
      store = await StoreClass.load('exam-store.json');
      return store;
    })();
  }
  
  return storePromise;
}

export async function getStoreValue<T>(key: string, defaultValue: T): Promise<T> {
  if (!isTauri()) {
    return defaultValue;
  }
  
  try {
    const s = await getStoreInstance();
    const value = await s.get<T>(key);
    return value ?? defaultValue;
  } catch {
    return defaultValue;
  }
}

export async function setStoreValue<T>(key: string, value: T): Promise<void> {
  if (!isTauri()) {
    return;
  }
  
  try {
    const s = await getStoreInstance();
    await s.set(key, value);
    await s.save();
  } catch (error) {
    console.error('Failed to save to store:', error);
  }
}

export async function removeStoreValue(key: string): Promise<void> {
  if (!isTauri()) {
    return;
  }
  
  try {
    const s = await getStoreInstance();
    await s.delete(key);
    await s.save();
  } catch (error) {
    console.error('Failed to remove from store:', error);
  }
}
