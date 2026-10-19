import test from 'node:test';
import { defaultTaskColumns } from '../src/features/tasks/taskColumns.js';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { StaticRouter } from 'react-router-dom/server.js';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

test('client hierarchy keeps unassigned work accessible and project filters cannot escape scope', async () => {
    const root = resolve('.tmp');
    mkdirSync(root, { recursive: true });
    const scratch = mkdtempSync(join(root, 'client-navigation-'));
    try {
        const bundle = await build({ configFile: false, plugins: [react()], logLevel: 'silent',
            build: { ssr: 'src/App.jsx', write: false } });
        const file = join(scratch, 'app.mjs');
        writeFileSync(file, bundle.output.find((chunk) => chunk.isEntry).code);
        const { default: App } = await import(pathToFileURL(file).href);
        const first = '11111111-1111-1111-1111-111111111111';
        const second = '22222222-2222-2222-2222-222222222222';
        const client = '33333333-3333-3333-3333-333333333333';
        const state = { auth: { status: 'authenticated', user: { userId: 'user', role: 'Administrator', name: 'Admin' } },
            workspace: { hasLoaded: true, status: 'ready', people: [], labels: [], details: {}, bulkResults: [], bulkBusy: false,
                clients: [{ id: client, name: '<Acme>' }],
                projects: [{ id: first, name: 'Assigned project', clientId: client, clientName: '<Acme>' },
                    { id: second, name: 'Unassigned project', clientId: null }],
                tasks: [
                    { id: 'a', code: 'TASK-1', title: 'Inside task', projectId: first, status: 'To Do', priority: 'Medium' },
                    { id: 'b', code: 'TASK-2', title: 'Outside task', projectId: second, status: 'To Do', priority: 'Medium' },
                    { id: 'c', code: 'TASK-3', title: 'General task', projectId: null, status: 'To Do', priority: 'Medium' },
                ], notifications: { items: [], unreadCount: 0 }, workflowPresentation: { data: null, error: null } } };
        state.workspace.taskColumns = Object.fromEntries(['default', first, second].flatMap((scope) =>
            Object.entries(defaultTaskColumns).map(([discipline, columns]) => [`${scope}:${discipline}`, { data: { columns } }])));
        state.workspace.tasks.forEach((task) => { task.discipline ||= 'Development'; });
        const store = { getState: () => state, subscribe: () => () => {}, dispatch: () => {} };
        const render = (path) => renderToStaticMarkup(React.createElement(Provider, { store },
            React.createElement(StaticRouter, { location: path }, React.createElement(App))));
        const clients = render('/clients');
        assert.doesNotMatch(clients, /New client|Create client|Delete client/);
        assert.match(clients, /&lt;Acme&gt;/);
        assert.match(clients, /Unassigned projects/);
        assert.match(clients, /href="\/projects\/general\/tasks"/);
        const projects = render(`/clients/${client}/projects`);
        assert.match(projects, /Assigned project/);
        assert.doesNotMatch(projects, /Open Unassigned project tasks/);
        assert.match(render('/clients/unassigned/projects'), /Open Unassigned project tasks/);
        const tasks = render(`/projects/${first}/tasks?view=list&project=${second}`);
        assert.match(tasks, /Inside task/);
        assert.doesNotMatch(tasks, /Outside task|General task|aria-label="Filter project"/);
        const general = render('/projects/general/tasks?view=list');
        assert.match(general, /General task/);
        assert.doesNotMatch(general, /Inside task|Outside task/);
        assert.match(render(`/projects/${second}/tasks?view=list`), /Outside task/);
        state.workspace.workflowPresentation.data = { version: 1, catalogVersion: 1,
            groups: [{ id: 'shared', name: 'Shared default column', color: 'blue', statuses: ['To Do'] }] };
        state.workspace.projectPresentations = {
            [first]: { data: { usesDefault: false, groups: [{ id: 'custom', name: 'Custom project column', color: 'green', statuses: ['To Do'] }] } },
            [second]: { data: { usesDefault: true, version: 1, catalogVersion: 1, groups: state.workspace.workflowPresentation.data.groups } },
        };
        const customBoard = render(`/projects/${first}/tasks?view=board`);
        assert.match(customBoard, /Custom project column/);
        assert.doesNotMatch(customBoard, /Shared default column|Outside task/);
        assert.match(render(`/projects/${second}/tasks?view=board`), /Shared default column/);
        assert.match(render('/projects/general/tasks?view=board'), /Shared default column/);
        assert.doesNotMatch(render('/dashboard'), /Custom project column/);
        const invalid = render('/projects/not-a-guid/tasks?view=list');
        assert.match(invalid, /Project unavailable/);
        assert.doesNotMatch(invalid, /Inside task|Outside task|General task|New task/);
        const router = createMemoryRouter([{ path: '*', element: React.createElement(App) }], {
            initialEntries: [`/projects/${first}/tasks/new`],
        });
        const newTask = renderToStaticMarkup(React.createElement(Provider, { store }, React.createElement(RouterProvider, { router })));
        assert.match(newTask, /<option value="11111111-1111-1111-1111-111111111111" selected="">Assigned project<\/option>/);
        assert.match(newTask, /<select form="task-details-form" disabled="">/);
        router.dispose();
        state.workspace.tasks.push({ id: 'historical', code: 'TASK-4', title: 'Historical parent',
            projectId: '44444444-4444-4444-4444-444444444444', status: 'To Do', priority: 'Medium' });
        const historicalRouter = createMemoryRouter([{ path: '*', element: React.createElement(App) }], {
            initialEntries: ['/tasks/new?parentTaskId=historical'],
        });
        const historicalChild = renderToStaticMarkup(React.createElement(Provider, { store }, React.createElement(RouterProvider, { router: historicalRouter })));
        assert.match(historicalChild, /Create task/);
        assert.match(historicalChild, /<option value="historical" selected="">TASK-4 · Historical parent/);
        assert.match(historicalChild, /<span>Project<\/span><select form="task-details-form"><option value="" selected="">/);
        assert.doesNotMatch(historicalChild, /Project unavailable/);
        historicalRouter.dispose();
        state.auth.user.role = 'User';
        assert.doesNotMatch(render(`/clients/${client}/projects`), /Change client|New client|New project/);
    }
    finally {
        assert.ok(scratch.startsWith(root + '\\') || scratch.startsWith(root + '/'));
        rmSync(scratch, { recursive: true, force: true });
    }
});
