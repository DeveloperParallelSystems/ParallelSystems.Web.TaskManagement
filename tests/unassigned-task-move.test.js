import test from 'node:test';
import assert from 'node:assert/strict';
import { unassignedTaskMove } from '../src/features/projects/unassignedTaskMove.js';

const project = { id: 'project', clientIds: ['a', 'b'] };
const clients = [{ id: 'a' }, { id: 'b' }];
const tasks = [
    { id: 'empty', projectId: 'project', clientId: null, version: 3 },
    { id: 'detached', projectId: 'project', clientId: 'removed', version: 4 },
    { id: 'assigned', projectId: 'project', clientId: 'a', version: 5 },
    { id: 'other', projectId: 'other', clientId: null, version: 6 },
];

test('project move selects only unassigned tasks and keeps their concurrency revisions', () => {
    const move = unassignedTaskMove(project, clients, tasks, 'b');
    assert.deepEqual(move.tasks.map(task => [task.id, task.version]), [['empty', 3], ['detached', 4]]);
    assert.deepEqual(move.changes, { clientId: 'b' });
    assert.equal(tasks[0].clientId, null);
    assert.equal(tasks[1].clientId, 'removed');
});

test('project move requires an existing linked destination and unassigned tasks', () => {
    for (const clientId of ['', 'removed']) {
        assert.throws(() => unassignedTaskMove(project, clients, tasks, clientId), /linked client/);
    }
    assert.throws(() => unassignedTaskMove(project, clients.filter(client => client.id !== 'b'), tasks, 'b'), /linked client/);
    assert.throws(() => unassignedTaskMove({ ...project, clientIds: ['a'] }, clients, tasks, 'b'), /linked client/);
    assert.throws(() => unassignedTaskMove(project, clients, [tasks[2], tasks[3]], 'b'), /No unassigned tasks/);
});
