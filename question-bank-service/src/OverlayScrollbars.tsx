import React, { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

type Rail = {
  id: string;
  target: HTMLElement;
  axis: "x" | "y";
  left: number;
  top: number;
  length: number;
  thumb: number;
  position: number;
  offset: number;
  range: number;
  viewport: number;
};
/** Native scroll containers remain intact. Only their zero-width chrome is replaced. */
export default function OverlayScrollbars() {
  const instance = useId().replace(/:/g, "");
  const [rails, setRails] = useState<Rail[]>([]);
  const layer = useRef<HTMLDivElement>(null);
  const live = useRef<Rail[]>([]);
  const drag = useRef<{ id: string; start: number; offset: number }>();
  const [dragging, setDragging] = useState("");
  useEffect(() => {
    let frame = 0;
    let discover = true;
    let targets: HTMLElement[] = [];
    let sequence = 0;
    const ids = new WeakMap<HTMLElement, number>();
    let previous = "";
    const schedule = (rescan = false) => {
      discover ||= rescan;
      if (!frame) frame = requestAnimationFrame(measure);
    };
    const resize = new ResizeObserver(() => schedule());
    const measure = () => {
      frame = 0;
      if (discover) {
        discover = false;
        resize.disconnect();
        targets = Array.from(document.querySelectorAll<HTMLElement>("*"))
          .filter(el => {
            if (el.closest("[data-overlay-scrollbars]")) return false;
            const style = getComputedStyle(el);
            return /(auto|scroll)/.test(`${style.overflowX} ${style.overflowY}`);
          });
        const root = document.scrollingElement as HTMLElement | null;
        if (root && !targets.includes(root)) targets.push(root);
        for (const el of new Set([document.documentElement, document.body, ...targets])) resize.observe(el);
      }
      const next: Rail[] = [];
      for (const target of targets) {
        if (!target.isConnected || !target.getClientRects().length) continue;
        const root = target === document.scrollingElement;
        const rect = root ? { left: 0, top: 0, right: innerWidth, bottom: innerHeight } : target.getBoundingClientRect();
        let left = Math.max(0, rect.left);
        let top = Math.max(0, rect.top);
        let right = Math.min(innerWidth, rect.right);
        let bottom = Math.min(innerHeight, rect.bottom);
        // Rails for nested panes are clipped with their scrollable ancestors.
        for (let parent = target.parentElement; parent && !root; parent = parent.parentElement) {
          const style = getComputedStyle(parent);
          const box = parent.getBoundingClientRect();
          if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) { top = Math.max(top, box.top); bottom = Math.min(bottom, box.bottom); }
          if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) { left = Math.max(left, box.left); right = Math.min(right, box.right); }
        }
        if (right - left < 20 || bottom - top < 20) continue;
        if (!ids.has(target)) ids.set(target, ++sequence);
        if (!target.id) target.id = `scroll-region-${instance}-${ids.get(target)}`;
        const style = getComputedStyle(target);
        const axes = (root ? ["x", "y"] : (["x", "y"] as const).filter(axis => /auto|scroll/.test(axis === "x" ? style.overflowX : style.overflowY))) as ("x" | "y")[];
        const hasX = axes.includes("x") && target.scrollWidth > target.clientWidth + 1;
        const hasY = axes.includes("y") && target.scrollHeight > target.clientHeight + 1;
        for (const axis of axes) {
          const vertical = axis === "y";
          const viewport = vertical ? target.clientHeight : target.clientWidth;
          const total = vertical ? target.scrollHeight : target.scrollWidth;
          const range = total - viewport;
          if (range <= 1) continue;
          const length = (vertical ? bottom - top : right - left) - 6 - (vertical ? (hasX ? 10 : 0) : (hasY ? 10 : 0));
          const thumb = Math.min(length, Math.max(28, length * viewport / total));
          const offset = Math.max(0, Math.min(range, vertical ? target.scrollTop : target.scrollLeft));
          next.push({ id: `${ids.get(target)}-${axis}`, target, axis,
            left: vertical ? right - 10 : left + 3, top: vertical ? top + 3 : bottom - 10,
            length, thumb, position: (length - thumb) * offset / range, offset, range, viewport });
        }
      }
      live.current = next;
      const signature = JSON.stringify(next.map(({ target: _target, ...rest }) => rest));
      if (signature !== previous) { previous = signature; setRails(next); }
    };
    const mutation = new MutationObserver(records => {
      if (records.some(r => !(r.target instanceof Element && r.target.closest("[data-overlay-scrollbars]")))) schedule(true);
    });
    mutation.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style", "open", "hidden"] });
    const scroll = () => schedule();
    const resized = () => schedule(true);
    document.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", resized);
    document.addEventListener("load", resized, true);
    const wheel = (event: WheelEvent) => {
      const node = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-rail-id]") : null;
      const rail = live.current.find(r => r.id === node?.dataset.railId);
      if (!rail) return;
      event.preventDefault();
      const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rail.viewport : 1;
      if (rail.axis === "y") rail.target.scrollTop += event.deltaY * scale;
      else rail.target.scrollLeft += (event.deltaX || event.deltaY) * scale;
    };
    const host = layer.current;
    host?.addEventListener("wheel", wheel, { passive: false });
    schedule(true);
    return () => {
      cancelAnimationFrame(frame); resize.disconnect(); mutation.disconnect();
      document.removeEventListener("scroll", scroll, true); window.removeEventListener("resize", resized);
      document.removeEventListener("load", resized, true);
      host?.removeEventListener("wheel", wheel);
    };
  }, [instance]);
  const move = (rail: Rail, value: number) => {
    const offset = Math.max(0, Math.min(rail.range, value));
    if (rail.axis === "y") rail.target.scrollTop = offset;
    else rail.target.scrollLeft = offset;
  };
  return createPortal(<div ref={layer} data-overlay-scrollbars="" aria-label="页面滚动控制">
    {rails.map(rail => <div key={rail.id} data-rail-id={rail.id}
      className={`overlay-scrollbar axis-${rail.axis}${dragging === rail.id ? " is-dragging" : ""}`}
      style={{ left: rail.left, top: rail.top, width: rail.axis === "y" ? 8 : rail.length, height: rail.axis === "y" ? rail.length : 8 }}
      role="scrollbar" tabIndex={0} aria-label={rail.axis === "y" ? "垂直滚动" : "水平滚动"}
      aria-controls={rail.target.id}
      aria-orientation={rail.axis === "y" ? "vertical" : "horizontal"} aria-valuemin={0} aria-valuemax={Math.round(rail.range)} aria-valuenow={Math.round(rail.offset)}
      onPointerDown={e => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.focus({ preventScroll: true });
        const vertical = rail.axis === "y";
        const point = vertical ? e.clientY : e.clientX;
        const onThumb = (e.target as HTMLElement).classList.contains("overlay-scrollbar-thumb");
        const offset = onThumb ? rail.offset : (point - (vertical ? rail.top : rail.left) - rail.thumb / 2) / Math.max(1, rail.length - rail.thumb) * rail.range;
        move(rail, offset);
        drag.current = { id: rail.id, start: point, offset: Math.max(0, Math.min(rail.range, offset)) };
        setDragging(rail.id); e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={e => {
        const start = drag.current;
        if (start?.id !== rail.id) return;
        move(rail, start.offset + ((rail.axis === "y" ? e.clientY : e.clientX) - start.start) * rail.range / Math.max(1, rail.length - rail.thumb));
      }}
      onPointerUp={() => { drag.current = undefined; setDragging(""); }}
      onPointerCancel={() => { drag.current = undefined; setDragging(""); }}
      onLostPointerCapture={() => { drag.current = undefined; setDragging(""); }}
      onKeyDown={e => {
        const delta = ({ ArrowDown: 40, ArrowRight: 40, ArrowUp: -40, ArrowLeft: -40, PageDown: rail.viewport * .9, PageUp: -rail.viewport * .9 } as Record<string, number>)[e.key];
        if (e.key === "Home" || e.key === "End" || delta !== undefined) {
          e.preventDefault(); move(rail, e.key === "Home" ? 0 : e.key === "End" ? rail.range : rail.offset + delta);
        }
      }}>
      <span className="overlay-scrollbar-thumb" style={rail.axis === "y" ? { top: rail.position, height: rail.thumb } : { left: rail.position, width: rail.thumb }} />
    </div>)}
  </div>, document.body);
}
