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

test('calendar renders authorized deadline tasks with composed filters, safe text and planning states', async () => {
    const scratchRoot = resolve('.tmp');
    mkdirSync(scratchRoot, { recursive: true });
    const scratch = mkdtempSync(join(scratchRoot, 'calendar-render-'));
    try {
        const bundle = await build({ configFile: false, plugins: [react()], logLevel: 'silent',
            build: { ssr: 'src/features/tasks/TasksPage.jsx', write: false } });
        const modulePath = join(scratch, 'calendar.mjs');
        writeFileSync(modulePath, bundle.output.find((chunk) => chunk.isEntry).code);
        const { default: TasksPage } = await import(pathToFileURL(modulePath).href);
        const owner = '11111111-1111-1111-1111-111111111111';
        const other = '22222222-2222-2222-2222-222222222222';
        const state = {
            auth: { user: { userId: 'user', role: 'User' } },
            workspace: { tasks: [
                { id: 'first', code: 'TASK-1', title: '<script>safe deadline</script>', status: 'To Do', priority: 'Medium',
                    dueDate: '2028-02-29T00:00:00', projectId: 'historic', projectName: 'Historic project', assigneeId: owner, assigneeName: 'Current owner' },
                { id: 'second', code: 'TASK-2', title: 'Other owner task', status: 'In Progress', priority: 'High',
                    dueDate: '2028-02-29', projectId: 'historic', assigneeId: other },
                { id: 'third', code: 'TASK-3', title: 'Other project task', status: 'To Do', priority: 'Low',
                    dueDate: '2028-02-29', projectId: 'another', assigneeId: owner },
                { id: 'undated', code: 'TASK-4', title: 'Plan a deadline', status: 'Backlog', priority: 'Medium',
                    dueDate: null, projectId: 'historic', assigneeId: owner },
            ], people: [{ id: owner, name: 'Current owner', isActive: true }], projects: [], labels: [], details: {}, bulkBusy: false },
        };
        const store = { getState: () => state, subscribe: () => () => {}, dispatch: () => {} };
        function render(query) {
            return renderToStaticMarkup(React.createElement(Provider, { store },
                React.createElement(StaticRouter, { location: `/tasks?${query}` }, React.createElement(TasksPage, { onOpen: () => {} }))));
        }
        const query = `view=calendar&month=2028-02&project=historic&assignee=${owner}`;
        const markup = render(query);
        assert.match(markup, /aria-pressed="true"[^>]*>.*?Calendar/s);
        assert.match(markup, /value="2028-02"/);
        assert.match(markup, /datetime="2028-02-29"/i);
        assert.match(markup, /&lt;script&gt;safe deadline/);
        assert.doesNotMatch(markup, /<script>|Other owner task|Other project task/);
        assert.match(markup, /Plan a deadline/);
        assert.match(markup, /Overdue/);
        assert.match(markup, /Next 30 days/);
        assert.match(markup, /No deadline/);
        assert.match(markup, /Current owner/);
        assert.match(markup, /aria-label="Open TASK-1:[^"]*Project: Historic project, Current owner: Current owner/);
        assert.doesNotMatch(markup, /draggable="true"|Move to…/);
        const empty = render(query + '&q=not-found');
        assert.match(empty, /No matching tasks/);
        assert.match(empty, /value="2028-02"/);
        state.workspace.tasks = [];
        const revoked = render(query);
        assert.doesNotMatch(revoked, /safe deadline|Plan a deadline/);
        assert.match(revoked, /Selected owner unavailable/);
    }
    finally {
        assert.ok(scratch.startsWith(scratchRoot + '\\') || scratch.startsWith(scratchRoot + '/'));
        rmSync(scratch, { recursive: true, force: true });
    }
});
