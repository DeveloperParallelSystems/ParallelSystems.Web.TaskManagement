import test from 'node:test';
import assert from 'node:assert/strict';
import { projectClientContext, projectsForClient, taskClientId, tasksForProjectClient } from '../src/features/projects/projectClients.js';
import { taskScopeLocation, newChildTaskLocation } from '../src/features/tasks/taskNavigation.js';
import { taskInput } from '../src/features/tasks/taskActions.js';

const clients = [{ id: 'a' }, { id: 'b' }];
const projects = [{ id: 'project', clientIds: ['a', 'b'] }];
const tasks = [
    { id: 'A', projectId: 'project', clientId: 'a' },
    { id: 'B', projectId: 'project', clientId: 'b' },
    { id: 'none', projectId: 'project', clientId: null },
    { id: 'removed', projectId: 'project', clientId: 'deleted' },
    { id: 'other', projectId: 'other', clientId: 'a' },
];

test('project task scopes isolate A, B and null while detached tasks remain unassigned', () => {
    assert.deepEqual(tasksForProjectClient(tasks, projects[0], clients, 'a').map((task) => task.id), ['A']);
    assert.deepEqual(tasksForProjectClient(tasks, projects[0], clients, 'b').map((task) => task.id), ['B']);
    assert.deepEqual(tasksForProjectClient(tasks, projects[0], clients, null).map((task) => task.id), ['none', 'removed']);
    assert.equal(taskClientId(tasks[0], [{ ...projects[0], clientIds: ['b'] }], clients), null);
    assert.deepEqual(projectsForClient(projects, clients, 'unassigned', tasks), projects);
});

test('bare project means unassigned and invalid explicit client never chooses another client', () => {
    assert.equal(projectClientContext(projects[0], clients, ''), null);
    assert.equal(projectClientContext(projects[0], clients, '?client=unassigned'), null);
    assert.equal(projectClientContext(projects[0], clients, '?client=b'), 'b');
    assert.equal(projectClientContext(projects[0], clients, '?client=deleted'), undefined);
    assert.equal(projectClientContext(projects[0], clients, '?client='), undefined);
});

test('direct detail, back context and child creation derive actual task client instead of stale queries', () => {
    assert.deepEqual(taskScopeLocation(tasks[0], projects, clients, '?client=b&view=list&following=1'), {
        pathname: '/projects/project/tasks/A', search: '?client=a&view=list&following=1',
    });
    assert.equal(taskScopeLocation(tasks[3], projects, clients).search, '?client=unassigned');
    const child = newChildTaskLocation(tasks[1], projects, '?client=a', clients);
    assert.equal(child.pathname, '/projects/project/tasks/new');
    assert.equal(new URLSearchParams(child.search).get('client'), 'b');
    assert.equal(new URLSearchParams(child.search).get('parentTaskId'), 'B');
});

test('ordinary task mutations omit client while an explicit assignment patch survives', () => {
    assert.equal(Object.hasOwn(taskInput(tasks[0], { status: 'Blocked' }), 'clientId'), false);
    assert.equal(taskInput(tasks[0], { clientId: null }).clientId, null);
    assert.equal(taskInput(tasks[0], { clientId: 'b' }).clientId, 'b');
});
