import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { requiredTaskColumns } from '../src/features/tasks/taskColumns.js';

test('task form custom interactions retain project drafts, validate before save, and omit inaccessible/member payloads', async () => {
    const root = resolve('.tmp');
    mkdirSync(root, { recursive: true });
    const scratch = mkdtempSync(join(root, 'custom-task-form-'));
    const originalFetch = globalThis.fetch;
    const originalWindow = globalThis.window;
    try {
        const hooks = join(scratch, 'hooks.js');
        writeFileSync(hooks, `
let slots = [];
let index = 0;
let state;
let loaded;
export function reset(next, task = null) { state = next; loaded = task; slots = []; }
export function renderStart() { index = 0; }
export function snapshot() { return state; }
export function useState(initial) {
    const slot = index++;
    if (!(slot in slots)) {
        slots[slot] = typeof initial === 'function' ? initial() : initial;
        if (slot === 0) { slots[slot] = { ...slots[slot], title: 'Task', originalAssigneeId: 'staff', projectId: 'project', ...loaded }; }
        if (slot === 1 && loaded) { slots[slot] = { task: slots[0], canEditDetails: state.auth.user.role === 'Administrator', allowedStatuses: [], activity: [] }; }
        if (slot === 2) { slots[slot] = false; }
        if (slot === 15) { slots[slot] = true; }
    }
    return [slots[slot], (value) => { slots[slot] = typeof value === 'function' ? value(slots[slot]) : value; }];
}
export function useEffect() {}
export function useRef() { return { current: null }; }
export function useSelector(select) { return select(state); }
export function useDispatch() { return (action) => typeof action === 'function' ? action(() => {}, () => state) : action; }
export function useBlocker() { return { state: 'unblocked' }; }
export function useLocation() { return { search: '' }; }
export function useNavigate() { return () => {}; }
`);
        const entry = join(scratch, 'entry.jsx');
        writeFileSync(entry, "export { default as TaskPage } from '../../src/features/tasks/TaskPage.jsx';\nexport { reset, renderStart, snapshot } from './hooks.js';");
        const bundle = await build({ configFile: false, logLevel: 'silent', plugins: [{
            name: 'form-hooks', enforce: 'pre', transform(source, id) {
                if (id.replaceAll('\\', '/').endsWith('/src/features/tasks/TaskPage.jsx')) {
                    return source.replace(/from '(react|react-redux|react-router-dom)'/g, `from ${JSON.stringify(hooks.replaceAll('\\', '/'))}`);
                }
            },
        }, react()], build: { ssr: entry, write: false } });
        const file = join(scratch, 'form.mjs');
        writeFileSync(file, bundle.output.find((chunk) => chunk.isEntry).code);
        const { TaskPage, reset, renderStart, snapshot } = await import(pathToFileURL(file).href);
        const field = { id: '11111111-1111-1111-1111-111111111111', name: 'Date Started', type: 'Date', isArchived: false };
        const state = { auth: { user: { role: 'Administrator' } }, workspace: {
            projects: [{ id: 'project', name: 'Project' }, { id: 'other', name: 'Other' }], tasks: [], people: [],
            statusSettings: { data: { catalog: [], disciplines: [] } }, taskColumnsRevision: 7,
            taskColumns: {
                'project:Development': { data: { version: 7, columns: [...requiredTaskColumns, `custom:${field.id}`] } },
                'project:Drafting': { data: { version: 7, columns: requiredTaskColumns } },
                'other:Development': { data: { version: 7, columns: requiredTaskColumns } },
            },
            customFields: { project: { data: { projectId: 'project', version: 7, canManage: true, fields: [field] } },
                other: { data: { projectId: 'other', version: 7, canManage: true, fields: [] } } },
        } };
        reset(state);
        globalThis.window = { confirm: () => true };
        const calls = [];
        globalThis.fetch = async (url, options) => {
            calls.push({ url, body: JSON.parse(options.body) });
            return new Response(JSON.stringify({ id: 'created' }));
        };
        function descendants(element) {
            if (Array.isArray(element)) {
                return element.flatMap(descendants);
            }
            return React.isValidElement(element) ? [element, ...descendants(element.props.children)] : [];
        }
        let taskId = 'new';
        function render() {
            renderStart();
            return descendants(TaskPage({ id: taskId, onEditingChange() {}, onClose() {}, onSaved() {} }));
        }
        const custom = () => render().find((element) => element.type?.name === 'TaskCustomFields');
        const form = () => render().find((element) => element.props.id === 'task-details-form');
        const projectSelect = () => render().find((element) => element.type === 'select' && element.props.value === 'project');
        assert.ok(custom(), 'Project fields must mount in the actual task form');
        assert.equal(render().some((element) => element.type === 'span' && element.props.children === 'Release owner'), false,
            'New tasks must not expose the unconfigured legacy release-owner field');
        custom().props.onChange(field.id, '2026-10-19');
        assert.equal(custom().props.values[field.id], '2026-10-19');
        projectSelect().props.onChange({ target: { value: 'other' } });
        assert.deepEqual(custom().props.values, {});
        render().find((element) => element.type === 'select' && element.props.value === 'other').props.onChange({ target: { value: 'project' } });
        assert.equal(custom().props.values[field.id], '2026-10-19');
        await form().props.onSubmit({ preventDefault() {} });
        assert.equal(calls.length, 1);
        assert.equal(calls[0].url, '/api/task-management/tasks/live');
        assert.deepEqual(calls[0].body.customFieldValues, [{ fieldId: field.id, value: '2026-10-19' }]);
        assert.equal(calls[0].body.customFieldVersion, 7);
        custom().props.onChange(field.id, '2026-02-30');
        await form().props.onSubmit({ preventDefault() {} });
        assert.equal(calls.length, 1, 'Invalid values must not reach the API');
        snapshot().workspace.taskColumnsRevision = 8;
        await form().props.onSubmit({ preventDefault() {} });
        assert.equal(calls.length, 1, 'Stale definitions must not reach the API');
        snapshot().workspace.projects = [];
        await form().props.onSubmit({ preventDefault() {} });
        assert.equal(calls.at(-1).body.customFieldValues, undefined, 'Historical inaccessible project skips custom payload');
        state.workspace.projects = [{ id: 'project', name: 'Project' }, { id: 'other', name: 'Other' }];
        state.workspace.taskColumnsRevision = 7;
        const restored = { id: '22222222-2222-2222-2222-222222222222', name: 'Restored note', type: 'Text', isArchived: false };
        state.workspace.customFields.project.data.fields = [field, restored];
        taskId = 'existing';
        reset(state, { id: taskId, projectId: 'project', releaseOwnerId: 'existing-release-owner', customFieldValues: [{ fieldId: restored.id, value: 'Keep hidden value' }], version: 3 });
        assert.deepEqual(custom().props.fields.map((item) => item.id), [field.id], 'Opened task follows configured custom visibility');
        assert.equal(render().some((element) => element.type === 'span' && element.props.children === 'Original assignee'), false);
        assert.equal(render().some((element) => element.type === 'span' && element.props.children === 'Reviewer / QA'), false);
        assert.equal(render().some((element) => element.type === 'span' && element.props.children === 'Release owner'), false,
            'Existing release-owner assignments must not bypass column visibility');
        custom().props.onChange(field.id, '2026-10-21');
        await form().props.onSubmit({ preventDefault() {} });
        assert.deepEqual(calls.at(-1).body.customFieldValues, [{ fieldId: field.id, value: '2026-10-21' }], 'Saving a visible field preserves hidden field values');
        assert.equal(calls.at(-1).body.releaseOwnerId, 'existing-release-owner', 'Unrelated edits preserve the existing release owner');
        state.workspace.taskColumns['project:Development'].data.columns.push(`custom:${restored.id}`, 'originalAssignee', 'qa');
        assert.deepEqual(custom().props.fields.map((item) => item.id), [field.id, restored.id]);
        assert.equal(custom().props.values[restored.id], 'Keep hidden value');
        assert.equal(render().some((element) => element.type === 'span' && element.props.children === 'Original assignee'), true);
        state.workspace.taskColumns['project:Development'].data.columns = [...requiredTaskColumns, `custom:${field.id}`];
        reset(state, { id: taskId, projectId: 'project', discipline: 'Drafting', version: 3 });
        assert.deepEqual(custom().props.fields, [], 'The selected task discipline controls visibility');
        state.workspace.taskColumns['project:Drafting'].invalidated = true;
        assert.equal(custom(), undefined, 'Stale visibility must not expose fields');
        state.workspace.taskColumns['project:Drafting'].invalidated = false;
        reset(state, { id: taskId, projectId: 'other', customFieldValues: [], version: 3 });
        render().find((element) => element.type === 'select' && element.props.value === 'other').props.onChange({ target: { value: 'project' } });
        await form().props.onSubmit({ preventDefault() {} });
        assert.equal(calls.at(-1).body.customFieldValues, undefined, 'B→A must not clear retained A values absent from the B-loaded form');
        reset(state, { id: taskId, projectId: 'project', customFieldValues: [{ fieldId: field.id, value: '2026-10-01' }], version: 4 });
        await form().props.onSubmit({ preventDefault() {} });
        assert.equal(calls.at(-1).body.customFieldValues, undefined, 'Ordinary save must not clear unseen restored field values');
        custom().props.onChange(field.id, '2026-10-20');
        await form().props.onSubmit({ preventDefault() {} });
        assert.deepEqual(calls.at(-1).body.customFieldValues, [{ fieldId: field.id, value: '2026-10-20' }], 'One field edit sends only that field');
        custom().props.onChange(field.id, '');
        await form().props.onSubmit({ preventDefault() {} });
        assert.deepEqual(calls.at(-1).body.customFieldValues, [{ fieldId: field.id, value: null }]);
        state.auth.user.role = 'User';
        reset(state, { id: taskId, projectId: 'project', customFieldValues: [{ fieldId: field.id, value: '2026-10-01' }], version: 4 });
        assert.equal(custom().props.editable, false);
        await form().props.onSubmit({ preventDefault() {} });
        assert.equal(calls.at(-1).body.customFieldValues, undefined, 'Member saves must omit custom field edits');
        state.auth.user.role = 'Administrator';
        reset(state, { id: taskId, projectId: 'project', status: 'To Do', version: 9 });
        const statusSelect = render().find((element) => element.type === 'select' && element.props['aria-label'] === 'Status');
        assert.ok(statusSelect, 'Task status must be an input in the unified task form');
        statusSelect.props.onChange({ target: { value: 'In Progress' } });
        const labelPanel = render().find((element) => element.type?.name === 'TaskLabels');
        assert.equal(labelPanel.props.integrated, true, 'Task labels must share the task save');
        labelPanel.props.onEditingChange({ dirty: true, saving: false, labelIds: ['label-id'] });
        custom().props.onChange(field.id, '2026-10-22');
        await form().props.onSubmit({ preventDefault() {} });
        assert.equal(calls.at(-1).body.status, 'In Progress');
        assert.deepEqual(calls.at(-1).body.labelIds, ['label-id']);
        assert.deepEqual(calls.at(-1).body.customFieldValues, [{ fieldId: field.id, value: '2026-10-22' }]);
        assert.equal(calls.at(-1).body.note, '', 'Discussion replaces task/status notes');
        state.workspace.statusSettings.data = {
            catalog: ['To Do', 'In Progress', 'code-review'].map((code) => ({ code, name: code === 'code-review' ? 'Code Review' : code })),
            disciplines: [
                { discipline: 'Development', statuses: ['To Do', 'In Progress', 'code-review'] },
                { discipline: 'Drafting', statuses: ['To Do', 'In Progress'] },
            ],
        };
        const disciplineSelect = () => render().find((element) => element.type === 'select' &&
            ['Development', 'Drafting'].includes(element.props.value));
        const currentStatus = () => render().find((element) => element.type === 'select' && element.props['aria-label'] === 'Status');
        reset(state, { id: taskId, discipline: 'Development', status: 'code-review', assigneeId: 'same-owner',
            workflow: { definition: { mode: 'Review' } }, version: 10 });
        assert.equal(disciplineSelect().props.disabled, false, 'Admins can correct discipline even with a historical workflow pin');
        disciplineSelect().props.onChange({ target: { value: 'Drafting' } });
        assert.equal(currentStatus().props.value, '', 'An unsupported status requires an explicit replacement');
        const beforeInvalidDiscipline = calls.length;
        await form().props.onSubmit({ preventDefault() {} });
        assert.equal(calls.length, beforeInvalidDiscipline, 'An unsupported destination status must not reach the API');
        currentStatus().props.onChange({ target: { value: 'In Progress' } });
        await form().props.onSubmit({ preventDefault() {} });
        assert.equal(calls.at(-1).body.discipline, 'Drafting');
        assert.equal(calls.at(-1).body.status, 'In Progress');
        assert.equal(calls.at(-1).body.assigneeId, 'same-owner', 'Discipline changes must preserve Assigned To');
        assert.equal(calls.at(-1).body.customFieldValues, undefined, 'Hidden project values must not be cleared by a discipline change');
        reset(state, { id: taskId, discipline: 'Development', status: 'In Progress', assigneeId: 'same-owner', version: 11 });
        disciplineSelect().props.onChange({ target: { value: 'Drafting' } });
        assert.equal(currentStatus().props.value, 'In Progress', 'Shared statuses remain selected');
        await form().props.onSubmit({ preventDefault() {} });
        assert.equal(calls.at(-1).body.status, 'In Progress');
        state.auth.user.role = 'User';
        reset(state, { id: taskId, discipline: 'Development', status: 'In Progress', version: 11 });
        assert.equal(disciplineSelect().props.disabled, true, 'Only admins may change discipline');
        disciplineSelect().props.onChange({ target: { value: 'Drafting' } });
        assert.equal(disciplineSelect().props.value, 'Development', 'Member event handlers cannot change discipline');
    }
    finally {
        globalThis.fetch = originalFetch;
        globalThis.window = originalWindow;
        assert.ok(scratch.startsWith(root + '\\') || scratch.startsWith(root + '/'));
        rmSync(scratch, { recursive: true, force: true });
    }
});
