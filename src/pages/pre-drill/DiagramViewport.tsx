import { memo, useLayoutEffect, useRef, useState } from 'react';
import type { MouseEvent, PointerEvent, ReactNode } from 'react';
import type { DrillScene } from './types';

export const diagramWidth = 1168;
const maxZoom = 2.5;
const zoomStep = 1.35;
const dragThreshold = 6;

type Point = { x: number; y: number };
type View = Point & { width: number; height: number };
type Anchor = { world: Point; screen?: Point };
type Pan = { point: Point; scroll: Point };
type Pinch = { distance: number; zoom: number; world: Point };

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const midpoint = (a: Point, b: Point) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

const OverviewDrawing = memo(function OverviewDrawing({ scene }: { scene: DrillScene }) {
  return <>
    {scene.pipes.map(pipe => <path key={pipe.id} d={pipe.path} data-circuit={pipe.circuit} data-tone={pipe.tone} />)}
    {scene.devices.map(device => <rect key={device.id} x={device.x} y={device.y} width={device.width} height={device.compact ? 30 : 42} rx="6" />)}
  </>;
});

export function DiagramViewport({ scene, children }: { scene: DrillScene; children: ReactNode }) {
  const surface = useRef<HTMLDivElement>(null);
  const pendingAnchor = useRef<Anchor>();
  const pointers = useRef(new Map<number, Point>());
  const pan = useRef<Pan>();
  const pinch = useRef<Pinch>();
  const suppressClickUntil = useRef(0);
  const dragActive = useRef(false);
  const [limits, setLimits] = useState({ width: diagramWidth, height: scene.height });
  const [requestedZoom, setRequestedZoom] = useState<number | null>(null);
  const [view, setView] = useState<View>({ x: 0, y: 0, width: diagramWidth, height: scene.height });
  const [overviewOpen, setOverviewOpen] = useState(false);
  const fitZoom = Math.min(1, limits.width / diagramWidth, limits.height / scene.height);
  const zoom = Math.max(fitZoom, requestedZoom ?? fitZoom);
  const atFit = zoom - fitZoom < .005;

  useLayoutEffect(() => {
    const area = surface.current!;
    const measure = () => {
      const width = area.clientWidth || diagramWidth;
      const maxHeight = Number.parseFloat(getComputedStyle(area).maxHeight);
      const height = Number.isFinite(maxHeight) ? maxHeight - 2 : scene.height;
      setLimits(previous => previous.width === width && previous.height === height ? previous : { width, height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(area);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [scene.height]);

  function updateView(area: HTMLDivElement) {
    const next = {
      x: area.scrollLeft / zoom, y: area.scrollTop / zoom,
      width: Math.min(diagramWidth, area.clientWidth / zoom), height: Math.min(scene.height, area.clientHeight / zoom),
    };
    setView(previous => previous.x === next.x && previous.y === next.y && previous.width === next.width && previous.height === next.height ? previous : next);
  }

  function placeAnchor(area: HTMLDivElement, anchor: Anchor) {
    const centeredOffset = Math.max(0, (area.clientWidth - diagramWidth * zoom) / 2);
    const screen = anchor.screen ?? { x: area.clientWidth / 2, y: area.clientHeight / 2 };
    area.scrollLeft = anchor.world.x * zoom + centeredOffset - screen.x;
    area.scrollTop = anchor.world.y * zoom - screen.y;
    updateView(area);
  }

  useLayoutEffect(() => {
    const area = surface.current!;
    const anchor = pendingAnchor.current;
    pendingAnchor.current = undefined;
    if (anchor) placeAnchor(area, anchor);
    else updateView(area);
  }, [zoom, limits, scene.height]);

  function screenPoint(area: HTMLDivElement, client: Point): Point {
    const bounds = area.getBoundingClientRect();
    return { x: client.x - bounds.left - area.clientLeft, y: client.y - bounds.top - area.clientTop };
  }

  function worldPoint(area: HTMLDivElement, screen: Point): Point {
    const offset = Math.max(0, (area.clientWidth - diagramWidth * zoom) / 2);
    return { x: (area.scrollLeft + screen.x - offset) / zoom, y: (area.scrollTop + screen.y) / zoom };
  }

  function moveTo(area: HTMLDivElement, requested: number, anchor: Anchor) {
    const next = Math.min(maxZoom, Math.max(fitZoom, requested));
    pendingAnchor.current = next === zoom ? undefined : anchor;
    setRequestedZoom(next === fitZoom ? null : next);
    if (next === zoom) placeAnchor(area, anchor);
  }

  function zoomBy(factor: number) {
    const area = surface.current!;
    const screen = { x: area.clientWidth / 2, y: area.clientHeight / 2 };
    moveTo(area, zoom * factor, { world: worldPoint(area, screen), screen });
  }

  function reset() {
    const area = surface.current!;
    moveTo(area, fitZoom, { world: { x: 0, y: 0 }, screen: { x: 0, y: 0 } });
  }

  function overviewGoTo(world: Point) {
    moveTo(surface.current!, atFit ? Math.max(1, zoom * zoomStep) : zoom, { world });
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || pointers.current.size === 2) return;
    const area = event.currentTarget;
    const point = { x: event.clientX, y: event.clientY };
    pointers.current.set(event.pointerId, point);
    if (pointers.current.size === 1) {
      suppressClickUntil.current = 0;
      dragActive.current = false;
      pan.current = { point, scroll: { x: area.scrollLeft, y: area.scrollTop } };
      return;
    }
    const [first, second] = pointers.current.values();
    const screen = screenPoint(area, midpoint(first, second));
    pinch.current = { distance: distance(first, second) || 1, zoom, world: worldPoint(area, screen) };
    dragActive.current = true;
    pan.current = undefined;
    for (const id of pointers.current.keys()) area.setPointerCapture(id);
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(event.pointerId)) return;
    const area = event.currentTarget;
    const point = { x: event.clientX, y: event.clientY };
    pointers.current.set(event.pointerId, point);
    if (pinch.current) {
      const [first, second] = pointers.current.values();
      moveTo(area, pinch.current.zoom * distance(first, second) / pinch.current.distance, {
        world: pinch.current.world, screen: screenPoint(area, midpoint(first, second)),
      });
      return;
    }
    const start = pan.current;
    const canPan = area.scrollWidth > area.clientWidth || area.scrollHeight > area.clientHeight;
    if (!start || !canPan || (!dragActive.current && distance(point, start.point) < dragThreshold)) return;
    if (!area.hasPointerCapture(event.pointerId)) area.setPointerCapture(event.pointerId);
    dragActive.current = true;
    area.scrollLeft = start.scroll.x + start.point.x - point.x;
    area.scrollTop = start.scroll.y + start.point.y - point.y;
  }

  function onPointerEnd(event: PointerEvent<HTMLDivElement>) {
    if (!pointers.current.delete(event.pointerId)) return;
    const area = event.currentTarget;
    const [remaining] = pointers.current.values();
    pinch.current = undefined;
    pan.current = remaining ? { point: remaining, scroll: { x: area.scrollLeft, y: area.scrollTop } } : undefined;
    if (dragActive.current) suppressClickUntil.current = performance.now() + 350;
    if (!remaining) dragActive.current = false;
  }

  function onClickCapture(event: MouseEvent<HTMLDivElement>) {
    if (event.detail > 0 && performance.now() < suppressClickUntil.current) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  return <>
    <div className="drill-map-tools" role="group" aria-label={`${scene.title}图面操作`}>
      <div className="drill-zoom-controls">
        <button type="button" aria-label="缩小图面" disabled={atFit} onClick={() => zoomBy(1 / zoomStep)}>−</button>
        <output aria-label="当前缩放比例">{Math.round(zoom * 100)}%</output>
        <button type="button" aria-label="放大图面" disabled={zoom >= maxZoom} onClick={() => zoomBy(zoomStep)}>＋</button>
      </div>
      <button type="button" onClick={reset}>全图</button>
      <button type="button" aria-expanded={overviewOpen} aria-controls={`drill-overview-${scene.id}`} onClick={() => setOverviewOpen(open => !open)}>鸟瞰图</button>
      <span className="drill-map-touch-hint">双指缩放，放大后拖动</span>
    </div>
    {overviewOpen && <div className="drill-overview" id={`drill-overview-${scene.id}`}>
      <button type="button" className="drill-overview-target" aria-label="在鸟瞰图上定位，可用方向键移动" onClick={event => {
        const box = event.currentTarget.querySelector('svg')!.getBoundingClientRect();
        overviewGoTo(event.detail === 0 ? { x: view.x + view.width / 2, y: view.y + view.height / 2 } : {
          x: (event.clientX - box.left) * diagramWidth / box.width, y: (event.clientY - box.top) * scene.height / box.height,
        });
      }} onKeyDown={event => {
        const offsets: Record<string, Point> = { ArrowLeft: { x: -.55, y: 0 }, ArrowRight: { x: .55, y: 0 }, ArrowUp: { x: 0, y: -.55 }, ArrowDown: { x: 0, y: .55 } };
        const offset = offsets[event.key];
        if (!offset) return;
        event.preventDefault();
        overviewGoTo({ x: view.x + view.width * (.5 + offset.x), y: view.y + view.height * (.5 + offset.y) });
      }}>
        <svg viewBox={`0 0 ${diagramWidth} ${scene.height}`} aria-hidden="true">
          <OverviewDrawing scene={scene} />
          <rect className="drill-overview-frame" x={view.x} y={view.y} width={view.width} height={view.height} />
        </svg>
      </button>
      <p>点鸟瞰图定位，白框标出当前区域。</p>
    </div>}
    <div ref={surface} className="drill-scroll" data-zoomed={!atFit} tabIndex={0} aria-label={`${scene.title}可缩放图面`}
      style={{ maxHeight: `min(${scene.height + 2}px, var(--drill-viewport-cap, 10000px))` }} onScroll={event => updateView(event.currentTarget)}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerEnd} onPointerCancel={onPointerEnd}
      onLostPointerCapture={event => { if (event.target === event.currentTarget) onPointerEnd(event); }}
      onPointerLeave={event => { if (!event.currentTarget.hasPointerCapture(event.pointerId)) onPointerEnd(event); }} onClickCapture={onClickCapture}>
      <div className="drill-map-size" style={{ width: diagramWidth * zoom, height: scene.height * zoom }}>
        <div className="drill-map-scale" style={{ width: diagramWidth, height: scene.height, transform: `scale(${zoom})` }}>{children}</div>
      </div>
    </div>
  </>;
}
