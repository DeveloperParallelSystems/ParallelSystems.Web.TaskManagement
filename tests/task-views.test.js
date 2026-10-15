import test from 'node:test';
import assert from 'node:assert/strict';
import { filterTasks, getProjectContributors, sortTasks, staffOptionLabel } from '../src/features/tasks/workflow.js';
import { defaultTaskQuery, parseTaskQuery, serializeTaskQuery } from '../src/features/tasks/taskQuery.js';
import { canMoveTask, needsReviewNote, taskInput } from '../src/features/tasks/taskActions.js';
import { taskCsv } from '../src/features/tasks/taskCsv.js';

const tasks = [
    { id: 'a', code: 'TASK-0001', title: 'Zebra', description: 'Coordinates across teams', assigneeId: 'me', reviewerId: 'other', releaseOwnerId: 'other', createdById: 'other', status: 'In Progress', priority: 'Urgent', dueDate: '2026-10-09', updatedAtUtc: '2026-10-08T02:00:00Z' },
    { id: 'b', code: 'TASK-0002', title: 'Alpha', assigneeId: 'other', reviewerId: 'me', releaseOwnerId: 'me', createdById: 'me', status: 'Ready for Review', priority: 'Low', dueDate: '2026-10-11', updatedAtUtc: '2026-10-09T02:00:00Z' },
    { id: 'c', code: 'TASK-0003', title: 'beta', assigneeId: 'other', reviewerId: 'me', status: 'Failed Review', priority: 'High', dueDate: null, updatedAtUtc: '2026-10-10T02:00:00Z' },
    { id: 'd', title: 'Completed', assigneeId: null, reviewerId: 'me', releaseOwnerId: 'me', status: 'Completed', dueDate: '2026-10-01' },
];
const ids = (items) => items.map((item) => item.id);

test('quick views apply actor roles, review stages, creator identity and local overdue dates', () => {
    const expected = { 'my-work': ['a'], review: ['b'], releases: ['b', 'd'], created: ['b'], overdue: ['a'] };
    for (const [quickView, result] of Object.entries(expected)) {
        assert.deepEqual(ids(filterTasks(tasks, { ...defaultTaskQuery, quickView }, 'me', [], new Date(2026, 9, 10))), result);
    }
    assert.deepEqual(filterTasks(tasks, { ...defaultTaskQuery, quickView: 'created' }, 'missing'), []);
    assert.deepEqual(filterTasks(tasks, { ...defaultTaskQuery, quickView: 'review', mine: true }, 'me'), []);
});

test('personal filters follow the staff-to-account link and keep creator identity separate', () => {
    const people = [{ id: 'staff-me', name: 'Staff Name', userId: 'account-me', isActive: true }];
    const assigned = [{ id: 'staff-task', status: 'In Review', assigneeId: 'staff-me', reviewerId: 'staff-me', releaseOwnerId: 'staff-me', createdById: 'account-me' }];
    for (const quickView of ['my-work', 'review', 'releases', 'created']) {
        assert.deepEqual(ids(filterTasks(assigned, { quickView }, 'account-me', people)), ['staff-task']);
    }
    assert.deepEqual(ids(filterTasks(assigned, { mine: true }, 'account-me', people)), ['staff-task']);
    assert.deepEqual(filterTasks(assigned, { mine: true }, 'account-me', [{ ...people[0], userId: null }]), []);
    assert.deepEqual(filterTasks(assigned, { quickView: 'my-work' }, 'other-account', people), []);
    assert.deepEqual(filterTasks([{ ...assigned[0], assigneeId: 'account-me' }], { mine: true }, 'account-me',
        [{ id: 'account-me', userId: 'another-account', name: 'Different staff' }]), []);
});

test('staff options show full name and email with safe fallbacks and disabled legacy labels', () => {
    const staff = { name: 'jcooper', firstName: ' Jamie ', lastName: ' Cooper ', email: ' jamie@example.test ', isActive: true };
    assert.equal(staffOptionLabel({ ...staff, userId: null }), 'Jamie, Cooper <jamie@example.test>');
    assert.equal(staffOptionLabel({ ...staff, userId: 'account', accountIsActive: false }), 'Jamie, Cooper <jamie@example.test>');
    assert.equal(staffOptionLabel({ ...staff, firstName: null, lastName: null }), 'jcooper <jamie@example.test>');
    assert.equal(staffOptionLabel({ ...staff, firstName: '', email: null }), 'Cooper');
    assert.equal(staffOptionLabel({ ...staff, lastName: ' ', email: ' ' }), 'Jamie');
    assert.equal(staffOptionLabel({ name: 'Legacy', isActive: false }), 'Legacy (legacy account — choose staff)');
    assert.equal(staffOptionLabel({ name: 'Jamie', isActive: true, userId: 'account', accountIsActive: true }), 'Jamie');
});

test('project contributors deduplicate staff across tasks and roles while excluding other projects', () => {
    const projectTasks = [
        { projectId: 'project', originalAssigneeId: 'dev', assigneeId: 'dev', assigneeName: 'Developer', reviewerId: 'qa' },
        { projectId: 'project', status: 'Completed', originalAssigneeId: 'dev', assigneeId: null, reviewerId: 'qa', releaseOwnerId: 'release' },
        { projectId: 'project', originalAssigneeId: 'qa', assigneeId: 'owner' },
        { projectId: 'other-project', originalAssigneeId: 'unrelated' },
    ];
    const contributors = getProjectContributors(projectTasks, 'project');
    assert.deepEqual(contributors.map((person) => person.id), ['dev', 'qa', 'release', 'owner']);
    assert.equal(contributors[0].description, 'Original assignee · Current owner');
    assert.equal(contributors[0].fallbackName, 'Developer');
    assert.equal(contributors[1].description, 'Reviewer / QA · Original assignee');
    assert.deepEqual(getProjectContributors(projectTasks, 'empty-project'), []);
});

test('extended search resolves participant names from lookups and matches descriptions', () => {
    const people = [{ id: 'other', name: 'Alice Reviewer' }];
    assert.deepEqual(ids(filterTasks(tasks, { search: 'coordinates' }, 'me')), ['a']);
    assert.deepEqual(ids(filterTasks(tasks, { search: 'alice', status: 'In Progress' }, 'me', people)), ['a']);
    assert.deepEqual(ids(filterTasks([{ ...tasks[0], releaseOwnerName: 'Taylor Release', assigneeId: null }], { search: 'taylor' }, 'me')), ['a']);
});

test('sorts due dates, priority, updated dates and titles without mutating input; missing values stay last', () => {
    const subset = tasks.slice(0, 3);
    assert.deepEqual(ids(sortTasks(subset, 'dueDate', 'asc')), ['a', 'b', 'c']);
    assert.deepEqual(ids(sortTasks(subset, 'dueDate', 'desc')), ['b', 'a', 'c']);
    assert.deepEqual(ids(sortTasks(subset, 'priority', 'desc')), ['a', 'c', 'b']);
    assert.deepEqual(ids(sortTasks(subset, 'priority', 'asc')), ['b', 'c', 'a']);
    assert.deepEqual(ids(sortTasks(subset, 'updatedAtUtc', 'desc')), ['c', 'b', 'a']);
    assert.deepEqual(ids(sortTasks(subset, 'title', 'asc')), ['b', 'c', 'a']);
    assert.deepEqual(ids(subset), ['a', 'b', 'c']);
});

test('URL state round trips special characters, every control and preserves unrelated query keys', () => {
    const state = { search: 'QA & drawings + café', discipline: 'Drafting', status: 'In Review', projectId: 'project-id', mine: true, labelIds: [], quickView: 'review', sort: 'dueDate', direction: 'asc', view: 'list', assigneeId: '', month: '' };
    const query = serializeTaskQuery(state, 'external=keep&q=old');
    assert.deepEqual(parseTaskQuery(query), state);
    assert.equal(new URLSearchParams(query).get('external'), 'keep');
    assert.equal(serializeTaskQuery(defaultTaskQuery, query), 'external=keep');
    assert.deepEqual(parseTaskQuery('?sort=unknown&dir=sideways&view=bad&quick=bad&status=invalid&discipline=unknown&mine=false'), defaultTaskQuery);
});

test('drag targets require loaded server permissions and preserve admin-only cancel/reopen', () => {
    const details = { task: { status: 'In Progress' }, allowedStatuses: ['In Progress', 'Ready for Review', 'Cancelled'] };
    assert.equal(canMoveTask(null, 'Ready for Review', true), false);
    assert.equal(canMoveTask(details, 'Approved', true), false);
    assert.equal(canMoveTask(details, 'In Progress', true), false);
    assert.equal(canMoveTask(details, 'Ready for Review', false), true);
    assert.equal(canMoveTask(details, 'Cancelled', false), false);
    assert.equal(canMoveTask(details, 'Cancelled', true), true);
    assert.equal(canMoveTask({ task: { status: 'Completed' }, allowedStatuses: ['To Do'] }, 'To Do', false), false);
    assert.equal(needsReviewNote('Approved'), true);
    assert.equal(needsReviewNote('Failed Review'), true);
    assert.equal(needsReviewNote('Ready for Review'), false);
});

test('mutation payload preserves version and unrelated fields while status suggests its owner', () => {
    const task = { ...tasks[0], version: 7, originalAssigneeId: 'me', reviewerId: 'reviewer' };
    const input = taskInput(task, { status: 'Ready for Review' });
    assert.equal(input.version, 7);
    assert.equal(input.description, task.description);
    assert.equal(input.assigneeId, 'reviewer');
    assert.equal(taskInput(task, { dueDate: null }).status, task.status);
    assert.equal(taskInput(task, { assigneeId: 'new' }).assigneeId, 'new');
});

test('CSV escapes quotes/newlines, preserves unicode and neutralizes spreadsheet formulas', () => {
    const csv = taskCsv([{ ...tasks[0], title: '=HYPERLINK("bad")', description: 'Line 1\nLine "2", café', projectName: ' +formula' }]);
    assert.ok(csv.startsWith('\uFEFF"Code","Title"'));
    assert.ok(csv.includes('"\'=HYPERLINK(""bad"")"'));
    assert.ok(csv.includes('"Line 1\nLine ""2"", café"'));
    assert.ok(csv.includes('"\' +formula"'));
    assert.equal(taskCsv([]).split('\r\n').length, 2);
    assert.equal(csv.includes('TASK-0002'), false);
});
