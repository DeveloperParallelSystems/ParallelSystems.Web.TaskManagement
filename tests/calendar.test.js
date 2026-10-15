import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { filterTasks } from '../src/features/tasks/workflow.js';
import { defaultTaskQuery, parseTaskQuery, serializeTaskQuery } from '../src/features/tasks/taskQuery.js';

const staff = '11111111-1111-1111-1111-111111111111';
const other = '22222222-2222-2222-2222-222222222222';

test('calendar month and current-owner filters round-trip through task links and reset', () => {
    const filters = parseTaskQuery(`view=calendar&month=2028-02&assignee=${staff.toUpperCase()}&project=project&label=${other}`);
    assert.equal(filters.view, 'calendar');
    assert.equal(filters.month, '2028-02');
    assert.equal(filters.assigneeId, staff);
    const query = serializeTaskQuery(filters, 'external=keep');
    assert.deepEqual(parseTaskQuery(query), filters);
    assert.match(query, /external=keep/);
    const reset = new URLSearchParams(serializeTaskQuery(defaultTaskQuery, query));
    assert.equal(reset.has('assignee'), false);
    assert.equal(reset.has('month'), false);
    assert.equal(reset.get('external'), 'keep');
    assert.equal(parseTaskQuery('assignee=unassigned').assigneeId, 'unassigned');
    for (const month of ['2028-13', '2028-00', '0000-01', '2028-2', 'oops', '10000-01']) {
        assert.equal(parseTaskQuery(`month=${month}`).month, '');
    }
    assert.equal(parseTaskQuery('assignee=invalid').assigneeId, '');
});

test('assignee filtering uses current Staff Information owner, combines filters, and preserves input', () => {
    const tasks = [
        { id: 'owner', assigneeId: staff, projectId: 'project', status: 'In Review', labels: [{ id: other }] },
        { id: 'original-only', originalAssigneeId: staff, assigneeId: other, projectId: 'project' },
        { id: 'reviewer-only', reviewerId: staff, assigneeId: other, projectId: 'project' },
        { id: 'another-project', assigneeId: staff, projectId: 'another' },
        { id: 'no-owner', assigneeId: null, projectId: 'project' },
    ];
    const before = structuredClone(tasks);
    assert.deepEqual(filterTasks(tasks, { assigneeId: staff, projectId: 'project', labelIds: [other] }).map((task) => task.id), ['owner']);
    assert.deepEqual(filterTasks(tasks, { assigneeId: 'unassigned' }).map((task) => task.id), ['no-owner']);
    assert.deepEqual(filterTasks(tasks, { assigneeId: other, mine: true }, 'account', [{ id: staff, userId: 'account' }]), []);
    assert.deepEqual(tasks, before);
});

test('month grid handles leap years, Monday starts, year boundaries and date-only deadlines', async () => {
    const { calendarDays, shiftMonth, deadlineKey, localDayKey } = await import('../src/features/tasks/calendar.js');
    const days = calendarDays('2028-02');
    assert.equal(days.length, 42);
    assert.equal(days[0].key, '2028-01-31');
    assert.equal(days.filter((day) => day.inMonth).length, 29);
    assert.equal(calendarDays('2027-02').filter((day) => day.inMonth).length, 28);
    assert.equal(calendarDays('2026-03')[0].key, '2026-02-23');
    assert.equal(shiftMonth('2026-12', 1), '2027-01');
    assert.equal(shiftMonth('2026-01', -1), '2025-12');
    assert.equal(shiftMonth('0001-01', -1), '0001-01');
    assert.equal(shiftMonth('9999-12', 1), '9999-12');
    assert.equal(deadlineKey('2028-02-29T00:00:00'), '2028-02-29');
    assert.equal(deadlineKey('2026-10-14T00:00:00Z'), '2026-10-14');
    assert.equal(deadlineKey('2027-02-29'), '');
    assert.equal(deadlineKey('bad-date'), '');
    assert.equal(deadlineKey(null), '');
    assert.equal(localDayKey(new Date(2026, 9, 14, 0, 1)), '2026-10-14');
});

test('planning separates open overdue, today, next 30 days and undated tasks independently of calendar month', async () => {
    const { planTasks } = await import('../src/features/tasks/calendar.js');
    const tasks = [
        { id: 'late', dueDate: '2026-10-13', status: 'Blocked' },
        { id: 'today', dueDate: '2026-10-14T00:00:00', status: 'Approved' },
        { id: 'next', dueDate: '2026-10-15', status: 'In Progress' },
        { id: 'boundary', dueDate: '2026-11-13', status: 'To Do' },
        { id: 'later', dueDate: '2026-11-14', status: 'To Do' },
        { id: 'undated', dueDate: null, status: 'Backlog' },
        { id: 'complete', dueDate: '2026-10-12', status: 'Completed' },
        { id: 'cancelled', dueDate: '2026-10-15', status: 'Cancelled' },
    ];
    const before = structuredClone(tasks);
    const plan = planTasks(tasks, '2026-10-14');
    const ids = (items) => items.map((task) => task.id);
    assert.deepEqual(ids(plan.overdue), ['late']);
    assert.deepEqual(ids(plan.today), ['today']);
    assert.deepEqual(ids(plan.upcoming), ['next', 'boundary']);
    assert.deepEqual(ids(plan.undated), ['undated']);
    assert.equal(plan.byDay['2026-10-12'][0].id, 'complete');
    assert.equal(plan.byDay['2026-10-15'].length, 2);
    assert.equal(plan.upcomingEnd, '2026-11-13');
    assert.deepEqual(tasks, before);
});

test('calendar options derive from currently visible task references including historical projects and legacy owners', async () => {
    const { calendarFilterOptions } = await import('../src/features/tasks/calendar.js');
    const tasks = [
        { id: 'a', projectId: 'historic', projectName: 'Historic project', assigneeId: staff, assigneeName: 'Staff name' },
        { id: 'b', projectId: 'historic', projectName: 'Historic project', assigneeId: other, assigneeName: 'Legacy name' },
        { id: 'c', projectId: null, assigneeId: null },
    ];
    const options = calendarFilterOptions(tasks, [{ id: staff, name: 'Staff name', email: 'staff@example.test', isActive: true }],
        [{ id: 'new', name: 'New project' }]);
    assert.deepEqual(options.owners.map((owner) => owner.id), [other, staff]);
    assert.match(options.owners.find((owner) => owner.id === staff).name, /staff@example.test/);
    assert.deepEqual(options.projects.map((project) => project.id), ['historic', 'new']);
    assert.deepEqual(calendarFilterOptions([], [], []).owners, []);
});

test('deadlines stay on their calendar date across time zones while today uses the local day', () => {
    const script = `import { deadlineKey, localDayKey, planTasks } from './src/features/tasks/calendar.js';
        console.log(JSON.stringify({ due: deadlineKey('2026-10-14T00:00:00Z'),
            today: localDayKey(new Date('2026-10-14T00:30:00Z')),
            upcoming: planTasks([], '2026-03-01').upcomingEnd }));`;
    for (const [zone, expected] of [['America/Los_Angeles', '2026-10-13'], ['Asia/Shanghai', '2026-10-14'], ['Pacific/Kiritimati', '2026-10-14']]) {
        const output = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
            encoding: 'utf8', env: { ...process.env, TZ: zone },
        });
        assert.deepEqual(JSON.parse(output), { due: '2026-10-14', today: expected, upcoming: '2026-03-31' });
    }
});

test('planning re-derives from refreshed authorized tasks without retaining removed dates or identities', async () => {
    const { planTasks } = await import('../src/features/tasks/calendar.js');
    const task = { id: 'task', status: 'To Do', dueDate: '2026-10-14' };
    assert.equal(planTasks([task], '2026-10-14').today.length, 1);
    const changed = planTasks([{ ...task, dueDate: '2026-11-01' }], '2026-10-14');
    assert.equal(changed.today.length, 0);
    assert.equal(changed.byDay['2026-10-14'], undefined);
    assert.equal(changed.upcoming.length, 1);
    const revoked = planTasks([], '2026-10-14');
    assert.deepEqual(revoked.byDay, {});
    assert.deepEqual(revoked.upcoming, []);
    assert.equal(planTasks([task], '2026-10-15').overdue.length, 1);
});
