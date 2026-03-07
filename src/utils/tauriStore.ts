import { Store } from '@tauri-apps/plugin-store';

let store: Store | null = null;

export async function getStore(): Promise<Store> {
  if (!store) {
    store = await Store.load('exam-store.json');
  }
  return store;
}

export async function getStoreValue<T>(key: string, defaultValue: T): Promise<T> {
  try {
    const store = await getStore();
    const value = await store.get<T>(key);
    return value ?? defaultValue;
  } catch {
    return defaultValue;
  }
}

export async function setStoreValue<T>(key: string, value: T): Promise<void> {
  try {
    const store = await getStore();
    await store.set(key, value);
    await store.save();
  } catch (error) {
    console.error('Failed to save to store:', error);
  }
}

export async function removeStoreValue(key: string): Promise<void> {
  try {
    const store = await getStore();
    await store.delete(key);
    await store.save();
  } catch (error) {
    console.error('Failed to remove from store:', error);
  }
}
