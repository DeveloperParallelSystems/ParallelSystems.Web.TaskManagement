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

test('linked tickets render both directions, safe links, permissions and independent progress notice', async () => {
    const scratchRoot = resolve('.tmp');
    mkdirSync(scratchRoot, { recursive: true });
    const scratch = mkdtempSync(join(scratchRoot, 'linked-ticket-render-'));
    try {
        const bundle = await build({ configFile: false, plugins: [react()], logLevel: 'silent',
            build: { ssr: 'src/features/tasks/TaskLinkedTickets.jsx', write: false } });
        const modulePath = join(scratch, 'linkedTickets.mjs');
        writeFileSync(modulePath, bundle.output.find((chunk) => chunk.isEntry).code);
        const { default: TaskLinkedTickets } = await import(pathToFileURL(modulePath).href);
        const task = { id: 'task', version: 1, projectId: 'current-project' };
        const linked = { taskId: 'linked', code: 'TASK-2', title: '<script>bad()</script>', status: 'Backlog', projectId: 'project', version: 1 };
        const hidden = { taskId: 'secret-id', code: 'SECRET', title: 'Hidden task', status: 'Backlog' };
        function render(canManage, parents = [linked, hidden], children = [linked], projects = [{ id: 'project' }, { id: 'current-project' }]) {
            const state = { workspace: {
                tasks: [task, { ...linked, id: 'linked' }],
                projects,
                linkedTickets: { task: { version: 1, hasLoaded: true, canManage, status: 'ready', parents, children } },
            } };
            const store = { getState: () => state, subscribe: () => () => {}, dispatch: () => {} };
            return renderToStaticMarkup(React.createElement(Provider, { store },
                React.createElement(StaticRouter, { location: '/tasks/task?view=list' },
                    React.createElement(TaskLinkedTickets, { task, onEditingChange: () => {}, onSaved: () => {}, onFailure: () => {} }))));
        }
        const admin = render(true);
        assert.match(admin, /Linked tickets/);
        assert.doesNotMatch(admin, /Blocked by|Dependencies|>Blocks</);
        assert.match(admin, /href="\/projects\/current-project\/tasks\/new\?view=list&amp;client=unassigned&amp;parentTaskId=task"/);
        assert.match(admin, /Parent ticket/);
        assert.match(admin, />Child tickets</);
        assert.match(admin, /Add child ticket/);
        assert.match(admin, /Unlink TASK-2/);
        assert.match(admin, /href="\/projects\/project\/tasks\/linked\?view=list&amp;client=unassigned"/);
        assert.match(admin, /&lt;script&gt;/);
        assert.doesNotMatch(admin, /<script>|secret-id|Hidden task|SECRET/);
        assert.match(admin, /links do not block progress/);
        const member = render(false);
        assert.doesNotMatch(member, /Add child ticket|Unlink/);
        assert.match(member, /TASK-2/);
        assert.match(render(true, [], []), /This is a standalone ticket/);
        assert.match(render(true, [], [linked]), /This is a parent ticket/);
        assert.match(render(true, [linked], []), /This is a child ticket/);
        const hiddenOnly = render(false, [hidden], []);
        assert.match(hiddenOnly, /No visible linked tickets/);
        assert.doesNotMatch(hiddenOnly, /standalone|SECRET|secret-id|Hidden task/);
        const historicalProjects = render(true, [linked, hidden], [linked], []);
        assert.match(historicalProjects, /href="\/tasks\/linked\?view=list&amp;client=unassigned"/);
        assert.match(historicalProjects, /href="\/tasks\/new\?view=list&amp;client=unassigned&amp;parentTaskId=task"/);
        assert.doesNotMatch(historicalProjects, /href="\/projects\/|secret-id|Hidden task|SECRET/);
    }
    finally {
        assert.ok(scratch.startsWith(scratchRoot + '\\') || scratch.startsWith(scratchRoot + '/'));
        rmSync(scratch, { recursive: true, force: true });
    }
});
