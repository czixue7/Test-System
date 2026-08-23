import { useState, useEffect, useCallback } from 'react';

export interface SafeAreaInsets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

// 设备类型判断
const isMobileDevice = (): boolean => {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  return /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(ua);
};

const isIOS = (): boolean => {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  return /iphone|ipad|ipod/i.test(ua);
};

const isAndroid = (): boolean => {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  return /android/i.test(ua);
};

const getDPR = (): number => {
  if (typeof window === 'undefined') return 1;
  return window.devicePixelRatio || 1;
};

// 从 CSS env() 读取安全区域（最准确，iOS 和部分 Android 支持）
const readFromCSSEnv = (): SafeAreaInsets | null => {
  if (typeof window === 'undefined' || !window.getComputedStyle) return null;
  
  const computedStyle = window.getComputedStyle(document.documentElement);
  
  const parsePx = (value: string): number => {
    if (!value || value === '0px' || value === '0') return 0;
    // 处理 env(safe-area-inset-*) 返回的空值或无效值
    const num = parseFloat(value);
    if (isNaN(num)) return 0;
    // 过滤掉明显不合理的值（比如完整字符串没有被解析）
    if (num <= 0) return 0;
    return num;
  };

  const top = parsePx(computedStyle.getPropertyValue('--safe-area-inset-top'));
  const bottom = parsePx(computedStyle.getPropertyValue('--safe-area-inset-bottom'));
  const left = parsePx(computedStyle.getPropertyValue('--safe-area-inset-left'));
  const right = parsePx(computedStyle.getPropertyValue('--safe-area-inset-right'));

  // 如果四个值都是 0，可能是 CSS env 不支持或未正确设置
  if (top === 0 && bottom === 0 && left === 0 && right === 0) {
    // 尝试直接从 CSS 环境变量读取
    const directTop = parsePx(computedStyle.getPropertyValue('env(safe-area-inset-top)'));
    if (directTop > 0) {
      return {
        top: directTop,
        bottom: parsePx(computedStyle.getPropertyValue('env(safe-area-inset-bottom)')),
        left: parsePx(computedStyle.getPropertyValue('env(safe-area-inset-left)')),
        right: parsePx(computedStyle.getPropertyValue('env(safe-area-inset-right)')),
      };
    }
    return null; // 表示 CSS env 不可用
  }

  return { top, bottom, left, right };
};

// 通过 window.screen 与 window.innerHeight/innerWidth 的差值估算
const estimateFromScreenDiff = (): SafeAreaInsets | null => {
  if (typeof window === 'undefined' || typeof document === 'undefined') return null;
  
  const screenHeight = window.screen?.height || 0;
  const screenWidth = window.screen?.width || 0;
  const innerHeight = window.innerHeight || 0;
  const innerWidth = window.innerWidth || 0;
  
  if (screenHeight === 0 || innerHeight === 0) return null;
  
  const dpr = getDPR();
  const isLandscape = innerWidth > innerHeight;
  
  // 将 screen 尺寸转换为 CSS 像素（screen.height 通常是物理像素，
  // 但在移动端浏览器中有时已经是 CSS 像素，这里做保守估计）
  // 实际上 window.screen.height 在大多数浏览器中返回的是 CSS 像素
  let availableHeight = screenHeight;
  let availableWidth = screenWidth;
  
  // 如果 screen 尺寸明显大于 inner 尺寸 * DPR，可能是物理像素
  if (screenHeight > innerHeight * dpr * 1.5) {
    availableHeight = screenHeight / dpr;
    availableWidth = screenWidth / dpr;
  }
  
  const heightDiff = Math.max(0, availableHeight - innerHeight);
  const widthDiff = Math.max(0, availableWidth - innerWidth);
  
  // 差值太小可能是因为浏览器工具栏，不是系统栏
  if (heightDiff < 20 && widthDiff < 20) return null;
  
  // 竖屏时：顶部是状态栏，底部可能是导航栏
  if (!isLandscape) {
    // 估算状态栏高度（顶部）
    const estimatedTop = Math.min(heightDiff * 0.3, 50); // 最多 50px
    // 剩余的归到底部（导航栏）
    const estimatedBottom = heightDiff - estimatedTop;
    
    return {
      top: estimatedTop,
      bottom: Math.max(0, estimatedBottom),
      left: 0,
      right: 0,
    };
  } else {
    // 横屏时：左右可能有安全区域（挖孔/刘海）
    const estimatedSide = Math.min(widthDiff * 0.5, 50);
    return {
      top: 0,
      bottom: heightDiff > 20 ? Math.min(heightDiff, 40) : 0,
      left: estimatedSide,
      right: estimatedSide,
    };
  }
};

// 基于 Android 设计规范的默认值（dp 转 px）
const getAndroidDefaults = (): SafeAreaInsets => {
  const dpr = getDPR();
  const isLandscape = 
    typeof window !== 'undefined' && 
    window.innerWidth > window.innerHeight;
  
  // Android 标准状态栏高度: 24dp
  const statusBarHeight = 24 * dpr;
  // Android 底部导航栏高度（三键导航）: 48dp
  // 手势导航底部条: 约 4-12dp，这里取保守值 24dp
  const navBarHeight = 48 * dpr;
  const gestureBarHeight = 12 * dpr;
  
  if (!isLandscape) {
    // 竖屏：顶部状态栏 + 底部导航栏
    // 不确定是手势还是三键，取中间值偏保守
    return {
      top: statusBarHeight,
      bottom: Math.min(navBarHeight, Math.max(gestureBarHeight, 32 * dpr)),
      left: 0,
      right: 0,
    };
  } else {
    // 横屏：左右可能有挖孔，底部可能有导航栏
    return {
      top: 0,
      bottom: gestureBarHeight,
      left: statusBarHeight, // 保守估计左侧挖孔
      right: 0,
    };
  }
};

// iOS 安全区域默认值（用于 fallback）
const getIOSDefaults = (): SafeAreaInsets => {
  const dpr = getDPR();
  const isLandscape = 
    typeof window !== 'undefined' && 
    window.innerWidth > window.innerHeight;
  
  // iPhone 系列安全区域（CSS 像素值，非物理像素）
  // 这些是大致值，实际以 env() 为准
  const hasNotch = 
    typeof window !== 'undefined' && 
    window.innerHeight >= 812; // iPhone X 及以上
  
  if (!isLandscape) {
    return {
      top: hasNotch ? 44 : 20, // 状态栏
      bottom: hasNotch ? 34 : 0, // 底部 Home Indicator
      left: 0,
      right: 0,
    };
  } else {
    return {
      top: hasNotch ? 0 : 20,
      bottom: hasNotch ? 21 : 0,
      left: hasNotch ? 44 : 0,
      right: hasNotch ? 44 : 0,
    };
  }
};

// 综合计算安全区域
const computeSafeArea = (): SafeAreaInsets => {
  if (typeof window === 'undefined') {
    return { top: 0, bottom: 0, left: 0, right: 0 };
  }

  // 桌面设备不需要安全区域
  if (!isMobileDevice()) {
    return { top: 0, bottom: 0, left: 0, right: 0 };
  }

  // 第1优先级：CSS env()（最准确）
  const cssEnv = readFromCSSEnv();
  if (cssEnv && (cssEnv.top > 0 || cssEnv.bottom > 0 || cssEnv.left > 0 || cssEnv.right > 0)) {
    console.log('[useSafeArea] Using CSS env values:', cssEnv);
    return cssEnv;
  }

  // 第2优先级：screen 差值估算
  const screenEstimate = estimateFromScreenDiff();
  if (screenEstimate && (screenEstimate.top > 10 || screenEstimate.bottom > 10)) {
    console.log('[useSafeArea] Using screen diff estimate:', screenEstimate);
    return screenEstimate;
  }

  // 第3优先级：基于设备类型的默认值
  let defaults: SafeAreaInsets;
  if (isIOS()) {
    defaults = getIOSDefaults();
    console.log('[useSafeArea] Using iOS defaults:', defaults);
  } else if (isAndroid()) {
    defaults = getAndroidDefaults();
    console.log('[useSafeArea] Using Android defaults:', defaults);
  } else {
    defaults = { top: 0, bottom: 0, left: 0, right: 0 };
  }

  return defaults;
};

export function useSafeArea(): SafeAreaInsets {
  const [safeArea, setSafeArea] = useState<SafeAreaInsets>(() => computeSafeArea());

  const updateSafeArea = useCallback(() => {
    const insets = computeSafeArea();
    setSafeArea((prev) => {
      // 只有变化明显时才更新，避免频繁重渲染
      if (
        Math.abs(prev.top - insets.top) < 1 &&
        Math.abs(prev.bottom - insets.bottom) < 1 &&
        Math.abs(prev.left - insets.left) < 1 &&
        Math.abs(prev.right - insets.right) < 1
      ) {
        return prev;
      }
      console.log('[useSafeArea] Updated:', insets);
      return insets;
    });
  }, []);

  useEffect(() => {
    // 初始计算
    updateSafeArea();

    // 延迟重试（有些浏览器安全区域值会延迟设置）
    const timers = [
      setTimeout(updateSafeArea, 100),
      setTimeout(updateSafeArea, 300),
      setTimeout(updateSafeArea, 500),
      setTimeout(updateSafeArea, 1000),
    ];

    // 监听各种变化事件
    const handleResize = () => updateSafeArea();
    const handleOrientationChange = () => {
      // 方向变化后延迟重新计算（等待布局稳定）
      setTimeout(updateSafeArea, 200);
      setTimeout(updateSafeArea, 500);
    };
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        setTimeout(updateSafeArea, 100);
      }
    };

    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleOrientationChange);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // visualViewport 变化时也重新计算（某些 Android 设备）
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', handleResize);
    }

    return () => {
      timers.forEach(clearTimeout);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleOrientationChange);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', handleResize);
      }
    };
  }, [updateSafeArea]);

  return safeArea;
}

// 同步获取安全区域顶部值（用于非 hook 场景）
export function getSafeAreaTop(): number {
  const insets = computeSafeArea();
  return insets.top;
}

// 同步获取安全区域底部值
export function getSafeAreaBottom(): number {
  const insets = computeSafeArea();
  return insets.bottom;
}

// 导出工具函数供其他模块使用
export const safeAreaUtils = {
  isMobileDevice,
  isIOS,
  isAndroid,
  getDPR,
  computeSafeArea,
};
