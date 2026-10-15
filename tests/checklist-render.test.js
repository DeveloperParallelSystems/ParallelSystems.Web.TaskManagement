import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

test('checklist markup has safe titles, permission controls and accessible zero/card progress', async () => {
    // Offline component rendering only: no browser, HTTP host, or application data.
    const scratchRoot = resolve('.tmp');
    mkdirSync(scratchRoot, { recursive: true });
    const scratch = mkdtempSync(join(scratchRoot, 'checklist-render-'));
    try {
        const bundle = await build({
            configFile: false,
            plugins: [react()],
            logLevel: 'silent',
            build: { ssr: 'src/features/tasks/TaskChecklist.jsx', write: false },
        });
        const modulePath = join(scratch, 'checklist.mjs');
        writeFileSync(modulePath, bundle.output.find((chunk) => chunk.isEntry).code);
        const { default: TaskChecklist, ChecklistProgress } = await import(pathToFileURL(modulePath).href);
        const summary = { total: 1, completed: 0, version: 1 };
        function render(canManage) {
            const state = { workspace: { checklists: { task: {
                items: [{ id: 1, title: '<script>hidden()</script>', completed: false, version: 1 }],
                version: 1, hasLoaded: true, status: 'ready', canManage, canComplete: true, summary,
            } } } };
            const store = { getState: () => state, subscribe: () => () => {}, dispatch: () => {} };
            return renderToStaticMarkup(React.createElement(Provider, { store },
                React.createElement(TaskChecklist, { taskId: 'task', onEditingChange: () => {}, onHistoryChange: () => {} })));
        }
        const admin = render(true);
        assert.match(admin, /New checklist item/);
        assert.match(admin, /Move &lt;script&gt;/);
        assert.match(admin, /type="checkbox"/);
        assert.doesNotMatch(admin, /<script>/);
        const member = render(false);
        assert.match(member, /type="checkbox"/);
        assert.doesNotMatch(member, /New checklist item|aria-label="Edit|aria-label="Delete|aria-label="Move/);
        const empty = renderToStaticMarkup(React.createElement(ChecklistProgress, { summary: { total: 0, completed: 0, version: 0 } }));
        assert.match(empty, /0\/0 items complete/);
        assert.match(empty, /max="1" value="0"/);
        assert.equal(renderToStaticMarkup(React.createElement(ChecklistProgress, {
            summary: { total: 0, completed: 0, version: 0 }, compact: true,
        })), '');
        assert.match(renderToStaticMarkup(React.createElement(ChecklistProgress, { summary, compact: true })), /0\/1 complete/);
    }
    finally {
        assert.ok(scratch.startsWith(scratchRoot + '\\') || scratch.startsWith(scratchRoot + '/'));
        rmSync(scratch, { recursive: true, force: true });
    }
});
