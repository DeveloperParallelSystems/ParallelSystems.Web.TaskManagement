import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

test('project dialogs write client arrays, preserve errors and allow clearing every client', async () => {
    const root = resolve('.tmp');
    mkdirSync(root, { recursive: true });
    const scratch = mkdtempSync(join(root, 'project-clients-'));
    const originalFetch = globalThis.fetch;
    const originalWindow = globalThis.window;
    try {
        const hooks = join(scratch, 'hooks.js');
        writeFileSync(hooks, `
let slots = [];
let index = 0;
let state;
export function reset(next) {
    state = next;
    slots = [];
}
export function renderStart() {
    index = 0;
}
export function useState(initial) {
    const slot = index++;
    if (!(slot in slots)) {
        slots[slot] = typeof initial === 'function' ? initial() : initial;
    }
    return [slots[slot], (value) => {
        slots[slot] = typeof value === 'function' ? value(slots[slot]) : value;
    }];
}
export function useRef() {
    return { current: null };
}
export function useCallback(callback) {
    return callback;
}
export function useEffect() {}
export function useSelector(select) {
    return select(state);
}
export function useDispatch() {
    if (state.dispatch) {
        return state.dispatch;
    }
    return (action) => typeof action === 'function' ? action(() => {}, () => state) : action;
}
export { Link, useBlocker } from 'react-router-dom';
export function useParams() {
    return state.routeParams;
}
export function useNavigate() {
    return (location) => {
        state.navigated = location;
    };
}
`);
        const entry = join(scratch, 'entry.jsx');
        writeFileSync(entry, `
export { default as Create } from '../../src/features/projects/ProjectDialog.jsx';
export { default as Edit } from '../../src/features/projects/ProjectClientDialog.jsx';
export { default as Board } from '../../src/features/tasks/BoardPresentationAdministration.jsx';
export { default as Columns } from '../../src/features/tasks/TaskColumnsAdministration.jsx';
export { default as Directory } from '../../src/features/projects/ClientProjectsPage.jsx';
export { default as Move } from '../../src/features/projects/MoveUnassignedTasksDialog.jsx';
export { reset, renderStart } from './hooks.js';
`);
        const targets = ['MoveUnassignedTasksDialog.jsx', 'ProjectDialog.jsx', 'ProjectClientDialog.jsx', 'BoardPresentationAdministration.jsx', 'TaskColumnsAdministration.jsx', 'ClientProjectsPage.jsx'];
        const bundle = await build({ configFile: false, logLevel: 'silent', plugins: [{
            name: 'project-client-hooks', enforce: 'pre', transform(source, id) {
                if (targets.some((name) => id.replaceAll('\\', '/').endsWith(`/${name}`))) {
                    return source.replace(/from '(react|react-redux|react-router-dom)'/g, `from ${JSON.stringify(hooks.replaceAll('\\', '/'))}`);
                }
            },
        }, react()], build: { ssr: entry, write: false } });
        const file = join(scratch, 'dialogs.mjs');
        writeFileSync(file, bundle.output.find((chunk) => chunk.isEntry).code);
        const { Create, Edit, Board, Columns, Directory, Move, reset, renderStart } = await import(pathToFileURL(file).href);
        const clientA = '11111111-1111-1111-1111-111111111111';
        const clientB = '22222222-2222-2222-2222-222222222222';
        const project = { id: '33333333-3333-3333-3333-333333333333', name: 'Shared project', clientIds: [clientA, clientB] };
        const state = { auth: { user: { role: 'Administrator' } }, routeParams: { clientId: clientB }, workspace: { tasks: [], people: [], clients: [{ id: clientA, name: 'Alpha' }, { id: clientB, name: 'Beta' }],
            projects: [project, { id: 'unassigned-project', name: 'Unassigned project', clientIds: [] }] } };
        const calls = [];
        let reject = false;
        globalThis.window = { confirm: () => true };
        globalThis.fetch = async (url, options) => {
            calls.push({ url, method: options.method, body: JSON.parse(options.body) });
            return new Response(JSON.stringify(reject ? { message: 'Client unavailable' } : project), { status: reject ? 400 : 200 });
        };
        function descendants(element) {
            if (Array.isArray(element)) {
                return element.flatMap(descendants);
            }
            if (!React.isValidElement(element)) {
                return [];
            }
            if (element.type.name === 'ProjectClientsPicker') {
                return descendants(element.type(element.props));
            }
            return [element, ...descendants(element.props.children)];
        }
        let Component = Create;
        let saved = 0;
        let props = { initialClientId: clientA, onCreated() { saved += 1; }, onClose() {} };
        function render() {
            renderStart();
            return descendants(Component(props));
        }
        function checkboxes() {
            return render().filter((element) => element.type === 'input' && element.props.type === 'checkbox');
        }
        const submit = () => render().find((element) => element.type === 'form').props.onSubmit({ preventDefault() {} });
        reset(state);
        assert.equal(checkboxes().length, 2);
        assert.equal(checkboxes()[0].props.checked, true);
        checkboxes()[1].props.onChange({ target: { checked: true } });
        render().find((element) => element.type === 'input' && element.props.placeholder === 'Enter a project name').props.onChange({ target: { value: ' Shared project ' } });
        await submit();
        assert.deepEqual(calls[0], { url: '/api/task-management/projects', method: 'POST', body: { name: 'Shared project', clientIds: [clientA, clientB] } });
        assert.equal(saved, 1);
        assert.ok(checkboxes().every((element) => element.props.disabled));

        Component = Edit;
        props = { project, onSaved() { saved += 1; }, onClose() {} };
        reset(state);
        assert.deepEqual(checkboxes().map((element) => element.props.checked), [true, true]);
        checkboxes()[0].props.onChange({ target: { checked: false } });
        reject = true;
        await submit();
        assert.equal(saved, 1);
        assert.deepEqual(checkboxes().map((element) => element.props.checked), [false, true]);
        assert.ok(render().some((element) => element.props.role === 'alert'));
        reject = false;
        await submit();
        assert.deepEqual(calls.at(-1), { url: `/api/task-management/projects/${project.id}/clients`, method: 'PUT', body: { clientIds: [clientB] } });
        reset(state);
        checkboxes()[0].props.onChange({ target: { checked: false } });
        checkboxes()[1].props.onChange({ target: { checked: false } });
        await submit();
        assert.deepEqual(calls.at(-1).body, { clientIds: [] });

        for (const Administration of [Board, Columns]) {
            Component = Administration;
            props = { onEditingChange() {} };
            reset(state);
            render().find((element) => element.type === 'select').props.onChange({ target: { value: 'project' } });
            function selectWithOption(value) {
                return render().find((element) => element.type === 'select' &&
                    descendants(element).some((child) => child.type === 'option' && child.props.value === value));
            }
            let editorKey;
            for (const clientId of [clientA, clientB]) {
                selectWithOption(clientId).props.onChange({ target: { value: clientId } });
                assert.ok(selectWithOption(project.id), 'Shared project must be selectable through either client');
                selectWithOption(project.id).props.onChange({ target: { value: project.id } });
                const editor = render().find((element) => element.props.projectId === project.id);
                assert.ok(editor);
                if (editorKey) {
                    assert.equal(editor.key, editorKey, 'The client must not become part of layout identity');
                }
                editorKey = editor.key;
            }
            selectWithOption('unassigned').props.onChange({ target: { value: 'unassigned' } });
            assert.ok(selectWithOption('unassigned-project'));
            assert.equal(selectWithOption(project.id), undefined);
        }

        Component = Directory;
        props = {};
        reset(state);
        const card = render().find((element) => element.props.project?.id === project.id);
        card.props.onOpen(project.id);
        assert.equal(state.navigated, `/projects/${project.id}/tasks?client=${clientB}`);
        render().find((element) => element.type === 'button' && element.props['aria-label'] === `Manage clients for ${project.name}`).props.onClick();
        assert.equal(render().find((element) => element.type === Edit).props.project.id, project.id);
        render().find((element) => element.type === 'button' && element.props.children?.includes('New project')).props.onClick();
        assert.equal(render().find((element) => element.type === Create).props.initialClientId, clientB);
        state.routeParams.clientId = 'unassigned';
        state.workspace.tasks = [
            { id: 'one', projectId: project.id, clientId: null, version: 2 },
            { id: 'two', projectId: project.id, clientId: null, version: 2 },
        ];
        reset(state);
        render().find(element => element.props['aria-label'] === `Move all unassigned tasks for ${project.name}`).props.onClick();
        assert.equal(render().find(element => element.type === Move).props.project.id, project.id);
        state.auth.user.role = 'User';
        reset(state);
        assert.equal(render().filter((element) => element.type === 'button').length, 0);
        Component = Move;
        state.auth.user.role = 'Administrator';
        let dispatched = 0;
        state.dispatch = () => ({ unwrap: async () => {
            dispatched += 1;
            return [{ id: 'one', success: true }, { id: 'two', code: 'TASK-2', success: false, message: 'Task changed' }];
        } });
        let closed = false;
        props = { project, onClose() { closed = true; } };
        reset(state);
        assert.equal(render().find(element => element.type === 'button' && !element.props.type).props.disabled, true);
        const destination = render().find(element => element.type === 'select');
        assert.equal(descendants(destination).filter(element => element.type === 'option').length, 3);
        destination.props.onChange({ target: { value: clientB } });
        await submit();
        assert.equal(dispatched, 2, 'Move refreshes the workspace after receiving per-task results');
        assert.ok(render().some(element => element.props.role === 'status'));
        assert.ok(render().some(element => element.type === 'p' && element.props.children?.includes('Task changed')));
        assert.equal(render().find(element => element.type === 'select').props.disabled, true, 'Partial results must not offer a stale retry');
        await submit();
        assert.equal(dispatched, 2);
        render().find(element => element.type === 'button' && element.props.children === 'Done').props.onClick();
        assert.equal(closed, true);
    }
    finally {
        globalThis.fetch = originalFetch;
        globalThis.window = originalWindow;
        assert.ok(scratch.startsWith(root + '\\') || scratch.startsWith(root + '/'));
        rmSync(scratch, { recursive: true, force: true });
    }
});
