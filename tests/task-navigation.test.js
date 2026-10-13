import test from 'node:test';
import assert from 'node:assert/strict';
import { taskIdFromPath, shouldBlockTaskNavigation } from '../src/features/tasks/taskNavigation.js';

test('task routes accept new tasks and GUID deep links without treating list routes as details', () => {
    const id = 'a41dbf24-0adf-4814-a822-54ae783de420';
    assert.equal(taskIdFromPath(`/tasks/${id}`), id);
    assert.equal(taskIdFromPath(`/tasks/${id.toUpperCase()}/`), id);
    assert.equal(taskIdFromPath('/tasks/new'), 'new');
    assert.equal(taskIdFromPath('/tasks'), null);
    assert.equal(taskIdFromPath('/tasks/not-a-guid'), null);
    assert.equal(taskIdFromPath(`/tasks/${id}/extra`), null);
});

test('dirty and saving tasks protect route and filter navigation, while clean tasks can leave', () => {
    const current = { pathname: '/tasks/task-id', search: '?view=list&project=one' };
    const destinations = [
        { pathname: '/tasks', search: current.search },
        { pathname: '/projects', search: '' },
        { pathname: '/tasks/other-task', search: current.search },
        { ...current, search: '?view=board' },
    ];
    for (const destination of destinations) {
        assert.equal(shouldBlockTaskNavigation({ dirty: true, saving: false }, current, destination), true);
        assert.equal(shouldBlockTaskNavigation({ dirty: false, saving: true }, current, destination), true);
        assert.equal(shouldBlockTaskNavigation({ dirty: false, saving: false }, current, destination), false);
    }
    assert.equal(shouldBlockTaskNavigation({ dirty: true, saving: false }, current, current), false);
});
