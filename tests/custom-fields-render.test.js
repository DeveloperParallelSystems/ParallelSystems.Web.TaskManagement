import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { StaticRouter } from 'react-router-dom/server.js';
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { requiredTaskColumns } from '../src/features/tasks/taskColumns.js';

test('custom fields render in task controls and project lists, while cards show only required fields', async () => {
    const root = resolve('.tmp');
    mkdirSync(root, { recursive: true });
    const scratch = mkdtempSync(join(root, 'custom-render-'));
    try {
        const entry = join(scratch, 'entry.jsx');
        writeFileSync(entry, "export { default as TaskCustomFields } from '../../src/features/tasks/TaskCustomFields.jsx';\nexport { default as Administration } from '../../src/features/tasks/ProjectCustomFieldsAdministration.jsx';\nexport { default as TasksPage, TaskCard } from '../../src/features/tasks/TasksPage.jsx';");
        const bundle = await build({ configFile: false, plugins: [react()], logLevel: 'silent', build: { ssr: entry, write: false } });
        const file = join(scratch, 'views.mjs');
        writeFileSync(file, bundle.output.find((chunk) => chunk.isEntry).code);
        const { TaskCustomFields, TaskCard, TasksPage, Administration } = await import(pathToFileURL(file).href);
        const fields = ['Text', 'Number', 'Date', 'Checkbox', 'Person'].map((type, index) => ({
            id: `00000000-0000-0000-0000-00000000000${index}`, name: `${type} <custom>`, type, isArchived: false,
        }));
        const people = [{ id: fields[0].id, name: 'Custom Developer', isActive: true }];
        const values = Object.fromEntries(fields.map((field, index) => [field.id, ['<script>value</script>', '123.500', '2026-10-19', 'false', fields[0].id][index]]));
        const state = { workspace: { labels: [], taskColumnsRevision: 1, customFields: {
            project: { data: { version: 1, projectId: 'project', canManage: true, fields } },
        } } };
        const store = { getState: () => state, subscribe: () => () => {}, dispatch() {} };
        const render = (Component, props) => renderToStaticMarkup(React.createElement(Provider, { store }, React.createElement(Component, props)));
        const inputs = render(TaskCustomFields, { fields, values, people, editable: true, onChange() {} });
        assert.match(inputs, /textarea[^>]*maxlength="2000"/i);
        assert.match(inputs, /inputMode="decimal"/i);
        assert.match(inputs, /type="date"/);
        assert.match(inputs, />Not set</);
        assert.match(inputs, /Custom Developer/);
        assert.match(inputs, /&lt;script&gt;value&lt;\/script&gt;/);
        const readOnly = render(TaskCustomFields, { fields, values, people, editable: false });
        assert.doesNotMatch(readOnly, /<input|<textarea|<select/);
        assert.match(readOnly, /Custom Developer/);
        const task = { code: 'TASK-1', title: 'Custom task', discipline: 'Development', status: 'To Do', priority: 'Medium', projectId: 'project',
            customFieldValues: fields.map((field) => ({ fieldId: field.id, value: values[field.id] })) };
        const card = render(TaskCard, { task, people, customFields: fields, columns: [...requiredTaskColumns, ...fields.map((field) => `custom:${field.id}`)], onOpen() {} });
        assert.match(card, /Assigned To:.*Unassigned/);
        assert.doesNotMatch(card, /&lt;custom&gt;|Custom Developer|123.500|2026-10-19/);
        assert.doesNotMatch(card, /<script>/);
        state.auth = { user: { role: 'User' } };
        Object.assign(state.workspace, { tasks: [{ ...task, id: 'task' }], projects: [{ id: 'project' }], people, details: {}, taskColumns: {} });
        for (const discipline of ['Development', 'Drafting']) {
            state.workspace.taskColumns[`default:${discipline}`] = { data: { columns: requiredTaskColumns, customFields: [] } };
            state.workspace.taskColumns[`project:${discipline}`] = { data: { columns: [...requiredTaskColumns, `custom:${fields[0].id}`], customFields: [fields[0]] } };
        }
        const list = (scope) => renderToStaticMarkup(React.createElement(Provider, { store }, React.createElement(StaticRouter,
            { location: '/tasks?view=list' }, React.createElement(TasksPage, { projectScope: scope, onOpen() {} }))));
        assert.match(list('project'), /<th>Text &lt;custom&gt;<\/th>/);
        assert.match(list('project'), /&lt;script&gt;value&lt;\/script&gt;/);
        assert.doesNotMatch(list(null), /Text &lt;custom&gt;|&lt;script&gt;value/);
        for (const discipline of ['Development', 'Drafting']) {
            state.workspace.taskColumns[`project:${discipline}`].data.customFields = [{ ...fields[0], name: 'Renamed field' }];
        }
        assert.match(list('project'), /<th>Renamed field<\/th>/);
        assert.doesNotMatch(list('project'), /Text &lt;custom&gt;/);
        state.workspace.taskColumns['project:Development'].invalidated = true;
        assert.doesNotMatch(list('project'), /<tbody>|Renamed field|&lt;script&gt;value/);
        for (const discipline of ['Development', 'Drafting']) {
            state.workspace.taskColumns[`project:${discipline}`] = { data: { columns: requiredTaskColumns, customFields: [] } };
        }
        assert.doesNotMatch(list('project'), /Renamed field|&lt;script&gt;value/);
        const admin = render(Administration, { projectId: 'project', onEditingChange() {} });
        assert.match(admin, /Add field/);
        assert.match(admin, /Edit Person &lt;custom&gt;/);
        assert.match(admin, /Archive Person &lt;custom&gt;/);
    }
    finally {
        assert.ok(scratch.startsWith(root + '\\') || scratch.startsWith(root + '/'));
        rmSync(scratch, { recursive: true, force: true });
    }
});
