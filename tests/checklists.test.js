import test from 'node:test';
import assert from 'node:assert/strict';
import { store, login, logout, loadWorkspace } from '../src/app/store.js';
import { blankChecklistEditor, finishChecklistReload } from '../src/features/tasks/checklistEditor.js';
import { deleteChecklistItem, loadTaskChecklist, reorderChecklist, saveChecklistItem } from '../src/features/tasks/checklistState.js';

const arg = { taskId: 'task' };
const page = (version, completed = false) => ({
    version,
    canManage: true,
    canComplete: true,
    items: [{ id: 1, title: 'Check layout', completed, order: 0, version }],
    summary: { version, total: 1, completed: completed ? 1 : 0 },
});

function action(operation, phase, requestId, payload, extra = {}) {
    store.dispatch({
        type: `checklist/${operation}/${phase}`,
        meta: { arg: { ...arg, ...extra }, requestId },
        payload,
    });
}

function workspace(id, tasks = [{ id: 'task', version: 1, checklistSummary: page(0).summary }], userId = 'account') {
    store.dispatch(loadWorkspace.pending(id));
    store.dispatch(loadWorkspace.fulfilled({
        tasks, people: [{ id: 'staff', userId, accountIsActive: true }], projects: [],
        notifications: { items: [], unreadCount: 0 },
    }, id));
}

function start() {
    store.dispatch(login.fulfilled({ userId: 'account', role: 'Administrator' }, 'login'));
    workspace('initial');
}

test('checklist completion updates card progress without changing task workflow version', () => {
    start();
    action('load', 'pending', 'read');
    action('load', 'fulfilled', 'read', page(1));
    action('save', 'pending', 'toggle');
    action('save', 'fulfilled', 'toggle', page(2, true));
    assert.deepEqual(store.getState().workspace.tasks[0].checklistSummary, page(2, true).summary);
    assert.equal(store.getState().workspace.tasks[0].version, 1);
    assert.equal(store.getState().workspace.checklists.task.items[0].completed, true);
});

test('old checklist reads and workspace polls cannot undo newer completion progress', () => {
    start();
    action('load', 'pending', 'initial');
    action('load', 'fulfilled', 'initial', page(1));
    action('load', 'pending', 'older');
    store.dispatch(loadWorkspace.pending('older-workspace'));
    action('save', 'pending', 'save');
    action('save', 'fulfilled', 'save', page(2, true));
    action('load', 'fulfilled', 'older', page(1));
    store.dispatch(loadWorkspace.fulfilled({
        tasks: [{ id: 'task', version: 1, checklistSummary: page(1).summary }],
        people: [{ id: 'staff', userId: 'account', accountIsActive: true }], projects: [],
        notifications: { items: [], unreadCount: 0 },
    }, 'older-workspace'));
    assert.equal(store.getState().workspace.checklists.task.version, 2);
    assert.equal(store.getState().workspace.tasks[0].checklistSummary.completed, 1);
});

test('checklist responses cannot restore private data after logout, staff rebinding or access loss', () => {
    for (const change of ['logout', 'binding', 'access']) {
        start();
        action('load', 'pending', 'initial');
        action('load', 'fulfilled', 'initial', page(1));
        action('save', 'pending', 'late-write');
        action('load', 'pending', 'late-read');
        if (change === 'logout') {
            store.dispatch(logout.fulfilled());
        }
        else if (change === 'binding') {
            workspace('rebound', [{ id: 'task', version: 1 }], null);
        }
        else {
            workspace('removed', []);
        }
        action('save', 'fulfilled', 'late-write', page(2));
        action('load', 'fulfilled', 'late-read', page(1));
        assert.deepEqual(store.getState().workspace.checklists, {});
    }
});

test('an inaccessible checklist clears data and invalidates all pending resource mutations', () => {
    start();
    action('load', 'pending', 'initial');
    action('load', 'fulfilled', 'initial', page(1));
    action('save', 'pending', 'late');
    action('load', 'pending', 'denied');
    action('load', 'rejected', 'denied', { status: 404, message: 'Unavailable' });
    action('save', 'fulfilled', 'late', page(2));
    assert.deepEqual(store.getState().workspace.checklists.task.items, []);
    assert.equal(store.getState().workspace.checklists.task.hasLoaded, false);
});

test('a newer checklist summary invalidates a cached page even when task version is unchanged', () => {
    start();
    action('load', 'pending', 'initial');
    action('load', 'fulfilled', 'initial', page(1));
    workspace('new-summary', [{ id: 'task', version: 1, checklistSummary: page(2, true).summary }]);
    assert.equal(store.getState().workspace.checklists.task.stale, true);
    action('load', 'pending', 'refresh');
    action('load', 'fulfilled', 'refresh', page(2, true));
    assert.equal(store.getState().workspace.checklists.task.stale, false);
});

test('an in-flight page older than a newly observed summary remains stale until refreshed', () => {
    start();
    action('load', 'pending', 'initial');
    action('load', 'fulfilled', 'initial', page(1));
    action('load', 'pending', 'in-flight');
    workspace('new-summary', [{ id: 'task', version: 1, checklistSummary: page(3, true).summary }]);
    action('load', 'fulfilled', 'in-flight', page(2));
    assert.equal(store.getState().workspace.checklists.task.stale, true);
    assert.equal(store.getState().workspace.tasks[0].checklistSummary.version, 3);
});

test('a delayed checklist reload preserves text entered after reload started', async () => {
    const started = blankChecklistEditor();
    let editor = started;
    let resolveReload;
    const response = new Promise((resolve) => {
        resolveReload = resolve;
    });
    const reload = response.then(() => {
        editor = finishChecklistReload(editor, started);
    });
    editor = { ...editor, title: 'New draft entered during reload' };
    resolveReload();
    await reload;
    assert.equal(editor.title, 'New draft entered during reload');
    const approvedDiscard = { id: 1, title: 'Old draft', originalTitle: 'Old title', version: 1 };
    assert.deepEqual(finishChecklistReload(approvedDiscard, approvedDiscard), blankChecklistEditor());
});

test('checklist thunks use resource versions and preserve API authentication and conflict handling', async () => {
    start();
    const originalFetch = globalThis.fetch;
    const requests = [];
    let responseStatus = 200;
    globalThis.fetch = async (url, options) => {
        requests.push({ url, ...options, body: options.body ? JSON.parse(options.body) : null });
        if (options.method === 'DELETE') {
            return new Response(null, { status: 204 });
        }
        return new Response(JSON.stringify(responseStatus === 200 ? page(1) : { message: 'Conflict or expired' }), { status: responseStatus });
    };
    try {
        await store.dispatch(loadTaskChecklist(arg)).unwrap();
        await store.dispatch(saveChecklistItem({ ...arg, values: { title: 'Item', collectionVersion: 1 } })).unwrap();
        await store.dispatch(saveChecklistItem({ ...arg, id: 1, values: { completed: true, version: 1 } })).unwrap();
        await store.dispatch(reorderChecklist({ ...arg, itemIds: [1], collectionVersion: 1 })).unwrap();
        await store.dispatch(deleteChecklistItem({ ...arg, id: 1, version: 1 })).unwrap();
        assert.deepEqual(requests.map(({ url, method, body }) => ({ url, method, body })), [
            { url: '/api/task-management/tasks/task/checklist', method: 'GET', body: null },
            { url: '/api/task-management/tasks/task/checklist', method: 'POST', body: { title: 'Item', collectionVersion: 1 } },
            { url: '/api/task-management/tasks/task/checklist/1', method: 'PUT', body: { completed: true, version: 1 } },
            { url: '/api/task-management/tasks/task/checklist/order', method: 'PUT', body: { itemIds: [1], collectionVersion: 1 } },
            { url: '/api/task-management/tasks/task/checklist/1', method: 'DELETE', body: { version: 1 } },
        ]);
        assert.ok(requests.every((request) => request.credentials === 'include' && request.headers['X-Task-Management'] === '1'));
        responseStatus = 409;
        await assert.rejects(store.dispatch(saveChecklistItem({ ...arg, id: 1, values: { completed: true, version: 1 } })).unwrap(),
            (error) => error.status === 409);
        responseStatus = 401;
        await assert.rejects(store.dispatch(loadTaskChecklist(arg)).unwrap(), (error) => error.status === 401);
        assert.deepEqual(store.getState().workspace.checklists, {});
    }
    finally {
        globalThis.fetch = originalFetch;
        store.dispatch(logout.fulfilled());
    }
});
