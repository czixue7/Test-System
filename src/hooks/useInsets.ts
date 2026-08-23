import { useSafeArea, type SafeAreaInsets } from './useSafeArea';
import { useKeyboard, type KeyboardState } from './useKeyboard';

export interface Insets {
  top: number;      // 顶部安全区域（状态栏等）
  bottom: number;   // 底部总边距 = max(安全区域底部, 键盘高度)
  left: number;     // 左侧安全区域
  right: number;    // 右侧安全区域
  safeArea: SafeAreaInsets;  // 纯安全区域（不含键盘）
  keyboard: KeyboardState;   // 键盘状态
}

/**
 * 统一的边距管理 Hook
 * 
 * 整合安全区域（状态栏、导航栏、刘海/挖孔）和键盘边距，
 * 提供统一的 top/bottom/left/right 边距值。
 * 
 * 使用方式：
 * ```tsx
 * const insets = useInsets();
 * 
 * // 顶部 padding（状态栏）
 * <div style={{ paddingTop: insets.top }} />
 * 
 * // 底部 padding（导航栏或键盘，取较大值）
 * <div style={{ paddingBottom: insets.bottom }} />
 * 
 * // 访问单独的安全区域和键盘状态
 * insets.safeArea.top
 * insets.keyboard.isOpen
 * ```
 */
export function useInsets(): Insets {
  const safeArea = useSafeArea();
  const keyboard = useKeyboard();

  // 底部边距取安全区域底部和键盘高度的较大值
  // 注意：键盘弹出时，键盘高度已经包含了从底部到键盘顶部的距离
  // 但安全区域底部（导航栏/手势条）在键盘弹出时仍然存在
  // 实际上在大多数设备上，键盘高度 = window.innerHeight - visualViewport.height
  // 这个差值已经包含了底部系统栏的变化，所以直接取最大值即可
  const bottom = Math.max(safeArea.bottom, keyboard.bottom);

  return {
    top: safeArea.top,
    bottom,
    left: safeArea.left,
    right: safeArea.right,
    safeArea,
    keyboard,
  };
}

export default useInsets;
