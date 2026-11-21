export type Reading = readonly [label: string, value: string, unit?: string];

export type DeviceKind = 'tower' | 'pump' | 'exchanger' | 'valve' | 'terminal' | 'sensor' | 'tank' | 'auxiliary';
export type PipeKind = 'cooling' | 'supply' | 'return' | 'makeup' | 'metering' | 'makeup-inlet' | 'unlabeled';
export type PipeTone = 'yellow' | 'green' | 'blue' | 'red' | 'steel' | 'orange' | 'purple';
export type FlowArrow = readonly [x: number, y: number, direction: 'right' | 'down' | 'left' | 'up'];

interface GraphItem {
  id: string;
  label: string;
  tag?: string;
  readings: Reading[];
  summary?: string;
  note?: string;
}

export interface Device extends GraphItem {
  kind: DeviceKind;
  x: number;
  y: number;
  width: number;
  compact?: boolean;
  appearance?: 'running' | 'standby' | 'motorized' | 'manual' | 'submersible' | 'booster';
}

export interface Pipeline extends GraphItem {
  kind: 'pipe';
  circuit: PipeKind;
  path: string;
  tone?: PipeTone;
  flow?: FlowArrow[];
  readout?: readonly [x: number, y: number];
}

export type DrillItem = Device | Pipeline;

export interface DrillScene {
  id: string;
  title: string;
  capturedAt: string;
  height: number;
  zones: { label: string; x: number; y?: number }[];
  devices: Device[];
  pipes: Pipeline[];
  notes?: string[];
  legend?: { label: string; tone: PipeTone }[];
}

export interface DrillSnapshot {
  title: string;
  scenes: DrillScene[];
}
