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
import { defaultPresentationGroups } from '../src/features/tasks/workflowPresentation.js';

test('one shared board displays both disciplines without workflow headings and actions use server permissions', async () => {
    const scratchRoot = resolve('.tmp');
    mkdirSync(scratchRoot, { recursive: true });
    const scratch = mkdtempSync(join(scratchRoot, 'task-workflow-render-'));
    try {
        const entryPath = join(scratch, 'entry.jsx');
        writeFileSync(entryPath, "export { default as TasksPage } from '../../src/features/tasks/TasksPage.jsx';\n" +
            "export { Dashboard } from '../../src/features/tasks/OverviewPages.jsx';\n" +
            "export { default as Actions } from '../../src/features/tasks/TaskWorkflowActions.jsx';\n");
        const bundle = await build({ configFile: false, plugins: [react()], logLevel: 'silent', build: { ssr: entryPath, write: false } });
        const modulePath = join(scratch, 'views.mjs');
        writeFileSync(modulePath, bundle.output.find((chunk) => chunk.isEntry).code);
        const { TasksPage, Dashboard, Actions } = await import(pathToFileURL(modulePath).href);
        const workflow = { id: '11111111-1111-1111-1111-111111111111', discipline: 'Drafting', versionNumber: 2,
            definition: { name: 'Drawing delivery', stages: [
                { id: 'check', name: '<Check drawings>', kind: 'Review', color: 'purple', ownerRole: 'Reviewer' },
                { id: 'issued', name: 'Issued', kind: 'Completed', color: 'green', ownerRole: 'None' },
            ] } };
        const task = { id: 'task', discipline: 'Drafting', version: 1, code: 'TASK-1', title: 'Custom workflow task', priority: 'Medium', status: 'check', workflow };
        const development = { ...workflow, id: 'development', discipline: 'Development', definition: {
            name: 'Development workflow', stages: [
                { id: 'dev-check', name: '<Check drawings>', kind: 'Review', color: 'purple' },
                { id: 'dev-only', name: 'Development only', kind: 'Work', color: 'amber' },
                { id: 'dev-issued', name: 'Issued', kind: 'Completed', color: 'green' },
            ],
        } };
        const devTask = { ...task, id: 'dev-task', code: 'TASK-2', title: 'Development task', discipline: 'Development',
            workflow: development, status: 'dev-check' };
        const state = { auth: { user: { role: 'User', userId: 'user' } }, workspace: {
            tasks: [task, devTask], projects: [], people: [], labels: [], details: {}, bulkBusy: false,
            workflowPresentation: { data: { groups: defaultPresentationGroups } },
            disciplineWorkflows: { data: { items: [{ discipline: 'Drafting', active: workflow },
                { discipline: 'Development', active: development }] } },
        } };
        const store = { getState: () => state, subscribe: () => () => {}, dispatch: () => {} };
        function render(Component, props = {}, path = '/tasks') {
            return renderToStaticMarkup(React.createElement(Provider, { store }, React.createElement(StaticRouter,
                { location: path }, React.createElement(Component, { onOpen: () => {}, ...props }))));
        }
        const board = render(TasksPage);
        assert.match(board, /class="button mobile-filter-toggle"[^>]*aria-expanded="false"[^>]*aria-controls="task-filter-controls"/,
            'Mobile filters must start collapsed with an accessible disclosure.');
        assert.match(board, /id="task-filter-controls"/);
        assert.equal((board.match(/<article class="task-card(?: [^"]*)?"/g) || []).length, 2);
        assert.equal((board.match(/aria-label="Task board"/g) || []).length, 1);
        assert.match(board, /aria-label="Board stages"/);
        assert.equal((board.match(/class="board-column [^"]*" data-mobile-active="true"/g) || []).length, 1);
        assert.doesNotMatch(board, /<h2>Drafting · Drawing delivery v2|<h2>Development · Development workflow/);
        assert.equal((board.match(/class="board-column /g) || []).length, 4);
        assert.equal((board.match(/<h2><i><\/i>Review<\/h2>/g) || []).length, 1);
        assert.match(board, /&lt;Check drawings&gt;/);
        assert.doesNotMatch(board, /<Check drawings>/);
        const dashboard = render(Dashboard);
        assert.doesNotMatch(dashboard, /Drafting · Drawing delivery v2/);
        assert.equal((dashboard.match(/class="progress-row"/g) || []).length, 4);
        const filteredBoard = render(TasksPage, {}, '/tasks?discipline=Drafting');
        assert.doesNotMatch(filteredBoard, /Development only|Development task/);
        assert.equal((filteredBoard.match(/<article class="task-card(?: [^"]*)?"/g) || []).length, 1);
        assert.match(render(TasksPage, {}, '/tasks?view=list'), /&lt;Check drawings&gt;/);
        state.workspace.workflowPresentation = { data: null };
        const unavailable = render(TasksPage);
        assert.match(unavailable, /Board layout is unavailable/);
        assert.doesNotMatch(unavailable, /class="board-column /);
        const details = { task, allowedStatuses: ['check', 'issued'], allowedTransitions: [
            { id: 'approve', name: 'Approve drawings', toStageId: 'issued', requireNote: false, kind: 'Approve' },
            { id: 'bad', name: 'Forbidden action', toStageId: 'missing', kind: 'Progress' },
        ] };
        const props = { details, onEditingChange: () => {}, onSaved: () => {}, onReload: () => {} };
        const actions = render(Actions, props);
        assert.match(actions, /Approve drawings/);
        assert.doesNotMatch(actions, /Forbidden action/);
        assert.match(render(Actions, { ...props, disabled: true }), /fieldset[^>]*disabled/);
        assert.match(render(Actions, { ...props, disabled: true }), /<\/fieldset>.*Cancel action/s,
            'Cancel must remain outside the fieldset disabled by another draft.');
        state.workspace.tasks = [];
        assert.equal(render(Actions, props), '');
    }
    finally {
        assert.ok(scratch.startsWith(scratchRoot + '\\') || scratch.startsWith(scratchRoot + '/'));
        rmSync(scratch, { recursive: true, force: true });
    }
});
