import React, { useEffect, useRef, useState } from 'react';
import { useDebugConsoleStore } from '../../utils/debugConsole';
import { redactText, snapshotDebugValue } from '../../utils/debugValues';
import ValueTree from './ValueTree';

export function elementLabel(node: Element): string {
  return node.tagName.toLowerCase() + (node.id ? '#' + node.id : '') + [...node.classList].slice(0, 3).map(name => '.' + name).join('');
}
export function isInspectableElement(node: unknown): node is Element {
  return typeof Element !== 'undefined' && node instanceof Element && !node.closest('.debug-console-root');
}
export function installElementPicker(actions: { hover: (node: Element) => void; select: (node: Element) => void; cancel: () => void }): () => void {
  const move = (event: Event) => { if (isInspectableElement(event.target)) actions.hover(event.target); };
  const prevent = (event: Event) => { if (isInspectableElement(event.target)) { event.preventDefault(); event.stopImmediatePropagation(); } };
  const click = (event: Event) => { if (isInspectableElement(event.target)) { prevent(event); actions.select(event.target); } };
  const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); actions.cancel(); } };
  document.addEventListener('pointermove', move, true); document.addEventListener('pointerdown', prevent, true); document.addEventListener('mousedown', prevent, true); document.addEventListener('click', click, true); document.addEventListener('keydown', key, true);
  return () => { document.removeEventListener('pointermove', move, true); document.removeEventListener('pointerdown', prevent, true); document.removeEventListener('mousedown', prevent, true); document.removeEventListener('click', click, true); document.removeEventListener('keydown', key, true); };
}
export function useElementInspector(enabled: boolean, onPicked: () => void) {
  const [selected, setSelected] = useState<Element | null>(null), [highlight, setHighlight] = useState<Element | null>(null), [picking, setPicking] = useState(false), [revision, setRevision] = useState(0);
  const callback = useRef(onPicked); callback.current = onPicked;
  useEffect(() => { if (!enabled) { setPicking(false); setHighlight(null); setSelected(null); } }, [enabled]);
  useEffect(() => {
    if (!enabled || !picking) return;
    const cleanup = installElementPicker({ hover: setHighlight, select: node => { setSelected(node); setHighlight(null); setPicking(false); useDebugConsoleStore.setState({ open: true }); callback.current(); }, cancel: () => { setPicking(false); setHighlight(null); useDebugConsoleStore.setState({ open: true }); } });
    const update = () => setRevision(value => value + 1);
    window.addEventListener('scroll', update, true); window.addEventListener('resize', update);
    return () => { cleanup(); window.removeEventListener('scroll', update, true); window.removeEventListener('resize', update); };
  }, [enabled, picking]);
  const start = () => { setPicking(true); setHighlight(null); useDebugConsoleStore.setState({ open: false }); };
  const cancel = () => { setPicking(false); setHighlight(null); useDebugConsoleStore.setState({ open: true }); };
  let rectangle: DOMRect | null = null;
  try { if (highlight?.isConnected) rectangle = highlight.getBoundingClientRect(); } catch {}
  void revision;
  const overlay = <>
    {rectangle && <div className="debug-element-highlight" style={{ left: rectangle.left, top: rectangle.top, width: rectangle.width, height: rectangle.height }}><span>{highlight && elementLabel(highlight).slice(0, 100)} · {Math.round(rectangle.width)} × {Math.round(rectangle.height)}</span></div>}
    {picking && <div className="debug-picker-bar"><span>点选页面元素 · Esc 取消</span><button type="button" onClick={cancel}>取消选取</button></div>}
  </>;
  return { selected, select: setSelected, picking, start, overlay };
}

function DOMTree({ node, selected, select, depth = 0 }: { node: Element; selected: Element | null; select: (element: Element) => void; depth?: number }) {
  const [open, setOpen] = useState(depth < 1);
  const children = [...node.children].filter(isInspectableElement);
  return <div className="debug-dom-node">
    <div className={`debug-dom-line ${node === selected ? 'debug-dom-line--selected' : ''}`}>
      <button type="button" className="debug-dom-expand" aria-label={`${open ? '折叠' : '展开'} ${node.tagName.toLowerCase()}`} aria-expanded={open} disabled={!children.length} onClick={() => setOpen(!open)}>{children.length ? open ? '⌄' : '›' : '·'}</button>
      <button type="button" className="debug-dom-name" title={elementLabel(node)} onClick={() => select(node)}>&lt;{elementLabel(node)}&gt;</button>
      {!!children.length && <small>{children.length}</small>}
    </div>
    {open && depth < 30 && <div className="debug-dom-children">{children.slice(0, 100).map((child, index) => <DOMTree key={index} node={child} selected={selected} select={select} depth={depth + 1} />)}{children.length > 100 && <p className="debug-inline-note">仅显示前 100 个子元素，请使用选择器定位</p>}</div>}
  </div>;
}

export default function ElementsPanel({ selected, select, startPicker, query, refresh, notify }: {
  selected: Element | null; select: (element: Element) => void; startPicker: () => void; query: string; refresh: number; notify: (message: string) => void;
}) {
  const [revision, setRevision] = useState(0), [attribute, setAttribute] = useState(''), [value, setValue] = useState(''), [mode, setMode] = useState<'attribute' | 'style'>('attribute');
  const locate = () => { try { const match = document.querySelector(query); if (isInspectableElement(match)) { select(match); notify('已定位 ' + elementLabel(match)); } else notify('没有匹配的页面元素'); } catch { notify('CSS 选择器无效'); } };
  let info: Record<string, unknown> | null = null, html = '';
  if (selected?.isConnected) {
    const rect = selected.getBoundingClientRect(), style = window.getComputedStyle(selected);
    info = { 元素: elementLabel(selected), 盒子: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, 属性: Object.fromEntries([...selected.attributes].map(attr => [attr.name, attr.value])), 样式: Object.fromEntries(['display', 'position', 'width', 'height', 'color', 'background-color', 'font-size', 'line-height', 'padding', 'margin', 'border', 'z-index', 'overflow', 'transform'].map(key => [key, style.getPropertyValue(key)])) };
    html = redactText(selected.outerHTML.slice(0, 16000));
  }
  const ancestry: Element[] = []; let parent = selected?.parentElement; while (parent && ancestry.length < 5) { ancestry.unshift(parent); parent = parent.parentElement; }
  return <div className="debug-elements-panel">
    <div className="debug-inline-actions"><span>CSS 选择器定位 / 页面点选</span><button type="button" onClick={locate} disabled={!query.trim()}>定位</button><button type="button" onClick={startPicker}>选取元素</button></div>
    {!!ancestry.length && <div className="debug-dom-breadcrumb">{ancestry.map((node, index) => <button type="button" key={index} onClick={() => select(node)}>{node.tagName.toLowerCase()}</button>)}</div>}
    {info ? <div className="debug-dom-inspection">
      <h4>{elementLabel(selected!)}</h4><ValueTree key={`${refresh}:${revision}:${elementLabel(selected!)}`} node={snapshotDebugValue(info)} initialOpen />
      <details><summary>HTML 源码</summary><pre>{html}</pre></details>
      <form className="debug-dom-editor" onSubmit={event => {
        event.preventDefault(); if (!selected?.isConnected || !attribute.trim()) return;
        try { if (mode === 'style') (selected as HTMLElement).style.setProperty(attribute.trim(), value); else selected.setAttribute(attribute.trim(), value); setRevision(value => value + 1); notify('已修改当前页面元素'); } catch (error) { notify(String(error)); }
      }}>
        <select aria-label="元素编辑类型" value={mode} onChange={event => setMode(event.target.value as typeof mode)}><option value="attribute">属性</option><option value="style">样式</option></select>
        <input aria-label="属性或样式名称" placeholder={mode === 'style' ? '如 color' : '如 title'} value={attribute} onChange={event => setAttribute(event.target.value)} />
        <input aria-label="属性或样式值" placeholder="值" value={value} onChange={event => setValue(event.target.value)} />
        <button type="submit">应用</button><button type="button" onClick={() => {
          if (!selected?.isConnected || !attribute.trim()) return;
          try { if (mode === 'style') (selected as HTMLElement).style.removeProperty(attribute.trim()); else selected.removeAttribute(attribute.trim()); setRevision(value => value + 1); notify('已移除'); } catch (error) { notify(String(error)); }
        }}>移除</button>
      </form>
    </div> : <p className="debug-inline-note">选取元素后，可查看属性、盒子尺寸和计算样式。$0 会指向选中元素。</p>}
    <div className="debug-dom-tree" key={`${refresh}:${revision}`}><DOMTree node={document.documentElement} selected={selected} select={select} /></div>
  </div>;
}
