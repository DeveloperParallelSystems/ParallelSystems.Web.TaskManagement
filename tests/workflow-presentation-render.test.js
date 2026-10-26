import test from 'node:test';
import { defaultTaskColumns } from '../src/features/tasks/taskColumns.js';
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
import { defaultPresentationGroups } from '../src/features/tasks/workflowPresentation.js';

test('board uses configured columns while the client dashboard remains independent of board layout', async () => {
    const scratchRoot = resolve('.tmp');
    mkdirSync(scratchRoot, { recursive: true });
    const scratch = mkdtempSync(join(scratchRoot, 'workflow-render-'));
    try {
        async function component(entry, name) {
            const bundle = await build({ configFile: false, plugins: [react()], logLevel: 'silent',
                build: { ssr: entry, write: false } });
            const modulePath = join(scratch, `${name}.mjs`);
            writeFileSync(modulePath, bundle.output.find((chunk) => chunk.isEntry).code);
            return import(pathToFileURL(modulePath).href);
        }
        const { default: TasksPage } = await component('src/features/tasks/TasksPage.jsx', 'tasks');
        const { Dashboard } = await component('src/features/tasks/OverviewPages.jsx', 'dashboard');
        const groups = structuredClone(defaultPresentationGroups);
        groups[0].name = '<script>Custom planning</script>';
        groups[1].statuses.push(...groups[0].statuses);
        groups[0].statuses = [];
        const state = {
            auth: { user: { userId: 'user', role: 'User' } },
            workspace: { workflowPresentation: { data: { groups, version: 2, canManage: false } },
                tasks: [{ id: 'task', code: 'TASK-1', title: 'Visible task', priority: 'Medium', status: 'Backlog' }],
                people: [], projects: [], labels: [], details: {}, bulkBusy: false },
        };
        state.workspace.taskColumns = Object.fromEntries(['default'].flatMap((scope) =>
            Object.entries(defaultTaskColumns).map(([discipline, columns]) => [`${scope}:${discipline}`, { data: { columns } }])));
        state.workspace.tasks.forEach((task) => { task.discipline ||= 'Development'; });
        const store = { getState: () => state, subscribe: () => () => {}, dispatch: () => {} };
        function render(Component) {
            return renderToStaticMarkup(React.createElement(Provider, { store },
                React.createElement(StaticRouter, { location: '/tasks' }, React.createElement(Component, { onOpen: () => {} }))));
        }
        const board = render(TasksPage);
        assert.match(board, /&lt;script&gt;Custom planning/);
        assert.doesNotMatch(board, /<script>/);
        assert.equal((board.match(/<article class="task-card(?: [^"]*)?"/g) || []).length, 1);
        assert.ok(board.indexOf('Visible task') > board.indexOf('>Working<'));
        assert.match(board, />Backlog</);
        const dashboard = render(Dashboard);
        assert.match(dashboard, /Client overview/);
        assert.match(dashboard, /aria-label="General tasks task metrics"/);
        assert.doesNotMatch(dashboard, /Custom planning|aria-label="Working"/);
        state.workspace.workflowPresentation = { data: null, status: 'error', error: { status: 500 } };
        const unavailable = render(TasksPage);
        assert.match(unavailable, /Board layout is unavailable/);
        assert.doesNotMatch(unavailable, /class="board-column/);
        assert.doesNotMatch(render(Dashboard), /Board layout is unavailable/);
        assert.match(render(Dashboard), /aria-label="General tasks task metrics"/);
        const { default: Editor } = await component('src/features/tasks/WorkflowPresentationEditor.jsx', 'editor');
        const editor = renderToStaticMarkup(React.createElement(Editor, { groups, onChange: () => {}, disabled: true }));
        assert.match(editor, /fieldset[^>]*disabled/);
        assert.match(editor, /Column name/);
        assert.match(editor, /Move Backlog to column/);
        assert.match(editor, /Add column/);
        assert.doesNotMatch(editor, /<script>/);
        assert.match(editor, /aria-label="Blue theme" aria-pressed="true"/);
        const { default: Preview } = await component('src/features/tasks/WorkflowPresentationPreview.jsx', 'preview');
        const preview = renderToStaticMarkup(React.createElement(Preview, { groups, tasks: [
            ...state.workspace.tasks,
            { id: 'configured', status: 'Backlog', workflow: { versionId: 'drafting-v1' } },
        ] }));
        assert.match(preview, /aria-label="Working: 1 task"/);
        assert.match(preview, /aria-label="Backlog: 1 task"/);
        assert.doesNotMatch(preview, /<script>/);
        assert.match(preview, /&lt;script&gt;Custom planning/);
    }
    finally {
        assert.ok(scratch.startsWith(scratchRoot + '\\') || scratch.startsWith(scratchRoot + '/'));
        rmSync(scratch, { recursive: true, force: true });
    }
});
