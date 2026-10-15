import test from 'node:test';
import assert from 'node:assert/strict';
import { configureStore, createSlice } from '@reduxjs/toolkit';
import { addDisciplineWorkflowReducers, emptyDisciplineWorkflows, loadDisciplineWorkflows,
    saveDisciplineWorkflowDraft, publishDisciplineWorkflowDraft, disableDisciplineWorkflow,
    validateDisciplineWorkflowDraft, workflowDefinitionErrors, renameWorkflowStage,
    removeWorkflowStage, workflowDraftIsStale, receiveWorkflowSnapshot, savedWorkflowSnapshot } from '../src/features/tasks/disciplineWorkflows.js';

export function definition() {
    return { name: 'Development', startStageId: 'work', stages: [
        { id: 'work', name: 'Work', kind: 'Work', color: 'blue', ownerRole: 'Owner' },
        { id: 'review', name: 'Review', kind: 'Review', color: 'purple', ownerRole: 'Reviewer' },
        { id: 'done', name: 'Done', kind: 'Completed', color: 'green', ownerRole: 'None' },
    ], transitions: [
        { id: 'submit', name: 'Submit', fromStageId: 'work', toStageId: 'review', actorRoles: ['Owner'], kind: 'Progress', requireNote: false },
        { id: 'approve', name: 'Approve', fromStageId: 'review', toStageId: 'done', actorRoles: ['Reviewer'], kind: 'Approve', requireNote: false },
        { id: 'reject', name: 'Return to work', fromStageId: 'review', toStageId: 'work', actorRoles: ['Reviewer'], kind: 'FailReview', requireNote: true },
    ] };
}
const draft = (version = 1) => ({ id: 'draft-id', discipline: 'Development', version, definition: definition() });
const page = (version = 1) => ({ canManage: true, items: [
    { discipline: 'Development', active: null, draft: draft(version) },
    { discipline: 'Drafting', active: null, draft: null },
] });
function makeStore(data = page()) {
    const slice = createSlice({ name: 'workspace', initialState: {
        disciplineWorkflows: { ...emptyDisciplineWorkflows, data },
    }, reducers: { reset(state) { state.disciplineWorkflows = { ...emptyDisciplineWorkflows }; } },
    extraReducers: addDisciplineWorkflowReducers });
    return configureStore({ reducer: { workspace: slice.reducer } });
}
function resource(store) {
    return store.getState().workspace.disciplineWorkflows;
}

test('publication accepts a reachable review retry loop and detects trapped and unreachable stages', () => {
    assert.deepEqual(workflowDefinitionErrors(definition(), true), []);
    const trapped = definition();
    trapped.transitions = trapped.transitions.filter((action) => action.id !== 'approve');
    const errors = workflowDefinitionErrors(trapped, true).join(' ');
    assert.match(errors, /Completed|completion/);
    assert.match(errors, /Approve/);
    const unreachable = definition();
    unreachable.stages.push({ id: 'orphan', name: 'Orphan', kind: 'Work', color: 'blue', ownerRole: 'Owner' });
    assert.match(workflowDefinitionErrors(unreachable, true).join(' '), /unreachable|reached/i);
});

test('validation checks participant permissions, required review notes, owner rules and structural limits', () => {
    const invalid = definition();
    invalid.transitions[2].actorRoles = ['Owner'];
    invalid.transitions[2].requireNote = false;
    invalid.stages[1].ownerRole = 'Owner';
    invalid.stages[2].ownerRole = 'Reviewer';
    const errors = workflowDefinitionErrors(invalid, true).join(' ');
    assert.match(errors, /Reviewer/);
    assert.match(errors, /note/i);
    assert.match(errors, /None/);
    assert.ok(workflowDefinitionErrors({ ...definition(), stages: Array(31).fill(definition().stages[0]) }).length);
    assert.ok(workflowDefinitionErrors({ ...definition(), transitions: Array(101).fill(definition().transitions[0]) }).length);
    assert.ok(workflowDefinitionErrors({ ...definition(), name: 'x'.repeat(81) }).length);
    assert.ok(workflowDefinitionErrors({ ...definition(), stages: [null] }).length);
    assert.ok(workflowDefinitionErrors({ ...definition(), transitions: [{ actorRoles: {} }] }).length);
});

test('incomplete draft can be saved but cannot be published; renaming preserves graph references', () => {
    const incomplete = { name: '', startStageId: '', stages: [], transitions: [] };
    assert.deepEqual(workflowDefinitionErrors(incomplete), []);
    assert.ok(workflowDefinitionErrors(incomplete, true).length);
    const initial = definition();
    const renamed = renameWorkflowStage(initial, 'work', 'doing');
    assert.equal(renamed.startStageId, 'doing');
    assert.equal(renamed.transitions[0].fromStageId, 'doing');
    assert.equal(renamed.transitions[2].toStageId, 'doing');
    assert.equal(initial.startStageId, 'work');
    const removed = removeWorkflowStage(initial, 'review');
    assert.equal(removed.stages.length, 2);
    assert.equal(removed.transitions.length, 0);
    assert.equal(workflowDraftIsStale(draft(), draft(2)), true);
    assert.equal(workflowDraftIsStale(draft(), null), true);
    assert.equal(workflowDraftIsStale(draft(), draft()), false);
});

test('publication prevents review actions outside review and arbitrary terminal exits', () => {
    const invalid = definition();
    invalid.transitions[0].kind = 'Approve';
    invalid.transitions[0].actorRoles = ['Reviewer'];
    invalid.transitions.push({ id: 'bad-exit', name: 'Exit completed', fromStageId: 'done', toStageId: 'work',
        actorRoles: ['Owner'], kind: 'Progress', requireNote: false });
    invalid.transitions.push({ id: 'bad-complete', name: 'Complete into review', fromStageId: 'work', toStageId: 'review',
        actorRoles: ['Owner'], kind: 'Complete', requireNote: false });
    const errors = workflowDefinitionErrors(invalid, true).join(' ');
    assert.match(errors, /start from a Review/);
    assert.match(errors, /terminal.*Reopen/);
    assert.match(errors, /Complete.*Completed/);
});

test('review and release exits cannot bypass their semantic participant checks', () => {
    const invalid = definition();
    invalid.transitions[1].kind = 'Progress';
    invalid.stages.push({ id: 'release', name: 'Release', kind: 'Release', ownerRole: 'Release', color: 'green' });
    invalid.transitions.push({ id: 'release-bypass', name: 'Release bypass', kind: 'Complete', fromStageId: 'release',
        toStageId: 'done', actorRoles: ['Owner'], requireNote: false });
    const errors = workflowDefinitionErrors(invalid, true).join(' ');
    assert.match(errors, /Review exits/);
    assert.match(errors, /Completed.*Complete or Approve/);
    assert.match(errors, /Release exits.*Release or Administrator/);
});

test('review actions stay reviewer-only even within review; cancelled targets require Cancel', () => {
    const invalid = definition();
    invalid.stages.push({ id: 'cancelled', name: 'Cancelled', kind: 'Cancelled', color: 'red', ownerRole: 'None' });
    invalid.transitions.push({ id: 'review-loop', name: 'Review loop', kind: 'Progress', fromStageId: 'review', toStageId: 'review',
        actorRoles: ['Owner'], requireNote: false });
    invalid.transitions.push({ id: 'cancel-bypass', name: 'Cancel bypass', kind: 'Progress', fromStageId: 'work', toStageId: 'cancelled',
        actorRoles: ['Owner'], requireNote: false });
    const errors = workflowDefinitionErrors(invalid, true).join(' ');
    assert.match(errors, /Review actions.*Reviewer or Administrator/);
    assert.match(errors, /entering Cancelled must use Cancel/);
});

test('reopen cannot target current Owner after terminal stages clear that owner', () => {
    const workflow = definition();
    workflow.transitions.push({ id: 'reopen', name: 'Reopen work', kind: 'Reopen', fromStageId: 'done', toStageId: 'work',
        actorRoles: ['Administrator'], requireNote: false });
    assert.match(workflowDefinitionErrors(workflow, true).join(' '), /Reopen.*Owner.*terminal stages clear/i);
    assert.deepEqual(workflowDefinitionErrors(workflow), []);
    for (const ownerRole of ['Original', 'Reviewer', 'Release', 'None']) {
        workflow.stages[0].ownerRole = ownerRole;
        assert.deepEqual(workflowDefinitionErrors(workflow, true), []);
    }
});

test('nonterminal stages with no owner cannot hand off to the cleared current Owner', () => {
    const workflow = definition();
    workflow.stages.unshift({ id: 'planning', name: 'Planning', kind: 'Planning', color: 'blue', ownerRole: 'None' });
    workflow.startStageId = 'planning';
    workflow.transitions.unshift({ id: 'begin-work', name: 'Begin work', kind: 'Progress', fromStageId: 'planning', toStageId: 'work',
        actorRoles: ['Administrator'], requireNote: false });
    assert.match(workflowDefinitionErrors(workflow, true).join(' '), /None.*Owner.*clears the current owner/i);
    assert.deepEqual(workflowDefinitionErrors(workflow), []);
    workflow.stages[1].ownerRole = 'Original';
    assert.deepEqual(workflowDefinitionErrors(workflow, true), []);
});

test('background refresh preserves the open draft, and save response cannot adopt another administrator’s later draft', () => {
    const opened = receiveWorkflowSnapshot(null, page().items[0]);
    opened.draft.definition.name = 'My unsaved workflow';
    assert.equal(receiveWorkflowSnapshot(opened, page(2).items[0]), opened);
    assert.equal(opened.draft.definition.name, 'My unsaved workflow');
    assert.equal(workflowDraftIsStale(opened.draft, page(2).items[0].draft), true);
    const saved = draft(2);
    saved.definition.name = 'My saved workflow';
    const afterSave = savedWorkflowSnapshot(opened, saved);
    assert.equal(afterSave.draft.definition.name, 'My saved workflow');
    assert.equal(workflowDraftIsStale(afterSave.draft, page(3).items[0].draft), true);
    assert.equal(workflowDraftIsStale(null, draft()), true);
});

test('resource rejects reads overtaken by writes and all replies after session reset', () => {
    const store = makeStore();
    store.dispatch(loadDisciplineWorkflows.pending('old-read'));
    store.dispatch(saveDisciplineWorkflowDraft.pending('write', draft()));
    store.dispatch(saveDisciplineWorkflowDraft.fulfilled({ page: page(2), result: draft(2) }, 'write', draft()));
    store.dispatch(loadDisciplineWorkflows.fulfilled(page(1), 'old-read'));
    assert.equal(resource(store).data.items[0].draft.version, 2);
    store.dispatch(loadDisciplineWorkflows.pending('late-read'));
    store.dispatch({ type: 'workspace/reset' });
    store.dispatch(loadDisciplineWorkflows.fulfilled(page(3), 'late-read'));
    assert.equal(resource(store).data, null);
});

test('save writes the captured draft version and reloads metadata, while polls and second writes are suppressed', async () => {
    const store = makeStore();
    const calls = [];
    let resolveWrite;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, options) => {
        calls.push({ url, options });
        if (options.method === 'PUT') {
            return new Promise((resolve) => { resolveWrite = resolve; });
        }
        return new Response(JSON.stringify(page(2)));
    };
    try {
        const saving = store.dispatch(saveDisciplineWorkflowDraft(draft()));
        assert.equal((await store.dispatch(loadDisciplineWorkflows())).meta.condition, true);
        assert.equal((await store.dispatch(saveDisciplineWorkflowDraft(draft()))).meta.condition, true);
        assert.equal(calls.length, 1);
        assert.deepEqual(JSON.parse(calls[0].options.body), { version: 1, definition: definition() });
        assert.equal(calls[0].options.credentials, 'include');
        resolveWrite(new Response(JSON.stringify(draft(2))));
        await saving;
        assert.equal(calls[1].url, '/api/task-management/discipline-workflows');
        assert.equal(resource(store).data.items[0].draft.version, 2);
    }
    finally {
        globalThis.fetch = originalFetch;
    }
});

test('late write completion after logout cannot issue a metadata read or restore state', async () => {
    const store = makeStore();
    const originalFetch = globalThis.fetch;
    let finish;
    let count = 0;
    globalThis.fetch = async () => {
        count++;
        return new Promise((resolve) => { finish = resolve; });
    };
    try {
        const saving = store.dispatch(saveDisciplineWorkflowDraft(draft()));
        store.dispatch({ type: 'workspace/reset' });
        finish(new Response(JSON.stringify(draft(2))));
        assert.equal((await saving).meta.requestStatus, 'rejected');
        assert.equal(count, 1);
        assert.equal(resource(store).data, null);
    }
    finally {
        globalThis.fetch = originalFetch;
    }
});

test('conflicts preserve metadata and validation never replaces it with a result object', async () => {
    const store = makeStore();
    const originalFetch = globalThis.fetch;
    try {
        globalThis.fetch = async () => new Response(JSON.stringify({ errors: ['Missing Completed stage.'] }));
        const result = await store.dispatch(validateDisciplineWorkflowDraft(draft())).unwrap();
        assert.deepEqual(result.errors, ['Missing Completed stage.']);
        assert.equal(resource(store).data.items[0].draft.version, 1);
        globalThis.fetch = async () => new Response(JSON.stringify({ message: 'Draft changed.' }), { status: 409 });
        await store.dispatch(publishDisciplineWorkflowDraft(draft()));
        assert.equal(resource(store).error.status, 409);
        assert.equal(resource(store).data.items[0].draft.version, 1);
        assert.equal(resource(store).writeId, null);
    }
    finally {
        globalThis.fetch = originalFetch;
    }
});

test('disable activation uses optimistic active ID and only 404 falls back to explicit legacy compatibility', async () => {
    const store = makeStore();
    const originalFetch = globalThis.fetch;
    const calls = [];
    try {
        globalThis.fetch = async (url, options) => {
            calls.push({ url, options });
            return new Response(JSON.stringify(page()));
        };
        await store.dispatch(disableDisciplineWorkflow({ discipline: 'Development', expectedActiveVersionId: 'active-id' })).unwrap();
        assert.deepEqual(JSON.parse(calls[0].options.body), { workflowVersionId: null, expectedActiveVersionId: 'active-id' });
        for (const status of [404, 403, 500]) {
            globalThis.fetch = async () => new Response(JSON.stringify({ message: 'Unavailable' }), { status });
            const result = await store.dispatch(loadDisciplineWorkflows());
            if (status === 404) {
                assert.equal(result.meta.requestStatus, 'fulfilled');
                assert.equal(resource(store).data.supported, false);
                assert.equal(resource(store).data.canManage, false);
                assert.ok(resource(store).data.items.every((item) => item.active === null && item.draft === null));
            }
            else {
                assert.equal(result.meta.requestStatus, 'rejected');
                assert.equal(resource(store).error.status, status);
            }
        }
    }
    finally {
        globalThis.fetch = originalFetch;
    }
});
