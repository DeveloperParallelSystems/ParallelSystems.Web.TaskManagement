import test from 'node:test';
import assert from 'node:assert/strict';
import { projectClientIds, projectClientContext, projectsForClient } from '../src/features/projects/projectClients.js';
import { defaultTaskQuery, serializeTaskQuery } from '../src/features/tasks/taskQuery.js';
import { newChildTaskLocation, withoutParentSelection } from '../src/features/tasks/taskNavigation.js';

const first = '11111111-1111-1111-1111-111111111111';
const second = '22222222-2222-2222-2222-222222222222';
const clients = [{ id: second }, { id: first }];

test('client membership respects authoritative arrays, legacy lookups and deleted clients', () => {
    assert.deepEqual(projectClientIds({ clientId: first }, clients), [first]);
    assert.deepEqual(projectClientIds({ clientIds: [], clientId: first }, clients), []);
    assert.deepEqual(projectClientIds({ clientIds: null, clientId: first }, clients), []);
    assert.deepEqual(projectClientIds({ clientIds: [first, first, 'deleted'] }, clients), [first]);
    const shared = { id: 'shared', clientIds: [first, second] };
    const orphaned = { id: 'orphaned', clientIds: ['deleted'] };
    assert.deepEqual(projectsForClient([shared, orphaned], clients, first), [shared]);
    assert.deepEqual(projectsForClient([shared, orphaned], clients, second), [shared]);
    assert.deepEqual(projectsForClient([shared, orphaned], clients, 'unassigned'), [orphaned]);
});

test('breadcrumb context validates membership without falling back to another client', () => {
    const shared = { clientIds: [second, first] };
    assert.equal(projectClientContext(shared, clients, `?client=${second}`), second);
    assert.equal(projectClientContext(shared, clients, '?client=deleted'), undefined);
    assert.equal(projectClientContext(shared, [...clients].reverse(), ''), null);
    assert.equal(projectClientContext({ clientIds: [first] }, clients, `?client=${second}`), undefined);
    assert.equal(projectClientContext({ clientIds: [] }, clients, `?client=${second}`), undefined);
});

test('view changes, filter reset and task child/back links retain the client context', () => {
    const search = `?client=${second}&following=1`;
    const changed = new URLSearchParams(serializeTaskQuery({ ...defaultTaskQuery, view: 'list', followingOnly: true }, search));
    assert.equal(changed.get('client'), second);
    assert.equal(changed.get('following'), '1');
    const reset = new URLSearchParams(serializeTaskQuery(defaultTaskQuery, search));
    assert.equal(reset.get('client'), second);
    assert.equal(reset.has('following'), false);
    const child = newChildTaskLocation({ id: 'task', projectId: 'project', clientId: second }, [{ id: 'project', clientIds: [second] }], search, clients);
    assert.equal(new URLSearchParams(child.search).get('client'), second);
    assert.equal(withoutParentSelection(child.search), search);
});
