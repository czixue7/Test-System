import { invoke } from '@tauri-apps/api/core';

export interface DeviceInfo {
  isMobile: boolean;
  isAndroid: boolean;
  isIOS: boolean;
  isTauri: boolean;
  memory: number;
  isLowMemory: boolean;
}

let cachedDeviceInfo: DeviceInfo | null = null;

async function detectTauri(): Promise<boolean> {
  try {
    await invoke('plugin:os|platform');
    return true;
  } catch {
    return false;
  }
}

function detectMobile(userAgent: string): boolean {
  return /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(userAgent);
}

function detectAndroid(userAgent: string): boolean {
  return /android/i.test(userAgent);
}

function detectIOS(userAgent: string): boolean {
  return /iphone|ipad|ipod/i.test(userAgent);
}

function detectMemory(): number {
  const deviceMemory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  if (deviceMemory !== undefined) {
    return deviceMemory;
  }
  return 8;
}

export async function getDeviceInfo(): Promise<DeviceInfo> {
  if (cachedDeviceInfo) {
    return cachedDeviceInfo;
  }

  const userAgent = navigator.userAgent;
  const isTauri = await detectTauri();
  const isAndroid = detectAndroid(userAgent);
  const isIOS = detectIOS(userAgent);
  const isMobile = detectMobile(userAgent);
  const memory = detectMemory();
  const isLowMemory = memory < 4;

  cachedDeviceInfo = {
    isMobile,
    isAndroid,
    isIOS,
    isTauri,
    memory,
    isLowMemory,
  };

  return cachedDeviceInfo;
}


