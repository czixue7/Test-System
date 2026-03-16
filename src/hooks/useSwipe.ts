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

  const handleTouchStart = useCallback((e: TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
    isSwiping.current = false;
  }, []);

  const handleTouchMove = useCallback((e: TouchEvent) => {
    const deltaX = e.touches[0].clientX - touchStartX.current;
    const deltaY = e.touches[0].clientY - touchStartY.current;
    
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
      element.addEventListener('touchmove', handleTouchMove, { passive: !preventDefaultTouch });
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
        return;
      }
      touchStartX.current = e.touches[0].clientX;
      touchStartY.current = e.touches[0].clientY;
      isSwiping.current = false;
    };

    const handleTouchMove = (e: TouchEvent) => {
      // 如果触摸的是输入框，不处理滑动
      if (isInputElement(e.target)) {
        return;
      }
      const deltaX = e.touches[0].clientX - touchStartX.current;
      const deltaY = e.touches[0].clientY - touchStartY.current;

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
    element.addEventListener('touchmove', handleTouchMove, { passive: !preventDefaultTouch });
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
