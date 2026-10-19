import test from 'node:test';
import assert from 'node:assert/strict';
import { store, login, logout } from '../src/app/store.js';
import { loadPresentation } from '../src/features/tasks/workflowPresentation.js';
import { loadProjectPresentation, saveProjectPresentation, useDefaultPresentation, selectProjectPresentationGroups } from '../src/features/tasks/projectBoardPresentation.js';

const projectId = '11111111-1111-1111-1111-111111111111';
const otherId = '22222222-2222-2222-2222-222222222222';
const groups = [{ id: 'all', name: 'Project work', color: 'blue', statuses: ['To Do'] }];
const page = { projectId, projectVersion: 1, usesDefault: false, version: 1, catalogVersion: 1,
    catalog: [{ code: 'To Do', name: 'To Do' }], groups, canManage: true };

test('project saves and resets use scoped URLs and both board revisions without changing the default', async () => {
    const originalFetch = globalThis.fetch;
    const calls = [];
    try {
        store.dispatch(login.fulfilled({ userId: 'admin', role: 'Administrator' }, 'login'));
        globalThis.fetch = async (url, options) => {
            calls.push({ url, method: options.method, body: options.body && JSON.parse(options.body) });
            return new Response(JSON.stringify(page));
        };
        await store.dispatch(saveProjectPresentation({ ...page, projectVersion: 0, groups })).unwrap();
        assert.equal(calls[0].url, `/api/task-management/board-presentation/projects/${projectId}`);
        assert.equal(calls[0].body.projectVersion, 0);
        assert.equal(calls[0].body.catalogVersion, 1);
        assert.equal(store.getState().workspace.workflowPresentation.data, null);
        await store.dispatch(useDefaultPresentation(page)).unwrap();
        assert.equal(calls[1].url, `/api/task-management/board-presentation/projects/${projectId}/use-default`);
        assert.equal(calls[1].method, 'POST');
        assert.equal(calls[1].body.groups, undefined);
    }
    finally {
        globalThis.fetch = originalFetch;
    }
});

test('project reads are isolated and late reads cannot overwrite a saved project layout', () => {
    store.dispatch(login.fulfilled({}, 'login'));
    store.dispatch(loadProjectPresentation.pending('old', projectId));
    store.dispatch(loadProjectPresentation.pending('other', otherId));
    store.dispatch(saveProjectPresentation.pending('save', page));
    store.dispatch(saveProjectPresentation.fulfilled({ ...page, supported: true }, 'save', page));
    store.dispatch(loadProjectPresentation.fulfilled({ ...page, groups: [] }, 'old', projectId));
    store.dispatch(loadProjectPresentation.fulfilled({ ...page, projectId: otherId, groups: [] }, 'other', otherId));
    assert.deepEqual(selectProjectPresentationGroups(store.getState(), projectId), groups);
    assert.deepEqual(selectProjectPresentationGroups(store.getState(), otherId), []);
    store.dispatch(logout.fulfilled({}, 'logout'));
    assert.deepEqual(store.getState().workspace.projectPresentations, {});
});

test('reset accepts a lower effective default version while rejecting older project revisions', () => {
    store.dispatch(login.fulfilled({}, 'login'));
    for (const [requestId, data] of [['custom', { ...page, projectVersion: 10, version: 10 }],
        ['reset', { ...page, projectVersion: 11, version: 1, usesDefault: true }],
        ['stale', { ...page, projectVersion: 10, version: 10 }]]) {
        store.dispatch(loadProjectPresentation.pending(requestId, projectId));
        store.dispatch(loadProjectPresentation.fulfilled(data, requestId, projectId));
    }
    assert.equal(store.getState().workspace.projectPresentations[projectId].data.usesDefault, true);
    store.dispatch(loadPresentation.pending('default'));
    store.dispatch(loadPresentation.fulfilled({ ...page, version: 2, groups: [{ ...groups[0], name: 'Updated default' }] }, 'default'));
    assert.equal(selectProjectPresentationGroups(store.getState(), projectId)[0].name, 'Updated default');
});

test('an unavailable project never falls back to shared columns or exposes cached data', async () => {
    const originalFetch = globalThis.fetch;
    try {
        globalThis.fetch = async () => new Response('{}', { status: 404 });
        const result = await store.dispatch(loadProjectPresentation(projectId));
        assert.equal(result.meta.requestStatus, 'rejected');
        assert.deepEqual(selectProjectPresentationGroups(store.getState(), projectId), []);
    }
    finally {
        globalThis.fetch = originalFetch;
    }
});

test('a newer catalog accepts reset project revisions, including customization after reset', () => {
    for (const usesDefault of [true, false]) {
        store.dispatch(login.fulfilled({}, 'login'));
        store.dispatch(loadProjectPresentation.pending('old', projectId));
        store.dispatch(loadProjectPresentation.fulfilled({ ...page, projectVersion: 10, version: 10, catalogVersion: 5 }, 'old', projectId));
        store.dispatch(loadProjectPresentation.pending('reset', projectId));
        const next = { ...page, projectVersion: usesDefault ? 0 : 1, version: 1, catalogVersion: 6, usesDefault };
        store.dispatch(loadProjectPresentation.fulfilled(next, 'reset', projectId));
        assert.deepEqual(store.getState().workspace.projectPresentations[projectId].data, next);
        store.dispatch(loadProjectPresentation.pending('late', projectId));
        store.dispatch(loadProjectPresentation.fulfilled({ ...page, projectVersion: 10, version: 10, catalogVersion: 5 }, 'late', projectId));
        assert.deepEqual(store.getState().workspace.projectPresentations[projectId].data, next);
    }
});
