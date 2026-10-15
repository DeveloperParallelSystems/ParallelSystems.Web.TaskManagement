import test from 'node:test';
import assert from 'node:assert/strict';
import { filterTasks } from '../src/features/tasks/workflow.js';
import { parseTaskQuery, serializeTaskQuery } from '../src/features/tasks/taskQuery.js';
import { store, login, logout, loadWorkspace } from '../src/app/store.js';
import { saveLabel, assignTaskLabels, labelOptions } from '../src/features/tasks/labelState.js';

const first = '11111111-1111-1111-1111-111111111111';
const second = '22222222-2222-2222-2222-222222222222';

test('deactivated draft selections remain visible for removal without discarding other selections', () => {
    const definitions = [{ id: first, active: false }, { id: second, active: true }];
    assert.deepEqual(labelOptions(definitions, [], [first, second]).map((label) => label.id), [first, second]);
    assert.deepEqual(labelOptions(definitions, [], [second]).map((label) => label.id), [second]);
    assert.deepEqual(labelOptions(definitions, [{ id: first }], []).map((label) => label.id), [first, second]);
});

test('label filters combine with project and require every selected label', () => {
    const tasks = [
        { id: 'both', projectId: 'project', labels: [{ id: first }, { id: second, active: false }] },
        { id: 'one', projectId: 'project', labels: [{ id: first }] },
        { id: 'other', projectId: 'other', labels: [{ id: first }, { id: second }] },
        { id: 'legacy', projectId: 'project' },
    ];
    assert.deepEqual(filterTasks(tasks, { labelIds: [first, second], projectId: 'project' }).map((task) => task.id), ['both']);
    assert.equal(filterTasks(tasks, {}).length, 4);
});

test('label query validates IDs, deduplicates and survives shared links and reset', () => {
    const query = parseTaskQuery(`label=${first},${second},${first},invalid&view=list`);
    assert.deepEqual(query.labelIds, [first, second]);
    const url = serializeTaskQuery(query, 'external=keep');
    assert.deepEqual(parseTaskQuery(url).labelIds, [first, second]);
    assert.match(url, /external=keep/);
    assert.equal(new URLSearchParams(serializeTaskQuery({ ...query, labelIds: [] }, url)).has('label'), false);
});

function workspace(requestId, tasks = [{ id: 'task', version: 1, labels: [] }], userId = 'account') {
    store.dispatch(loadWorkspace.pending(requestId));
    store.dispatch(loadWorkspace.fulfilled({ tasks, labels: [], projects: [],
        people: [{ id: 'staff', userId }], notifications: { items: [], unreadCount: 0 } }, requestId));
}

function labelAction(operation, phase, requestId, payload, arg = { taskId: 'task' }) {
    store.dispatch({ type: `labels/${operation}/${phase}`, payload, meta: { requestId, arg } });
}

test('assignment result updates task version and labels while rejecting an earlier workspace response', () => {
    store.dispatch(login.fulfilled({ userId: 'account', role: 'Administrator' }, 'login'));
    workspace('initial');
    labelAction('assign', 'pending', 'save');
    store.dispatch(loadWorkspace.pending('old'));
    const labels = [{ id: first, name: 'Release', color: '#000000', active: true, version: 1 }];
    labelAction('assign', 'fulfilled', 'save', { labels, version: 2 });
    store.dispatch(loadWorkspace.fulfilled({ tasks: [{ id: 'task', version: 1, labels: [] }], people: [], projects: [] }, 'old'));
    assert.equal(store.getState().workspace.tasks[0].version, 2);
    assert.deepEqual(store.getState().workspace.tasks[0].labels, labels);
});

test('definition edits update existing cards and late writes cannot restore private data', () => {
    store.dispatch(login.fulfilled({ userId: 'account', role: 'Administrator' }, 'login'));
    workspace('initial', [{ id: 'task', version: 2, labels: [{ id: first, version: 1, name: 'Old' }] }]);
    const label = { id: first, version: 2, name: 'Renamed', color: '#ffffff', active: false };
    labelAction('save', 'pending', 'definition', undefined, { id: first });
    labelAction('save', 'fulfilled', 'definition', label, { id: first });
    assert.equal(store.getState().workspace.tasks[0].labels[0].name, 'Renamed');
    for (const loss of ['logout', 'binding', 'access']) {
        store.dispatch(login.fulfilled({ userId: 'account', role: 'Administrator' }, 'login'));
        workspace('initial');
        labelAction('assign', 'pending', 'late');
        if (loss === 'logout') {
            store.dispatch(logout.fulfilled());
        }
        else {
            workspace('changed', [], loss === 'binding' ? 'new-account' : 'account');
        }
        labelAction('assign', 'fulfilled', 'late', { labels: [label], version: 3 });
        assert.deepEqual(store.getState().workspace.tasks, []);
    }
});

test('label writes use scoped credentialed transport and propagate conflicts without replacing state', async () => {
    store.dispatch(login.fulfilled({ userId: 'account', role: 'Administrator' }, 'login'));
    workspace('initial');
    const originalFetch = globalThis.fetch;
    const calls = [];
    globalThis.fetch = async (url, options) => {
        calls.push({ url, options });
        return new Response(JSON.stringify({ message: 'Task has changed.' }), {
            status: 409, headers: { 'Content-Type': 'application/json' },
        });
    };
    try {
        const result = await store.dispatch(assignTaskLabels({ taskId: 'task', labelIds: [first], version: 1 }));
        assert.equal(result.payload.status, 409);
        assert.equal(calls[0].url, '/api/task-management/tasks/task/labels');
        assert.equal(calls[0].options.credentials, 'include');
        assert.equal(calls[0].options.headers['X-Task-Management'], '1');
        assert.deepEqual(JSON.parse(calls[0].options.body), { labelIds: [first], version: 1 });
        assert.deepEqual(store.getState().workspace.tasks[0].labels, []);
        await store.dispatch(saveLabel({ id: first, values: { name: 'Name', color: '#ffffff', active: false, version: 2 } }));
        assert.equal(calls[1].url, `/api/task-management/labels/${first}`);
        assert.equal(calls[1].options.method, 'PUT');
    }
    finally {
        globalThis.fetch = originalFetch;
    }
});
