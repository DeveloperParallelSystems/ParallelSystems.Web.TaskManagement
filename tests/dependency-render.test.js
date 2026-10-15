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

test('dependencies render both directions, safe links, permissions and informational workflow notice', async () => {
    const scratchRoot = resolve('.tmp');
    mkdirSync(scratchRoot, { recursive: true });
    const scratch = mkdtempSync(join(scratchRoot, 'dependency-render-'));
    try {
        const bundle = await build({ configFile: false, plugins: [react()], logLevel: 'silent',
            build: { ssr: 'src/features/tasks/TaskDependencies.jsx', write: false } });
        const modulePath = join(scratch, 'dependencies.mjs');
        writeFileSync(modulePath, bundle.output.find((chunk) => chunk.isEntry).code);
        const { default: TaskDependencies } = await import(pathToFileURL(modulePath).href);
        const task = { id: 'task', version: 1 };
        const linked = { taskId: 'linked', code: 'TASK-2', title: '<script>bad()</script>', status: 'Backlog' };
        const hidden = { taskId: 'secret-id', code: 'SECRET', title: 'Hidden task', status: 'Backlog' };
        function render(canManage) {
            const state = { workspace: {
                tasks: [task, { ...linked, id: 'linked' }],
                dependencies: { task: { version: 1, hasLoaded: true, canManage, status: 'ready', blockedBy: [linked, hidden], blocks: [linked] } },
            } };
            const store = { getState: () => state, subscribe: () => () => {}, dispatch: () => {} };
            return renderToStaticMarkup(React.createElement(Provider, { store },
                React.createElement(StaticRouter, { location: '/tasks/task?view=list' },
                    React.createElement(TaskDependencies, { task, onEditingChange: () => {}, onSaved: () => {}, onFailure: () => {} }))));
        }
        const admin = render(true);
        assert.match(admin, /Blocked by/);
        assert.match(admin, />Blocks</);
        assert.match(admin, /Add dependency/);
        assert.match(admin, /Remove dependency on TASK-2/);
        assert.match(admin, /href="\/tasks\/linked\?view=list"/);
        assert.match(admin, /&lt;script&gt;/);
        assert.doesNotMatch(admin, /<script>|secret-id|Hidden task|SECRET/);
        assert.match(admin, /do not prevent status changes/);
        const member = render(false);
        assert.doesNotMatch(member, /Add dependency|Remove dependency/);
        assert.match(member, /TASK-2/);
    }
    finally {
        assert.ok(scratch.startsWith(scratchRoot + '\\') || scratch.startsWith(scratchRoot + '/'));
        rmSync(scratch, { recursive: true, force: true });
    }
});
