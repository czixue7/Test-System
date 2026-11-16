import assert from 'node:assert/strict';
import { createRoleDrafts, renameRoleDraft, finishRoleEdits, applyDutyRoleEdits, dutyLeaderLabel } from '../src/utils/dutyRoleEdits';
import type { DutyRoleAssignment } from '../src/types';
const roles: DutyRoleAssignment[] = [
  { date: '2026-10-21', group: 'C', shiftType: 'night', leader: '张三', posts: [{ name: '配电', person: '李四' }, { name: '暖通', person: '王五' }] },
  { date: '2026-10-21', group: 'A', shiftType: 'morning', leader: '赵六', posts: [{ name: '配电', person: '钱七' }] },
  { date: '2026-10-22', group: 'D', shiftType: 'night', leader: '孙八', posts: [{ name: '配电', person: '周九' }, { name: '暖通', person: '吴十' }] },
];
const untouched = structuredClone(roles);
let drafts = createRoleDrafts(roles.filter(role => role.date === '2026-10-21'));
drafts = renameRoleDraft(drafts, 0, null, '当班负责人');
drafts = renameRoleDraft(drafts, 0, 0, '供配电');
drafts[0].leader = '新值班长';
drafts[0].posts[0].person = '新成员';
const edits = finishRoleEdits(drafts);
const result = applyDutyRoleEdits(roles, '2026-10-21', edits.roles, edits.renames);
assert(result.every(role => dutyLeaderLabel(role) === '当班负责人'));
assert(result.every(role => role.posts.some(post => post.name === '供配电')));
assert.equal(result.find(role => role.date === '2026-10-22')!.leader, '孙八');
assert.equal(result.find(role => role.date === '2026-10-22')!.posts[0].person, '周九');
assert.equal(result.find(role => role.group === 'A')!.posts[0].person, '钱七');
assert.equal(result.find(role => role.group === 'C')!.posts[0].person, '新成员');
assert.deepEqual(roles, untouched, 'draft edits must not mutate source data');
assert(!JSON.stringify(result).includes('originalName'));
let swapped = renameRoleDraft(createRoleDrafts([roles[0]]), 0, 0, '暖通');
swapped = renameRoleDraft(swapped, 0, 1, '配电');
const swapEdits = finishRoleEdits(swapped);
const swappedTable = applyDutyRoleEdits(roles, roles[0].date, swapEdits.roles, swapEdits.renames);
assert.deepEqual(swappedTable.find(role => role.date === '2026-10-22')!.posts.map(post => post.name), ['暖通', '配电'], 'name swaps apply once without cascading');
assert.throws(() => finishRoleEdits(renameRoleDraft(createRoleDrafts([roles[0]]), 0, null, '  ')), /不能为空/);
console.log('✓ 岗位统一改名：全部日期/班组、值班长名称、姓名仅当天、交换名称不串改、草稿隔离与空名称校验');
