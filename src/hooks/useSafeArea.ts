import { useState, useEffect } from 'react';

export interface SafeAreaInsets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

const MAX_SAFE_AREA_TOP = 32;
const MAX_SAFE_AREA_OTHER = 100;

export function useSafeArea(): SafeAreaInsets {
  const [safeArea, setSafeArea] = useState<SafeAreaInsets>({ top: 0, bottom: 0, left: 0, right: 0 });

  useEffect(() => {
    const computeSafeArea = () => {
      const computedStyle = getComputedStyle(document.documentElement);
      
      const parseValue = (value: string, isTop: boolean = false): number => {
        if (!value || value === '0px') return 0;
        const num = parseFloat(value);
        if (isNaN(num)) return 0;
        if (isTop) {
          return Math.min(num, MAX_SAFE_AREA_TOP);
        }
        return Math.min(num, MAX_SAFE_AREA_OTHER);
      };

      const top = parseValue(computedStyle.getPropertyValue('--safe-area-inset-top'), true);
      const bottom = parseValue(computedStyle.getPropertyValue('--safe-area-inset-bottom'));
      const left = parseValue(computedStyle.getPropertyValue('--safe-area-inset-left'));
      const right = parseValue(computedStyle.getPropertyValue('--safe-area-inset-right'));

      const insets: SafeAreaInsets = { top, bottom, left, right };
      setSafeArea(insets);
      
      console.log('[useSafeArea] Computed safe area:', insets);
    };

    computeSafeArea();

    const handleResize = () => {
      computeSafeArea();
    };

    window.addEventListener('resize', handleResize);
    
    const timer = setTimeout(computeSafeArea, 100);
    const timer2 = setTimeout(computeSafeArea, 500);
    
    return () => {
      window.removeEventListener('resize', handleResize);
      clearTimeout(timer);
      clearTimeout(timer2);
    };
  }, []);

  return safeArea;
}

export function getSafeAreaTop(): number {
  const computedStyle = getComputedStyle(document.documentElement);
  const value = computedStyle.getPropertyValue('--safe-area-inset-top');
  const num = parseFloat(value);
  if (isNaN(num)) return 0;
  return Math.min(num, MAX_SAFE_AREA_TOP);
}
