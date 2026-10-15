import assert from 'node:assert/strict';
import test from 'node:test';
import { allowedDisciplineStatuses, validateStatusSettings } from '../src/features/tasks/liveStatuses.js';
import { boardMoveStatuses, isTaskClosed, taskStatusOptions, workflowBoards } from '../src/features/tasks/taskWorkflow.js';
import { defaultPresentationGroups } from '../src/features/tasks/workflowPresentation.js';
import { store, login, logout } from '../src/app/store.js';
import { loadStatusSettings, saveStatusSettings } from '../src/features/tasks/liveStatuses.js';
import { parseTaskQuery } from '../src/features/tasks/taskQuery.js';
import { filterTasks } from '../src/features/tasks/workflow.js';
test('discipline settings share To Do and keep independent choices', () => {
 const settings={catalog:[{code:'To Do',name:'To Do',boardStatus:'To Do'},{code:'custom',name:'Custom',boardStatus:'In Progress'}],disciplines:[{discipline:'Development',statuses:['To Do','custom']},{discipline:'Drafting',statuses:['To Do']}]};
 assert.equal(validateStatusSettings(settings),'');
 assert.deepEqual(allowedDisciplineStatuses(settings,'Development').map(item=>item.code),['To Do','custom']);
 assert.deepEqual(allowedDisciplineStatuses(settings,'Drafting').map(item=>item.code),['To Do']);
});

test('custom statuses use the saved four columns for both disciplines and historical pins', () => {
    const settings = { catalog: [{ code: 'To Do', name: 'To Do', boardStatus: 'To Do' },
        { code: 'design-qa', name: 'Design QA', boardStatus: 'In Review' },
        { code: 'drawing', name: 'Drawing', boardStatus: 'In Progress' }], disciplines: [
        { discipline: 'Development', statuses: ['To Do', 'design-qa'] },
        { discipline: 'Drafting', statuses: ['To Do', 'drawing'] },
    ] };
    const tasks = [{ id: 'old', discipline: 'Development', status: 'design-qa', workflow: { id: 'old-pin', definition: { stages: [] } } },
        { id: 'new', discipline: 'Drafting', status: 'drawing' }];
    const [board] = workflowBoards(tasks, defaultPresentationGroups, { statusSettings: settings });
    assert.equal(board.groups.length, 4);
    assert.deepEqual(board.groups.map(({ name, color }) => ({ name, color })),
        defaultPresentationGroups.map(({ name, color }) => ({ name, color })));
    assert.equal(board.groups.flatMap((group) => group.tasks).length, 2);
    const review = board.groups.find((group) => group.statuses.includes('In Review'));
    assert.deepEqual(review.tasks.map((task) => task.id), ['old']);
    assert.deepEqual(boardMoveStatuses(review, tasks[0]), ['design-qa']);
    assert.deepEqual(boardMoveStatuses(review, tasks[1]), []);
    const filtered = workflowBoards(tasks, defaultPresentationGroups, { statusSettings: settings, discipline: 'Drafting' });
    assert.equal(filtered[0].groups.length, 4);
    assert.deepEqual(filtered[0].groups.flatMap((group) => group.tasks).map((task) => task.id), ['new']);
    assert.deepEqual(workflowBoards(tasks, [], { statusSettings: settings }), []);
    assert.equal(taskStatusOptions(tasks, settings, 'Development')[1].value, 'status:design-qa');
    assert.equal(parseTaskQuery('?status=status%3Adesign-qa').status, 'status:design-qa');
});

test('settings validate board destinations and the common default', () => {
    const settings = { catalog: [{ code: 'To Do', name: 'To Do', boardStatus: 'To Do' }],
        disciplines: [{ discipline: 'Development', statuses: ['To Do'] }, { discipline: 'Drafting', statuses: ['To Do'] }] };
    const invalid = structuredClone(settings);
    invalid.catalog[0].boardStatus = 'fifth-column';
    assert.ok(validateStatusSettings(invalid));
    invalid.catalog[0].boardStatus = 'To Do';
    invalid.disciplines[1].statuses = [];
    assert.match(validateStatusSettings(invalid), /To Do/);
});

test('board grouping cannot close or reopen a task or change historical completion meaning', () => {
    assert.equal(isTaskClosed({ status: 'qa', liveStatusMode: true, statusBoardStatus: 'Completed' }), false);
    assert.equal(isTaskClosed({ status: 'Completed', liveStatusMode: true, statusBoardStatus: 'In Progress' }), true);
    assert.equal(isTaskClosed({ status: 'delivered', liveStatusMode: true, statusBoardStatus: 'In Progress',
        workflow: { definition: { stages: [{ id: 'delivered', name: 'Delivered', kind: 'Completed' }] } } }), true);
});

test('saved canonical and pinned status filter links survive catalog display metadata', () => {
    const task = { id: 'old', title: 'Task', status: 'To Do', statusName: 'To Do' };
    assert.equal(filterTasks([task], { status: 'To Do' }).length, 1);
    const pinned = { ...task, status: 'work', statusName: 'Working', workflow: { id: 'pin', definition: { stages: [] } } };
    assert.equal(filterTasks([pinned], { status: 'pin:work' }).length, 1);
});

test('status settings ignore overtaken responses and clear data on session changes', () => {
    store.dispatch(login.fulfilled({ userId: 'admin', role: 'Administrator' }, 'login'));
    const page = (version) => ({ version, canManage: true, catalog: [], disciplines: [] });
    store.dispatch(loadStatusSettings.pending('first'));
    store.dispatch(loadStatusSettings.fulfilled(page(1), 'first'));
    store.dispatch(loadStatusSettings.pending('older'));
    store.dispatch(saveStatusSettings.pending('saving'));
    store.dispatch(saveStatusSettings.fulfilled(page(2), 'saving'));
    store.dispatch(loadStatusSettings.fulfilled(page(1), 'older'));
    assert.equal(store.getState().workspace.statusSettings.data.version, 2);
    store.dispatch(loadStatusSettings.pending('late'));
    store.dispatch(logout.fulfilled());
    store.dispatch(loadStatusSettings.fulfilled(page(3), 'late'));
    assert.equal(store.getState().workspace.statusSettings.data, null);
});
