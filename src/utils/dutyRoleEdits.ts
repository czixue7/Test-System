import { DutyRoleAssignment, DutyRolePostKind, DutyShiftType } from '../types';

export const dutyLeaderLabel = (role: DutyRoleAssignment) => role.leaderLabel?.trim() || '值班长';
// 展示时去掉「副岗位」前缀，历史已保存的数据也能显示为 (左)柴发+一层 这类短名称。
export const postLabel = (name: string) => (name || '').replace(/^副岗位\s*/, '').trim();

// 标签类型只由标签名决定：做表 / 休息 之外都算巡检区域。
export const dutyPostKind = (name: string): DutyRolePostKind => {
  const label = postLabel(name);
  if (label === '做表') return 'report';
  if (label === '休息' || label === '休') return 'rest';
  return 'patrol';
};

// 同类型标签固定在同一位置：巡检第一、做表第二、休息第三。
export const dutyPostKindRank: Record<DutyRolePostKind, number> = { patrol: 0, report: 1, rest: 2 };

export const sortRolePosts = <T extends { name: string; kind?: DutyRolePostKind }>(posts: T[]): T[] =>
  [...posts].sort((a, b) =>
    dutyPostKindRank[a.kind ?? dutyPostKind(a.name)] - dutyPostKindRank[b.kind ?? dutyPostKind(b.name)]);

export type RoleNameChange = { from: string; to: string };
export type RoleShiftCategory = 'white' | 'night';

// 岗位划分展示只区分白班/夜班；早班、中班、全天都归入白班。
export const roleShiftCategory = (shiftType: DutyShiftType): RoleShiftCategory => shiftType === 'night' ? 'night' : 'white';
export const roleShiftLabel = (category: RoleShiftCategory) => category === 'night' ? '夜班' : '白班';
export const roleGroupLabel = (group: string) => group ? `${group} 组` : '长白班';

// 固定人员行顺序：以每个「班组 + 白/夜班」最后一条岗位划分的人员顺序为基准，
// 轮换改变的只是人员身上的标签（巡检区域 / 做表 / 休息），人员位置不随日期跳动。
export function normalizeRolePersonOrder(roles: DutyRoleAssignment[]): DutyRoleAssignment[] {
  const groups = new Map<string, DutyRoleAssignment[]>();
  for (const role of roles) {
    const key = `${role.group}|${roleShiftCategory(role.shiftType)}`;
    groups.set(key, [...(groups.get(key) || []), role]);
  }

  const orders = new Map<string, Map<string, number>>();
  for (const [key, list] of groups) {
    const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date));
    const reference = sorted[sorted.length - 1];
    const order = new Map<string, number>();
    const remember = (person: string) => {
      const name = (person || '').trim();
      if (name && !order.has(name)) order.set(name, order.size);
    };
    // 基准顺序先取巡检区域，再补齐该组出现过的其他人员，保证每人都能定位。
    sortRolePosts(reference.posts).forEach(post => remember(post.person));
    sorted.forEach(role => role.posts.forEach(post => remember(post.person)));
    orders.set(key, order);
  }

  return roles.map(role => {
    const order = orders.get(`${role.group}|${roleShiftCategory(role.shiftType)}`);
    if (!order) return role;
    const rank = (person: string) => order.get((person || '').trim()) ?? Number.MAX_SAFE_INTEGER;
    const posts = [...role.posts].sort((a, b) => rank(a.person) - rank(b.person));
    // 顺序未变时复用原对象，避免无意义的重新渲染。
    return posts.every((post, index) => post === role.posts[index]) ? role : { ...role, posts };
  });
}

export type RoleDraft = Omit<DutyRoleAssignment, 'posts'> & {
  uid: string;
  leaderLabel: string;
  originalLeaderLabel: string;
  posts: { name: string; person: string; originalName: string; kind?: DutyRolePostKind }[];
};

let draftSeq = 0;
const nextDraftUid = () => `role-draft-${++draftSeq}`;

export const createRoleDrafts = (roles: DutyRoleAssignment[]): RoleDraft[] => roles.map(role => ({
  ...role, uid: nextDraftUid(), leaderLabel: dutyLeaderLabel(role), originalLeaderLabel: dutyLeaderLabel(role),
  // 编辑框直接显示去掉「副岗位」的短名称；originalName 保留原值，保存时作为整表改名应用。
  // 同类型标签按巡检 → 做表 → 休息排队，保证每张表里位置一致。
  posts: sortRolePosts(role.posts).map(post => ({ ...post, name: postLabel(post.name) || post.name, originalName: post.name.trim() })),
}));

// 新建条目：原名称留空，避免把岗位改名误当成整张表的统一改名。
export const createRoleDraft = (date: string, group: string, category: RoleShiftCategory): RoleDraft => ({
  date,
  group,
  shiftType: category === 'night' ? 'night' : 'morning',
  uid: nextDraftUid(),
  leaderLabel: '值班长',
  originalLeaderLabel: '',
  posts: [],
});

export function addRoleDraft(list: RoleDraft[], date: string, group: string, category: RoleShiftCategory): RoleDraft[] {
  return [...list, createRoleDraft(date, group, category)];
}

export function updateRoleDraftShift(
  list: RoleDraft[],
  row: number,
  patch: { group?: string; category?: RoleShiftCategory }
): RoleDraft[] {
  return list.map((draft, index) => {
    if (index !== row) return draft;
    const next = { ...draft };
    if (patch.group !== undefined) next.group = patch.group;
    if (patch.category && roleShiftCategory(draft.shiftType) !== patch.category) {
      next.shiftType = patch.category === 'night' ? 'night' : 'morning';
    }
    return next;
  });
}

export function removeRoleDraft(list: RoleDraft[], row: number): RoleDraft[] {
  return list.filter((_, index) => index !== row);
}

// Match original labels rather than each keystroke, so chained renames and swaps are unambiguous.
export function renameRoleDraft(list: RoleDraft[], row: number, post: number | null, name: string): RoleDraft[] {
  const origin = post === null ? list[row].originalLeaderLabel : list[row].posts[post].originalName;
  return list.map((role, i) => ({ ...role,
    leaderLabel: (origin && role.originalLeaderLabel === origin) || (i === row && post === null) ? name : role.leaderLabel,
    posts: role.posts.map((item, j) => (origin ? item.originalName === origin : i === row && j === post) ? { ...item, name } : item),
  }));
}
export function finishRoleEdits(list: RoleDraft[]): { roles: DutyRoleAssignment[]; renames: RoleNameChange[] } {
  const changes = new Map<string, string>();
  const collect = (from: string, to: string) => {
    if (from && !to) throw new Error('岗位名称不能为空；移除岗位请使用删除按钮');
    if (from && from !== to) changes.set(from, to);
  };
  const seen = new Set<string>();
  const roles = list.map(({ originalLeaderLabel, uid, posts, ...role }) => {
    const key = `${role.group}|${roleShiftCategory(role.shiftType)}`;
    if (seen.has(key)) throw new Error(`${roleGroupLabel(role.group)}${roleShiftLabel(roleShiftCategory(role.shiftType))}已存在岗位划分，请合并后再保存`);
    seen.add(key);
    const leaderLabel = role.leaderLabel.trim();
    collect(originalLeaderLabel, leaderLabel);
    const cleaned = sortRolePosts(posts.map(post => {
      const name = post.name.trim(), person = post.person.trim();
      collect(post.originalName, name);
      if (person && !name) throw new Error('请填写标签名称');
      return { name, person, kind: dutyPostKind(name) };
    }).filter(post => post.person));
    return { ...role, leaderLabel, leader: role.leader?.trim(), posts: cleaned };
  });
  return { roles, renames: [...changes].map(([from, to]) => ({ from, to })) };
}
export function applyDutyRoleEdits(existing: DutyRoleAssignment[], date: string, edited: DutyRoleAssignment[], renames: RoleNameChange[]): DutyRoleAssignment[] {
  const changes = new Map(renames.map(change => [change.from, change.to]));
  // Apply exactly once to untouched dates; edited rows already contain the new labels.
  return [...existing.filter(role => role.date !== date).map(role => {
    const leaderLabel = changes.get(dutyLeaderLabel(role));
    return { ...role, ...(leaderLabel ? { leaderLabel } : {}),
      posts: role.posts.map(post => ({ ...post, name: changes.get(post.name.trim()) ?? post.name })),
    };
  }), ...edited.map(role => ({ ...role, date }))];
}
