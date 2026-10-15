import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Provider } from 'react-redux';
import { createStaticHandler, createStaticRouter, StaticRouterProvider } from 'react-router-dom/server.js';
import { buildSimpleStatusDefinition } from '../src/features/tasks/simpleStatusWorkflow.js';

test('workflow editor exposes stages, configured action roles, failed review destination and a safe preview', async () => {
    const root = resolve('.tmp');
    mkdirSync(root, { recursive: true });
    const scratch = mkdtempSync(join(root, 'discipline-render-'));
    try {
        const bundle = await build({ configFile: false, plugins: [react()], logLevel: 'silent',
            build: { ssr: 'src/features/tasks/DisciplineWorkflowEditor.jsx', write: false } });
        const path = join(scratch, 'editor.mjs');
        writeFileSync(path, bundle.output.find((chunk) => chunk.isEntry).code);
        const { default: Editor, DisciplineWorkflowPreview } = await import(pathToFileURL(path).href);
        const definition = { name: '<script>Example</script>', startStageId: 'review', stages: [
            { id: 'review', name: 'Technical review', kind: 'Review', color: 'purple', ownerRole: 'Reviewer' },
            { id: 'work', name: 'Rework', kind: 'Work', color: 'amber', ownerRole: 'Owner' },
            { id: 'done', name: 'Done', kind: 'Completed', color: 'green', ownerRole: 'None' },
        ], transitions: [
            { id: 'reject', name: 'Request changes', kind: 'FailReview', fromStageId: 'review', toStageId: 'work',
                actorRoles: ['Reviewer', 'Administrator'], requireNote: true },
        ] };
        const editor = renderToStaticMarkup(React.createElement(Editor, { definition, onChange: () => {}, disabled: true }));
        assert.match(editor, /fieldset[^>]*disabled/);
        assert.match(editor, /Start stage/);
        assert.match(editor, /Add stage/);
        assert.match(editor, /Add action/);
        assert.match(editor, /Failed review destination/);
        assert.match(editor, /Allowed participants/);
        assert.match(editor, /Original/);
        assert.match(editor, /Administrator/);
        assert.match(editor, /Require a note/);
        assert.match(editor, /Workflow map/);
        assert.match(editor, /aria-label="purple theme color" aria-pressed="true"/);
        assert.match(editor, /<summary[^>]*aria-label="Edit action Request changes"/);
        assert.match(editor, /Technical review → Rework/);
        assert.doesNotMatch(editor, /<script>/);
        const preview = renderToStaticMarkup(React.createElement(DisciplineWorkflowPreview, { definition }));
        assert.match(preview, /Workflow preview/);
        assert.match(preview, /Request changes/);
        assert.match(preview, /Rework/);
        assert.match(preview, /Reviewer/);
        assert.match(preview, /Note required/);
        assert.match(preview, /Completed/);
        assert.doesNotMatch(preview, /<script>/);
        const pageBundle = await build({ configFile: false, plugins: [react()], logLevel: 'silent',
            build: { ssr: 'src/features/tasks/DisciplineWorkflowsPage.jsx', write: false } });
        const pagePath = join(scratch, 'page.mjs');
        writeFileSync(pagePath, pageBundle.output.find((chunk) => chunk.isEntry).code);
        const { default: Page } = await import(pathToFileURL(pagePath).href);
        const state = { workspace: { disciplineWorkflows: { data: { canManage: true, supported: true, items: [
            { discipline: 'Development', active: { id: 'published', versionNumber: 1, definition },
                draft: { id: 'draft', version: 2, definition, discipline: 'Development' } },
            { discipline: 'Drafting', active: null, draft: null },
        ] }, status: 'ready', readId: null, writeId: null, error: null } } };
        const store = { getState: () => state, subscribe: () => () => {}, dispatch: () => {} };
        const routes = [{ path: '/discipline-workflows', element: React.createElement(Page) }];
        const handler = createStaticHandler(routes);
        const context = await handler.query(new Request('http://localhost/discipline-workflows'));
        const router = createStaticRouter(handler.dataRoutes, context);
        const renderPage = () => renderToStaticMarkup(React.createElement(Provider, { store },
            React.createElement(StaticRouterProvider, { router, context, hydrate: false })));
        const page = renderPage();
        assert.match(page, /Save draft/);
        assert.match(page, /Validate saved draft/);
        assert.match(page, /Publish for new tasks/);
        assert.match(page, /Disable for new tasks/);
        assert.match(page, /Reload latest workflow/);
        assert.match(page, /Development draft · Revision 2/);
        assert.match(page, /Publish statuses/);
        assert.match(page, /Use simple statuses/);
        assert.match(page, /aria-pressed="true"[^>]*>Development/);
        assert.match(page, /Versions/);
        assert.doesNotMatch(page, /<script>/);
        state.workspace.disciplineWorkflows.data.items[0].draft.definition = buildSimpleStatusDefinition('Development', [
            { id: 'to-do', name: 'To Do' },
            { id: 'in-progress', name: 'In Progress' },
            { id: 'in-review', name: 'In Review' },
            { id: 'completed', name: 'Completed' },
        ]);
        const simplePage = renderPage();
        assert.match(simplePage, /Status 4/);
        assert.match(simplePage, /Add status/);
        assert.match(simplePage, /including out of the last one/);
        assert.doesNotMatch(simplePage, /Add action|Failed review destination/);
        state.workspace.disciplineWorkflows.data.canManage = false;
        const denied = renderPage();
        assert.doesNotMatch(denied, /Save draft|Validate saved draft|Publish for new tasks/);
        state.workspace.disciplineWorkflows.data.canManage = true;
        state.workspace.disciplineWorkflows.data.items[0] = { discipline: 'Development', active: null, draft: null };
        const empty = renderPage();
        assert.match(empty, /Create draft/);
        assert.match(empty, /Legacy v1/);
        assert.doesNotMatch(empty, /Save draft|Publish statuses|Revision 2/);
    }
    finally {
        assert.ok(scratch.startsWith(root + '\\') || scratch.startsWith(root + '/'));
        rmSync(scratch, { recursive: true, force: true });
    }
});
