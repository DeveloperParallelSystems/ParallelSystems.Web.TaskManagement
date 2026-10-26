import test from 'node:test';
import assert from 'node:assert/strict';
import { clientDashboardGroups, dashboardDueMatches, dashboardTaskOverdue,
    dashboardTaskSummary, sortDashboardClients } from '../src/features/tasks/clientDashboard.js';

const clients = [{ id: 'a', name: 'Acme' }, { id: 'b', name: 'Beta' }, { id: 'zero', name: 'Zero' }];
const projects = [{ id: 'shared', clientIds: ['a', 'b'] }, { id: 'single', clientIds: ['a'] }];
const today = '2026-10-26';
const task = (id, values = {}) => ({ id, projectId: 'shared', clientId: 'a', status: 'In Progress', ...values });

test('client dashboard counts each task once using its own available client assignment', () => {
    const tasks = [task('a'), task('b', { clientId: 'B' }), task('null', { clientId: null }),
        task('detached', { projectId: 'single', clientId: 'b' }), task('removed', { clientId: 'removed' }),
        task('historical', { projectId: 'missing' }), task('general', { projectId: null, clientId: 'a' })];
    const original = structuredClone(tasks);
    const groups = clientDashboardGroups({ tasks, projects, clients, today });
    assert.deepEqual(groups.clients.map((group) => [group.id, group.tasks.map((item) => item.id)]),
        [['a', ['a']], ['b', ['b']], ['zero', []]]);
    assert.deepEqual(groups.other.map((group) => [group.id, group.summary.total]), [['unassigned', 4], ['general', 1]]);
    assert.deepEqual(groups.clients.map((group) => [group.id, group.projectCount]), [['a', 2], ['b', 1], ['zero', 0]]);
    assert.deepEqual(groups.other.map((group) => [group.id, group.projectCount]), [['unassigned', 2], ['general', 0]]);
    const ids = [...groups.clients, ...groups.other].flatMap((group) => group.tasks.map((item) => item.id));
    assert.equal(ids.length, tasks.length);
    assert.equal(new Set(ids).size, tasks.length);
    assert.deepEqual(tasks, original);
    const afterAccessLoss = clientDashboardGroups({ tasks: [tasks[1]], projects, clients: [clients[1]], today });
    assert.deepEqual(afterAccessLoss.clients.map((group) => group.id), ['b']);
    assert.equal(afterAccessLoss.clients[0].summary.total, 1);
    assert.deepEqual(afterAccessLoss.other, []);
});

test('dashboard counts deadlines and missing current owners without inferring completion from columns', () => {
    const items = [task('todo', { status: 'To Do', assigneeId: 'owner' }),
        task('custom', { status: 'qa', liveStatusMode: true, statusBoardStatus: 'Completed', dueDate: '2026-10-25', assigneeId: 'OWNER' }),
        task('review', { status: 'In Review', dueDate: '2026-10-26', assigneeId: ' ' }), task('done', { status: 'Completed', dueDate: '2026-10-01' }),
        task('cancelled', { status: 'Cancelled', dueDate: '2026-10-01' }),
        task('release', { status: 'Ready for Release', dueDate: '2026-11-01', originalAssigneeId: 'someone' }),
        task('workflow-done', { status: 'issued', dueDate: '2026-10-01', workflow: {
            definition: { stages: [{ id: 'issued', kind: 'Completed' }] },
        } })];
    const summary = dashboardTaskSummary(items, today);
    assert.deepEqual(summary, { total: 7, overdue: 1, dueThisWeek: 2, withoutOwner: 5 });
    assert.deepEqual(dashboardTaskSummary([], today), { total: 0, overdue: 0, dueThisWeek: 0, withoutOwner: 0 });
    assert.equal(dashboardTaskOverdue(task('invalid', { dueDate: '2026-02-30' }), today), false);
});

test('due filters use inclusive local Monday–Sunday deadlines and retain undated work under All dates', () => {
    for (const date of ['2026-10-26', '2026-11-01']) {
        assert.equal(dashboardDueMatches(task(date, { dueDate: date }), 'week', today), true);
        assert.equal(dashboardDueMatches(task(date, { dueDate: date }), 'week', '2026-11-01'), true);
    }
    for (const date of ['2026-10-25', '2026-11-02', null, '2026-10-40']) {
        assert.equal(dashboardDueMatches(task('outside', { dueDate: date }), 'week', today), false);
    }
    assert.equal(dashboardDueMatches(task('undated'), 'all', today), true);
    assert.equal(dashboardDueMatches(task('today', { dueDate: today }), 'overdue', today), false);
    assert.equal(dashboardDueMatches(task('late', { dueDate: '2026-10-25' }), 'overdue', today), true);
    assert.equal(dashboardDueMatches(task('done', { status: 'Completed', dueDate: '2026-10-25' }), 'overdue', today), false);
    assert.equal(dashboardDueMatches(task('leap', { dueDate: '2028-02-29' }), 'week', '2028-03-01'), true);
    const groups = clientDashboardGroups({ tasks: [task('late', { clientId: null, dueDate: '2026-10-25' }),
        task('general', { projectId: null })], projects, clients, today, due: 'week' });
    assert.equal(groups.other.length, 2, 'Other work remains discoverable when a date filter matches nothing.');
    assert.ok(groups.other.every((group) => group.summary.total === 0 && group.totalAvailable === 1));
    assert.deepEqual(groups.clients.map((group) => group.projectCount), [2, 1, 0], 'Project counts include empty projects and do not change with the date filter.');
});

test('clients sort by overdue, projects, due this week, missing owners or name without mutating the catalog', () => {
    const groups = clientDashboardGroups({ tasks: [task('late', { dueDate: '2026-10-25' }),
        task('upcoming', { clientId: 'b', dueDate: '2026-10-27' }),
        task('missing-owner', { clientId: 'b' }),
        task('owned', { clientId: 'b', assigneeId: 'someone' })], projects, clients, today }).clients;
    assert.deepEqual(sortDashboardClients(groups, 'overdue').map((group) => group.id), ['a', 'b', 'zero']);
    assert.deepEqual(sortDashboardClients(groups, 'week').map((group) => group.id), ['b', 'a', 'zero']);
    assert.deepEqual(sortDashboardClients(groups, 'projects').map((group) => group.id), ['a', 'b', 'zero']);
    assert.deepEqual(sortDashboardClients(groups, 'withoutOwner').map((group) => group.id), ['b', 'a', 'zero']);
    assert.deepEqual(sortDashboardClients(groups, 'name').map((group) => group.id), ['a', 'b', 'zero']);
    assert.deepEqual(groups.map((group) => group.id), ['a', 'b', 'zero']);
});
