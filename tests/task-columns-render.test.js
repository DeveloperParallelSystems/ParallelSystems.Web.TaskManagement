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
import { defaultTaskColumns } from '../src/features/tasks/taskColumns.js';

test('task list/cards and administration obey ordered profiles, fixed fields, inherited read-only state and scope failures', async () => {
    const root = resolve('.tmp');
    mkdirSync(root, { recursive: true });
    const scratch = mkdtempSync(join(root, 'task-columns-'));
    try {
        const entry = join(scratch, 'entry.jsx');
        writeFileSync(entry, "export { default as TasksPage, TaskCard } from '../../src/features/tasks/TasksPage.jsx';\nexport { TaskColumnsEditor } from '../../src/features/tasks/TaskColumnsAdministration.jsx';");
        const bundle = await build({ configFile: false, logLevel: 'silent', plugins: [{
            name: 'inert-blocker', enforce: 'pre', transform(source, id) {
                if (id.replaceAll('\\', '/').endsWith('/TaskColumnsAdministration.jsx')) {
                    return source.replace("import { useBlocker } from 'react-router-dom';", "function useBlocker() { return { state: 'unblocked' }; }");
                }
            },
        }, react()], build: { ssr: entry, write: false } });
        const file = join(scratch, 'views.mjs');
        writeFileSync(file, bundle.output.find((chunk) => chunk.isEntry).code);
        const { TaskCard, TasksPage, TaskColumnsEditor } = await import(pathToFileURL(file).href);
        const task = { id: 'a', code: 'TASK-1', title: '<Drawing>', discipline: 'Drafting', priority: 'High', status: 'To Do',
            assigneeId: 'owner', originalAssigneeId: 'original', reviewerId: 'qa', labels: [{ id: 'label', name: 'Keep label', color: 'blue' }] };
        const people = [{ id: 'owner', name: 'Current person' }, { id: 'original', name: 'Original person' }, { id: 'qa', name: 'Secret reviewer' }];
        const cardStore = { getState: () => ({ workspace: { labels: [] } }), subscribe: () => () => {}, dispatch() {} };
        const renderCard = (props) => renderToStaticMarkup(React.createElement(Provider, { store: cardStore }, React.createElement(TaskCard, props)));
        const card = renderCard({ task, people, onOpen() {} });
        assert.match(card, /Assigned To:.*Current person/);
        assert.doesNotMatch(card, /Original assignee:|Original person/);
        assert.doesNotMatch(card, /Secret reviewer|Reviewer \/ QA/);
        const minimal = renderCard( { task: { ...task, assigneeId: null }, people,
            columns: ['assignedTo', 'task', 'discipline', 'status', 'priority', 'dueDate'], onOpen() {} });
        assert.match(minimal, /Assigned To:.*Unassigned/);
        assert.doesNotMatch(minimal, /Keep label/);
        assert.doesNotMatch(minimal, /Original person|Secret reviewer/);
        assert.match(minimal, /High/);
        assert.match(minimal, /Drafting/);
        assert.match(minimal, /To Do/);
        assert.ok(minimal.indexOf('<h3>&lt;Drawing&gt;') < minimal.indexOf('Assigned To'));
        const profiles = Object.fromEntries(Object.entries(defaultTaskColumns).map(([discipline, columns]) => [`default:${discipline}`,
            { data: { version: 1, projectId: null, discipline, columns, canManage: true, usesDefault: true } }]));
        const state = { auth: { user: { role: 'Administrator' } }, workspace: { tasks: [task, { ...task, id: 'b', discipline: 'Development' }],
            people, projects: [], details: {}, bulkResults: [], taskColumns: profiles } };
        const store = { getState: () => state, subscribe: () => () => {}, dispatch() {} };
        const render = (Component, props = {}, location = '/tasks?view=list') => renderToStaticMarkup(React.createElement(Provider, { store },
            React.createElement(StaticRouter, { location }, React.createElement(Component, { onOpen() {}, onEditingChange() {}, ...props }))));
        const list = render(TasksPage);
        assert.match(list, /<th>Original assignee<\/th><th>Assigned To<\/th><th>QA<\/th>/);
        const rows = list.match(/<tbody>([\s\S]*?)<\/tbody>/)[1].split('</tr>');
        assert.doesNotMatch(rows[0], /Secret reviewer/);
        assert.match(rows[1], /Secret reviewer/);
        assert.match(rows[0], /<td>—<\/td>/);
        const editor = render(TaskColumnsEditor, { discipline: 'Drafting' });
        for (const label of ['Task', 'Discipline', 'Status', 'Priority', 'Assigned To', 'Due']) {
            assert.match(editor, new RegExp(`aria-label="Show ${label}"[^>]*disabled=""[^>]*checked=""`));
        }
        assert.match(editor, /aria-label="Show Original assignee" checked=""/);
        assert.match(editor, /aria-label="Show QA"\/>/);
        assert.match(editor, /List preview/);
        assert.match(editor, /Card preview/);
        assert.doesNotMatch(editor, /Add field|Project custom fields/);
        profiles['project:Drafting'] = { data: { ...profiles['default:Drafting'].data, projectId: 'project' } };
        assert.match(render(TaskColumnsEditor, { discipline: 'Drafting', projectId: 'project' }), /Customize this project/);
        const unavailable = render(TasksPage, { projectScope: 'missing' });
        assert.match(unavailable, /Task columns are unavailable or still loading/);
        assert.doesNotMatch(unavailable, /<tbody>/);
    }
    finally {
        assert.ok(scratch.startsWith(root + '\\') || scratch.startsWith(root + '/'));
        rmSync(scratch, { recursive: true, force: true });
    }
});
