import { useRef, useCallback, useEffect } from 'react';

interface UseSwipeOptions {
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  threshold?: number;
  preventDefaultTouch?: boolean;
}

export function useSwipe(options: UseSwipeOptions) {
  const { onSwipeLeft, onSwipeRight, threshold = 50, preventDefaultTouch = false } = options;
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const touchEndX = useRef(0);
  const touchEndY = useRef(0);
  const isSwiping = useRef(false);
  const isScrolling = useRef(false);

  const handleTouchStart = useCallback((e: TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
    isSwiping.current = false;
    isScrolling.current = false;
  }, []);

  const handleTouchMove = useCallback((e: TouchEvent) => {
    const deltaX = e.touches[0].clientX - touchStartX.current;
    const deltaY = e.touches[0].clientY - touchStartY.current;
    
    // 如果已经开始垂直滚动，不再处理水平滑动
    if (isScrolling.current) {
      return;
    }
    
    // 如果垂直移动距离大于水平移动距离，认为是滚动操作
    if (Math.abs(deltaY) > Math.abs(deltaX) && Math.abs(deltaY) > 10) {
      isScrolling.current = true;
      return;
    }
    
    // 只有水平移动距离明显大于垂直移动距离时，才认为是滑动操作
    if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 10) {
      isSwiping.current = true;
      if (preventDefaultTouch) {
        e.preventDefault();
      }
    }
    
    touchEndX.current = e.touches[0].clientX;
    touchEndY.current = e.touches[0].clientY;
  }, [preventDefaultTouch]);

  const handleTouchEnd = useCallback(() => {
    // 如果正在滚动，不处理滑动
    if (isScrolling.current) {
      isScrolling.current = false;
      return;
    }
    
    if (!isSwiping.current) return;
    
    const deltaX = touchEndX.current - touchStartX.current;
    
    if (Math.abs(deltaX) > threshold) {
      if (deltaX > 0 && onSwipeRight) {
        onSwipeRight();
      } else if (deltaX < 0 && onSwipeLeft) {
        onSwipeLeft();
      }
    }
    
    isSwiping.current = false;
  }, [onSwipeLeft, onSwipeRight, threshold]);

  const handleMouseDown = useCallback((e: MouseEvent) => {
    touchStartX.current = e.clientX;
    touchStartY.current = e.clientY;
    isSwiping.current = false;
  }, []);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    const deltaX = e.clientX - touchStartX.current;
    const deltaY = e.clientY - touchStartY.current;
    
    if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 10) {
      isSwiping.current = true;
    }
    
    touchEndX.current = e.clientX;
    touchEndY.current = e.clientY;
  }, []);

  const handleMouseUp = useCallback(() => {
    if (!isSwiping.current) return;
    
    const deltaX = touchEndX.current - touchStartX.current;
    
    if (Math.abs(deltaX) > threshold) {
      if (deltaX > 0 && onSwipeRight) {
        onSwipeRight();
      } else if (deltaX < 0 && onSwipeLeft) {
        onSwipeLeft();
      }
    }
    
    isSwiping.current = false;
  }, [onSwipeLeft, onSwipeRight, threshold]);

  return {
    handlers: {
      onTouchStart: handleTouchStart,
      onTouchMove: handleTouchMove,
      onTouchEnd: handleTouchEnd,
      onMouseDown: handleMouseDown,
      onMouseMove: handleMouseMove,
      onMouseUp: handleMouseUp,
    },
    bindSwipe: (element: HTMLElement | null) => {
      if (!element) return;
      
      element.addEventListener('touchstart', handleTouchStart, { passive: true });
      element.addEventListener('touchmove', handleTouchMove, { passive: true });
      element.addEventListener('touchend', handleTouchEnd);
      element.addEventListener('mousedown', handleMouseDown);
      element.addEventListener('mousemove', handleMouseMove);
      element.addEventListener('mouseup', handleMouseUp);
      
      return () => {
        element.removeEventListener('touchstart', handleTouchStart);
        element.removeEventListener('touchmove', handleTouchMove);
        element.removeEventListener('touchend', handleTouchEnd);
        element.removeEventListener('mousedown', handleMouseDown);
        element.removeEventListener('mousemove', handleMouseMove);
        element.removeEventListener('mouseup', handleMouseUp);
      };
    }
  };
}

export function useSwipeElement(
  elementRef: React.RefObject<HTMLElement>,
  options: UseSwipeOptions
) {
  const { onSwipeLeft, onSwipeRight, threshold = 50, preventDefaultTouch = false } = options;
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const touchEndX = useRef(0);
  const touchEndY = useRef(0);
  const isSwiping = useRef(false);
  const isScrolling = useRef(false);

  // 检查目标元素是否是输入框或文本域
  const isInputElement = (target: EventTarget | null): boolean => {
    if (!(target instanceof HTMLElement)) return false;
    const tagName = target.tagName.toLowerCase();
    const inputType = target.getAttribute('type');
    return (
      tagName === 'input' ||
      tagName === 'textarea' ||
      target.isContentEditable ||
      (tagName === 'input' && (inputType === 'text' || inputType === 'password' || inputType === 'email' || inputType === 'number' || inputType === 'search' || inputType === 'tel' || inputType === 'url'))
    );
  };

  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;

    const handleTouchStart = (e: TouchEvent) => {
      // 如果触摸的是输入框，不处理滑动
      if (isInputElement(e.target)) {
        isSwiping.current = false;
        isScrolling.current = false;
        return;
      }
      touchStartX.current = e.touches[0].clientX;
      touchStartY.current = e.touches[0].clientY;
      isSwiping.current = false;
      isScrolling.current = false;
    };

    const handleTouchMove = (e: TouchEvent) => {
      // 如果触摸的是输入框，不处理滑动
      if (isInputElement(e.target)) {
        return;
      }
      
      const deltaX = e.touches[0].clientX - touchStartX.current;
      const deltaY = e.touches[0].clientY - touchStartY.current;
      
      // 如果已经开始垂直滚动，不再处理水平滑动
      if (isScrolling.current) {
        return;
      }
      
      // 如果已经开始水平滑动，阻止默认行为（防止页面滚动）
      if (isSwiping.current) {
        if (preventDefaultTouch) {
          e.preventDefault();
        }
        touchEndX.current = e.touches[0].clientX;
        touchEndY.current = e.touches[0].clientY;
        return;
      }

      // 如果垂直移动距离明显大于水平移动距离，认为是滚动操作
      if (Math.abs(deltaY) > Math.abs(deltaX) && Math.abs(deltaY) > 5) {
        isScrolling.current = true;
        return;
      }

      // 只有水平移动距离明显大于垂直移动距离时，才认为是滑动操作
      if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 10) {
        isSwiping.current = true;
        if (preventDefaultTouch) {
          e.preventDefault();
        }
      }

      touchEndX.current = e.touches[0].clientX;
      touchEndY.current = e.touches[0].clientY;
    };

    const handleTouchEnd = () => {
      // 如果正在滚动，不处理滑动
      if (isScrolling.current) {
        isScrolling.current = false;
        return;
      }
      
      if (!isSwiping.current) return;

      const deltaX = touchEndX.current - touchStartX.current;

      if (Math.abs(deltaX) > threshold) {
        if (deltaX > 0 && onSwipeRight) {
          onSwipeRight();
        } else if (deltaX < 0 && onSwipeLeft) {
          onSwipeLeft();
        }
      }

      isSwiping.current = false;
    };

    const handleMouseDown = (e: MouseEvent) => {
      // 如果点击的是输入框，不处理滑动
      if (isInputElement(e.target)) {
        isSwiping.current = false;
        return;
      }
      touchStartX.current = e.clientX;
      touchStartY.current = e.clientY;
      isSwiping.current = false;
    };

    const handleMouseMove = (e: MouseEvent) => {
      // 如果点击的是输入框，不处理滑动
      if (isInputElement(e.target)) {
        return;
      }
      if (!isSwiping.current && e.buttons !== 1) return;

      const deltaX = e.clientX - touchStartX.current;
      const deltaY = e.clientY - touchStartY.current;

      if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 10) {
        isSwiping.current = true;
      }

      touchEndX.current = e.clientX;
      touchEndY.current = e.clientY;
    };

    const handleMouseUp = () => {
      if (!isSwiping.current) return;

      const deltaX = touchEndX.current - touchStartX.current;

      if (Math.abs(deltaX) > threshold) {
        if (deltaX > 0 && onSwipeRight) {
          onSwipeRight();
        } else if (deltaX < 0 && onSwipeLeft) {
          onSwipeLeft();
        }
      }

      isSwiping.current = false;
    };

    element.addEventListener('touchstart', handleTouchStart, { passive: true });
    element.addEventListener('touchmove', handleTouchMove, { passive: true });
    element.addEventListener('touchend', handleTouchEnd);
    element.addEventListener('mousedown', handleMouseDown);
    element.addEventListener('mousemove', handleMouseMove);
    element.addEventListener('mouseup', handleMouseUp);

    return () => {
      element.removeEventListener('touchstart', handleTouchStart);
      element.removeEventListener('touchmove', handleTouchMove);
      element.removeEventListener('touchend', handleTouchEnd);
      element.removeEventListener('mousedown', handleMouseDown);
      element.removeEventListener('mousemove', handleMouseMove);
      element.removeEventListener('mouseup', handleMouseUp);
    };
  }, [elementRef, onSwipeLeft, onSwipeRight, threshold, preventDefaultTouch]);
}
