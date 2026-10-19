import test from 'node:test';
import assert from 'node:assert/strict';
import { store, login, logout, loadWorkspace } from '../src/app/store.js';
import { columnError, defaultTaskColumns, requiredTaskColumns, taskColumnKey, listTaskColumns, taskPersonName, loadTaskColumns, saveTaskColumns, useDefaultTaskColumns } from '../src/features/tasks/taskColumns.js';

const scope = { projectId: '11111111-1111-1111-1111-111111111111', discipline: 'Drafting' };
const requiredFields = ['task', 'discipline', 'status', 'priority', 'assignedTo', 'dueDate'];
const page = { ...scope, version: 1, usesDefault: true, canManage: true, columns: defaultTaskColumns.Drafting };
const resource = () => store.getState().workspace.taskColumns[taskColumnKey(scope)];

test('empty custom metadata from shared defaults or a new project normalizes to an empty list', async () => {
    const original = globalThis.fetch;
    try {
        for (const projectId of [null, scope.projectId]) {
            store.dispatch(login.fulfilled({}, 'empty-fields-login'));
            const emptyScope = { projectId, discipline: 'Drafting' };
            globalThis.fetch = async () => new Response(JSON.stringify({ ...page, ...emptyScope, customFields: null }));
            const loaded = await store.dispatch(loadTaskColumns(emptyScope)).unwrap();
            assert.deepEqual(loaded.customFields, []);
            assert.deepEqual(loaded.columns, defaultTaskColumns.Drafting);
        }
    }
    finally {
        globalThis.fetch = original;
    }
});

test('six task fields are required and reorderable with Drafting QA hidden', () => {
    assert.deepEqual(requiredTaskColumns, requiredFields);
    assert.equal(defaultTaskColumns.Drafting.includes('qa'), false);
    assert.equal(defaultTaskColumns.Drafting.includes('originalAssignee'), true);
    assert.match(columnError(['task']), /Assigned To/);
    assert.match(columnError(['assignedTo']), /Task/);
    assert.ok(columnError(['task', 'assignedTo', 'qa', 'qa']));
    assert.ok(columnError(['task', 'assignedTo', 'unknown']));
    for (const field of requiredFields) {
        assert.ok(columnError(requiredFields.filter((candidate) => candidate !== field)), `${field} must be required`);
    }
    assert.equal(columnError([...requiredFields].reverse()), '');
    assert.equal(columnError([...requiredFields, 'originalAssignee', 'qa']), '');
    assert.deepEqual(listTaskColumns({ Development: ['task', 'qa', 'assignedTo'], Drafting: ['assignedTo', 'task', 'dueDate'] }), ['task', 'qa', 'assignedTo', 'dueDate']);
    assert.deepEqual(listTaskColumns(defaultTaskColumns, 'Drafting'), defaultTaskColumns.Drafting);
    assert.equal(taskPersonName({ originalAssigneeId: 'old', assigneeId: 'old', assigneeName: 'Historical Name' }, [], 'originalAssignee'), 'Historical Name');
    assert.equal(taskPersonName({}, [], 'assignedTo'), 'Unassigned');
});

test('save helper rejects every required field omission without sending a request', async () => {
    const original = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => {
        calls++;
        return new Response(JSON.stringify(page));
    };
    try {
        for (const field of requiredFields) {
            const result = await store.dispatch(saveTaskColumns({ ...page, columns: page.columns.filter((candidate) => candidate !== field) }));
            assert.equal(result.meta.requestStatus, 'rejected', `${field} omission must be rejected`);
        }
        assert.equal(calls, 0);
    }
    finally {
        globalThis.fetch = original;
    }
});

test('profile API uses scoped credentialed reads/writes/reset and never sends task mutations', async () => {
    store.dispatch(login.fulfilled({}, 'login'));
    const original = globalThis.fetch;
    const calls = [];
    globalThis.fetch = async (url, options) => {
        calls.push({ url, ...options, body: options.body && JSON.parse(options.body) });
        return new Response(JSON.stringify({ ...page, version: calls.length }));
    };
    try {
        await store.dispatch(loadTaskColumns(scope)).unwrap();
        await store.dispatch(saveTaskColumns(page)).unwrap();
        await store.dispatch(useDefaultTaskColumns({ ...page, version: 2 })).unwrap();
        assert.equal(calls[0].url, `/api/task-management/task-columns/projects/${scope.projectId}/Drafting`);
        assert.equal(calls[1].method, 'PUT');
        assert.deepEqual(calls[1].body, { version: 1, columns: page.columns });
        assert.equal(calls[1].credentials, 'include');
        assert.equal(calls[1].headers['X-Task-Management'], '1');
        assert.equal(calls[2].url, calls[0].url + '/use-default');
        assert.deepEqual(calls[2].body, { version: 2 });
    }
    finally {
        globalThis.fetch = original;
    }
});

test('writes invalidate all profiles and stale reads or responses after logout cannot restore data', () => {
    store.dispatch(login.fulfilled({}, 'login'));
    const shared = { projectId: null, discipline: 'Development' };
    store.dispatch(loadTaskColumns.pending('shared', shared));
    store.dispatch(loadTaskColumns.fulfilled({ ...page, ...shared }, 'shared', shared));
    store.dispatch(loadTaskColumns.pending('late', scope));
    store.dispatch(useDefaultTaskColumns.pending('reset', page));
    store.dispatch(useDefaultTaskColumns.fulfilled({ ...page, version: 5 }, 'reset', page));
    assert.equal(store.getState().workspace.taskColumns[taskColumnKey(shared)].invalidated, true);
    store.dispatch(loadTaskColumns.fulfilled({ ...page, version: 2, usesDefault: false }, 'late', scope));
    assert.equal(resource().data.version, 5);
    store.dispatch(loadTaskColumns.pending('older', scope));
    store.dispatch(loadTaskColumns.fulfilled({ ...page, version: 4 }, 'older', scope));
    assert.equal(resource().data.version, 5);
    store.dispatch(loadTaskColumns.pending('session', scope));
    store.dispatch(logout.fulfilled({}, 'logout'));
    store.dispatch(loadTaskColumns.fulfilled(page, 'session', scope));
    assert.deepEqual(store.getState().workspace.taskColumns, {});
});

test('profile failures preserve prior transport data but clear forbidden project data', () => {
    store.dispatch(login.fulfilled({}, 'login'));
    store.dispatch(loadTaskColumns.pending('read', scope));
    store.dispatch(loadTaskColumns.fulfilled(page, 'read', scope));
    store.dispatch(loadTaskColumns.pending('network', scope));
    store.dispatch(loadTaskColumns.rejected(null, 'network', scope, { status: 500, message: 'offline' }));
    assert.equal(resource().data.version, 1);
    store.dispatch(loadTaskColumns.pending('denied', scope));
    store.dispatch(loadTaskColumns.rejected(null, 'denied', scope, { status: 403 }));
    assert.equal(resource().data, null);
});

test('workspace access changes clear project profiles and in-flight replies cannot restore lost access', () => {
    store.dispatch(login.fulfilled({}, 'login'));
    store.dispatch(loadTaskColumns.pending('read', scope));
    store.dispatch(loadTaskColumns.fulfilled(page, 'read', scope));
    store.dispatch(loadTaskColumns.pending('late', scope));
    store.dispatch(loadWorkspace.pending('workspace'));
    store.dispatch(loadWorkspace.fulfilled({ tasks: [], people: [], projects: [], labels: [] }, 'workspace'));
    assert.equal(resource(), undefined);
    store.dispatch(loadTaskColumns.fulfilled(page, 'late', scope));
    assert.equal(resource(), undefined);
    const shared = { projectId: null, discipline: 'Development' };
    store.dispatch(loadTaskColumns.pending('shared', shared));
    store.dispatch(loadTaskColumns.fulfilled({ ...page, ...shared }, 'shared', shared));
    store.dispatch(loadWorkspace.pending('binding'));
    store.dispatch(loadWorkspace.fulfilled({ tasks: [], people: [{ id: 'new-staff', userId: 'new-binding' }], projects: [], labels: [] }, 'binding'));
    assert.deepEqual(store.getState().workspace.taskColumns, {});
    assert.ok(store.getState().workspace.taskColumnsEpoch > 0);
});
