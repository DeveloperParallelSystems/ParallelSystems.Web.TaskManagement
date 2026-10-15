import test from 'node:test';
import assert from 'node:assert/strict';
import { presentationError, movePresentationStatus } from '../src/features/tasks/workflowPresentation.js';
import { boardMoveStatuses, workflowBoards } from '../src/features/tasks/taskWorkflow.js';
import { loadPresentation, savePresentation } from '../src/features/tasks/workflowPresentation.js';
import { store, login } from '../src/app/store.js';

const catalog = [{ code: 'To Do', name: 'To Do' }, { code: 'qa', name: 'Design QA' }];
const columns = [
    { id: 'planning', name: 'Planning', color: 'blue', statuses: ['To Do'] },
    { id: 'working', name: 'Working', color: 'amber', statuses: [] },
    { id: 'review', name: 'Review', color: 'purple', statuses: ['qa'] },
    { id: 'completed', name: 'Completed', color: 'green', statuses: [] },
];

test('board validation and movement use the current catalog instead of a fixed status list', () => {
    assert.equal(presentationError(columns, catalog), '');
    const moved = movePresentationStatus(columns, 'qa', 'working', catalog);
    assert.deepEqual(moved[1].statuses, ['qa']);
    assert.deepEqual(columns[1].statuses, []);
    assert.equal(moved.length, 4);
    assert.ok(presentationError(columns.map((column) => ({ ...column, statuses: column.statuses.filter((code) => code !== 'qa') })), catalog));
    assert.ok(presentationError([...columns.slice(0, 3), { ...columns[3], statuses: ['unknown'] }], catalog));
});

test('task cards and move targets use the direct catalog column even when the old mapping differs', () => {
    const task = { id: 'a', status: 'qa', discipline: 'Development' };
    const settings = { catalog: catalog.map((item) => ({ ...item, boardStatus: 'To Do' })), disciplines: [
        { discipline: 'Development', statuses: ['To Do', 'qa'] }, { discipline: 'Drafting', statuses: ['To Do'] }] };
    const [board] = workflowBoards([task], columns, { statusSettings: settings });
    assert.equal(board.groups.length, 4);
    assert.equal(board.groups[2].tasks[0]?.id, 'a');
    assert.deepEqual(boardMoveStatuses(board.groups[2], task), ['qa']);
});

test('unified board save sends both revisions in one catalog-aware request', async () => {
    const originalFetch = globalThis.fetch;
    const calls = [];
    try {
        store.dispatch(login.fulfilled({ userId: 'admin', role: 'Administrator' }, 'login'));
        globalThis.fetch = async (url, options) => {
            calls.push({ url, body: JSON.parse(options.body) });
            return new Response(JSON.stringify({ version: 6, catalogVersion: 8, canManage: true, catalog, groups: columns }));
        };
        await store.dispatch(savePresentation({ version: 5, catalogVersion: 8, catalog, groups: columns })).unwrap();
        assert.equal(calls.length, 1);
        assert.equal(calls[0].url, '/api/task-management/board-presentation');
        assert.equal(calls[0].body.version, 5);
        assert.equal(calls[0].body.catalogVersion, 8);
        assert.deepEqual(calls[0].body.groups, columns);
        assert.equal(store.getState().workspace.workflowPresentation.data.catalogVersion, 8);
    }
    finally {
        globalThis.fetch = originalFetch;
    }
});

test('presentation does not replace a newer catalog snapshot at the same board revision', () => {
    store.dispatch(login.fulfilled({ userId: 'admin', role: 'Administrator' }, 'login'));
    for (const [requestId, catalogVersion] of [['current', 8], ['older', 7]]) {
        store.dispatch(loadPresentation.pending(requestId));
        store.dispatch(loadPresentation.fulfilled({ version: 6, catalogVersion, catalog, groups: columns, canManage: true, supported: true }, requestId));
    }
    assert.equal(store.getState().workspace.workflowPresentation.data.catalogVersion, 8);
});

test('malformed catalog responses are rejected without replacing the saved layout', async () => {
    const originalFetch = globalThis.fetch;
    try {
        globalThis.fetch = async () => new Response(JSON.stringify({ version: 6, catalogVersion: 8, catalog: [null], groups: columns, canManage: true }));
        const result = await store.dispatch(loadPresentation());
        assert.equal(result.meta.requestStatus, 'rejected');
        assert.match(result.payload.message, /invalid status catalog/);
        assert.equal(store.getState().workspace.workflowPresentation.data.catalogVersion, 8);
    }
    finally {
        globalThis.fetch = originalFetch;
    }
});
