import test from 'node:test';
import assert from 'node:assert/strict';
import { changeTaskField, filterTasks, isOverdue, suggestAssignee } from '../src/features/tasks/workflow.js';

test('workflow assigns review, correction, release and terminal owners', () => {
    const values = {
        originalAssigneeId: 'worker',
        reviewerId: 'reviewer',
        releaseOwnerId: 'release',
        assigneeId: 'current',
    };
    assert.equal(suggestAssignee(values, 'Ready for Review'), 'reviewer');
    assert.equal(suggestAssignee(values, 'Failed Review'), 'worker');
    assert.equal(suggestAssignee(values, 'Ready for Re-Review'), 'reviewer');
    assert.equal(suggestAssignee(values, 'Approved'), 'release');
    assert.equal(suggestAssignee(values, 'Completed'), '');
    assert.equal(suggestAssignee(values, 'Blocked'), 'current');
});

test('approval without release retains the reviewer for closure', () => {
    assert.equal(suggestAssignee({ reviewerId: 'reviewer', releaseOwnerId: '' }, 'Approved'), 'reviewer');
});

test('participant changes follow suggested ownership and preserve administrator overrides', () => {
    const current = { status: 'Ready for Review', reviewerId: 'old', assigneeId: 'old' };
    assert.equal(changeTaskField(current, 'reviewerId', 'new').assigneeId, 'new');
    assert.equal(changeTaskField({ ...current, assigneeId: 'override' }, 'reviewerId', 'new').assigneeId, 'override');
    assert.equal(changeTaskField({ ...current, assigneeId: '' }, 'reviewerId', 'new').assigneeId, 'new');
    assert.equal(changeTaskField({ status: 'Approved', reviewerId: 'reviewer', releaseOwnerId: '', assigneeId: 'reviewer' }, 'releaseOwnerId', 'release').assigneeId, 'release');
});

test('overdue uses the local date and excludes completed or cancelled tasks', () => {
    const today = new Date(2026, 9, 10, 0, 15);
    assert.equal(isOverdue({ dueDate: '2026-10-09T00:00:00', status: 'In Progress' }, today), true);
    assert.equal(isOverdue({ dueDate: '2026-10-10', status: 'In Progress' }, today), false);
    assert.equal(isOverdue({ dueDate: '2026-10-09', status: 'Completed' }, today), false);
    assert.equal(isOverdue({ dueDate: null, status: 'To Do' }, today), false);
});

test('search and assignment filters compose without changing the source data', () => {
    const tasks = [
        {
            id: '1',
            code: 'TASK-0001',
            title: 'Review drawings',
            projectName: 'Riverside',
            projectId: 'p1',
            discipline: 'Drafting',
            status: 'In Review',
            assigneeId: 'me',
        },
        {
            id: '2',
            code: 'TASK-0002',
            title: 'Review code',
            projectName: 'Riverside',
            projectId: 'p1',
            discipline: 'Development',
            status: 'In Review',
            assigneeId: 'other',
        },
    ];
    const result = filterTasks(
        tasks,
        { search: ' RIVERSIDE ', discipline: '', status: 'In Review', projectId: 'p1', mine: true },
        'me',
    );
    assert.deepEqual(
        result.map((task) => task.id),
        ['1'],
    );
    assert.equal(tasks.length, 2);
});
