import test from 'node:test';
import assert from 'node:assert/strict';
import { store, checkSession, loadWorkspace, login, logout, sessionExpired } from '../src/app/store.js';

test('a signed-out session check does not show an error', () => {
    store.dispatch(checkSession.pending('probe'));
    store.dispatch(checkSession.rejected(null, 'probe', undefined, { status: 401, message: 'Unauthorized' }));
    assert.equal(store.getState().auth.status, 'anonymous');
    assert.equal(store.getState().auth.error, null);
});

test('logout clears task data and late requests cannot restore it', () => {
    store.dispatch(loadWorkspace.pending('load-1'));
    store.dispatch(
        loadWorkspace.fulfilled({ tasks: [{ id: 'private' }], people: [], projects: [], notifications: { items: [{ id: 1 }], unreadCount: 1 } }, 'load-1'),
    );
    assert.equal(store.getState().workspace.tasks.length, 1);
    store.dispatch(logout.fulfilled());
    store.dispatch(loadWorkspace.fulfilled({ tasks: [{ id: 'private' }] }, 'load-1'));
    assert.deepEqual(store.getState().workspace.tasks, []);
    assert.deepEqual(store.getState().workspace.notifications, { items: [], unreadCount: 0 });
});

test('expired sessions clear data and stale session probes cannot replace a new login', () => {
    store.dispatch(checkSession.pending('old-probe'));
    store.dispatch(login.pending('new-login'));
    store.dispatch(login.fulfilled({ userId: 'new-user', role: 'User' }, 'new-login'));
    store.dispatch(checkSession.fulfilled({ userId: 'old-user' }, 'old-probe'));
    assert.equal(store.getState().auth.user.userId, 'new-user');
    store.dispatch(sessionExpired());
    assert.equal(store.getState().auth.user, null);
    assert.deepEqual(store.getState().workspace.tasks, []);
});
