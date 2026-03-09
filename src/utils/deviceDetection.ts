import { invoke } from '@tauri-apps/api/core';

export interface DeviceInfo {
  isMobile: boolean;
  isAndroid: boolean;
  isIOS: boolean;
  isTauri: boolean;
  memory: number;
  isLowMemory: boolean;
  hasWebGPU: boolean;
  webGPUError?: string;
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

async function detectWebGPU(): Promise<{ supported: boolean; error?: string }> {
  // 检查基本支持
  if (!('gpu' in navigator)) {
    return { supported: false, error: '浏览器不支持 WebGPU API' };
  }

  try {
    const gpu = (navigator as Navigator & { gpu: GPU }).gpu;
    
    // 尝试请求适配器
    const adapter = await gpu.requestAdapter();
    if (!adapter) {
      return { supported: false, error: '无法获取 WebGPU 适配器，GPU 可能被禁用或不支持' };
    }

    // 尝试创建设备 - 这是一些手机会失败的地方
    const device = await adapter.requestDevice();
    if (!device) {
      return { supported: false, error: '无法创建 WebGPU 设备，驱动程序可能不兼容' };
    }

    // 测试基本操作 - 创建缓冲区
    try {
      const testBuffer = device.createBuffer({
        size: 16,
        usage: GPUBufferUsage.UNIFORM,
      });
      testBuffer.destroy();
    } catch (bufferError) {
      device.destroy();
      return { supported: false, error: 'WebGPU 缓冲区操作失败，设备可能不完全兼容' };
    }

    // 清理
    device.destroy();
    
    return { supported: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : '未知错误';
    
    // 检测特定的 WebGPU 错误
    if (errorMessage.includes('not captured') || errorMessage.includes('internal')) {
      return { supported: false, error: 'WebGPU 内部错误，此设备可能存在兼容性问题' };
    }
    
    return { supported: false, error: `WebGPU 检测失败: ${errorMessage}` };
  }
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
  const webGPUCheck = await detectWebGPU();

  cachedDeviceInfo = {
    isMobile,
    isAndroid,
    isIOS,
    isTauri,
    memory,
    isLowMemory,
    hasWebGPU: webGPUCheck.supported,
    webGPUError: webGPUCheck.error,
  };

  return cachedDeviceInfo;
}

export function getRecommendedModel(deviceInfo: DeviceInfo): string | null {
  if (deviceInfo.isLowMemory) {
    return 'bge-small-zh-v1.5';
  }
  
  if (!deviceInfo.hasWebGPU) {
    return 'bge-small-zh-v1.5';
  }
  
  if (deviceInfo.memory >= 4 && deviceInfo.memory < 8) {
    return 'qwen3.5-0.8b-q4';
  }
  
  return 'qwen3.5-0.8b-q4';
}

export function getDeviceWarnings(deviceInfo: DeviceInfo): string[] {
  const warnings: string[] = [];

  if (deviceInfo.isLowMemory) {
    warnings.push(`设备内存较低 (${deviceInfo.memory}GB)，建议使用较小的模型以避免性能问题`);
  }

  if (!deviceInfo.hasWebGPU) {
    const errorDetail = deviceInfo.webGPUError ? ` (${deviceInfo.webGPUError})` : '';
    warnings.push(`您的浏览器不支持 WebGPU${errorDetail}。AI 模型推理可能较慢或无法运行，请使用支持 WebGPU 的浏览器或更换设备。`);
  }

  if (deviceInfo.isMobile && !deviceInfo.isTauri) {
    warnings.push('您正在使用移动端浏览器，建议安装 Tauri 应用以获得更好的性能体验');
  }

  if (deviceInfo.isIOS && deviceInfo.isTauri) {
    warnings.push('iOS 设备上的 WebGPU 支持有限，部分模型可能无法正常运行');
  }

  if (deviceInfo.memory < 2) {
    warnings.push('设备内存严重不足，AI 功能可能无法正常使用');
  }

  return warnings;
}

export function clearDeviceCache(): void {
  cachedDeviceInfo = null;
}
