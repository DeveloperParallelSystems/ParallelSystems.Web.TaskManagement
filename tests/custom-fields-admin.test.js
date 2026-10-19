import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

test('project field administration handlers create, rename, archive and restore with immutable types', async () => {
    const root = resolve('.tmp');
    mkdirSync(root, { recursive: true });
    const scratch = mkdtempSync(join(root, 'custom-admin-'));
    const originalFetch = globalThis.fetch;
    const originalWindow = globalThis.window;
    try {
        const hooks = join(scratch, 'hooks.js');
        writeFileSync(hooks, `
let slots = [];
let index = 0;
let state;
export function reset(next) { state = next; slots = []; }
export function renderStart() { index = 0; }
export function useState(initial) {
    const slot = index++;
    if (!(slot in slots)) { slots[slot] = initial; }
    return [slots[slot], (value) => { slots[slot] = typeof value === 'function' ? value(slots[slot]) : value; }];
}
export function useEffect() {}
export function useSelector(select) { return select(state); }
export function useDispatch() { return (action) => typeof action === 'function' ? action(() => {}, () => state) : action; }
`);
        const entry = join(scratch, 'entry.jsx');
        writeFileSync(entry, "export { default as Administration } from '../../src/features/tasks/ProjectCustomFieldsAdministration.jsx';\nexport { reset, renderStart } from './hooks.js';");
        const bundle = await build({ configFile: false, logLevel: 'silent', plugins: [{
            name: 'admin-hooks', enforce: 'pre', transform(source, id) {
                if (id.replaceAll('\\', '/').endsWith('/src/features/tasks/ProjectCustomFieldsAdministration.jsx')) {
                    return source.replace(/from '(react|react-redux)'/g, `from ${JSON.stringify(hooks.replaceAll('\\', '/'))}`);
                }
            },
        }, react()], build: { ssr: entry, write: false } });
        const file = join(scratch, 'admin.mjs');
        writeFileSync(file, bundle.output.find((chunk) => chunk.isEntry).code);
        const { Administration, reset, renderStart } = await import(pathToFileURL(file).href);
        const projectId = '11111111-1111-1111-1111-111111111111';
        const field = { id: '22222222-2222-2222-2222-222222222222', name: 'Assigned Developer', type: 'Person', isArchived: false };
        const resource = { data: { projectId, version: 1, canManage: true, fields: [] } };
        const state = { workspace: { taskColumnsRevision: 1, customFields: { [projectId]: resource } } };
        reset(state);
        globalThis.window = { confirm: () => true };
        const calls = [];
        globalThis.fetch = async (url, options) => {
            if (!url.includes('/custom-fields')) {
                return new Response(JSON.stringify([]));
            }
            calls.push({ url, method: options.method, body: JSON.parse(options.body) });
            resource.data = { ...resource.data, version: resource.data.version + 1, fields: [field] };
            state.workspace.taskColumnsRevision = resource.data.version;
            return new Response(JSON.stringify(resource.data));
        };
        function descendants(element) {
            if (Array.isArray(element)) {
                return element.flatMap(descendants);
            }
            return React.isValidElement(element) ? [element, ...descendants(element.props.children)] : [];
        }
        function render() {
            renderStart();
            return descendants(Administration({ projectId, onEditingChange() {} }));
        }
        render().find((element) => element.type === 'button' && element.props.children === 'Add field').props.onClick();
        render().find((element) => element.type === 'input').props.onChange({ target: { value: 'Assigned Developer' } });
        render().find((element) => element.type === 'select').props.onChange({ target: { value: 'Person' } });
        await render().find((element) => element.type === 'form').props.onSubmit({ preventDefault() {} });
        assert.equal(calls.length, 1);
        assert.deepEqual(calls[0].body, { version: 1, name: 'Assigned Developer', type: 'Person' });
        render().find((element) => element.props['aria-label'] === 'Edit Assigned Developer').props.onClick();
        assert.equal(render().find((element) => element.type === 'select').props.disabled, true);
        render().find((element) => element.type === 'input').props.onChange({ target: { value: 'Developer' } });
        await render().find((element) => element.type === 'form').props.onSubmit({ preventDefault() {} });
        assert.equal(calls[1].method, 'PUT');
        assert.equal(calls[1].url, `/api/task-management/projects/${projectId}/custom-fields/${field.id}`);
        assert.equal(calls[1].body.name, 'Developer');
        await render().find((element) => element.props['aria-label'] === 'Archive Assigned Developer').props.onClick();
        assert.match(calls[2].url, /\/archive$/);
        field.isArchived = true;
        await render().find((element) => element.props['aria-label'] === 'Restore Assigned Developer').props.onClick();
        assert.match(calls[3].url, /\/restore$/);
    }
    finally {
        globalThis.fetch = originalFetch;
        globalThis.window = originalWindow;
        assert.ok(scratch.startsWith(root + '\\') || scratch.startsWith(root + '/'));
        rmSync(scratch, { recursive: true, force: true });
    }
});
