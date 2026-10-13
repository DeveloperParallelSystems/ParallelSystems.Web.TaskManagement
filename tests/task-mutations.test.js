import test from 'node:test';
import assert from 'node:assert/strict';
import { store, login, logout, loadTaskDetail, loadWorkspace, bulkUpdateTasks } from '../src/app/store.js';

test('detail responses arriving after logout cannot restore private task data', () => {
    store.dispatch(loadTaskDetail.pending('old-detail', { id: 'task' }));
    store.dispatch(logout.fulfilled());
    store.dispatch(loadTaskDetail.fulfilled({ task: { id: 'task', version: 1 } }, 'old-detail', { id: 'task' }));
    assert.deepEqual(store.getState().workspace.details, {});
});

test('staff account-link changes clear cached permissions and ignore old detail responses', () => {
    store.dispatch(login.fulfilled({ userId: 'account', role: 'User' }, 'staff-login'));
    const workspace = {
        tasks: [{ id: 'task', version: 1 }], projects: [],
        people: [{ id: 'staff', userId: 'account', accountIsActive: true }],
        notifications: { items: [], unreadCount: 0 },
    };
    store.dispatch(loadWorkspace.pending('workspace-one'));
    store.dispatch(loadWorkspace.fulfilled(workspace, 'workspace-one'));
    store.dispatch(loadTaskDetail.pending('detail-one', { id: 'task' }));
    store.dispatch(loadTaskDetail.fulfilled({ task: workspace.tasks[0], allowedStatuses: ['In Review'] }, 'detail-one', { id: 'task' }));
    assert.ok(store.getState().workspace.details.task);
    store.dispatch(loadTaskDetail.pending('detail-stale', { id: 'task' }));
    store.dispatch(loadWorkspace.pending('workspace-two'));
    store.dispatch(loadWorkspace.fulfilled({ ...workspace, people: [{ ...workspace.people[0], userId: null }] }, 'workspace-two'));
    assert.deepEqual(store.getState().workspace.details, {});
    store.dispatch(loadTaskDetail.fulfilled({ task: workspace.tasks[0] }, 'detail-stale', { id: 'task' }));
    assert.deepEqual(store.getState().workspace.details, {});
    store.dispatch(logout.fulfilled());
});

test('bulk updates use full details and versions and report conflicts separately', async () => {
    store.dispatch(login.fulfilled({ userId: 'admin', role: 'Administrator' }, 'admin-login'));
    const originalFetch = globalThis.fetch;
    const writes = [];
    globalThis.fetch = async (url, options) => {
        if (options.method === 'PUT') {
            writes.push({ url, input: JSON.parse(options.body) });
            return new Response(JSON.stringify({ id: 'one' }), { status: 200 });
        }
        const id = url.split('/').at(-1);
        return new Response(JSON.stringify({ task: {
            id, title: 'Task', description: 'Preserve this detail', discipline: 'Development',
            priority: 'High', status: 'To Do', originalAssigneeId: 'worker', assigneeId: 'worker',
            version: id === 'two' ? 9 : 2,
        } }), { status: 200 });
    };
    try {
        const results = await store.dispatch(bulkUpdateTasks({
            tasks: [{ id: 'one', code: 'TASK-1', version: 2 }, { id: 'two', code: 'TASK-2', version: 2 }],
            changes: { dueDate: '2026-10-20' },
        })).unwrap();
        assert.equal(writes.length, 1);
        assert.equal(writes[0].input.description, 'Preserve this detail');
        assert.equal(writes[0].input.version, 2);
        assert.equal(writes[0].input.dueDate, '2026-10-20');
        assert.equal(results[0].success, true);
        assert.equal(results[1].status, 409);
    }
    finally {
        globalThis.fetch = originalFetch;
        store.dispatch(logout.fulfilled());
    }
});
