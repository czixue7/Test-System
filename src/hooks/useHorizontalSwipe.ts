import { useRef } from 'react';
import type { MouseEvent, PointerEvent } from 'react';

interface SwipeOptions {
  onSwipeLeft: () => void;
  onSwipeRight: () => void;
  onMove: () => void;
}

/** 横向手势切页；纵向滚动交给浏览器，移动后不再触发日期点击或长按。 */
export function useHorizontalSwipe({ onSwipeLeft, onSwipeRight, onMove }: SwipeOptions) {
  const gesture = useRef<{
    pointerId: number;
    x: number;
    y: number;
    axis: 'horizontal' | 'vertical' | null;
    moved: boolean;
  } | null>(null);
  const suppressClick = useRef(false);

  const cancel = () => { gesture.current = null; };

  return {
    cancel,
    handlers: {
      onPointerDownCapture(e: PointerEvent<HTMLElement>) {
        if (!e.isPrimary) {
          cancel();
          suppressClick.current = true;
          onMove();
          return;
        }
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        suppressClick.current = false;
        gesture.current = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, axis: null, moved: false };
      },
      onPointerMoveCapture(e: PointerEvent<HTMLElement>) {
        const start = gesture.current;
        if (!start || start.pointerId !== e.pointerId) return;
        const dx = Math.abs(e.clientX - start.x);
        const dy = Math.abs(e.clientY - start.y);
        if (Math.max(dx, dy) <= 10) return;
        start.moved = true;
        suppressClick.current = true;
        onMove();
        if (!start.axis) {
          if (dx > dy * 1.5) {
            start.axis = 'horizontal';
            // 横滑确认后再捕获，普通点击和长按仍以日期按钮为目标。
            e.currentTarget.setPointerCapture(e.pointerId);
          } else if (dy > dx * 1.5) {
            start.axis = 'vertical';
          }
        }
      },
      onPointerUpCapture(e: PointerEvent<HTMLElement>) {
        const start = gesture.current;
        if (!start || start.pointerId !== e.pointerId) return;
        cancel();
        if (!start.moved) return;
        onMove();
        const dx = e.clientX - start.x;
        const dy = e.clientY - start.y;
        if (start.axis !== 'horizontal' || Math.abs(dx) < 48 || Math.abs(dx) <= Math.abs(dy) * 1.5) return;
        if (dx < 0) onSwipeLeft();
        else onSwipeRight();
      },
      onPointerCancel() {
        cancel();
        onMove();
      },
      onPointerLeave(e: PointerEvent<HTMLElement>) {
        if (!e.currentTarget.hasPointerCapture(e.pointerId)) {
          cancel();
          onMove();
        }
      },
      onClickCapture(e: MouseEvent<HTMLElement>) {
        const blocked = suppressClick.current;
        suppressClick.current = false;
        // 键盘触发的 click 没有指针位移，不能被上次拖动影响。
        if (blocked && e.detail !== 0) {
          e.preventDefault();
          e.stopPropagation();
        }
      },
    },
  };
}
