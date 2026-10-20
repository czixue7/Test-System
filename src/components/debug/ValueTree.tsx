import React, { useState } from 'react';
import type { DebugValue } from '../../utils/debugValues';

export default function ValueTree({ node, label, initialOpen = false }: { node: DebugValue; label?: string; initialOpen?: boolean }) {
  const [open, setOpen] = useState(initialOpen);
  const caption = <>{label !== undefined && <span className="debug-value-key">{label}: </span>}<span className={`debug-value-preview debug-value-preview--${node.type}`}>{node.type === 'string' ? JSON.stringify(node.preview) : node.preview}</span><small className="debug-value-type">{node.type}</small></>;
  if (!node.children?.length) return <div className="debug-value-leaf">{caption}</div>;
  return <details className="debug-value-tree" open={open} onToggle={event => { if (event.target === event.currentTarget) setOpen(event.currentTarget.open); }}>
    <summary>{caption}</summary>
    {open && <div className="debug-value-children">{node.children.map((child, index) => <ValueTree key={index} node={child.value} label={child.key} />)}</div>}
  </details>;
}
