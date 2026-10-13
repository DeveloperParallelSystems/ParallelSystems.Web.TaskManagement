import test from 'node:test';
import assert from 'node:assert/strict';
import { adjustMentions, commentInput, commentParts, discussionThreads, insertMention,
    mentionCandidates, mentionQuery, mergeComments } from '../src/features/tasks/commentMentions.js';
import { store, login, logout, loadWorkspace } from '../src/app/store.js';
import { deleteTaskComment, loadTaskComments, saveTaskComment } from '../src/features/tasks/discussionState.js';

test('mention suggestions use the caret, match staff names/emails and ignore email addresses and selected mentions', () => {
    assert.deepEqual(mentionQuery('Ask @Alex Mo', 12), { start: 4, end: 12, query: 'Alex Mo' });
    assert.equal(mentionQuery('alex@example.test', 17), null);
    assert.equal(mentionQuery('Ask @Alex Morgan ', 17, [{ start: 4, length: 12 }]), null);
    const people = [{ id: 'one', name: 'Alex Morgan', email: 'qa@example.test' }, { id: 'two', name: 'Alex Morgan', email: 'alex@other.test' }];
    assert.deepEqual(mentionCandidates(people, 'qa@'), [people[0]]);
    assert.equal(mentionCandidates(people, 'Alex Morgan').length, 2);
});

test('mention suggestions exclude the signed-in account using the staff account link', () => {
    const self = { id: 'my-staff', userId: 'MY-ACCOUNT', name: 'Alex Morgan', email: 'me@example.test' };
    const other = { id: 'other-staff', userId: 'other-account', name: 'Alex Morgan', email: 'other@example.test' };
    const people = [self, other];
    assert.deepEqual(mentionCandidates(people, '', 'my-account'), [other]);
    assert.deepEqual(mentionCandidates(people, 'Alex', 'my-account'), [other]);
    assert.deepEqual(mentionCandidates(people, 'me@', 'my-account'), []);
    assert.deepEqual(mentionCandidates(people, 'other@', 'my-account'), [other]);
    assert.deepEqual(mentionCandidates([self], '', 'my-account'), []);
    assert.deepEqual(mentionCandidates(people, '', undefined), people);

    const morePeople = Array.from({ length: 8 }, (_, index) => ({
        id: `staff-${index}`, userId: `account-${index}`, name: `Person ${index}`,
    }));
    assert.deepEqual(mentionCandidates([self, ...morePeople], '', 'my-account'), morePeople);
});

test('selected mentions retain staff identity, UTF-16 offsets and text around the caret', () => {
    const body = '👋 @Al, please review';
    const range = mentionQuery(body, 6);
    const inserted = insertMention(body, [], range, { id: 'staff', name: 'Alex Morgan' });
    assert.equal(inserted.body, '👋 @Alex Morgan , please review');
    assert.equal(inserted.mentions[0].start, 3);
    assert.equal(inserted.caret, 16);
    assert.deepEqual(commentInput({ ...inserted, parentId: 2, version: 3 }), {
        body: inserted.body, parentId: 2, version: 3,
        mentions: [{ staffId: 'staff', start: 3, length: 12 }],
    });
});

test('editing text shifts mentions but editing or extending a mention removes its notification metadata', () => {
    const body = 'Ask @Alex Morgan today';
    const mentions = [{ staffId: 'staff', start: 4, length: 12, text: '@Alex Morgan' }];
    assert.equal(adjustMentions(body, 'Please ' + body, mentions)[0].start, 11);
    assert.equal(adjustMentions(body, 'Ask @Alex Mo today', mentions).length, 0);
    assert.equal(adjustMentions(body, 'Ask @Alex MorganExtra today', mentions).length, 0);
    assert.equal(adjustMentions(body, 'Ask  today', mentions).length, 0);
    assert.equal(adjustMentions(body, body + '!', mentions).length, 1);
});

test('comment rendering preserves plain text and sorts valid spans without parsing HTML', () => {
    const body = '<script>plain</script> @Alex Morgan';
    const parts = commentParts(body, [{ staffId: 'staff', start: 23, length: 12 }, { start: -1, length: 2 }]);
    assert.equal(parts.map((part) => part.text).join(''), body);
    assert.equal(parts.filter((part) => part.mention).length, 1);
    assert.equal(parts.find((part) => part.mention).text, '@Alex Morgan');
});

test('threads preserve replies to deleted roots, deduplicate pages and keep newer comment versions', () => {
    const root = { id: 1, version: 3, parentId: null, deleted: true, body: '' };
    const reply = { id: 2, version: 1, parentId: 1, body: 'Reply remains' };
    const merged = mergeComments([root, reply], [{ ...root, version: 2, deleted: false, body: 'Old' }, reply]);
    assert.equal(merged.length, 2);
    assert.equal(merged[0].deleted, true);
    assert.deepEqual(discussionThreads(merged), [{ comment: root, replies: [reply] }]);
    assert.equal(discussionThreads([{ ...reply, parentId: 99 }])[0].comment.id, 2);
});

function signIn() {
    store.dispatch(login.fulfilled({ userId: 'account', role: 'User' }, 'discussion-login'));
}

test('late comment loads and saves cannot restore private data after logout or a new login', () => {
    signIn();
    const arg = { taskId: 'task' };
    store.dispatch(loadTaskComments.pending('load-one', arg));
    store.dispatch(saveTaskComment.pending('save-one', arg));
    store.dispatch(logout.fulfilled());
    store.dispatch(loadTaskComments.fulfilled({ items: [{ id: 1, body: 'Private' }], mentionablePeople: [] }, 'load-one', arg));
    store.dispatch(saveTaskComment.fulfilled({ id: 2, body: 'Private' }, 'save-one', arg));
    assert.deepEqual(store.getState().workspace.discussions, {});
    signIn();
    store.dispatch(loadTaskComments.pending('load-new', arg));
    store.dispatch(loadTaskComments.fulfilled({ items: [{ id: 1, body: 'Old session' }] }, 'load-one', arg));
    assert.equal(store.getState().workspace.discussions.task.items.length, 0);
    store.dispatch(logout.fulfilled());
});

test('comment saves invalidate pending older reads and deletion cannot be undone by stale pagination', () => {
    signIn();
    const arg = { taskId: 'task' };
    const comment = { id: 1, version: 1, body: 'Original', mentions: [] };
    store.dispatch(loadTaskComments.pending('initial', arg));
    store.dispatch(loadTaskComments.fulfilled({ items: [comment], nextCursor: null, mentionablePeople: [] }, 'initial', arg));
    store.dispatch(loadTaskComments.pending('old-page', arg));
    store.dispatch(saveTaskComment.pending('write', arg));
    store.dispatch(saveTaskComment.fulfilled({ ...comment, version: 2, body: 'Updated' }, 'write', arg));
    store.dispatch(loadTaskComments.fulfilled({ items: [comment], mentionablePeople: [] }, 'old-page', arg));
    assert.equal(store.getState().workspace.discussions.task.items[0].body, 'Updated');
    const deletion = { taskId: 'task', id: 1, version: 2 };
    store.dispatch(deleteTaskComment.pending('remove', deletion));
    store.dispatch(deleteTaskComment.fulfilled({ id: 1, version: 2 }, 'remove', deletion));
    store.dispatch(loadTaskComments.pending('page', { ...arg, after: 1 }));
    store.dispatch(loadTaskComments.fulfilled({ items: [comment], nextCursor: null, mentionablePeople: [] }, 'page', { ...arg, after: 1 }));
    assert.equal(store.getState().workspace.discussions.task.items[0].deleted, true);
    store.dispatch(logout.fulfilled());
});

test('lost task access and changed staff bindings clear comment content and in-flight writes', () => {
    signIn();
    const workspace = { tasks: [{ id: 'task', version: 1 }], people: [{ id: 'staff', userId: 'account' }],
        projects: [], notifications: { items: [], unreadCount: 0 } };
    store.dispatch(loadWorkspace.pending('workspace'));
    store.dispatch(loadWorkspace.fulfilled(workspace, 'workspace'));
    const arg = { taskId: 'task' };
    store.dispatch(loadTaskComments.pending('comments', arg));
    store.dispatch(loadTaskComments.fulfilled({ items: [{ id: 1, version: 1, body: 'Private' }], mentionablePeople: [], nextCursor: null }, 'comments', arg));
    store.dispatch(saveTaskComment.pending('old-write', arg));
    store.dispatch(loadWorkspace.pending('binding'));
    store.dispatch(loadWorkspace.fulfilled({ ...workspace, people: [{ id: 'staff', userId: null }] }, 'binding'));
    store.dispatch(saveTaskComment.fulfilled({ id: 2, body: 'Late' }, 'old-write', arg));
    assert.deepEqual(store.getState().workspace.discussions, {});
    store.dispatch(loadTaskComments.pending('no-access', arg));
    store.dispatch(loadTaskComments.rejected(null, 'no-access', arg, { status: 404, message: 'No access' }));
    assert.equal(store.getState().workspace.discussions.task.hasLoaded, false);
    assert.equal(store.getState().workspace.discussions.task.items.length, 0);
    store.dispatch(logout.fulfilled());
});
