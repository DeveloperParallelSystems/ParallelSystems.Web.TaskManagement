import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { requiredTaskColumns } from '../src/features/tasks/taskColumns.js';

test('task form custom interactions retain project drafts, validate before save, and respect detail permissions', async () => {
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
let detailEffect;
let actualAssignments;
export function reset(next, task = null, preserveInitialAssignments = false) {
    state = next;
    loaded = task;
    slots = [];
    actualAssignments = preserveInitialAssignments;
}
export function renderStart() { index = 0; }
export function snapshot() { return state; }
export function useState(initial) {
    const slot = index++;
    if (!(slot in slots)) {
        slots[slot] = typeof initial === 'function' ? initial() : initial;
        if (slot === 0) {
            const assignments = actualAssignments ? {} : { originalAssigneeId: 'staff', assigneeId: 'staff' };
            slots[slot] = { ...slots[slot], title: 'Task', ...assignments, projectId: 'project', ...loaded };
        }
        if (slot === 1 && loaded) { slots[slot] = { task: slots[0], canEditDetails: state.canEditDetails ?? true, allowedStatuses: [], activity: [] }; }
        if (slot === 2) { slots[slot] = false; }
        if (slot === 15) { slots[slot] = true; }
    }
    return [slots[slot], (value) => { slots[slot] = typeof value === 'function' ? value(slots[slot]) : value; }];
}
export function useEffect(effect, dependencies) {
    if (dependencies?.length === 3 && dependencies[0] === 'existing' && typeof dependencies[1] === 'number') {
        detailEffect = effect;
    }
}
export async function refreshDetails() {
    detailEffect();
    await new Promise((resolve) => setTimeout(resolve, 0));
}
export function loadedDetails() { return slots[1]; }
export function useRef() { return { current: null }; }
export function useSelector(select) { return select(state); }
export function useDispatch() { return (action) => typeof action === 'function' ? action(() => {}, () => state) : action; }
export function useBlocker() { return { state: 'unblocked' }; }
export function useLocation() { return state.location || { search: '' }; }
export function useNavigate() { return (location) => { state.navigation = location; }; }
`);
        const entry = join(scratch, 'entry.jsx');
        writeFileSync(entry, "export { default as TaskPage } from '../../src/features/tasks/TaskPage.jsx';\nexport { reset, renderStart, snapshot, refreshDetails, loadedDetails } from './hooks.js';");
        const bundle = await build({ configFile: false, logLevel: 'silent', plugins: [{
            name: 'form-hooks', enforce: 'pre', transform(source, id) {
                if (id.replaceAll('\\', '/').endsWith('/src/features/tasks/TaskPage.jsx')) {
                    return source.replace(/from '(react|react-redux|react-router-dom)'/g, `from ${JSON.stringify(hooks.replaceAll('\\', '/'))}`);
                }
            },
        }, react()], build: { ssr: entry, write: false } });
        const file = join(scratch, 'form.mjs');
        writeFileSync(file, bundle.output.find((chunk) => chunk.isEntry).code);
        const { TaskPage, reset, renderStart, snapshot, refreshDetails, loadedDetails } = await import(pathToFileURL(file).href);
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
        let idOnly = false;
        let detailReply;
        globalThis.fetch = async (url, options) => {
            if (!options.method || options.method === 'GET') {
                return new Response(JSON.stringify(detailReply));
            }
            calls.push({ url, body: JSON.parse(options.body) });
            if (idOnly) {
                return new Response(JSON.stringify({ id: 'existing' }));
            }
            return new Response(JSON.stringify({ id: 'created', version: (JSON.parse(options.body).version || 0) + 1 }));
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
        assert.equal(render().some(element => element.type === 'span' && element.props.children === 'Original assignee'), false,
            'New tasks respect hidden Original assignee');
        assert.equal(render().some(element => element.type === 'span' && element.props.children === 'Reviewer / QA'), false,
            'New tasks respect hidden QA');
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
        assert.equal(calls[0].body.originalAssigneeId, 'staff', 'Hidden original assignee comes from Assigned To');
        custom().props.onChange(field.id, '2026-02-30');
        await form().props.onSubmit({ preventDefault() {} });
        assert.equal(calls.length, 1, 'Invalid values must not reach the API');
        snapshot().workspace.taskColumnsRevision = 8;
        await form().props.onSubmit({ preventDefault() {} });
        assert.equal(calls.length, 1, 'Stale definitions must not reach the API');
        snapshot().workspace.projects = [];
        taskId = 'existing';
        reset(state, { id: taskId, projectId: 'project', version: 2 });
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
        assert.equal(custom().props.editable, true, 'Participants can edit configured project values');
        custom().props.onChange(field.id, '2026-10-24');
        const memberControl = (label, type) => {
            const fieldLabel = render().find((element) => element.type === 'label' &&
                descendants(element).some((child) => child.type === 'span' && child.props.children === label));
            return descendants(fieldLabel).find((element) => element.type === type);
        };
        assert.equal(render().find((element) => element.type === 'fieldset').props.disabled, false);
        memberControl('Task title', 'input').props.onChange({ target: { value: 'Member title' } });
        memberControl('Description', 'textarea').props.onChange({ target: { value: 'Member description' } });
        memberControl('Priority', 'select').props.onChange({ target: { value: 'High' } });
        memberControl('Due date', 'input').props.onChange({ target: { value: '2026-10-25' } });
        assert.equal(memberControl('Assigned To', 'select').props.disabled, false);
        memberControl('Assigned To', 'select').props.onChange({ target: { value: 'new-owner' } });
        await form().props.onSubmit({ preventDefault() {} });
        assert.deepEqual(calls.at(-1).body.customFieldValues, [{ fieldId: field.id, value: '2026-10-24' }]);
        assert.equal(calls.at(-1).body.title, 'Member title');
        assert.equal(calls.at(-1).body.description, 'Member description');
        assert.equal(calls.at(-1).body.priority, 'High');
        assert.equal(calls.at(-1).body.dueDate, '2026-10-25');
        assert.equal(calls.at(-1).body.assigneeId, 'new-owner');
        const memberProject = render().find((element) => element.type === 'select' && element.props.value === 'project');
        assert.equal(memberProject.props.disabled, true, 'Project moves remain admin-only');
        memberProject.props.onChange({ target: { value: 'other' } });
        assert.equal(render().find((element) => element.type === 'select' && element.props.value === 'project')?.props.disabled, true);
        state.canEditDetails = false;
        reset(state, { id: taskId, projectId: 'project', version: 5 });
        assert.equal(custom().props.editable, false, 'Server permission controls editability');
        custom().props.onChange(field.id, '2026-10-25');
        await form().props.onSubmit({ preventDefault() {} });
        assert.equal(calls.at(-1).body.customFieldValues, undefined, 'Read-only forms omit custom edits');
        delete state.canEditDetails;
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
        state.auth.user.role = 'Administrator';
        state.workspace.clients = [{ id: 'client-a', name: 'Client A' }, { id: 'client-b', name: 'Client B' }];
        state.workspace.projects[0].clientIds = ['client-a', 'client-b'];
        const clientSelect = () => render().find((element) => element.type === 'label' &&
            descendants(element).some((child) => child.type === 'span' && child.props.children === 'Client'));
        reset(state, { id: taskId, projectId: 'project', clientId: 'client-a', status: 'To Do', version: 12 });
        await form().props.onSubmit({ preventDefault() {} });
        assert.equal(Object.hasOwn(calls.at(-1).body, 'clientId'), false, 'An ordinary task save preserves the persisted client by omission');
        assert.equal(clientSelect(), undefined, 'Client is inherited from navigation, never edited in the task form');
        custom().props.onChange(field.id, '2026-10-23');
        await form().props.onSubmit({ preventDefault() {} });
        assert.equal(Object.hasOwn(calls.at(-1).body, 'clientId'), false);
        assert.deepEqual(calls.at(-1).body.customFieldValues, [{ fieldId: field.id, value: '2026-10-23' }], 'Saving retains the same project field definitions and values');
        const savedVersion = calls.at(-1).body.version + 1;
        const description = render().find((element) => element.type === 'textarea');
        description.props.onChange({ target: { value: 'Edit immediately after saving' } });
        await form().props.onSubmit({ preventDefault() {} });
        assert.equal(calls.at(-1).body.version, savedVersion, 'A subsequent edit uses the saved revision');
        reset(state, { id: taskId, projectId: 'project', clientId: 'removed', version: 13 });
        await form().props.onSubmit({ preventDefault() {} });
        assert.equal(Object.hasOwn(calls.at(-1).body, 'clientId'), false, 'Unrelated edits preserve historical detached client associations');
        taskId = 'new';
        state.location = { search: '?client=client-b' };
        reset(state);
        // A scoped create uses the route project before the test fixture fills its title.
        renderStart();
        const scopedCreate = descendants(TaskPage({ id: taskId, projectScope: 'project', onEditingChange() {}, onClose() {}, onSaved() {} }));
        await scopedCreate.find((element) => element.props.id === 'task-details-form').props.onSubmit({ preventDefault() {} });
        assert.equal(calls.at(-1).body.clientId, 'client-b');
        state.workspace.tasks = [{ id: 'parent-b', projectId: 'project', clientId: 'client-b' }];
        state.location = { search: '?client=client-a&parentTaskId=parent-b' };
        reset(state);
        await form().props.onSubmit({ preventDefault() {} });
        assert.equal(calls.at(-1).body.clientId, 'client-b', 'Child creation inherits the actual parent client over a stale query');
        assert.equal(calls.at(-1).body.parentTaskId, 'parent-b');
        taskId = 'existing';
        reset(state, { id: taskId, projectId: 'project', clientId: 'client-a', version: 20 });
        assert.equal(clientSelect(), undefined, 'Client is inherited from navigation, never edited in the task form');
        idOnly = true;
        const savingTask = form().props.onSubmit({ preventDefault() {} });
        assert.equal(clientSelect(), undefined, 'Saving never introduces a Client field');
        await savingTask;
        assert.equal(form(), undefined, 'The real id-only save contract suspends form editing until detail refresh');
        assert.equal(render().find((element) => element.type === 'button' && element.props.type === 'submit').props.disabled, true,
            'Save remains disabled while waiting for the saved revision');
        detailReply = { task: { ...calls.at(-1).body, id: taskId, version: 21 }, canEditDetails: true,
            allowedStatuses: [], activity: [{ description: 'Task updated' }] };
        render();
        await refreshDetails();
        assert.equal(loadedDetails().activity[0].description, 'Task updated', 'Saves refresh History');
        render().find((element) => element.type === 'textarea').props.onChange({ target: { value: 'Second edit after save' } });
        await form().props.onSubmit({ preventDefault() {} });
        assert.equal(calls.at(-1).body.version, 21, 'A second edit after id-only save uses the refreshed revision');
        assert.equal(Object.hasOwn(calls.at(-1).body, 'clientId'), false, 'The client remains unchanged after saving');
        state.auth.user.role = 'User';
        taskId = 'existing';
        reset(state, { id: taskId, projectId: 'project', clientId: 'client-b', version: 14 });
        assert.equal(clientSelect(), undefined, 'Members also inherit client context without a Client field');
        state.auth.user.role = 'Administrator';
        taskId = 'new';
        idOnly = false;
        reset(state, { assigneeId: '', originalAssigneeId: 'stale-original' });
        const beforeMissingOwner = calls.length;
        await form().props.onSubmit({ preventDefault() {} });
        assert.equal(calls.length, beforeMissingOwner, 'Hidden original requires an initial Assigned To selection');
        reset(state, { assigneeId: 'initial-owner', originalAssigneeId: 'stale-original', reviewerId: 'hidden-reviewer' });
        await form().props.onSubmit({ preventDefault() {} });
        assert.equal(calls.at(-1).body.originalAssigneeId, 'initial-owner');
        assert.equal(calls.at(-1).body.reviewerId, null, 'Hidden QA drafts do not assign someone during creation');
        state.workspace.taskColumns['project:Development'].data.columns.push('originalAssignee', 'qa');
        reset(state, { assigneeId: 'current-owner', originalAssigneeId: 'chosen-original', reviewerId: 'chosen-reviewer' });
        assert.equal(render().some(element => element.type === 'span' && element.props.children === 'Original assignee'), true);
        await form().props.onSubmit({ preventDefault() {} });
        assert.equal(calls.at(-1).body.originalAssigneeId, 'chosen-original');
        assert.equal(calls.at(-1).body.reviewerId, 'chosen-reviewer');
        state.workspace.taskColumns['project:Development'].data.columns = [...requiredTaskColumns];
        taskId = 'existing';
        reset(state, { id: taskId, originalAssigneeId: 'historic-original', assigneeId: 'different-owner', reviewerId: 'historic-reviewer', version: 22 });
        await form().props.onSubmit({ preventDefault() {} });
        assert.equal(calls.at(-1).body.originalAssigneeId, 'historic-original', 'Hidden original is never replaced on an existing task');
        assert.equal(calls.at(-1).body.reviewerId, 'historic-reviewer', 'Hiding QA does not clear existing assignments');

        state.auth.user.userId = 'my-account';
        state.workspace.people = [
            { id: 'legacy', userId: 'my-account', name: 'Legacy account', isActive: false },
            { id: 'self-staff', userId: 'MY-ACCOUNT', name: 'My staff record', isActive: true },
            { id: 'other-staff', userId: 'another-account', name: 'Other staff', isActive: true },
        ];
        taskId = 'new';
        function assignedTo() {
            const label = render().find((element) => element.type === 'label' &&
                descendants(element).some((child) => child.type === 'span' && child.props.children === 'Assigned To'));
            return descendants(label).find((element) => element.type === 'select');
        }
        reset(state, null, true);
        assert.equal(assignedTo().props.value, 'self-staff', 'New tasks default to the active staff linked to the signed-in account');
        await form().props.onSubmit({ preventDefault() {} });
        assert.equal(calls.at(-1).body.assigneeId, 'self-staff');
        assert.equal(calls.at(-1).body.originalAssigneeId, 'self-staff', 'Hidden original uses the defaulted current owner');
        reset(state, null, true);
        assignedTo().props.onChange({ target: { value: 'other-staff' } });
        state.workspace.people = [...state.workspace.people];
        assert.equal(assignedTo().props.value, 'other-staff', 'Lookup refresh must preserve a manual assignment');
        await form().props.onSubmit({ preventDefault() {} });
        assert.equal(calls.at(-1).body.assigneeId, 'other-staff');
        state.auth.user.userId = 'unlinked-account';
        reset(state, null, true);
        assert.equal(assignedTo().props.value, '');
        assert.equal(descendants(assignedTo()).find((element) => element.type === 'option' && element.props.value === '').props.children, 'Select staff');
        delete state.auth.user.userId;
        reset(state, null, true);
        assert.equal(assignedTo().props.value, '', 'Missing account identity never matches an unlinked staff record');
        state.auth.user.userId = 'my-account';
        state.workspace.people[1].isActive = false;
        reset(state, null, true);
        assert.equal(assignedTo().props.value, '', 'Inactive or legacy choices are not eligible defaults');
        state.workspace.people[1].isActive = true;
        taskId = 'existing';
        for (const owner of ['other-staff', '']) {
            reset(state, { id: taskId, assigneeId: owner }, true);
            assert.equal(assignedTo().props.value, owner, 'Existing task ownership is never defaulted');
        }
        state.auth.user.role = 'User';
        taskId = 'new';
        reset(state, null, true);
        assert.ok(form(), 'A signed-in non-admin can open the actual task creation form');
        assert.equal(assignedTo().props.value, 'self-staff');
        assert.equal(assignedTo().props.disabled, false);
        assert.equal(render().find((element) => element.type === 'fieldset').props.disabled, false);
        const disciplineLabel = render().find((element) => element.type === 'label' &&
            descendants(element).some((child) => child.type === 'span' && child.props.children === 'Discipline'));
        assert.equal(descendants(disciplineLabel).find((element) => element.type === 'select').props.disabled, false);
        assert.equal(projectSelect().props.disabled, false);
        await form().props.onSubmit({ preventDefault() {} });
        assert.equal(calls.at(-1).body.assigneeId, 'self-staff');
        assert.equal(calls.at(-1).body.originalAssigneeId, 'self-staff');
        assert.equal(calls.at(-1).url, '/api/task-management/tasks/live');
        taskId = 'existing';
        state.canEditDetails = false;
        reset(state, { id: taskId, assigneeId: 'other-staff' }, true);
        assert.equal(assignedTo().props.disabled, true, 'Unrelated viewers retain read-only task details');
        assert.equal(render().find((element) => element.type?.name === 'TaskDiscussion').props.readOnly, true);
        assert.equal(render().find((element) => element.type?.name === 'TaskAttachments').props.readOnly, true);
    }
    finally {
        globalThis.fetch = originalFetch;
        globalThis.window = originalWindow;
        assert.ok(scratch.startsWith(root + '\\') || scratch.startsWith(root + '/'));
        rmSync(scratch, { recursive: true, force: true });
    }
});
