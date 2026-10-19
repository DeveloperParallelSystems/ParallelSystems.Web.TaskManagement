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

test('one board editor and preview use catalog names without a secondary grouping section', async () => {
    const root = resolve('.tmp');
    mkdirSync(root, { recursive: true });
    const scratch = mkdtempSync(join(root, 'catalog-board-render-'));
    try {
        const bundle = await build({ configFile: false, logLevel: 'silent', plugins: [{
            name: 'inert-navigation-guard', enforce: 'pre',
            transform(source, id) {
                if (!id.replaceAll('\\', '/').endsWith('/WorkflowPresentationPage.jsx')) {
                    return null;
                }
                return source.replace("import { useBlocker } from 'react-router-dom';",
                    "function useBlocker() { return { state: 'unblocked' }; }");
            },
        }, react()], build: { ssr: 'src/features/tasks/WorkflowPresentationPage.jsx', write: false } });
        const modulePath = join(scratch, 'board.mjs');
        writeFileSync(modulePath, bundle.output.find((chunk) => chunk.isEntry).code);
        const { default: Page } = await import(pathToFileURL(modulePath).href);
        const catalog = [{ code: 'To Do', name: 'To Do' }, { code: 'qa', name: '<Design QA>' }];
        const groups = [
            { id: 'planning', name: 'Planning', color: 'blue', statuses: ['To Do'] },
            { id: 'working', name: 'Working', color: 'amber', statuses: [] },
            { id: 'review', name: 'Review', color: 'purple', statuses: ['qa'] },
            { id: 'done', name: 'Done', color: 'green', statuses: [] },
        ];
        const state = { workspace: { workflowPresentation: { data: {
            version: 4, catalogVersion: 8, canManage: true, supported: true, groups, catalog } },
        statusSettings: { data: { version: 8 } }, tasks: [{ id: 'a', status: 'qa', statusBoardStatus: 'To Do' }] } };
        const store = { getState: () => state, subscribe: () => () => {}, dispatch: () => {} };
        const markup = renderToStaticMarkup(React.createElement(Provider, { store },
            React.createElement(Page, { onEditingChange: () => {} })));
        assert.match(markup, /All 2 catalog statuses placed exactly once/);
        assert.match(markup, /Move &lt;Design QA&gt; to column/);
        assert.match(markup, /aria-label="Review: 1 task"/);
        assert.match(markup, /aria-label="Planning: 0 tasks"/);
        assert.equal((markup.match(/>Save default layout</g) || []).length, 1);
        assert.equal((markup.match(/<select/g) || []).length, 2);
        assert.doesNotMatch(markup, /Additional status groupings|Save status groupings|Move Released to column|<Design QA>/);
        const projectId = '11111111-1111-1111-1111-111111111111';
        state.workspace.projectPresentations = { [projectId]: { data: {
            ...state.workspace.workflowPresentation.data, projectId, projectVersion: 0, usesDefault: true } } };
        const renderProject = () => renderToStaticMarkup(React.createElement(Provider, { store },
            React.createElement(Page, { projectId, projectName: '<Project>', clientName: 'Client', onEditingChange: () => {} })));
        const inherited = renderProject();
        assert.match(inherited, /Using default/);
        assert.match(inherited, /Project board grouping/);
        assert.doesNotMatch(inherited, /Board and dashboard grouping/);
        assert.match(inherited, /Customize this project/);
        assert.match(inherited, /Client \/ &lt;Project&gt;/);
        assert.match(inherited, /aria-label="Review: 0 tasks"/);
        assert.doesNotMatch(inherited, /Use default columns/);
        assert.match(inherited, /<button class="button primary" disabled=""><svg[^]*?Save project layout/);
        state.workspace.projectPresentations[projectId].data.usesDefault = false;
        const custom = renderProject();
        assert.match(custom, /Custom layout/);
        assert.match(custom, /Use default layout/);
        assert.doesNotMatch(custom, /Customize this project/);
    }
    finally {
        assert.ok(scratch.startsWith(root + '\\') || scratch.startsWith(root + '/'));
        rmSync(scratch, { recursive: true, force: true });
    }
});
