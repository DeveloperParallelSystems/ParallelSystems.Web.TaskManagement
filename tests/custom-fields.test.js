import test from 'node:test';
import assert from 'node:assert/strict';
import { store, login, logout } from '../src/app/store.js';
import { columnError, requiredTaskColumns, loadTaskColumns } from '../src/features/tasks/taskColumns.js';
import { customValueError, customTaskPayload, projectFieldDraft, customFieldDisplay } from '../src/features/tasks/customFieldValues.js';
import { fieldDefinitionError, loadCustomFields, saveCustomField, archiveCustomField } from '../src/features/tasks/customFields.js';
import { taskInput } from '../src/features/tasks/taskActions.js';

const projectId = '11111111-1111-1111-1111-111111111111';
const fieldId = '22222222-2222-2222-2222-222222222222';
const field = { id: fieldId, name: 'Date Started', type: 'Date', isArchived: false };
const page = { version: 4, projectId, canManage: true, fields: [field] };

test('custom field definitions and columns are project-scoped and six built-ins stay required', () => {
    assert.equal(fieldDefinitionError({ name: ' Assigned Developer ', type: 'Person' }, []), '');
    assert.ok(fieldDefinitionError({ name: 'Assigned To', type: 'Text' }, []));
    assert.ok(fieldDefinitionError({ name: 'DATE STARTED', type: 'Date' }, [field]));
    assert.ok(fieldDefinitionError({ ...field, type: 'Text' }, [field]));
    assert.equal(columnError([...requiredTaskColumns, `custom:${fieldId}`], [field]), '');
    assert.ok(columnError([...requiredTaskColumns, `custom:${fieldId}`]));
    assert.ok(columnError([...requiredTaskColumns, `custom:${fieldId}`], [{ ...field, isArchived: true }]));
    assert.ok(columnError(['task', `custom:${fieldId}`], [field]));
});

test('typed values validate exact dates/decimal precision without rounding and render safe strings', () => {
    assert.equal(customValueError({ type: 'Number' }, '12345678901234567890.12345678'), '');
    for (const value of ['1e3', '1.123456789', '123456789012345678901', 'NaN']) {
        assert.ok(customValueError({ type: 'Number' }, value));
    }
    assert.equal(customValueError(field, '2024-02-29'), '');
    assert.ok(customValueError(field, '2025-02-29'));
    assert.ok(customValueError(field, '2024-1-1'));
    assert.equal(customValueError({ type: 'Text' }, '<script>safe</script>'), '');
    assert.ok(customValueError({ type: 'Text' }, 'x'.repeat(2001)));
    assert.ok(customValueError({ type: 'Checkbox' }, 'yes'));
    assert.ok(customValueError({ type: 'Person' }, 'not-staff'));
    assert.equal(customFieldDisplay({ type: 'Checkbox' }, 'false'), 'No');
    assert.equal(customFieldDisplay({ type: 'Person' }, fieldId, [{ id: fieldId, name: 'Staff Name' }]), 'Staff Name');
    assert.equal(customFieldDisplay({ type: 'Person' }, fieldId, []), 'Staff details unavailable');
});

test('task custom payload requires current definitions, preserves per-project drafts and never leaks to ordinary saves', () => {
    const task = { projectId, customFieldValues: [{ fieldId, value: '2026-10-01' }] };
    const original = projectFieldDraft({}, projectId, task);
    const changed = { ...original, [fieldId]: '2026-10-02' };
    const drafts = { [projectId]: changed };
    assert.deepEqual(projectFieldDraft(drafts, 'other-project', task), {});
    assert.deepEqual(projectFieldDraft(drafts, projectId, task), changed);
    assert.deepEqual(customTaskPayload({ projectId, page, revision: 4, values: changed, canEdit: true }), {
        customFieldVersion: 4, customFieldValues: [{ fieldId, value: '2026-10-02' }],
    });
    assert.throws(() => customTaskPayload({ projectId, page, revision: 5, values: changed, canEdit: true }), /Reload/);
    assert.throws(() => customTaskPayload({ projectId, page: null, revision: 4, values: changed, canEdit: true }), /load/i);
    assert.deepEqual(customTaskPayload({ projectId, page, revision: 4, values: changed, canEdit: false }), {});
    assert.deepEqual(customTaskPayload({ projectId: null, page, revision: 4, values: changed, canEdit: true }), {});
    assert.equal(taskInput(task).customFieldValues, undefined);
});

test('sparse custom patches preserve unseen project and restored values unless explicitly edited', () => {
    const restoredId = '33333333-3333-3333-3333-333333333333';
    const restoredPage = { ...page, fields: [...page.fields, { id: restoredId, name: 'Retained note', type: 'Text', isArchived: false }] };
    const taskLoadedInB = { projectId: 'other-project', customFieldValues: [] };
    assert.deepEqual(projectFieldDraft({}, projectId, taskLoadedInB), {});
    assert.deepEqual(customTaskPayload({ projectId, page: restoredPage, revision: 4, values: {}, canEdit: true }), {},
        'Moving back to A without edits must preserve the unseen prior-project values');
    assert.deepEqual(customTaskPayload({ projectId, page: restoredPage, revision: 4, values: { [fieldId]: '2026-10-19' }, canEdit: true }), {
        customFieldVersion: 4, customFieldValues: [{ fieldId, value: '2026-10-19' }],
    }, 'Editing one field must not send or clear an unseen restored field');
    assert.deepEqual(customTaskPayload({ projectId, page: restoredPage, revision: 4, values: { [restoredId]: '' }, canEdit: true }), {
        customFieldVersion: 4, customFieldValues: [{ fieldId: restoredId, value: null }],
    }, 'Only an explicit clear sends null');
    const task = { projectId, customFieldValues: [{ fieldId, value: '2026-10-01' }, { fieldId: restoredId, value: 'Keep me' }] };
    assert.deepEqual(projectFieldDraft({ [projectId]: { [fieldId]: '2026-10-19' } }, projectId, task), {
        [fieldId]: '2026-10-19', [restoredId]: 'Keep me',
    }, 'Display merges loaded values with sparse edits');
});

test('definition API uses project paths, guarded writes, immutable type and revision invalidation', async () => {
    store.dispatch(login.fulfilled({}, 'login'));
    const original = globalThis.fetch;
    const calls = [];
    globalThis.fetch = async (url, options) => {
        calls.push({ url, ...options, body: options.body && JSON.parse(options.body) });
        return new Response(JSON.stringify({ ...page, version: 4 + calls.length }));
    };
    try {
        await store.dispatch(loadCustomFields(projectId)).unwrap();
        const scope = { projectId, discipline: 'Drafting' };
        store.dispatch(loadTaskColumns.pending('columns', scope));
        store.dispatch(loadTaskColumns.fulfilled({ ...scope, version: 5, columns: requiredTaskColumns, customFields: [field] }, 'columns', scope));
        await store.dispatch(saveCustomField({ projectId, version: 5, name: 'Assigned Developer', type: 'Person' })).unwrap();
        assert.equal(calls[1].url, `/api/task-management/projects/${projectId}/custom-fields`);
        assert.deepEqual(calls[1].body, { version: 5, name: 'Assigned Developer', type: 'Person' });
        assert.equal(calls[1].headers['X-Task-Management'], '1');
        assert.equal(store.getState().workspace.taskColumns[`${projectId}:Drafting`].invalidated, true);
        await store.dispatch(archiveCustomField({ projectId, fieldId, version: 6, restore: false })).unwrap();
        assert.equal(calls[2].url, `/api/task-management/projects/${projectId}/custom-fields/${fieldId}/archive`);
        assert.deepEqual(calls[2].body, { version: 6 });
        store.dispatch(loadCustomFields.pending('late', projectId));
        store.dispatch(logout.fulfilled({}, 'logout'));
        store.dispatch(loadCustomFields.fulfilled(page, 'late', projectId));
        assert.deepEqual(store.getState().workspace.customFields, {});
    }
    finally {
        globalThis.fetch = original;
    }
});
