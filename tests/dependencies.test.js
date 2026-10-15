import test from 'node:test';
import assert from 'node:assert/strict';
import { store, login, logout, loadWorkspace } from '../src/app/store.js';
import { addDependency, removeDependency, loadDependencies, mergeDependencyVersion } from '../src/features/tasks/dependencyState.js';

const neighbor = { taskId: 'other', code: 'TASK-2', title: 'Other', status: 'Backlog' };
const page = (version, blockedBy = []) => ({ version, blockedBy, blocks: [], canManage: true, changedTasks: [] });

function action(operation, phase, requestId, payload, arg = { taskId: 'task' }) {
    store.dispatch({ type: `dependencies/${operation}/${phase}`, payload, meta: { requestId, arg } });
}

function workspace(requestId, tasks = [{ id: 'task', version: 1 }, { id: 'other', version: 1 }], userId = 'account') {
    store.dispatch(loadWorkspace.pending(requestId));
    store.dispatch(loadWorkspace.fulfilled({ tasks, labels: [], projects: [],
        people: [{ id: 'staff', userId }], notifications: { items: [], unreadCount: 0 } }, requestId));
}

function start() {
    store.dispatch(login.fulfilled({ userId: 'account', role: 'Administrator' }, 'login'));
    workspace('start');
}

test('dependency saves update both versions and reject older resource/workspace reads', () => {
    start();
    action('load', 'pending', 'load');
    action('load', 'fulfilled', 'load', page(1));
    action('load', 'pending', 'old-read');
    store.dispatch(loadWorkspace.pending('old-poll'));
    action('add', 'pending', 'save');
    action('add', 'fulfilled', 'save', { ...page(2, [neighbor]), changedTasks: [{ id: 'task', version: 2 }, { id: 'other', version: 2 }] });
    action('load', 'fulfilled', 'old-read', page(1));
    store.dispatch(loadWorkspace.fulfilled({ tasks: [], people: [], projects: [] }, 'old-poll'));
    assert.deepEqual(store.getState().workspace.tasks.map((task) => task.version), [2, 2]);
    assert.equal(store.getState().workspace.dependencies.task.blockedBy[0].taskId, 'other');
});

test('dependency cache clears on logout, membership change or related-task access loss and ignores late replies', () => {
    for (const loss of ['logout', 'binding', 'neighbor']) {
        start();
        action('load', 'pending', 'load');
        action('load', 'fulfilled', 'load', page(1, [neighbor]));
        assert.equal(store.getState().workspace.dependencies?.task?.blockedBy.length, 1);
        action('load', 'pending', 'late');
        if (loss === 'logout') {
            store.dispatch(logout.fulfilled());
        }
        else {
            workspace('changed', [{ id: 'task', version: 1 }], loss === 'binding' ? 'different' : 'account');
        }
        action('load', 'fulfilled', 'late', page(1, [neighbor]));
        assert.equal(store.getState().workspace.dependencies?.task, undefined);
    }
});

test('rejected inaccessible dependency pages remove names and invalidate pending writes', () => {
    start();
    action('load', 'pending', 'load');
    action('load', 'fulfilled', 'load', page(1, [neighbor]));
    action('add', 'pending', 'write');
    action('load', 'pending', 'denied');
    action('load', 'rejected', 'denied', { status: 404, message: 'Unavailable' });
    action('add', 'fulfilled', 'write', { ...page(2, [neighbor]), changedTasks: [] });
    assert.deepEqual(store.getState().workspace.dependencies.task.blockedBy, []);
    assert.equal(store.getState().workspace.dependencies.task.hasLoaded, false);
});

test('a denied neighbor read invalidates every page and pending response that could disclose it', () => {
    start();
    action('load', 'pending', 'a');
    action('load', 'fulfilled', 'a', page(1, [neighbor]));
    action('load', 'pending', 'old-a');
    action('load', 'pending', 'b', undefined, { taskId: 'other' });
    action('load', 'rejected', 'b', { status: 404, message: 'Unavailable' }, { taskId: 'other' });
    assert.equal(store.getState().workspace.dependencies.task, undefined);
    action('load', 'fulfilled', 'old-a', page(1, [neighbor]));
    assert.equal(store.getState().workspace.dependencies.task, undefined);
    assert.equal(store.getState().workspace.dependencies.other.hasLoaded, false);
});

test('inverse read invalidation releases loading state so the page can reload immediately', () => {
    start();
    action('load', 'pending', 'a');
    action('load', 'fulfilled', 'a', page(1));
    action('load', 'pending', 'old-b', undefined, { taskId: 'other' });
    action('add', 'pending', 'write');
    action('add', 'fulfilled', 'write', { ...page(2, [neighbor]), changedTasks: [{ id: 'task', version: 2 }, { id: 'other', version: 2 }] });
    action('load', 'fulfilled', 'old-b', page(1), { taskId: 'other' });
    assert.equal(store.getState().workspace.dependencies.other.status, 'ready');
    assert.equal(store.getState().workspace.dependencies.other.hasLoaded, false);
    assert.equal(store.getState().workspace.dependencies.other.stale, true);
});

test('own dependency result preserves detail drafts and cannot bless a different task version', () => {
    const draft = { title: 'Unsaved title', note: 'Unsaved review note', labels: ['existing'], status: 'In Review', version: 4 };
    const change = { id: 'task', version: 5, updatedAtUtc: '2026-10-14', title: 'Remote title', status: 'Completed' };
    assert.deepEqual(mergeDependencyVersion(draft, change, 4), { ...draft, version: 5, updatedAtUtc: '2026-10-14' });
    assert.equal(mergeDependencyVersion(draft, change, 3), draft);
});

test('inverse dependency caches invalidate when either endpoint changes', () => {
    start();
    action('load', 'pending', 'inverse', undefined, { taskId: 'other' });
    action('load', 'fulfilled', 'inverse', page(1), { taskId: 'other' });
    action('load', 'pending', 'own');
    action('load', 'fulfilled', 'own', page(1));
    action('add', 'pending', 'save');
    action('add', 'fulfilled', 'save', { ...page(2, [neighbor]), changedTasks: [{ id: 'task', version: 2 }, { id: 'other', version: 2 }] });
    assert.equal(store.getState().workspace.dependencies.other.stale, true);
    workspace('updated-title', [{ id: 'task', version: 2 }, { id: 'other', version: 3, title: 'New title' }]);
    assert.equal(store.getState().workspace.dependencies.task.stale, true);
});

test('dependency transport uses dedicated credentialed requests and exposes conflict errors', async () => {
    start();
    const originalFetch = globalThis.fetch;
    const calls = [];
    globalThis.fetch = async (url, options) => {
        calls.push({ url, options });
        return new Response(JSON.stringify(calls.length === 1 ? page(1) : { message: 'Task has changed.' }), {
            status: calls.length === 1 ? 200 : 409, headers: { 'Content-Type': 'application/json' },
        });
    };
    try {
        await store.dispatch(loadDependencies({ taskId: 'task' })).unwrap();
        const result = await store.dispatch(addDependency({ taskId: 'task', blockedByTaskId: 'other', version: 1 }));
        assert.equal(result.payload.status, 409);
        assert.equal(calls[1].url, '/api/task-management/tasks/task/dependencies');
        assert.equal(calls[1].options.credentials, 'include');
        assert.equal(calls[1].options.headers['X-Task-Management'], '1');
        assert.deepEqual(JSON.parse(calls[1].options.body), { blockedByTaskId: 'other', version: 1 });
        await store.dispatch(removeDependency({ taskId: 'task', blockedByTaskId: 'other', version: 1 }));
        assert.equal(calls[2].url, '/api/task-management/tasks/task/dependencies/other');
        assert.equal(calls[2].options.method, 'DELETE');
        assert.deepEqual(JSON.parse(calls[2].options.body), { version: 1 });
    }
    finally {
        globalThis.fetch = originalFetch;
    }
});
