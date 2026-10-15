import test from 'node:test';
import assert from 'node:assert/strict';
import { configureStore, createSlice } from '@reduxjs/toolkit';
import { addTaskTransitionReducers, transitionTask } from '../src/features/tasks/taskTransitions.js';

function fixture() {
    const slice = createSlice({ name: 'workspace', initialState: {
        tasks: [{ id: 'task', version: 1, checklistSummary: { version: 8, completed: 2, total: 3 } }], taskTransitions: {}, details: {}, detailRequests: {}, dependencies: {}, requestId: 'old-poll',
    }, reducers: { clear: (state) => { state.taskTransitions = {}; } }, extraReducers: addTaskTransitionReducers });
    const auth = createSlice({ name: 'auth', initialState: { user: { userId: 'actor' } }, reducers: {
        reset: () => ({ user: { userId: 'actor' } }),
    } });
    return { slice, auth, store: configureStore({ reducer: { workspace: slice.reducer, auth: auth.reducer } }) };
}

test('workflow action sends only action/version/note and adopts canonical task without stale poll restoration', async () => {
    const { store } = fixture();
    const originalFetch = global.fetch;
    global.fetch = async (url, options) => {
        assert.ok(url.endsWith('/tasks/task/transitions'));
        assert.equal(options.headers['X-Task-Workflow'], '1');
        assert.deepEqual(JSON.parse(options.body), { transitionId: 'approve', version: 1, note: 'Checked' });
        return new Response(JSON.stringify({ task: { id: 'task', version: 2, status: 'done' }, allowedStatuses: ['done'], allowedTransitions: [] }));
    };
    try {
        const saved = await store.dispatch(transitionTask({ id: 'task', transitionId: 'approve', version: 1, note: 'Checked' })).unwrap();
        assert.equal(saved.task.checklistSummary.version, 8);
        assert.equal(store.getState().workspace.tasks[0].version, 2);
        assert.equal(store.getState().workspace.requestId, null);
    }
    finally {
        global.fetch = originalFetch;
    }
});

test('late transition replies cannot restore task data after request invalidation', () => {
    const { store, slice } = fixture();
    const args = { id: 'task', version: 1, transitionId: 'approve' };
    store.dispatch(transitionTask.pending('request', args));
    store.dispatch(slice.actions.clear());
    store.dispatch(transitionTask.fulfilled({ task: { id: 'task', version: 2 } }, 'request', args));
    assert.equal(store.getState().workspace.tasks[0].version, 1);
    assert.deepEqual(store.getState().workspace.details, {});
});

test('observed access denial removes task and related private caches', () => {
    const { store } = fixture();
    const args = { id: 'task', version: 1, transitionId: 'approve' };
    store.dispatch(transitionTask.pending('request', args));
    store.dispatch(transitionTask.rejected(null, 'request', args, { status: 404, message: 'Unavailable' }));
    assert.equal(store.getState().workspace.tasks.length, 0);
    assert.deepEqual(store.getState().workspace.details, {});
});

test('transition response preserves independently newer checklist summaries in list and details', () => {
    const { store } = fixture();
    const args = { id: 'task', version: 1, transitionId: 'approve' };
    store.dispatch(transitionTask.pending('request', args));
    store.dispatch(transitionTask.fulfilled({ task: { id: 'task', version: 2,
        checklistSummary: { version: 7, completed: 1, total: 3 } } }, 'request', args));
    assert.equal(store.getState().workspace.tasks[0].checklistSummary.version, 8);
    assert.equal(store.getState().workspace.details.task.task.checklistSummary.completed, 2);
});

test('successful handoff with lost visibility acknowledges success and clears private task state', async () => {
    const { store } = fixture();
    const originalFetch = global.fetch;
    global.fetch = async () => new Response(JSON.stringify({ taskId: 'task', accessLost: true }));
    try {
        const result = await store.dispatch(transitionTask({ id: 'task', version: 1, transitionId: 'review', note: '' })).unwrap();
        assert.deepEqual(result, { taskId: 'task', accessLost: true });
        assert.equal(store.getState().workspace.tasks.length, 0);
        assert.deepEqual(store.getState().workspace.details, {});
        assert.deepEqual(store.getState().workspace.dependencies, {});
        assert.equal(store.getState().workspace.requestId, null);
    }
    finally {
        global.fetch = originalFetch;
    }
});

test('a poll invalidating the action cannot suppress acknowledged handoff success', async () => {
    const { store, slice } = fixture();
    const originalFetch = global.fetch;
    let respond;
    global.fetch = () => new Promise((resolve) => { respond = resolve; });
    try {
        const pending = store.dispatch(transitionTask({ id: 'task', version: 1, transitionId: 'review', note: '' }));
        store.dispatch(slice.actions.clear());
        respond(new Response(JSON.stringify({ taskId: 'task', accessLost: true })));
        const result = await pending.unwrap();
        assert.equal(result.accessLost, true);
        assert.equal(store.getState().workspace.tasks.length, 0);
    }
    finally {
        global.fetch = originalFetch;
    }
});

test('handoff acknowledgement cannot cross into a replacement login session', async () => {
    const { store, slice, auth } = fixture();
    const originalFetch = global.fetch;
    let respond;
    global.fetch = () => new Promise((resolve) => { respond = resolve; });
    try {
        const pending = store.dispatch(transitionTask({ id: 'task', version: 1, transitionId: 'review', note: '' }));
        store.dispatch(slice.actions.clear());
        store.dispatch(auth.actions.reset());
        respond(new Response(JSON.stringify({ taskId: 'task', accessLost: true })));
        await assert.rejects(pending.unwrap(), /./);
        assert.equal(store.getState().workspace.tasks.length, 1);
    }
    finally {
        global.fetch = originalFetch;
    }
});
