import test from 'node:test';
import assert from 'node:assert/strict';
import { store, login, logout, loadWorkspace, loadTaskDetail } from '../src/app/store.js';
import { setTaskFollowing } from '../src/features/tasks/taskFollowing.js';

const task = { id: 'task', version: 4, isFollowed: false };
const page = (tasks = [task]) => ({ tasks, people: [], projects: [], notifications: { items: [], unreadCount: 0 } });
function start() {
    store.dispatch(login.fulfilled({ userId: 'user', role: 'User' }, 'login'));
    store.dispatch(loadWorkspace.pending('initial'));
    store.dispatch(loadWorkspace.fulfilled(page(), 'initial'));
    store.dispatch(loadTaskDetail.pending('detail', { id: 'task' }));
    store.dispatch(loadTaskDetail.fulfilled({ task, activity: [] }, 'detail', { id: 'task' }));
}
function follow(phase, requestId, isFollowed, payload = { isFollowed }) {
    store.dispatch({ type: `taskFollowing/set/${phase}`, payload, meta: { requestId, arg: { taskId: 'task', isFollowed } } });
}

test('following reconciles list/detail without changing task revision and rejects pre-mutation reads', () => {
    start();
    store.dispatch(loadWorkspace.pending('stale'));
    store.dispatch(loadTaskDetail.pending('stale-detail', { id: 'task' }));
    follow('pending', 'follow', true);
    follow('fulfilled', 'follow', true);
    store.dispatch(loadWorkspace.fulfilled(page(), 'stale'));
    store.dispatch(loadTaskDetail.fulfilled({ task, activity: [] }, 'stale-detail', { id: 'task' }));
    assert.equal(store.getState().workspace.tasks[0].isFollowed, true);
    assert.equal(store.getState().workspace.details.task.task.isFollowed, true);
    assert.equal(store.getState().workspace.details.task.task.version, 4);
    follow('pending', 'unfollow', false);
    follow('fulfilled', 'unfollow', false);
    assert.equal(store.getState().workspace.tasks[0].isFollowed, false);
});

test('failed follow preserves current preference and late replies cannot survive session or access loss', () => {
    start();
    follow('pending', 'failed', true);
    follow('rejected', 'failed', true, { message: 'Offline', status: 503 });
    assert.equal(store.getState().workspace.tasks[0].isFollowed, false);
    assert.equal(store.getState().workspace.taskFollowing.task.error, 'Offline');
    follow('pending', 'late', true);
    store.dispatch(logout.fulfilled());
    follow('fulfilled', 'late', true);
    assert.deepEqual(store.getState().workspace.tasks, []);
    start();
    follow('pending', 'lost-access', true);
    store.dispatch(loadWorkspace.pending('access'));
    store.dispatch(loadWorkspace.fulfilled(page([]), 'access'));
    follow('fulfilled', 'lost-access', true);
    assert.deepEqual(store.getState().workspace.tasks, []);
    assert.equal(store.getState().workspace.details.task, undefined);
});

test('follow requests use credentialed personal endpoints and prevent repeated in-flight clicks', async () => {
    start();
    const originalFetch = globalThis.fetch;
    const requests = [];
    let finish;
    globalThis.fetch = (url, options) => {
        requests.push({ url, options });
        return new Promise((resolve) => { finish = resolve; });
    };
    try {
        const pending = store.dispatch(setTaskFollowing({ taskId: 'task', isFollowed: true }));
        await store.dispatch(setTaskFollowing({ taskId: 'task', isFollowed: true }));
        assert.equal(requests.length, 1);
        assert.equal(requests[0].url, '/api/task-management/tasks/task/follow');
        assert.equal(requests[0].options.method, 'PUT');
        assert.equal(requests[0].options.credentials, 'include');
        assert.equal(requests[0].options.headers['X-Task-Management'], '1');
        finish(new Response(JSON.stringify({ isFollowed: true }), { status: 200 }));
        await pending;
        const removing = store.dispatch(setTaskFollowing({ taskId: 'task', isFollowed: false }));
        assert.equal(requests[1].options.method, 'DELETE');
        finish(new Response(JSON.stringify({ isFollowed: false }), { status: 200 }));
        await removing;
        assert.equal(store.getState().workspace.tasks[0].isFollowed, false);
    }
    finally {
        globalThis.fetch = originalFetch;
    }
});

test('unrelated staff refresh cannot discard a pending follow for a still-visible task', () => {
    start();
    follow('pending', 'following', true);
    store.dispatch(loadWorkspace.pending('people-refresh'));
    store.dispatch(loadWorkspace.fulfilled({ ...page(), people: [{ id: 'new-staff', userId: 'other-user' }] }, 'people-refresh'));
    assert.equal(store.getState().workspace.taskFollowing.task?.requestId, 'following');
    follow('fulfilled', 'following', true);
    assert.equal(store.getState().workspace.tasks[0].isFollowed, true);
});
