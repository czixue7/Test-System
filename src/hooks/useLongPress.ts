import { useRef, useCallback } from 'react';

interface UseLongPressOptions {
  /** 长按触发回调（在达到延迟后触发一次）；target 为按下时的元素（事件 currentTarget 延迟后已失效，故单独缓存传入） */
  onLongPress?: (e: React.PointerEvent<HTMLElement>, target?: HTMLElement) => void;
  /** 普通点击回调（长按触发后本次抬起产生的 click 会被抑制，不调用） */
  onClick?: (e: React.MouseEvent<HTMLElement>) => void;
  /** 长按判定时长（ms），默认 500 */
  delay?: number;
  /** 位移阈值（px）：按下后移动超过该距离则取消长按，默认 10 */
  moveThreshold?: number;
}

/**
 * 长按手势 hook：基于 Pointer Events（兼容触摸 / 鼠标 / 触控笔）。
 * - 按下并保持超过 delay 毫秒且移动不超过 moveThreshold 时触发 onLongPress；
 * - 长按触发后，紧随其后的 click 事件会被抑制（避免同时触发普通点击）。
 * - 通过事件 target 上的 data-* 属性携带上下文，方便同一 hook 复用于多个元素。
 */
export function useLongPress({
  onLongPress,
  onClick,
  delay = 500,
  moveThreshold = 10,
}: UseLongPressOptions) {
  const timerRef = useRef<number | null>(null);
  const startPosRef = useRef<{ x: number; y: number } | null>(null);
  const longPressFiredRef = useRef(false);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLElement>) => {
    // 鼠标只响应左键
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    longPressFiredRef.current = false;
    startPosRef.current = { x: e.clientX, y: e.clientY };
    // React 在合成事件回调结束后会把 currentTarget 置空，此处先缓存按下的元素供延迟触发使用
    const target = e.currentTarget as HTMLElement | null;
    clearTimer();
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      longPressFiredRef.current = true;
      onLongPress?.(e, target ?? undefined);
    }, delay);
  }, [onLongPress, delay, clearTimer]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (timerRef.current === null) return;
    const start = startPosRef.current;
    if (!start) return;
    const dx = Math.abs(e.clientX - start.x);
    const dy = Math.abs(e.clientY - start.y);
    if (Math.max(dx, dy) > moveThreshold) {
      clearTimer();
    }
  }, [moveThreshold, clearTimer]);

  const finishPress = useCallback(() => {
    clearTimer();
    startPosRef.current = null;
  }, [clearTimer]);

  const handleClick = useCallback((e: React.MouseEvent<HTMLElement>) => {
    if (longPressFiredRef.current) {
      longPressFiredRef.current = false;
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    onClick?.(e);
  }, [onClick]);

  return {
    onPointerDown: handlePointerDown,
    onPointerMove: handlePointerMove,
    onPointerUp: finishPress,
    onPointerLeave: finishPress,
    onPointerCancel: finishPress,
    onClick: handleClick,
  };
}

export default useLongPress;
