import test from 'node:test';
import assert from 'node:assert/strict';
import { store, login, logout, loadWorkspace } from '../src/app/store.js';
import { loadNotificationInbox, readNotifications, notificationBadge, notificationQuery } from '../src/features/tasks/notificationInbox.js';

const page = (unreadCount = 106) => ({ items: [{ id: 1, taskId: 'task' }], page: 1, pageSize: 25, totalCount: 113, unreadCount });
function start() {
    store.dispatch(login.fulfilled({ userId: 'user', role: 'User' }, 'login'));
}
function workspace(requestId, unreadCount) {
    store.dispatch(loadWorkspace.fulfilled({ tasks: [], people: [], projects: [], notifications: page(unreadCount) }, requestId));
}

test('badge caps at 99+ while inbox queries normalize filter and page', () => {
    assert.equal(notificationBadge(99), '99');
    assert.equal(notificationBadge(106), '99+');
    assert.deepEqual(notificationQuery('?filter=unread&page=3'), { filter: 'unread', page: 3 });
    assert.deepEqual(notificationQuery('?filter=bogus&page=-9'), { filter: 'all', page: 1 });
});

test('inbox ignores superseded pages, pre-mutation reads and expired-session replies', () => {
    start();
    const query = { filter: 'all', page: 1 };
    store.dispatch(loadNotificationInbox.pending('old', query));
    store.dispatch(loadNotificationInbox.pending('latest', { filter: 'unread', page: 2 }));
    store.dispatch(loadNotificationInbox.fulfilled(page(5), 'old', query));
    assert.equal(store.getState().workspace.notificationInbox.data, null);
    store.dispatch(loadWorkspace.pending('workspace-old'));
    store.dispatch(readNotifications.pending('mark', { filter: 'unread', page: 1 }));
    store.dispatch(loadWorkspace.pending('workspace-during'));
    workspace('workspace-during', 106);
    assert.equal(store.getState().workspace.notificationSummaryRequestId, 'mark');
    store.dispatch(loadNotificationInbox.fulfilled(page(106), 'latest', { filter: 'unread', page: 2 }));
    store.dispatch(readNotifications.fulfilled({ ...page(0), items: [], totalCount: 0 }, 'mark', { filter: 'unread', page: 1 }));
    workspace('workspace-old', 106);
    assert.equal(store.getState().workspace.notifications.unreadCount, 0);
    assert.equal(store.getState().workspace.notificationInbox.data.totalCount, 0);
    store.dispatch(loadNotificationInbox.pending('logout', query));
    store.dispatch(logout.fulfilled());
    store.dispatch(loadNotificationInbox.fulfilled(page(), 'logout', query));
    assert.equal(store.getState().workspace.notifications.unreadCount, 0);
    assert.equal(store.getState().workspace.notificationInbox.data, null);
});

test('failed mark-all preserves the count and requests use only the task notification endpoints', async () => {
    start();
    const originalFetch = globalThis.fetch;
    const calls = [];
    let fail = false;
    globalThis.fetch = async (url, options) => {
        calls.push({ url, options });
        if (options.method === 'POST') {
            return fail ? new Response(JSON.stringify({ message: 'Offline' }), { status: 503 }) : new Response(null, { status: 204 });
        }
        return new Response(JSON.stringify(page()), { status: 200 });
    };
    try {
        await store.dispatch(loadNotificationInbox({ filter: 'unread', page: 2 }));
        assert.equal(calls[0].url, '/api/task-management/notifications?filter=unread&page=2');
        fail = true;
        await store.dispatch(readNotifications({ filter: 'all', page: 1 }));
        assert.equal(store.getState().workspace.notifications.unreadCount, 106);
        assert.equal(store.getState().workspace.notificationInbox.error, 'Offline');
        fail = false;
        await store.dispatch(readNotifications({ filter: 'all', page: 1 }));
        assert.equal(calls[2].url, '/api/task-management/notifications/read-all');
        await store.dispatch(readNotifications({ id: 4, filter: 'unread', page: 3 }));
        assert.equal(calls[4].url, '/api/task-management/notifications/4/read');
        assert.equal(calls[4].options.credentials, 'include');
    }
    finally {
        globalThis.fetch = originalFetch;
    }
});
