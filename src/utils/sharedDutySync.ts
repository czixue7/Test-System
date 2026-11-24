import { useDataSourceStore } from '../store/dataSourceStore';
import { useDutyScheduleStore } from '../store/dutyScheduleStore';
import type { SharedDutySnapshot } from '../types';
import { sourceRequest } from './dataSourceRequest';
import { sharedDutyReference } from './sharedDutyAnnotations';

const endpoint = 'api/v1/duty-shared/';
const retryMs = 5000;

function parseSnapshot(snapshot: SharedDutySnapshot) {
  if (!snapshot || !Number.isSafeInteger(snapshot.revision) || snapshot.revision < 0
    || !snapshot.entries || typeof snapshot.entries !== 'object' || Array.isArray(snapshot.entries)) {
    throw new Error('服务台返回了无效的共享标注');
  }
  return snapshot;
}

function connect(id: string, filename: string, target: { base: string; resource: string }, token: string) {
  let stopped = false;
  let watching = false;
  let writing = false;
  let readTimer: ReturnType<typeof setTimeout> | undefined;
  let writeTimer: ReturnType<typeof setTimeout> | undefined;
  const store = useDutyScheduleStore.getState;
  const current = () => store().getDuty(id)?.sharedAnnotations;
  const active = () => !stopped && store().getDuty(id)?.sourceFilename === filename
    && useDataSourceStore.getState().sources.some(source =>
      source.enabled && source.kind === 'service' && source.url === target.base && source.token === token);
  const options = { base: target.base, token };
  const onError = (error: unknown) => {
    if (active()) store().setSharedDutyError(id, filename, error instanceof Error ? error.message : '共享标注尚未同步');
  };

  const watch = async () => {
    if (!active() || watching || readTimer) return;
    watching = true;
    let delay = 0;
    try {
      const revision = current()?.snapshot?.revision;
      const path = revision == null ? `sheet/${target.resource}` : `watch/${revision}/${target.resource}`;
      const { status, data } = await sourceRequest<SharedDutySnapshot>(endpoint + path, options);
      if (active() && status === 200) {
        const snapshot = parseSnapshot(data);
        if (revision != null && snapshot.revision < revision) {
          throw new Error('服务台共享数据版本低于本机副本，请检查服务台的数据目录');
        }
        store().receiveSharedDuty(id, filename, snapshot);
      }
    } catch (error) {
      delay = retryMs;
      onError(error);
    } finally {
      watching = false;
      if (active()) {
        readTimer = setTimeout(() => {
          readTimer = undefined;
          void watch();
        }, delay);
      }
    }
  };

  const upload = async () => {
    if (!active() || writing || writeTimer) return;
    const local = current();
    const batch = local?.pending[0];
    if (!local?.snapshot || !batch || local.conflict) return;
    writing = true;
    let delay = 0;
    try {
      const { status, data } = await sourceRequest<SharedDutySnapshot>(endpoint + 'sheet/' + target.resource, {
        ...options, method: 'PUT', data: batch,
      });
      if (active()) store().receiveSharedDuty(id, filename, parseSnapshot(data), { id: batch.id, conflict: status === 409 });
    } catch (error) {
      // A write may already have reached the server. Reuse its batch ID on every retry.
      delay = retryMs;
      onError(error);
    } finally {
      writing = false;
      if (active()) {
        writeTimer = setTimeout(() => {
          writeTimer = undefined;
          void upload();
        }, delay);
      }
    }
  };

  return {
    token,
    filename,
    kick() { void watch(); void upload(); },
    stop() { stopped = true; clearTimeout(readTimer); clearTimeout(writeTimer); },
  };
}

export function startSharedDutySync() {
  const connections = new Map<string, ReturnType<typeof connect>>();
  const sync = () => {
    const sources = useDataSourceStore.getState().sources;
    const activeIds = new Set<string>();
    for (const duty of useDutyScheduleStore.getState().duties) {
      const target = sharedDutyReference(duty.sourceFilename);
      if (!target || !duty.sourceFilename || document.visibilityState === 'hidden') continue;
      const source = sources.find(item => item.enabled && item.kind === 'service' && item.url === target.base);
      if (!source) continue;
      activeIds.add(duty.id);
      let connection = connections.get(duty.id);
      if (connection?.token !== source.token || connection?.filename !== duty.sourceFilename) {
        connection?.stop();
        connection = connect(duty.id, duty.sourceFilename, target, source.token);
        connections.set(duty.id, connection);
      }
      connection.kick();
    }
    for (const [id, connection] of connections) {
      if (activeIds.has(id)) continue;
      connection.stop();
      connections.delete(id);
    }
  };
  const unsubscribeDuties = useDutyScheduleStore.subscribe(sync);
  const unsubscribeSources = useDataSourceStore.subscribe(sync);
  document.addEventListener('visibilitychange', sync);
  window.addEventListener('online', sync);
  sync();
  return () => {
    unsubscribeDuties();
    unsubscribeSources();
    document.removeEventListener('visibilitychange', sync);
    window.removeEventListener('online', sync);
    for (const connection of connections.values()) connection.stop();
    connections.clear();
  };
}
