import { create } from 'zustand';
import { snapshotDebugValue, serializeDebugValue, sanitizeDebugUrl, type DebugValue } from './debugValues';
import { installDebugNetworkCapture, debugQuery, type DebugRequest } from './debugNetwork';
import { evaluateDebugCommand } from './debugEvaluator';
export { serializeDebugValue, sanitizeDebugUrl, redactText } from './debugValues';
export type { DebugRequest } from './debugNetwork';

export type DebugLevel = 'log' | 'info' | 'warn' | 'error' | 'debug';
export interface DebugLog { id: number; time: number; level: DebugLevel; text: string; count: number; values: DebugValue[] }
export interface DebugCommandResult { id: number; source: string; time: number; status: 'pending' | 'fulfilled' | 'rejected'; result?: DebugValue }
export const LOG_LIMIT = 500;
export const REQUEST_LIMIT = 100;
export const useDebugConsoleStore = create<{
  enabled: boolean; open: boolean; paused: boolean; logs: DebugLog[]; requests: DebugRequest[]; commands: DebugCommandResult[];
}>(() => ({ enabled: false, open: false, paused: false, logs: [], requests: [], commands: [] }));

let sequence = 0;
let generation = 0;
let pending: DebugLog[] = [];
let scheduled = false;
let restore: (() => void) | null = null;

export function flushDebugLogs(): void {
  scheduled = false;
  const batch = pending;
  pending = [];
  if (!useDebugConsoleStore.getState().enabled || !batch.length) return;
  useDebugConsoleStore.setState(state => {
    const logs = [...state.logs];
    for (const item of batch) {
      const last = logs[logs.length - 1];
      if (last && last.level === item.level && last.text === item.text && item.time - last.time < 1000) logs[logs.length - 1] = { ...last, time: item.time, count: last.count + 1 };
      else logs.push(item);
    }
    return { logs: logs.slice(-LOG_LIMIT) };
  });
}

export function recordDebugLog(level: DebugLevel, ...values: unknown[]): void {
  const state = useDebugConsoleStore.getState();
  if (!state.enabled || state.paused) return;
  const limited = values.slice(0, 20);
  pending.push({ id: ++sequence, time: Date.now(), level, text: limited.map(serializeDebugValue).join(' ').slice(0, 20000), values: limited.map(snapshotDebugValue), count: 1 });
  if (pending.length > LOG_LIMIT) pending = pending.slice(-LOG_LIMIT);
  if (!scheduled) { scheduled = true; queueMicrotask(flushDebugLogs); }
}

export function clearDebugData(tab: 'logs' | 'network'): void {
  if (tab === 'logs') { pending = []; useDebugConsoleStore.setState({ logs: [] }); }
  else useDebugConsoleStore.setState({ requests: [] });
}

export function startDebugCapture(): void {
  if (restore || typeof window === 'undefined') return;
  const current = ++generation;
  const cleanups: Array<() => void> = [];
  useDebugConsoleStore.setState({ enabled: true, open: false, paused: false });
  for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    const original = console[level];
    const wrapped = (...args: unknown[]) => {
      Reflect.apply(original, console, args);
      try { recordDebugLog(level, ...args); } catch {}
    };
    console[level] = wrapped;
    cleanups.push(() => { if (console[level] === wrapped) console[level] = original; });
  }
  const error = (event: ErrorEvent) => recordDebugLog('error', event.error || event.message || '资源加载失败');
  const rejection = (event: PromiseRejectionEvent) => recordDebugLog('error', '未处理的 Promise 拒绝', event.reason);
  window.addEventListener('error', error);
  window.addEventListener('unhandledrejection', rejection);
  cleanups.push(() => { window.removeEventListener('error', error); window.removeEventListener('unhandledrejection', rejection); });

  cleanups.push(installDebugNetworkCapture({
    active: () => generation === current,
    add: (method, url, source) => {
      if (useDebugConsoleStore.getState().paused || generation !== current) return null;
      const request: DebugRequest = { id: ++sequence, time: Date.now(), method: method.toUpperCase(), url: sanitizeDebugUrl(url), query: debugQuery(url), source, status: null, duration: 0 };
      useDebugConsoleStore.setState(state => ({ requests: [...state.requests, request].slice(-REQUEST_LIMIT) }));
      return request;
    },
    patch: (request, patch) => {
      if (!request || generation !== current) return;
      useDebugConsoleStore.setState(state => ({ requests: state.requests.map(item => item.id === request.id ? { ...item, ...patch } : item) }));
    },
  }));
  restore = () => cleanups.reverse().forEach(cleanup => cleanup());
  recordDebugLog('info', '调试控制台已开启');
}

export function stopDebugCapture(): void {
  ++generation;
  restore?.();
  restore = null;
  pending = [];
  useDebugConsoleStore.setState({ enabled: false, open: false, paused: false });
}

export async function executeDebugCommand(source: string, selected: Element | null): Promise<void> {
  if (!source.trim()) return;
  const id = ++sequence, current = generation;
  useDebugConsoleStore.setState(state => ({ commands: [...state.commands, { id, source: source.slice(0, 20000), time: Date.now(), status: 'pending' as const }].slice(-50) }));
  try {
    const result = snapshotDebugValue(await evaluateDebugCommand(source, selected));
    if (current === generation) useDebugConsoleStore.setState(state => ({ commands: state.commands.map(command => command.id === id ? { ...command, status: 'fulfilled', result } : command) }));
  } catch (error) {
    const result = snapshotDebugValue(error);
    if (current === generation) useDebugConsoleStore.setState(state => ({ commands: state.commands.map(command => command.id === id ? { ...command, status: 'rejected', result } : command) }));
  }
}
