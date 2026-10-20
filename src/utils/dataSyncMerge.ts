// Merge only records with stable IDs. Local deletes stay local; no inferred remote deletion.
export function mergeById<T extends { id: string }>(
  local: T[],
  remote: T[],
  timestamp: (value: T) => number,
): T[] {
  const map = new Map<string, T>();
  for (const value of [...remote, ...local]) {
    const old = map.get(value.id);
    if (!old || timestamp(value) >= timestamp(old)) map.set(value.id, value);
  }
  return [...map.values()].sort((a, b) => a.id.localeCompare(b.id));
}
export const dateValue = (value: {
  updatedAt?: string;
  createdAt?: string | number;
}) => {
  const raw = value.updatedAt ?? value.createdAt ?? 0;
  return typeof raw === "number" ? raw : Date.parse(raw) || 0;
};
// Rust serializes JSON object keys in a different order than JS snapshots.
// Compare values canonically so unchanged content does not upload every minute.
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, current) =>
    current && typeof current === 'object' && !Array.isArray(current)
      ? Object.fromEntries(Object.keys(current).sort().map(key => [key, current[key]]))
      : current,
  );
}
export function mergeConversations<
  T extends {
    id: string;
    updatedAt: string;
    messages: {
      id: string;
      createdAt: string;
      updatedAt?: string;
      content: string;
    }[];
  },
>(local: T[], remote: T[]): T[] {
  const all = mergeById(local, remote, dateValue);
  return all.map((record) => {
    const left = local.find((c) => c.id === record.id);
    const right = remote.find((c) => c.id === record.id);
    if (!left || !right) return record;
    const messages = mergeById(
      left.messages.map((m) => ({
        ...m,
        updatedAt: m.updatedAt ?? left.updatedAt,
      })),
      right.messages.map((m) => ({
        ...m,
        updatedAt: m.updatedAt ?? right.updatedAt,
      })),
      dateValue,
    );
    const order = new Map<string, number>();
    for (const message of [
      ...record.messages,
      ...left.messages,
      ...right.messages,
    ]) {
      if (!order.has(message.id)) order.set(message.id, order.size);
    }
    messages.sort(
      (a, b) =>
        Date.parse(a.createdAt) - Date.parse(b.createdAt) ||
        order.get(a.id)! - order.get(b.id)!,
    );
    return { ...record, messages };
  });
}
