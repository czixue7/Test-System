import type {
  DutyAnnotation, DutyDrill, DutyRoleAssignment, DutySchedule, DutyShift, SharedDutyBatch, SharedDutyState,
} from '../types';
import { canonicalJson } from './dataSyncMerge';

export function sharedDutyReference(filename?: string) {
  const match = filename?.match(/^service:([^:]+):([A-Za-z0-9_-]+)\/(.+)$/);
  if (!match) return undefined;
  try {
    const [, base, mount, relative] = match;
    return {
      base: decodeURIComponent(base),
      resource: [mount, ...relative.split('/').map(encodeURIComponent)].join('/'),
    };
  } catch {
    return undefined;
  }
}

const drillKey = (item: DutyDrill) => `drill/${item.date}/${item.group}`;
const roleKey = (item: DutyRoleAssignment) =>
  `role/${item.date}/${item.group}/${item.shiftType === 'night' ? 'night' : 'white'}`;

function groupItems<T>(items: T[], identity: (item: T) => string) {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = identity(item);
    const list = groups.get(key);
    if (list) list.push(item);
    else groups.set(key, [item]);
  }
  return groups;
}

const shiftKey = (shift: DutyShift) => `shift/${shift.date}`;

function applyRows<T>(
  base: T[], values: Map<string, DutyAnnotation>, prefix: string, key: (row: T) => string,
): T[] {
  const patches = [...values].filter(([id]) => id.startsWith(prefix));
  if (!patches.length) return base;
  const changed = new Set(patches.map(([id]) => id));
  const replacement = patches.flatMap(([, value]) => value == null ? [] : value as T | T[]);
  return [...base.filter(row => !changed.has(key(row))), ...replacement];
}

function effectiveEntries(state: SharedDutyState) {
  const entries = new Map(Object.entries(state.snapshot?.entries ?? {}));
  for (const batch of state.pending) {
    for (const [key, change] of Object.entries(batch.changes)) {
      entries.set(key, { version: batch.id, value: change.value });
    }
  }
  return entries;
}

export function dutyWithSharedAnnotations(duty: DutySchedule): DutySchedule {
  const shared = duty.sharedAnnotations;
  if (!shared) return duty;
  const values = new Map([...effectiveEntries(shared)].map(([key, entry]) => [key, entry.value]));
  return {
    ...duty,
    drills: applyRows(duty.sourceDrills ?? duty.drills ?? [], values, 'drill/', drillKey),
    roles: applyRows(duty.sourceRoles ?? duty.roles ?? [], values, 'role/', roleKey),
    shifts: applyRows(duty.shifts, values, 'shift/', shiftKey),
  };
}

function differences<T extends DutyAnnotation>(
  previous: Map<string, T>, next: Map<string, T>, changes: Map<string, DutyAnnotation>, empty: DutyAnnotation = null,
) {
  for (const key of new Set([...previous.keys(), ...next.keys()])) {
    const before = previous.get(key);
    const after = next.get(key);
    if (before !== after && canonicalJson(before) !== canonicalJson(after)) changes.set(key, after ?? empty);
  }
}

function batchFor(changes: Map<string, DutyAnnotation>, state: SharedDutyState): SharedDutyBatch | undefined {
  if (changes.size === 0) return undefined;
  const current = effectiveEntries(state);
  return {
    id: crypto.randomUUID(),
    changes: Object.fromEntries([...changes].map(([key, value]) => [
      key, { value, expected: current.get(key)?.version ?? null },
    ])),
  };
}

export function initialSharedAnnotations(duty: DutySchedule): SharedDutyState {
  const shared: SharedDutyState = { pending: [] };
  if (!duty.locallyEdited) return shared;
  const changes = new Map<string, DutyAnnotation>();
  if (duty.sourceDrills) differences(
    groupItems(duty.sourceDrills, drillKey), groupItems(duty.drills ?? [], drillKey), changes,
  );
  if (duty.sourceRoles) differences(
    new Map(duty.sourceRoles.map(item => [roleKey(item), item])),
    new Map((duty.roles ?? []).map(item => [roleKey(item), item])), changes,
  );
  const swappedDates = new Set(duty.shifts.filter(shift => shift.originDate || shift.originGroup)
    .flatMap(shift => [shift.date, shift.originDate]).filter((date): date is string => !!date));
  if (swappedDates.size) {
    for (const [key, shifts] of groupItems(duty.shifts, shiftKey)) {
      if (swappedDates.has(shifts[0].date)) changes.set(key, shifts);
    }
  }
  const batch = batchFor(changes, shared);
  return batch ? { pending: [batch] } : shared;
}

export function preserveSharedAnnotations(duty: DutySchedule, filename: string) {
  return duty.sharedAnnotations ?? (duty.locallyEdited && sharedDutyReference(filename)
    ? initialSharedAnnotations(duty) : undefined);
}

export function queueSharedAnnotations(
  duty: DutySchedule, updates: Partial<DutySchedule>, shared: SharedDutyState, basis?: DutySchedule,
) {
  const current = basis ?? dutyWithSharedAnnotations({ ...duty, sharedAnnotations: shared });
  const changes = new Map<string, DutyAnnotation>();
  if ('drills' in updates) differences(
    groupItems(current.drills ?? [], drillKey), groupItems(updates.drills ?? [], drillKey), changes,
  );
  if ('roles' in updates) differences(
    new Map((current.roles ?? []).map(item => [roleKey(item), item])),
    new Map((updates.roles ?? []).map(item => [roleKey(item), item])), changes,
  );
  if (updates.shifts) differences(groupItems(current.shifts, shiftKey), groupItems(updates.shifts, shiftKey), changes, []);
  const batch = batchFor(changes, basis ? basis.sharedAnnotations ?? { pending: [] } : shared);
  return batch ? { ...shared, pending: [...shared.pending, batch] } : shared;
}
