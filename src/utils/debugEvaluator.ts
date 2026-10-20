import { createDebugStorageFacade } from './debugStorage';

const local = createDebugStorageFacade('local'), session = createDebugStorageFacade('session');

// Debug-only command execution; the existing application CSP allows evaluation.
export async function evaluateDebugCommand(source: string, selected: Element | null): Promise<unknown> {
  const code = source.trim(); if (!code) return undefined;
  const names = ['localStorage', 'sessionStorage', '$', '$$', '$0'];
  const args = [local, session, (selector: string) => document.querySelector(selector), (selector: string) => [...document.querySelectorAll(selector)], selected];
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as FunctionConstructor;
  let execute: Function;
  try { execute = new AsyncFunction(...names, `return (\n${code}\n);`); }
  catch { execute = new AsyncFunction(...names, code); }
  return await execute(...args);
}
