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
        const otherClient = '55555555-5555-5555-5555-555555555555';
        const state = { auth: { status: 'authenticated', user: { userId: 'user', role: 'Administrator', name: 'Admin' } },
            workspace: { hasLoaded: true, status: 'ready', people: [], labels: [], details: {}, discussions: {}, attachments: {}, checklists: {}, taskLabels: {}, bulkResults: [], bulkBusy: false,
                clients: [{ id: client, name: '<Acme>' }, { id: otherClient, name: 'Other client' }],
                projects: [{ id: first, name: 'Assigned project', clientIds: [client, otherClient], clientId: client, clientName: '<Acme>' },
                    { id: second, name: 'Unassigned project', clientIds: [], clientId: client }],
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
        assert.doesNotMatch(clients, /href="\/following/);
        assert.doesNotMatch(clients, /Only followed tasks/);
        state.workspace.tasks[0].isFollowed = true;
        const following = render('/clients?following=1');
        assert.match(following, /Unassigned projects|General tasks/);
        assert.doesNotMatch(following, /Only followed tasks|Clear filter|following=1/);
        const unassignedProjects = render('/clients/unassigned/projects?following=1');
        assert.match(unassignedProjects, /Open Unassigned project tasks/);
        assert.doesNotMatch(unassignedProjects, /Only followed tasks|Clear filter|following=1/);
        const globalTasks = render('/tasks?view=list&following=1');
        assert.match(globalTasks, /Inside task/);
        assert.match(globalTasks, /Outside task/);
        assert.doesNotMatch(globalTasks, /Only followed tasks/);
        const projects = render(`/clients/${client}/projects`);
        assert.match(projects, /Assigned project/);
        assert.doesNotMatch(projects, /Open Unassigned project tasks/);
        assert.match(render(`/clients/${otherClient}/projects`), /Open Assigned project tasks/);
        assert.match(render('/clients/unassigned/projects'), /Open Assigned project tasks/);
        const breadcrumb = render(`/projects/${first}/tasks?view=list&client=${otherClient}`).match(/class="breadcrumb"[\s\S]*?<\/header>/)[0];
        assert.match(breadcrumb, new RegExp(`href="/clients/${otherClient}/projects"`));
        const invalidContext = render(`/projects/${first}/tasks?view=list&client=invalid`).match(/class="breadcrumb"[\s\S]*?<\/header>/)[0];
        assert.doesNotMatch(invalidContext, new RegExp(`href="/clients/${client}/projects"`));
        const invalidClient = render(`/projects/${first}/tasks?view=list&client=invalid`);
        assert.match(invalidClient, /Client unavailable for this project/);
        assert.doesNotMatch(invalidClient, /Inside task|New task/);
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
        const otherClientBoard = render(`/projects/${first}/tasks?view=board&client=${otherClient}`);
        assert.match(otherClientBoard, /Custom project column/);
        assert.doesNotMatch(otherClientBoard, /Shared default column|Outside task/);
        assert.match(otherClientBoard, new RegExp(`view=calendar&amp;client=${otherClient}`));
        state.workspace.tasks.push({ id: 'not-followed', code: 'TASK-5', title: 'Unfollowed sibling',
            projectId: first, discipline: 'Development', status: 'To Do', priority: 'Medium' });
        const followedBoard = render(`/projects/${first}/tasks?following=1&view=board`);
        assert.match(followedBoard, /Custom project column/);
        assert.match(followedBoard, /Inside task/);
        assert.doesNotMatch(followedBoard, /Shared default column|Unfollowed sibling|Outside task/);
        assert.match(followedBoard, /Only followed tasks/);
        assert.doesNotMatch(followedBoard, /href="\/clients[^"]*following=1/);
        assert.match(render(`/projects/${first}/tasks?following=1&view=list`), /Inside task/);
        assert.doesNotMatch(render(`/projects/${first}/tasks?following=1&view=list`), /Unfollowed sibling/);
        assert.match(render(`/projects/${first}/tasks?view=list`), /Unfollowed sibling/);
        state.workspace.tasks[0].isFollowed = false;
        assert.doesNotMatch(render('/clients?following=1'), /No followed tasks yet/);
        assert.match(render('/clients?following=1'), /class="project-card client-card"/);
        assert.match(render(`/projects/${first}/tasks?following=1`), /No followed tasks yet/);
        state.workspace.tasks[0].isFollowed = true;
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
            projectId: '44444444-4444-4444-4444-444444444444', status: 'To Do', priority: 'Medium', isFollowed: true });
        const historicalFollow = render('/clients?following=1');
        assert.doesNotMatch(historicalFollow, /Historical parent|Other followed tasks/);

        const historicalRouter = createMemoryRouter([{ path: '*', element: React.createElement(App) }], {
            initialEntries: ['/tasks/new?parentTaskId=historical'],
        });
        const historicalChild = renderToStaticMarkup(React.createElement(Provider, { store }, React.createElement(RouterProvider, { router: historicalRouter })));
        assert.match(historicalChild, /Create task/);
        assert.match(historicalChild, /<option value="historical" selected="">TASK-4 · Historical parent/);
        assert.match(historicalChild, /<span>Project<\/span><select form="task-details-form"><option value="" selected="">/);
        assert.doesNotMatch(historicalChild, /Project unavailable/);
        historicalRouter.dispose();
        const scopedTaskId = '66666666-6666-6666-6666-666666666666';
        state.workspace.tasks = [
            { id: scopedTaskId, code: 'TASK-A', title: 'Client A isolated', clientId: client },
            { id: 'client-b', code: 'TASK-B', title: 'Client B isolated', clientId: otherClient },
            { id: 'no-client', code: 'TASK-N', title: 'Unassigned isolated', clientId: null },
            { id: 'removed-client', code: 'TASK-R', title: 'Removed client isolated', clientId: 'removed' },
        ].map((task) => ({ ...task, projectId: first, discipline: 'Development', status: 'To Do', priority: 'Medium', isFollowed: true }));
        for (const [scope, included, excluded] of [
            [client, /Client A isolated/, /Client B isolated|Unassigned isolated|Removed client isolated/],
            [otherClient, /Client B isolated/, /Client A isolated|Unassigned isolated|Removed client isolated/],
            ['unassigned', /Unassigned isolated[\s\S]*Removed client isolated/, /Client A isolated|Client B isolated/],
        ]) {
            for (const view of ['list', 'board', 'calendar']) {
                const isolated = render(`/projects/${first}/tasks?client=${scope}&view=${view}&following=1`);
                if (view !== 'calendar') {
                    assert.match(isolated, included);
                }
                assert.doesNotMatch(isolated, excluded);
                assert.match(isolated, new RegExp(`view=calendar&amp;client=${scope}`));
            }
        }
        assert.match(render(`/clients/${client}/projects`), /1 task · 0 completed/);
        assert.match(render(`/clients/${otherClient}/projects`), /1 task · 0 completed/);
        assert.match(render('/clients/unassigned/projects'), /2 tasks · 0 completed/);
        assert.doesNotMatch(render('/projects'), /Open Assigned project tasks|4 tasks · 0 completed/,
            'The legacy projects route redirects to clients instead of showing aggregate counts that open unassigned scope');
        assert.match(render(`/projects/${first}/tasks?view=list`), /Unassigned isolated/);
        assert.doesNotMatch(render(`/projects/${first}/tasks?view=list`), /Client A isolated|Client B isolated/);
        const directRouter = createMemoryRouter([{ path: '*', element: React.createElement(App) }], {
            initialEntries: [`/tasks/${scopedTaskId}?client=${otherClient}&following=1`],
        });
        const direct = renderToStaticMarkup(React.createElement(Provider, { store }, React.createElement(RouterProvider, { router: directRouter })));
        const directBreadcrumb = direct.match(/class="breadcrumb"[\s\S]*?<\/header>/)[0];
        assert.match(directBreadcrumb, new RegExp(`href="/clients/${client}/projects"`));
        assert.match(directBreadcrumb, new RegExp(`/projects/${first}/tasks\\?client=${client}&amp;following=1`));
        assert.doesNotMatch(directBreadcrumb, new RegExp(`/clients/${otherClient}/projects`));
        directRouter.dispose();
        state.workspace.projects[0].clientIds = [otherClient];
        assert.match(render('/clients/unassigned/projects'), /3 tasks · 0 completed/);
        assert.match(render(`/projects/${first}/tasks?view=list`), /Client A isolated/);
        assert.doesNotMatch(render(`/projects/${first}/tasks?client=${client}&view=list`), /Client A isolated/);
        state.auth.user.role = 'User';
        assert.doesNotMatch(render(`/clients/${client}/projects`), /Change client|New client|New project/);
    }
    finally {
        assert.ok(scratch.startsWith(root + '\\') || scratch.startsWith(root + '/'));
        rmSync(scratch, { recursive: true, force: true });
    }
});
