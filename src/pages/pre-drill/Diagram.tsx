import { EquipmentIcon } from './EquipmentIcon';
import { DiagramViewport, diagramWidth } from './DiagramViewport';
import type { DeviceKind, DrillItem, DrillScene, FlowArrow, Pipeline, PipeKind } from './types';

export const deviceNames: Record<DeviceKind, string> = {
  tower: '冷塔', pump: '水泵', exchanger: '板式换热器', valve: '阀门',
  terminal: '末端', sensor: '测点', tank: '水箱', auxiliary: '辅助设备',
};

const symbols: Partial<Record<DeviceKind, string>> = { terminal: '▤', sensor: '◇', tank: '▱', auxiliary: '⊡' };
const rotations: Record<FlowArrow[2], number> = { right: 0, down: 90, left: 180, up: 270 };
const readoutFields = [
  { label: '温度', code: 'T', offset: 0, width: 39 },
  { label: '压力', code: 'P', offset: 43, width: 41 },
  { label: '流量', code: 'F', offset: 88, width: 48 },
];

function PipeReadout({ pipe }: { pipe: Pipeline }) {
  if (!pipe.readout) return null;
  const [x, y] = pipe.readout;
  return <g className="drill-readout" transform={`translate(${x} ${y})`} aria-hidden="true">
    {readoutFields.map(({ label, code, offset, width }) => {
      const reading = pipe.readings.find(([name]) => name === label);
      if (!reading) return null;
      return <g key={code} data-reading={code} transform={`translate(${offset} 0)`}>
        <rect width={width} height="13" rx="2" />
        <text x="4" y="9.75">{code} {reading[1]}</text>
      </g>;
    })}
  </g>;
}

const circuitNames: Record<PipeKind, string> = {
  cooling: '冷却水', supply: '冷冻水供水', return: '冷冻水回水', makeup: '补水', metering: '软化水 / 计量',
  'makeup-inlet': '补水进水', unlabeled: '未标名接管',
};

export const itemKindName = (item: DrillItem) => item.kind === 'pipe'
  ? circuitNames[item.circuit] + '管段'
  : deviceNames[item.kind];

export function Diagram({ scene, stateOf, onSelect }: {
  scene: DrillScene;
  stateOf: (item: DrillItem) => string | undefined;
  onSelect: (item: DrillItem) => void;
}) {
  const circuits = [...new Set(scene.pipes.map(pipe => pipe.circuit))];

  return (
    <section className="drill-sheet" id={`pre-drill-${scene.id}`} aria-labelledby={`drill-title-${scene.id}`}>
      <div className="drill-sheet-header">
        <div><h2 id={`drill-title-${scene.id}`}>{scene.title}</h2><p>截图时间 {scene.capturedAt}</p></div>
        <ul className="drill-legend" aria-label="管线图例">
          {scene.legend ? scene.legend.map(({ label, tone }) => <li key={tone} data-tone={tone}>{label}</li>)
            : circuits.map(circuit => <li key={circuit} data-circuit={circuit}>{circuitNames[circuit]}</li>)}
          {scene.pipes.some(pipe => pipe.flow?.length) && <li className="drill-flow-legend">箭头表示截图流向</li>}
          {scene.pipes.some(pipe => pipe.readout) && <li className="drill-readout-legend">T 温度 °C · P 压力 bar · F 流量 m³/h</li>}
        </ul>
      </div>
      <DiagramViewport scene={scene}>
        <div className="drill-diagram" style={{ height: scene.height }}>
          <svg className="drill-lines" viewBox={`0 0 ${diagramWidth} ${scene.height}`} aria-label="可操作管段">
            {scene.pipes.map(pipe => (
              <g key={pipe.id} role="button" tabIndex={0}
                aria-label={`${pipe.label}，${itemKindName(pipe)}${stateOf(pipe) ? `，${stateOf(pipe)}` : ''}`}
                data-circuit={pipe.circuit} data-tone={pipe.tone} data-state={stateOf(pipe)}
                onClick={() => onSelect(pipe)}
                onKeyDown={event => {
                  if (event.key !== 'Enter' && event.key !== ' ') return;
                  event.preventDefault();
                  onSelect(pipe);
                }}>
                <title>{pipe.label}{stateOf(pipe) ? ` · ${stateOf(pipe)}` : ''}</title>
                <path className="drill-line-hit" d={pipe.path} />
                <path className="drill-line-casing" d={pipe.path} />
                <path className="drill-line" d={pipe.path} />
                {pipe.flow?.map(([x, y, direction]) => <path key={`${x}/${y}`} className="drill-flow-arrow" aria-hidden="true"
                  d="M-5-2.8 5 0-5 2.8z" transform={`translate(${x} ${y}) rotate(${rotations[direction]})`} />)}
                <PipeReadout pipe={pipe} />
              </g>
            ))}
          </svg>
          {scene.zones.map(zone => <div key={zone.label} className="drill-zone" style={{ left: zone.x, top: zone.y ?? 16 }}>{zone.label}</div>)}
          {scene.devices.map(device => (
            <button type="button" key={device.id} className={`drill-node${device.compact ? ' drill-node-compact' : ''}${symbols[device.kind] ? '' : ' drill-node-equipment'}`}
              data-kind={device.kind} data-state={stateOf(device)}
              style={{ left: device.x, top: device.y, width: device.width }}
              title={`${device.label}${device.tag ? ` · ${device.tag}` : ''}`}
              onClick={() => onSelect(device)}>
              {!symbols[device.kind] && <EquipmentIcon kind={device.kind} appearance={device.appearance} />}
              <span className="drill-node-text">
                <span className="drill-node-label">{symbols[device.kind] && <span className="drill-symbol" aria-hidden="true">{symbols[device.kind]}</span>}{device.label}</span>
                {(stateOf(device) || device.summary) && <span className="drill-node-value">{stateOf(device) || device.summary}</span>}
              </span>
            </button>
          ))}
        </div>
      </DiagramViewport>
      <footer className="drill-sheet-footer">
        {scene.notes?.map(note => <p key={note}>{note}</p>)}
      </footer>
      <details className="drill-item-index">
        <summary>管段与设备索引（{scene.devices.length + scene.pipes.length}）</summary>
        <div className="drill-index-grid">{[...scene.pipes, ...scene.devices].map(item => (
          <button type="button" key={item.id} onClick={() => onSelect(item)}>{item.label}{stateOf(item) && ` · ${stateOf(item)}`}</button>
        ))}</div>
      </details>
    </section>
  );
}
