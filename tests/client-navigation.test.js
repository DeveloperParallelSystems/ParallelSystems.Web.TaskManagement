import test from 'node:test';
import assert from 'node:assert/strict';
import { taskIdFromPath, taskPathAfterSave } from '../src/features/tasks/taskNavigation.js';

test('project task routes preserve project context for new and existing task details', () => {
    const project = '11111111-1111-1111-1111-111111111111';
    const task = '22222222-2222-2222-2222-222222222222';
    assert.equal(taskIdFromPath(`/projects/${project}/tasks/new`), 'new');
    assert.equal(taskIdFromPath(`/projects/${project}/tasks/${task}`), task);
    assert.equal(taskIdFromPath(`/projects/general/tasks/${task}`), task);
    assert.equal(taskIdFromPath(`/projects/${project}/tasks`), null);
});

test('saving project task moves follows the destination including General and preserves legacy detail routes', () => {
    // The API save response contains only id; the submitted project determines the destination.
    assert.equal(taskPathAfterSave({ id: 'task' }, 'next', 'previous'), '/projects/next/tasks/task');
    assert.equal(taskPathAfterSave({ id: 'task' }, null, 'previous'), '/projects/general/tasks/task');
    assert.equal(taskPathAfterSave({ id: 'task' }, 'next', null), '/tasks/task');
});
