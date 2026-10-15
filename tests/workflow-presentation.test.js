import test from 'node:test';
import assert from 'node:assert/strict';
import { store, login, logout } from '../src/app/store.js';
import { groups } from '../src/features/tasks/workflow.js';
import { defaultPresentationGroups, loadPresentation, movePresentationStatus, presentationError,
    reorderPresentation, savePresentation, selectPresentationGroups } from '../src/features/tasks/workflowPresentation.js';

const page = (version) => ({ version, canManage: true, groups: structuredClone(groups) });
function action(operation, phase, requestId, payload) {
    store.dispatch({ type: `presentation/${operation}/${phase}`, payload, meta: { requestId } });
}
function resource() {
    return store.getState().workspace.workflowPresentation;
}

test('presentation keeps its own version and ignores reads overtaken by successful writes', () => {
    store.dispatch(login.fulfilled({ userId: 'admin', role: 'Administrator' }, 'login'));
    action('load', 'pending', 'first');
    action('load', 'fulfilled', 'first', page(1));
    assert.equal(resource()?.data.version, 1);
    action('load', 'pending', 'older');
    action('save', 'pending', 'write');
    action('save', 'fulfilled', 'write', page(2));
    action('load', 'fulfilled', 'older', page(1));
    assert.equal(resource().data.version, 2);
    assert.equal(resource().status, 'ready');
    assert.deepEqual(store.getState().workspace.tasks, []);
});

test('presentation rejects stale versions and late responses after logout', () => {
    store.dispatch(login.fulfilled({ userId: 'admin', role: 'Administrator' }, 'login'));
    action('load', 'pending', 'first');
    action('load', 'fulfilled', 'first', page(5));
    action('load', 'pending', 'stale');
    action('load', 'fulfilled', 'stale', page(4));
    assert.equal(resource()?.data.version, 5);
    action('save', 'pending', 'late-write');
    action('load', 'pending', 'late-read');
    store.dispatch(logout.fulfilled());
    action('load', 'fulfilled', 'late-read', page(6));
    action('save', 'fulfilled', 'late-write', page(7));
    assert.equal(resource().data, null);
});

test('configuration conflicts retain the last usable presentation and release busy state', () => {
    store.dispatch(login.fulfilled({ userId: 'admin', role: 'Administrator' }, 'login'));
    action('load', 'pending', 'first');
    action('load', 'fulfilled', 'first', page(1));
    action('save', 'pending', 'conflict');
    action('save', 'rejected', 'conflict', { status: 409, message: 'Reload configuration.' });
    assert.equal(resource()?.data.version, 1);
    assert.equal(resource().writeId, null);
    assert.equal(resource().error.status, 409);
});

test('editor operations preserve every canonical status exactly once without mutating the source', () => {
    const columns = structuredClone(defaultPresentationGroups);
    const moved = movePresentationStatus(columns, 'Backlog', 'review');
    assert.equal(presentationError(moved), '');
    assert.deepEqual(columns, defaultPresentationGroups);
    assert.equal(moved[2].statuses.at(-1), 'Backlog');
    assert.equal(moved[0].statuses.includes('Backlog'), false);
    const ordered = reorderPresentation(moved, 2, -1);
    assert.equal(ordered[1].id, 'review');
    assert.equal(presentationError(ordered), '');
    assert.equal(reorderPresentation(columns, 0, -1), columns);
    assert.equal(movePresentationStatus(columns, 'Backlog', 'missing'), columns);
    assert.ok(presentationError([...columns, columns[0]]));
    const missing = structuredClone(columns);
    missing[0].statuses.pop();
    assert.ok(presentationError(missing));
    assert.ok(presentationError(columns.map((column) => ({ ...column, color: 'url(evil)' }))));
    assert.deepEqual(selectPresentationGroups({ workspace: {} }), []);
});

test('only a missing endpoint falls back; server, authentication and malformed-response errors remain errors', async () => {
    const originalFetch = globalThis.fetch;
    try {
        for (const status of [404, 500, 401, 403, 200]) {
            store.dispatch(login.fulfilled({ userId: 'admin', role: 'Administrator' }, 'login'));
            globalThis.fetch = async () => new Response(JSON.stringify({ message: 'Unavailable' }), { status });
            const result = await store.dispatch(loadPresentation());
            if (status === 404) {
                assert.equal(result.meta.requestStatus, 'fulfilled');
                assert.equal(resource().data.supported, false);
                assert.equal(resource().data.canManage, false);
                assert.deepEqual(resource().data.groups, defaultPresentationGroups);
            }
            else {
                assert.equal(result.meta.requestStatus, 'rejected');
                assert.equal(resource().data, null);
                assert.deepEqual(selectPresentationGroups(store.getState()), []);
            }
        }
    }
    finally {
        globalThis.fetch = originalFetch;
    }
});

test('presentation writes use credentialed versioned transport and polls cannot overwrite an in-flight save', async () => {
    store.dispatch(login.fulfilled({ userId: 'admin', role: 'Administrator' }, 'login'));
    const originalFetch = globalThis.fetch;
    const calls = [];
    let complete;
    globalThis.fetch = async (url, options) => {
        calls.push({ url, options });
        return new Promise((resolve) => { complete = resolve; });
    };
    try {
        const saving = store.dispatch(savePresentation({ version: 1, groups: defaultPresentationGroups }));
        const poll = await store.dispatch(loadPresentation());
        assert.equal(poll.meta.condition, true);
        assert.equal(calls.length, 1);
        assert.equal(calls[0].url, '/api/task-management/workflow-presentation');
        assert.equal(calls[0].options.method, 'PUT');
        assert.equal(calls[0].options.credentials, 'include');
        assert.equal(calls[0].options.headers['X-Task-Management'], '1');
        assert.equal(JSON.parse(calls[0].options.body).version, 1);
        complete(new Response(JSON.stringify({ version: 2, canManage: true, groups: defaultPresentationGroups })));
        await saving;
        assert.equal(resource().data.version, 2);
    }
    finally {
        globalThis.fetch = originalFetch;
    }
});
