import test from 'node:test';
import assert from 'node:assert/strict';
import { boardMoveStatuses, taskKind, taskStatusName, taskStatusKey, isTaskClosed, workflowBoards, taskStatusOptions, ownerForStage, initializeTaskWorkflow, changeWorkflowField } from '../src/features/tasks/taskWorkflow.js';
import { filterTasks, isOverdue } from '../src/features/tasks/workflow.js';
import { parseTaskQuery, serializeTaskQuery } from '../src/features/tasks/taskQuery.js';
import { planTasks } from '../src/features/tasks/calendar.js';
import { canMoveTask } from '../src/features/tasks/taskActions.js';
import { taskCsv } from '../src/features/tasks/taskCsv.js';
import { defaultPresentationGroups } from '../src/features/tasks/workflowPresentation.js';

const workflow = { id: '11111111-1111-1111-1111-111111111111', discipline: 'Drafting', versionNumber: 1,
    definition: { name: 'Drawing delivery', startStageId: 'drawing', stages: [
        { id: 'drawing', name: 'Drawing', kind: 'Work', color: 'amber', ownerRole: 'Original' },
        { id: 'checking', name: 'Checking', kind: 'Review', color: 'purple', ownerRole: 'Reviewer' },
        { id: 'issued', name: 'Issued', kind: 'Completed', color: 'green', ownerRole: 'None' },
    ] } };
const task = { id: 'task', workflow, workflowVersionId: workflow.id, status: 'checking', reviewerId: 'staff', dueDate: '2026-01-01' };

test('workflow metadata drives display, review and terminal semantics without changing legacy rules', () => {
    assert.equal(taskKind(task), 'Review');
    assert.equal(taskStatusName(task), 'Checking');
    assert.equal(isTaskClosed({ ...task, status: 'issued' }), true);
    assert.equal(isOverdue({ ...task, status: 'issued' }, new Date('2026-02-01')), false);
    assert.equal(planTasks([{ ...task, status: 'issued' }], '2026-02-01').overdue.length, 0);
    assert.equal(taskStatusName({ status: 'Failed Review' }), 'Failed Review');
    assert.equal(isTaskClosed({ status: 'Approved' }), false);
    assert.equal(taskKind({ status: 'Ready for Re-Review' }), 'Review');
    assert.equal(ownerForStage(task, 'checking'), 'staff');
    assert.equal(ownerForStage(task, 'issued'), null);
    assert.match(taskCsv([task]), /Checking/);
});

test('status filters retain task identity while board columns combine workflow versions', () => {
    const second = { ...task, id: 'second', workflow: { ...workflow, id: '22222222-2222-2222-2222-222222222222', versionNumber: 2 } };
    const tasks = [task, second, { id: 'legacy', status: 'In Review' }];
    const filters = parseTaskQuery(serializeTaskQuery({ status: taskStatusKey(task) }));
    assert.equal(filters.status, taskStatusKey(task));
    assert.deepEqual(filterTasks(tasks, filters, null).map((item) => item.id), ['task']);
    assert.equal(taskStatusOptions(tasks).filter((option) => option.label.includes('Checking')).length, 2);
    const boards = workflowBoards(tasks, [{ id: 'review', name: 'Review', color: 'purple', statuses: ['In Review'] }]);
    assert.equal(boards.length, 1);
    assert.equal(boards[0].name, 'Task board');
    assert.equal(boards[0].groups.filter((group) => group.name === 'Review').length, 1);
    assert.deepEqual(boards.flatMap((board) => board.groups.flatMap((group) => group.tasks.map((item) => item.id))).sort(), ['legacy', 'second', 'task']);
    assert.equal(parseTaskQuery('status=not-a-stage').status, '');
});

test('one board uses saved columns and scopes move targets by discipline', () => {
    const development = { ...workflow, id: 'development', discipline: 'Development', definition: { stages: [
        { id: 'todo', name: 'To Do', kind: 'Work', color: 'blue' },
        { id: 'code', name: 'Development only', kind: 'Work', color: 'amber' },
        { id: 'done', name: 'Completed', kind: 'Completed', color: 'green' },
    ] } };
    const drafting = { ...workflow, id: 'drafting', definition: { stages: [
        { id: 'queued', name: 'To Do', kind: 'Work', color: 'blue' },
        { id: 'draw', name: 'Drafting only', kind: 'Work', color: 'amber' },
        { id: 'issued', name: 'Completed', kind: 'Completed', color: 'green' },
    ] } };
    const tasks = [
        { id: 'dev', discipline: 'Development', workflow: development, status: 'todo' },
        { id: 'draft', discipline: 'Drafting', workflow: drafting, status: 'queued' },
    ];
    const options = { availableTasks: tasks, workflows: [development, drafting] };
    const board = workflowBoards(tasks, defaultPresentationGroups, options)[0];
    assert.deepEqual(board.groups.map((group) => group.name), defaultPresentationGroups.map((group) => group.name));
    assert.deepEqual(board.groups[0].tasks.map((item) => item.id), ['dev', 'draft']);
    assert.deepEqual(board.groups[0].targets.filter((target) => target.workflowId), [
        { workflowId: 'development', status: 'todo' },
        { workflowId: 'drafting', status: 'queued' },
    ]);
    assert.deepEqual(boardMoveStatuses(board.groups[0], tasks[0]), ['todo']);
    assert.deepEqual(boardMoveStatuses(board.groups[0], tasks[1]), ['queued']);
    assert.deepEqual(boardMoveStatuses(board.groups[1], tasks[1]), ['draw']);
    assert.deepEqual(boardMoveStatuses(board.groups[2], tasks[1]), []);
    assert.deepEqual(boardMoveStatuses(board.groups[0], null), []);
    const filtered = workflowBoards(tasks, defaultPresentationGroups, { ...options, discipline: 'Development' })[0];
    assert.deepEqual(filtered.groups.map((group) => group.name), defaultPresentationGroups.map((group) => group.name));
    assert.deepEqual(filtered.groups.flatMap((group) => group.tasks.map((item) => item.id)), ['dev']);
    const empty = workflowBoards([], defaultPresentationGroups, { ...options, discipline: 'Drafting' })[0];
    assert.deepEqual(empty.groups.map((group) => group.name), defaultPresentationGroups.map((group) => group.name));
    assert.equal(empty.groups.flatMap((group) => group.tasks).length, 0);
});

test('workflow stages never add columns beyond saved presentation, including Release and historical versions', () => {
    const stages = [
        { id: 'plan', name: 'Planning', kind: 'Planning', color: 'gray' },
        { id: 'work', name: 'Working', kind: 'Work', color: 'gray' },
        { id: 'review', name: 'Review', kind: 'Review', color: 'gray' },
        { id: 'release', name: 'Release', kind: 'Release', color: 'gray' },
        { id: 'done', name: 'Completed', kind: 'Completed', color: 'gray' },
        { id: 'cancelled', name: 'Cancelled', kind: 'Cancelled', color: 'gray' },
    ];
    const definition = { ...workflow, definition: { stages } };
    const tasks = stages.map((stage) => ({ id: stage.id, status: stage.id, workflow: definition }));
    const saved = structuredClone(defaultPresentationGroups);
    saved.reverse();
    saved[0].name = 'Issued work';
    saved[0].color = 'purple';
    const before = structuredClone({ tasks, saved });
    const board = workflowBoards(tasks, saved)[0];
    assert.equal(board.groups.length, 4);
    assert.deepEqual(board.groups.map(({ name, color, statuses }) => ({ name, color, statuses })),
        saved.map(({ name, color, statuses }) => ({ name, color, statuses })));
    const delivery = board.groups.find((group) => group.id === 'legacy:delivery');
    assert.deepEqual(delivery.tasks.map((item) => item.id), ['release', 'done', 'cancelled']);
    assert.deepEqual(board.groups.flatMap((group) => group.tasks.map((item) => item.id)).sort(), stages.map((stage) => stage.id).sort());
    assert.deepEqual({ tasks, saved }, before);
    assert.deepEqual(workflowBoards(tasks, []), []);
});

test('legacy and configured status matches share presentation columns without changing tasks', () => {
    const configured = { ...task, workflow: { ...workflow, definition: { stages: [
        { id: 'reviewing', name: 'In Review', color: 'purple' },
    ] } }, status: 'reviewing' };
    const legacy = { id: 'legacy', status: 'In Review' };
    const tasks = [legacy, configured];
    const before = structuredClone(tasks);
    const board = workflowBoards(tasks, [{ id: 'review', name: 'Review', color: 'purple', statuses: ['In Review'] }])[0];
    assert.equal(board.groups.length, 1);
    assert.deepEqual(board.groups[0].tasks.map((item) => item.id), ['legacy', 'task']);
    assert.deepEqual(tasks, before);
});

test('dynamic moves require both server status and transition permissions', () => {
    const details = { task, allowedStatuses: ['checking', 'issued'], allowedTransitions: [] };
    assert.equal(canMoveTask(details, 'issued', true), false);
    details.allowedTransitions = [{ id: 'approve', toStageId: 'issued' }];
    assert.equal(canMoveTask(details, 'issued', false), true);
    assert.equal(canMoveTask(details, 'drawing', true), false);
    const tasks = filterTasks([task], { quickView: 'review' }, 'account', [{ id: 'staff', userId: 'account' }]);
    assert.equal(tasks.length, 1);
});

test('new task workflow selection pins a version and derives stage handler from existing staff roles', () => {
    const values = { title: 'Draft', discipline: 'Drafting', originalAssigneeId: 'drafter', reviewerId: 'checker', assigneeId: 'other' };
    const selected = initializeTaskWorkflow(values, workflow);
    assert.equal(selected.workflowVersionId, workflow.id);
    assert.equal(selected.status, 'drawing');
    assert.equal(selected.assigneeId, 'drafter');
    const changed = changeWorkflowField(selected, 'originalAssigneeId', 'next-drafter');
    assert.equal(changed.assigneeId, 'next-drafter');
    assert.equal(changed.workflowVersionId, workflow.id);
    assert.equal(changed.title, 'Draft');
    const legacy = initializeTaskWorkflow(values, null);
    assert.equal(legacy.workflowVersionId, null);
    assert.equal(legacy.status, 'Backlog');
    assert.equal(legacy.assigneeId, 'other');
});
