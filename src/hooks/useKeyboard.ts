import { useState, useEffect } from 'react';

interface KeyboardState {
  isOpen: boolean;
  height: number;
  bottom: number;
}

export function useKeyboard(): KeyboardState {
  const [keyboardState, setKeyboardState] = useState<KeyboardState>({
    isOpen: false,
    height: 0,
    bottom: 0,
  });

  useEffect(() => {
    let lastHeight = window.innerHeight;

    const updateKeyboardState = (isOpen: boolean, height: number) => {
      setKeyboardState({
        isOpen,
        height,
        bottom: isOpen ? height : 0,
      });
    };

    const handleResize = () => {
      const currentHeight = window.innerHeight;
      const heightDiff = lastHeight - currentHeight;
      
      if (window.visualViewport) {
        const keyboardHeight = Math.max(0, window.innerHeight - window.visualViewport.height);
        if (keyboardHeight > 100) {
          updateKeyboardState(true, keyboardHeight);
        } else {
          updateKeyboardState(false, 0);
        }
      } else {
        if (heightDiff > 100) {
          updateKeyboardState(true, heightDiff);
        } else if (currentHeight >= lastHeight - 50) {
          updateKeyboardState(false, 0);
        }
      }
      
      lastHeight = currentHeight;
    };

    const handleFocusIn = (e: FocusEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        setTimeout(() => {
          const rect = target.getBoundingClientRect();
          const viewportHeight = window.visualViewport?.height || window.innerHeight;
          const keyboardHeight = Math.max(0, window.innerHeight - viewportHeight);
          
          if (rect.bottom > viewportHeight - 100 || keyboardHeight > 100) {
            const estimatedHeight = Math.max(keyboardHeight, 250);
            updateKeyboardState(true, estimatedHeight);
          }
        }, 300);
      }
    };

    const handleFocusOut = () => {
      setTimeout(() => {
        if (window.visualViewport) {
          const keyboardHeight = Math.max(0, window.innerHeight - window.visualViewport.height);
          if (keyboardHeight < 100) {
            updateKeyboardState(false, 0);
          }
        } else {
          updateKeyboardState(false, 0);
        }
      }, 300);
    };

    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', handleResize);
    }
    window.addEventListener('resize', handleResize);
    document.addEventListener('focusin', handleFocusIn);
    document.addEventListener('focusout', handleFocusOut);

    return () => {
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', handleResize);
      }
      window.removeEventListener('resize', handleResize);
      document.removeEventListener('focusin', handleFocusIn);
      document.removeEventListener('focusout', handleFocusOut);
    };
  }, []);

  return keyboardState;
}