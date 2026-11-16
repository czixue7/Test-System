import { apiConcurrency } from '../../shared/apiConfigSync';

type Queue = { active: number; limit: number; pending: (() => void)[] };
const queues = new Map<string, Queue>();

// Share a budget across summary types using the same endpoint/key. Release secrets when idle.
export function runWithAPIConcurrency<T>(config: { endpoint: string; apiKey: string }, limit: number, task: () => Promise<T>): Promise<T> {
  const key = JSON.stringify([config.endpoint, config.apiKey]);
  let queue = queues.get(key);
  if (!queue) { queue = { active: 0, limit: apiConcurrency(limit), pending: [] }; queues.set(key, queue); }
  queue.limit = apiConcurrency(limit);
  const current = queue;
  const pump = () => {
    while (current.active < current.limit && current.pending.length) current.pending.shift()!();
    if (!current.active && !current.pending.length && queues.get(key) === current) queues.delete(key);
  };
  return new Promise<T>((resolve, reject) => {
    current.pending.push(() => {
      current.active++;
      Promise.resolve().then(task).then(resolve, reject).finally(() => { current.active--; pump(); });
    });
    pump();
  });
}
