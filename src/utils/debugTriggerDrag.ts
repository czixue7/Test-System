export interface TriggerPoint { x: number; y: number }
export interface TriggerBounds { left: number; top: number; right: number; bottom: number }
export const TRIGGER_SIZE = 44;

export function clampTrigger(point: TriggerPoint, bounds: TriggerBounds): TriggerPoint {
  return {
    x: Math.max(bounds.left, Math.min(point.x, Math.max(bounds.left, bounds.right - TRIGGER_SIZE))),
    y: Math.max(bounds.top, Math.min(point.y, Math.max(bounds.top, bounds.bottom - TRIGGER_SIZE))),
  };
}

// One primary pointer owns a gesture. Travel beyond 5px becomes a drag,
// including when the pointer later returns to its starting position.
export function createTriggerDrag(bounds: () => TriggerBounds, update: (point: TriggerPoint) => void) {
  let gesture: { id: number; x: number; y: number; origin: TriggerPoint; moved: boolean } | null = null;
  let suppressClick = false;
  return {
    start(id: number, x: number, y: number, origin: TriggerPoint) {
      if (gesture) return false;
      suppressClick = false;
      gesture = { id, x, y, origin, moved: false };
      return true;
    },
    move(id: number, x: number, y: number) {
      if (!gesture || gesture.id !== id) return false;
      const dx = x - gesture.x, dy = y - gesture.y;
      gesture.moved ||= Math.hypot(dx, dy) > 5;
      if (gesture.moved) update(clampTrigger({ x: gesture.origin.x + dx, y: gesture.origin.y + dy }, bounds()));
      return gesture.moved;
    },
    end(id: number, cancelled = false) {
      if (!gesture || gesture.id !== id) return;
      suppressClick = gesture.moved || cancelled;
      gesture = null;
    },
    click(keyboard = false) {
      const allowed = keyboard || !suppressClick;
      suppressClick = false;
      return allowed;
    },
  };
}
