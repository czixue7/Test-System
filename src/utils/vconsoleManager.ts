import { startDebugCapture, stopDebugCapture, useDebugConsoleStore } from './debugConsole';
import { useSettingsStore } from '../store/settingsStore';

// 保留原设置入口，启用完整的应用内控制台。
export async function initVConsole(): Promise<void> {
  startDebugCapture();
}
export function destroyVConsole(): void { stopDebugCapture(); }
export function isVConsoleReady(): boolean { return useDebugConsoleStore.getState().enabled; }
export async function initVConsoleOnStartup(): Promise<void> {
  if (useSettingsStore.getState().vconsoleEnabled) startDebugCapture();
}
