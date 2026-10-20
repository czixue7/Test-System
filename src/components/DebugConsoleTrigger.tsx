import React, { useEffect, useRef, useState } from 'react';
import { clampTrigger, createTriggerDrag, type TriggerPoint } from '../utils/debugTriggerDrag';

function viewportBounds() {
  const viewport = window.visualViewport;
  const left = viewport?.offsetLeft ?? 0, top = viewport?.offsetTop ?? 0;
  return { left: left + 8, top: top + 8, right: left + (viewport?.width ?? window.innerWidth) - 8, bottom: top + (viewport?.height ?? window.innerHeight) - 8 };
}

export default function DebugConsoleTrigger({ visible, errors, onOpen }: { visible: boolean; errors: number; onOpen: () => void }) {
  const [position, setPosition] = useState<TriggerPoint | null>(null);
  const drag = useRef<ReturnType<typeof createTriggerDrag> | null>(null);
  if (!drag.current) drag.current = createTriggerDrag(viewportBounds, setPosition);
  useEffect(() => {
    const resize = () => setPosition(point => point ? clampTrigger(point, viewportBounds()) : null);
    window.addEventListener('resize', resize);
    window.visualViewport?.addEventListener('resize', resize);
    window.visualViewport?.addEventListener('scroll', resize);
    return () => {
      window.removeEventListener('resize', resize);
      window.visualViewport?.removeEventListener('resize', resize);
      window.visualViewport?.removeEventListener('scroll', resize);
    };
  }, []);
  if (!visible) return null;
  return <button className="debug-console-trigger" type="button" aria-label={`打开调试控制台${errors ? `，${errors} 条错误` : ''}`} title="打开调试控制台，可拖动" style={position ? { left: position.x, top: position.y, right: 'auto', bottom: 'auto' } : undefined}
    onPointerDown={event => {
      if (!event.isPrimary || event.button !== 0) return;
      const rect = event.currentTarget.getBoundingClientRect();
      if (drag.current!.start(event.pointerId, event.clientX, event.clientY, { x: rect.left, y: rect.top })) event.currentTarget.setPointerCapture(event.pointerId);
    }}
    onPointerMove={event => { if (drag.current!.move(event.pointerId, event.clientX, event.clientY)) event.preventDefault(); }}
    onPointerUp={event => {
      drag.current!.move(event.pointerId, event.clientX, event.clientY);
      drag.current!.end(event.pointerId);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    }}
    onPointerCancel={event => drag.current!.end(event.pointerId, true)}
    onLostPointerCapture={event => drag.current!.end(event.pointerId, true)}
    onDragStart={event => event.preventDefault()}
    onClick={event => { if (drag.current!.click(event.detail === 0)) onOpen(); }}>
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m8 7-5 5 5 5m8-10 5 5-5 5M14 4l-4 16" /></svg>
    {errors > 0 && <span className="debug-error-count" aria-hidden="true">{errors > 99 ? '99+' : errors}</span>}
  </button>;
}
