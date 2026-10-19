import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultTaskQuery, parseTaskQuery, serializeTaskQuery } from '../src/features/tasks/taskQuery.js';

test('following filter survives task view changes and resets with the other filters', () => {
    const query = parseTaskQuery('?following=1&view=board');
    assert.equal(query.followingOnly, true);
    const listQuery = serializeTaskQuery({ ...query, view: 'list' });
    assert.equal(new URLSearchParams(listQuery).get('following'), '1');
    assert.equal(parseTaskQuery(listQuery).followingOnly, true);
    const reset = serializeTaskQuery({ ...defaultTaskQuery, view: 'list' }, listQuery);
    assert.equal(new URLSearchParams(reset).has('following'), false);
    assert.equal(parseTaskQuery('?following=true').followingOnly, false);
});
