import test from 'node:test';
import assert from 'node:assert/strict';
import { filterTasks } from '../src/features/tasks/workflow.js';
import { defaultTaskQuery, parseTaskQuery, serializeTaskQuery } from '../src/features/tasks/taskQuery.js';

test('mockup saved views use linked staff and current-week deadlines without closed work', () => {
    const tasks = [
        { id: 'mine', assigneeId: 'staff', status: 'In Progress', dueDate: '2026-10-15' },
        { id: 'monday', status: 'To Do', dueDate: '2026-10-12' },
        { id: 'sunday', status: 'To Do', dueDate: '2026-10-18T00:00:00' },
        { id: 'next', status: 'To Do', dueDate: '2026-10-19' },
        { id: 'previous', status: 'To Do', dueDate: '2026-10-11' },
        { id: 'closed', assigneeId: 'staff', status: 'Completed', dueDate: '2026-10-15' },
        { id: 'configured-closed', assigneeId: 'staff', status: 'issued', dueDate: '2026-10-15',
            workflow: { definition: { stages: [{ id: 'issued', kind: 'Completed' }] } } },
        { id: 'invalid', status: 'To Do', dueDate: '2026-02-30' },
    ];
    const people = [{ id: 'staff', userId: 'account' }];
    const select = (quickView, today = new Date(2026, 9, 15)) => filterTasks(tasks,
        { ...defaultTaskQuery, quickView }, 'account', people, today).map((task) => task.id);
    assert.deepEqual(select('my-open'), ['mine']);
    assert.deepEqual(select('due-week'), ['mine', 'monday', 'sunday']);
    assert.deepEqual(select('due-week', new Date(2026, 9, 18)), ['mine', 'monday', 'sunday']);
    assert.deepEqual(select('due-week', new Date(2026, 9, 19)), ['next']);
    for (const quickView of ['my-open', 'due-week']) {
        assert.equal(parseTaskQuery(serializeTaskQuery({ ...defaultTaskQuery, quickView })).quickView, quickView);
    }
    assert.deepEqual(filterTasks(tasks, { quickView: 'my-open' }, 'unlinked', people), []);
});
