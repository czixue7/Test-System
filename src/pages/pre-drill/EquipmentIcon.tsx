import type { Device } from './types';

export function EquipmentIcon({ kind, appearance }: Pick<Device, 'kind' | 'appearance'>) {
  const active = appearance === 'running' || appearance === 'motorized';
  const body = active ? '#137455' : '#264b73';
  const edge = active ? '#62eca2' : '#8cc9ed';

  return <svg className="drill-equipment-icon" viewBox="0 0 54 40" aria-hidden="true" fill="none" strokeLinejoin="round">
    {kind === 'tower' && <>
      <path d="M9 11 15 5h29l3 6v25l-5 3H9z" fill={body} stroke={edge} />
      <path d="M9 11h33l5-6M42 11v28M9 31h33" stroke={edge} opacity=".8" />
      <path d="M16 7V4l4-2h15l3 2v3" fill={body} stroke={edge} />
      <circle cx="25.5" cy="21" r="9" fill="#0a192c" stroke={edge} />
      {[0, 90, 180, 270].map(angle => <path key={angle} d="M25 20c-7-5-4-9 0-7 3 1 4 5 1 8z" transform={`rotate(${angle} 25.5 21)`} fill={active ? '#41e8ff' : '#6a9fc7'} />)}
      <circle cx="25.5" cy="21" r="2" fill={edge} />
      <path d="M14 35h4m3 0h4m3 0h4m3 0h4" stroke={edge} />
    </>}
    {kind === 'pump' && (appearance === 'submersible' || appearance === 'booster' ? <>
      <path d="M8 34h39v4H8z" fill="#203447" stroke="#91a9b9" />
      {(appearance === 'booster' ? [12, 23] : [22]).map(x => <g key={x} transform={`translate(${x} 0)`}>
        <path d="M-3 12h13v18l-3 5H0l-3-5z" fill="#6c8698" stroke="#c5d9e6" />
        <path d="M-1 6h9v6h-9zM-1 20h9m-9 5h9m-8-11v15m5-15v15" stroke="#c5d9e6" />
        <path d="M-8 27h5v6h-5z" fill="#2b465c" stroke="#a3b6c6" />
      </g>)}
      {appearance === 'booster' && <path d="M35 16h10v17H35zM38 20h4" fill="#a88956" stroke="#e6ca93" />}
    </> : <>
      <path d="M4 32h46v4H4zM9 25v7m34-5v5" fill={body} stroke={edge} />
      <path d="M3 21h10v6H3zm22-9h20l3 5v10l-3 4H25z" fill={body} stroke={edge} />
      <circle cx="20" cy="23" r="10" fill={body} stroke={edge} />
      <path d="M17 13V7h8v8m7 2v9m4-9v9m4-9v9m4-9v9" stroke={edge} />
      <circle cx="20" cy="23" r="5" fill={active ? '#09cce9' : '#517fa4'} stroke={edge} />
      <path d="m20 19 2 4-2 4-2-4z" fill="#17354b" />
    </>)}
    {kind === 'valve' && <>
      <path d="M3 28h48m-42-5v10m36-10v10" stroke={active ? '#a0ffb5' : '#d2e0ee'} strokeWidth="2" />
      <path d="m11 22 15 5 15-5v12l-15-5-15 5z" fill={active ? '#23a950' : '#7f95a9'} stroke={active ? '#9bffad' : '#e3ecf4'} />
      <path d="M26 25v-8M17 8h18v9H17zM14 11h24" fill={active ? '#32d558' : '#91a5b6'} stroke={active ? '#94ff93' : '#e2ebf3'} />
      <path d="M35 14h8v7" stroke={active ? '#86ed91' : '#d2e0ee'} />
    </>}
    {kind === 'exchanger' && <>
      <path d="M8 9h8m-8 22h8M38 9h8m-8 22h8" stroke="#8ee6f5" strokeWidth="3" />
      <path d="m15 5 5-3h17l5 3v31l-5 3H15z" fill="#225c81" stroke="#8ee6f5" />
      <path d="M15 5h22l5-3M37 5v34m-18-31v27m4-27v27m4-27v27m4-27v27m3-27v27M16 12h21m-21 5h21m-21 5h21m-21 5h21m-21 5h21" stroke="#78cae4" opacity=".85" />
    </>}
  </svg>;
}
