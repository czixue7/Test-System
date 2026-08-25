import { useState, useEffect, useRef, useCallback } from 'react';
import { safeAreaUtils } from './useSafeArea';

export interface KeyboardState {
  isOpen: boolean;
  height: number;      // 键盘高度（CSS 像素）
  bottom: number;      // 底部边距（键盘高度 + 安全区域底部修正）
}

// 输入元素类型
const isInputElement = (el: Element | null): boolean => {
  if (!el) return false;
  const tagName = el.tagName?.toLowerCase() || '';
  const inputTypes = ['input', 'textarea', 'select'];
  
  if (inputTypes.includes(tagName)) {
    // 排除非文本输入类型
    if (tagName === 'input') {
      const type = (el as HTMLInputElement).type?.toLowerCase() || 'text';
      const nonTextTypes = [
        'button', 'checkbox', 'radio', 'file', 
        'submit', 'reset', 'image', 'hidden',
        'range', 'color'
      ];
      return !nonTextTypes.includes(type);
    }
    return true;
  }
  
  // contenteditable 元素
  if (el.getAttribute && el.getAttribute('contenteditable') === 'true') {
    return true;
  }
  
  return false;
};

// 获取动态阈值（屏幕高度的一定比例）
const getKeyboardThreshold = (): number => {
  if (typeof window === 'undefined') return 100;
  const screenHeight = window.innerHeight || 600;
  // 键盘高度通常占屏幕高度的 30%~50%
  // 阈值设为屏幕高度的 15%，最低 80px
  return Math.max(80, screenHeight * 0.15);
};

// 从 visualViewport 计算键盘高度（最准确）
const getKeyboardHeightFromVisualViewport = (): number => {
  if (typeof window === 'undefined' || !window.visualViewport) return 0;
  
  const vv = window.visualViewport;
  // 键盘高度 = 视口总高度 - 可视视口高度 - 可视视口顶部偏移
  // 注意：visualViewport.height 不包含键盘区域
  const keyboardHeight = Math.max(
    0,
    window.innerHeight - vv.height - (vv.offsetTop || 0)
  );
  
  return keyboardHeight;
};

// 从 resize 事件估算键盘高度
let lastInnerHeight = 0;
let lastInnerWidth = 0;

const estimateKeyboardHeightFromResize = (): { height: number; isKeyboard: boolean } => {
  if (typeof window === 'undefined') {
    return { height: 0, isKeyboard: false };
  }
  
  const currentHeight = window.innerHeight;
  const currentWidth = window.innerWidth;
  
  // 初始化
  if (lastInnerHeight === 0) {
    lastInnerHeight = currentHeight;
    lastInnerWidth = currentWidth;
    return { height: 0, isKeyboard: false };
  }
  
  // 宽度变化可能是方向改变，不是键盘
  const widthChanged = Math.abs(currentWidth - lastInnerWidth) > 50;
  if (widthChanged) {
    lastInnerHeight = currentHeight;
    lastInnerWidth = currentWidth;
    return { height: 0, isKeyboard: false };
  }
  
  const heightDiff = lastInnerHeight - currentHeight;
  const threshold = getKeyboardThreshold();
  
  // 高度增加（键盘收起）或高度减少（键盘弹出）
  if (heightDiff > threshold) {
    // 键盘弹出
    lastInnerHeight = currentHeight;
    lastInnerWidth = currentWidth;
    return { height: heightDiff, isKeyboard: true };
  } else if (heightDiff < -threshold) {
    // 键盘收起
    lastInnerHeight = currentHeight;
    lastInnerWidth = currentWidth;
    return { height: 0, isKeyboard: false };
  }
  
  // 小幅变化忽略
  return { 
    height: Math.max(0, heightDiff), 
    isKeyboard: heightDiff > threshold * 0.5 
  };
};

// 估算默认键盘高度（用于键盘弹出中但高度还没稳定时）
const getEstimatedKeyboardHeight = (): number => {
  if (typeof window === 'undefined') return 280;
  // 桌面端不会弹出虚拟键盘，不估算（调用方也应做守卫）
  if (!safeAreaUtils.isMobileDevice()) return 0;
  // 使用 CSS 像素的 innerHeight（screen.height 在 Android WebView 中是物理像素，不能直接用）
  const screenHeight = window.innerHeight || 600;
  
  // Android 键盘高度大约是屏幕高度的 40%~50%
  // iOS 键盘高度约 216pt (非 plus) 或 271pt (plus)
  if (safeAreaUtils.isIOS()) {
    const hasNotch = screenHeight >= 812;
    return hasNotch ? 301 : 216; // 包含顶部工具条
  }
  
  // Android 保守估算：不超过可视区域 35%，上限 300（宁可偏小，避免抬升过多出现空白）
  return Math.min(screenHeight * 0.35, 300);
};

export function useKeyboard(): KeyboardState {
  const [keyboardState, setKeyboardState] = useState<KeyboardState>({
    isOpen: false,
    height: 0,
    bottom: 0,
  });
  
  const stateRef = useRef({
    isOpen: false,
    height: 0,
    hasFocusedInput: false,
    consecutiveCloseChecks: 0, // 连续检测到键盘关闭的次数
    consecutiveOpenChecks: 0,  // 连续检测到键盘打开的次数
  });
  
  // 布局视口基准高度：键盘关闭时的 innerHeight，用于判断窗口是否随键盘缩小（adjustResize）
  const baseInnerHeightRef = useRef<number>(0);
  
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  // 更新键盘状态（带去抖动）
  const updateKeyboardState = useCallback((isOpen: boolean, height: number) => {
    const state = stateRef.current;
    const threshold = getKeyboardThreshold();
    
    // 高度上限保护：键盘高度不可能超过可视区域 60%，避免异常值把底部栏抬得过高出现空白
    const maxHeight = Math.max(0, (window.innerHeight || 600) * 0.6);
    const clampedHeight = Math.min(height, maxHeight);
    
    // 防抖：连续多次检测到才确认状态变化
    // （clampedHeight === 0 表示 adjustResize 模式下窗口已让位，是强信号，无需连续确认）
    if (isOpen && !state.isOpen) {
      state.consecutiveOpenChecks++;
      state.consecutiveCloseChecks = 0;
      if (state.consecutiveOpenChecks < 2 && clampedHeight > 0 && clampedHeight < threshold) {
        return; // 需要至少两次确认或高度超过阈值
      }
    } else if (!isOpen && state.isOpen) {
      state.consecutiveCloseChecks++;
      state.consecutiveOpenChecks = 0;
      if (state.consecutiveCloseChecks < 3) {
        return; // 键盘收起需要更多次确认，避免误判
      }
    } else {
      state.consecutiveOpenChecks = 0;
      state.consecutiveCloseChecks = 0;
    }
    
    // 状态未变化时不更新
    if (state.isOpen === isOpen && Math.abs(state.height - clampedHeight) < 5) {
      return;
    }
    
    state.isOpen = isOpen;
    state.height = clampedHeight;
    state.consecutiveOpenChecks = 0;
    state.consecutiveCloseChecks = 0;
    
    // 底部边距 = 键盘高度（visualViewport 差值已天然处理 adjustResize：窗口让位时差值为 0）
    const bottom = isOpen ? clampedHeight : 0;
    
    setKeyboardState({
      isOpen,
      height: clampedHeight,
      bottom,
    });
    
    console.log('[useKeyboard] State updated:', { isOpen, height: clampedHeight, bottom });
  }, []);

  // 检测并更新键盘高度
  const detectKeyboard = useCallback(() => {
    // 桌面端不会弹出虚拟键盘，直接保持关闭
    if (!safeAreaUtils.isMobileDevice()) {
      updateKeyboardState(false, 0);
      return;
    }

    // 优先使用 visualViewport
    if (window.visualViewport) {
      const vvHeight = getKeyboardHeightFromVisualViewport();
      const threshold = getKeyboardThreshold();
      
      if (vvHeight > threshold) {
        // adjustPan：布局视口不变，差值 = 键盘占用高度，底部栏抬升该值
        updateKeyboardState(true, vvHeight);
      } else {
        // 差值很小：可能键盘已关闭，或窗口已随键盘缩小（adjustResize 模式，窗口已让位）
        const shrunk = baseInnerHeightRef.current - window.innerHeight;
        if (shrunk > threshold) {
          // adjustResize：窗口已缩小到键盘上方，无需再额外抬升底部栏
          updateKeyboardState(true, 0);
        } else if (!stateRef.current.hasFocusedInput) {
          updateKeyboardState(false, 0);
          // 键盘关闭，刷新基准高度
          baseInnerHeightRef.current = window.innerHeight;
        }
        // 聚焦中但都未检测到键盘：保持现状，等待后续事件（避免跳变）
      }
      return;
    }
    
    // fallback: 使用 resize 差值（此方法只能检测到窗口缩小的 adjustResize 模式；
    // 该模式下窗口已让位，无需再额外抬升底部栏）
    const result = estimateKeyboardHeightFromResize();
    if (result.isKeyboard) {
      updateKeyboardState(true, 0);
    } else if (!stateRef.current.hasFocusedInput) {
      updateKeyboardState(false, 0);
    }
  }, [updateKeyboardState]);

  // 平滑的高度更新（用于动画过渡期间）
  const smoothUpdateHeight = useCallback((targetHeight: number, duration: number = 200) => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }
    
    const startHeight = stateRef.current.height;
    const startTime = performance.now();
    
    const animate = (currentTime: number) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      
      // easeOutCubic
      const eased = 1 - Math.pow(1 - progress, 3);
      const currentHeight = startHeight + (targetHeight - startHeight) * eased;
      
      const isOpen = currentHeight > getKeyboardThreshold() * 0.5;
      updateKeyboardState(isOpen, currentHeight);
      
      if (progress < 1) {
        animationFrameRef.current = requestAnimationFrame(animate);
      }
    };
    
    animationFrameRef.current = requestAnimationFrame(animate);
  }, [updateKeyboardState]);

  useEffect(() => {
    // 初始化基准高度
    if (typeof window !== 'undefined') {
      lastInnerHeight = window.innerHeight;
      lastInnerWidth = window.innerWidth;
      baseInnerHeightRef.current = window.innerHeight;
    }

    // === visualViewport 监听（首选）===
    const handleVisualViewportResize = () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      debounceTimerRef.current = setTimeout(detectKeyboard, 16);
    };

    const handleVisualViewportScroll = () => {
      // visualViewport 滚动也可能意味着键盘变化
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      debounceTimerRef.current = setTimeout(detectKeyboard, 32);
    };

    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', handleVisualViewportResize);
      window.visualViewport.addEventListener('scroll', handleVisualViewportScroll);
    }

    // === window resize 监听（fallback）===
    const handleWindowResize = () => {
      if (window.visualViewport) {
        // 有 visualViewport 时以它为准
        return;
      }
      
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      debounceTimerRef.current = setTimeout(detectKeyboard, 50);
    };

    window.addEventListener('resize', handleWindowResize);

    // === focus 事件监听 ===
    const handleFocusIn = (e: FocusEvent) => {
      const target = e.target as HTMLElement;
      if (!isInputElement(target)) return;
      
      // 桌面端不会弹出虚拟键盘，无需处理
      if (!safeAreaUtils.isMobileDevice()) return;
      
      stateRef.current.hasFocusedInput = true;
      
      // 立即检测一次
      detectKeyboard();
      
      // 延迟多次检测（等待键盘完全弹出）
      const checkTimings = [100, 200, 350, 500, 800, 1200];
      checkTimings.forEach((delay, index) => {
        setTimeout(() => {
          if (stateRef.current.hasFocusedInput) {
            detectKeyboard();
          }
        }, delay);
      });
      
      // 兜底：聚焦后仍检测不到键盘（如 WebView 不支持 visualViewport）且窗口未随键盘缩小
      // （非 adjustResize）时，才给保守估算。宁可偏小，避免抬升过多出现空白。
      setTimeout(() => {
        if (stateRef.current.hasFocusedInput && !stateRef.current.isOpen) {
          const shrunk = baseInnerHeightRef.current - window.innerHeight;
          if (shrunk <= getKeyboardThreshold()) {
            updateKeyboardState(true, getEstimatedKeyboardHeight());
          }
        }
      }, 600);
      
      // 滚动输入框到可视区域
      setTimeout(() => {
        if (target.scrollIntoView) {
          target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 300);
    };

    const handleFocusOut = (e: FocusEvent) => {
      const target = e.target as HTMLElement;
      if (!isInputElement(target)) return;
      
      // 延迟检查是否还有其他输入框获得焦点
      setTimeout(() => {
        const activeEl = document.activeElement;
        if (!isInputElement(activeEl)) {
          stateRef.current.hasFocusedInput = false;
          
          // 键盘开始收起，平滑过渡
          if (stateRef.current.isOpen) {
            smoothUpdateHeight(0, 200);
          }
          
          // 延迟确认键盘已收起
          const closeTimings = [200, 400, 600];
          closeTimings.forEach((delay) => {
            setTimeout(() => {
              if (!stateRef.current.hasFocusedInput) {
                detectKeyboard();
              }
            }, delay);
          });
        }
      }, 100);
    };

    document.addEventListener('focusin', handleFocusIn);
    document.addEventListener('focusout', handleFocusOut);

    // === 方向变化监听 ===
    const handleOrientationChange = () => {
      // 方向变化时重置基准
      lastInnerHeight = window.innerHeight;
      lastInnerWidth = window.innerWidth;
      baseInnerHeightRef.current = window.innerHeight;
      
      // 方向变化时键盘通常会收起
      stateRef.current.hasFocusedInput = false;
      updateKeyboardState(false, 0);
      
      // 延迟重新检测
      setTimeout(detectKeyboard, 500);
      setTimeout(detectKeyboard, 1000);
    };

    window.addEventListener('orientationchange', handleOrientationChange);

    // === 可见性变化监听 ===
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        // 页面重新可见时重新检测
        setTimeout(detectKeyboard, 100);
        setTimeout(detectKeyboard, 300);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    // === 软键盘隐藏事件（部分 Android 浏览器支持）===
    const handleBeforeInput = () => {
      // 输入前确认键盘状态
      detectKeyboard();
    };

    document.addEventListener('beforeinput', handleBeforeInput);

    // 初始检测
    setTimeout(detectKeyboard, 100);
    setTimeout(detectKeyboard, 500);

    return () => {
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', handleVisualViewportResize);
        window.visualViewport.removeEventListener('scroll', handleVisualViewportScroll);
      }
      
      window.removeEventListener('resize', handleWindowResize);
      window.removeEventListener('orientationchange', handleOrientationChange);
      document.removeEventListener('focusin', handleFocusIn);
      document.removeEventListener('focusout', handleFocusOut);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      document.removeEventListener('beforeinput', handleBeforeInput);
      
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [detectKeyboard, updateKeyboardState, smoothUpdateHeight]);

  return keyboardState;
}

export default useKeyboard;
