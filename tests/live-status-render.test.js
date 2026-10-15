import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server.js';
import { Provider } from 'react-redux';
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { allowedDisciplineStatuses, validateStatusSettings } from '../src/features/tasks/liveStatuses.js';

test('Change status renders only the selected discipline statuses and server-permitted moves', async () => {
    const root = resolve('.tmp');
    mkdirSync(root, { recursive: true });
    const scratch = mkdtempSync(join(root, 'live-status-control-'));
    try {
        const bundle = await build({ configFile: false, plugins: [react()], logLevel: 'silent',
            build: { ssr: 'src/features/tasks/TaskStatusControl.jsx', write: false } });
        const modulePath = join(scratch, 'status-control.mjs');
        writeFileSync(modulePath, bundle.output.find((chunk) => chunk.isEntry).code);
        const { default: TaskStatusControl } = await import(pathToFileURL(modulePath).href);
        const settings = { catalog: [{ code: 'To Do', name: 'To Do' },
            { code: 'In Progress', name: 'In Progress' }, { code: 'draft-check', name: 'Draft check' }],
        disciplines: [{ discipline: 'Development', statuses: ['To Do', 'In Progress'] },
            { discipline: 'Drafting', statuses: ['To Do', 'draft-check'] }] };
        const store = { getState: () => ({}), subscribe: () => () => {}, dispatch: () => {} };
        const markup = renderToStaticMarkup(React.createElement(Provider, { store },
            React.createElement(TaskStatusControl, { task: { id: 'task', status: 'To Do', discipline: 'Development' },
                settings, allowedStatuses: ['To Do', 'In Progress'], disabled: false, onEditingChange: () => {},
                onChanged: () => {} })));
        assert.match(markup, /<option value="In Progress">In Progress<\/option>/);
        assert.doesNotMatch(markup, /Draft check|draft-check/);
        const restricted = renderToStaticMarkup(React.createElement(Provider, { store },
            React.createElement(TaskStatusControl, { task: { id: 'old', status: 'retired', discipline: 'Development' },
                settings, allowedStatuses: ['To Do'], disabled: false, onEditingChange: () => {}, onChanged: () => {} })));
        assert.match(restricted, /value="retired" disabled=""[^>]*>retired · current/);
        assert.doesNotMatch(restricted, /<option[^>]*value="In Progress"/);
    }
    finally {
        rmSync(scratch, { recursive: true, force: true });
    }
});

test('discipline assignment page omits catalog administration and board grouping', async () => {
    const root = resolve('.tmp');
    mkdirSync(root, { recursive: true });
    const scratch = mkdtempSync(join(root, 'status-settings-render-'));
    try {
        const bundle = await build({ configFile: false, logLevel: 'silent', plugins: [{
            name: 'inert-navigation-guard',
            enforce: 'pre',
            transform(source, id) {
                if (!id.replaceAll('\\', '/').endsWith('/StatusSettingsPage.jsx')) {
                    return null;
                }
                return source.replace("import { Link, useBlocker } from 'react-router-dom';",
                    "import { Link } from 'react-router-dom'; function useBlocker() { return { state: 'unblocked' }; }");
            },
        }, react()], build: { ssr: 'src/features/tasks/StatusSettingsPage.jsx', write: false } });
        const modulePath = join(scratch, 'settings.mjs');
        writeFileSync(modulePath, bundle.output.find((chunk) => chunk.isEntry).code);
        const { default: Page } = await import(pathToFileURL(modulePath).href);
        const settings = { version: 1, canManage: true, catalog: [
            { code: 'To Do', name: 'To Do', boardStatus: 'To Do', isCustom: false },
            { code: 'qa', name: '<QA>', boardStatus: 'In Review', isCustom: true },
            { code: 'unused', name: 'Unused status', boardStatus: 'In Progress' },
            { code: 'assigned', name: 'Assigned status', boardStatus: 'In Progress' }], disciplines: [
            { discipline: 'Development', statuses: ['To Do', 'qa', 'assigned'] },
            { discipline: 'Drafting', statuses: ['To Do'] }] };
        const state = { workspace: { statusSettings: { data: settings }, tasks: [
            { id: 'old', discipline: 'Development', status: 'qa' }], workflowPresentation: { data: { groups: [
                { id: 'planning', name: 'Planning', statuses: ['To Do'] },
                { id: 'review', name: 'Review', statuses: ['In Review'] }] } } } };
        const store = { getState: () => state, subscribe: () => () => {}, dispatch: () => {} };
        const markup = renderToStaticMarkup(React.createElement(Provider, { store },
            React.createElement(StaticRouter, null, React.createElement(Page, { onEditingChange: () => {} }))));
        assert.match(markup, /<h1[^>]*>Discipline statuses<\/h1>/);
        assert.doesNotMatch(markup, /Shared status catalog|New status name|Status name<|Board column for/);
        assert.match(markup, /Development statuses/);
        assert.match(markup, /Remove &lt;QA&gt; from Development" disabled=""/);

        assert.match(markup, /Save statuses/);
        assert.match(markup, /href="\/status-catalog"/);
        const catalogMarkup = renderToStaticMarkup(React.createElement(Provider, { store },
            React.createElement(StaticRouter, null, React.createElement(Page, { view: 'catalog', onEditingChange: () => {} }))));
        assert.match(catalogMarkup, /<h1[^>]*>Status catalog<\/h1>/);
        assert.match(catalogMarkup, /Shared status catalog/);
        assert.match(catalogMarkup, /<table[^>]*>/);
        assert.match(catalogMarkup, /<th[^>]*>Type<\/th>/);
        assert.match(catalogMarkup, /<td>Default<\/td>/);
        assert.match(catalogMarkup, /<td>Custom<\/td>/);
        assert.match(catalogMarkup, /<th[^>]*>Assigned disciplines<\/th>/);
        assert.match(catalogMarkup, /Add status/);
        assert.match(catalogMarkup, /aria-label="Edit &lt;QA&gt;"/);
        assert.match(catalogMarkup, /aria-label="Delete &lt;QA&gt;"[^>]*disabled=""/);
        assert.match(catalogMarkup, /aria-label="Delete Assigned status"[^>]*disabled=""/);
        assert.match(catalogMarkup, /aria-label="Delete To Do"[^>]*disabled=""/);
        assert.match(catalogMarkup, /aria-label="Delete Unused status"(?![^>]*disabled=)/);
        assert.match(catalogMarkup, /In use by tasks/);
        assert.doesNotMatch(catalogMarkup, /Save catalog|Board column for/);
        assert.doesNotMatch(catalogMarkup, /Board column for|Move &lt;QA&gt; earlier|Development statuses|Available from the catalog/);
        assert.doesNotMatch(markup, /Publish|Legacy v1|Version history|Create draft/);
    }
    finally {
        rmSync(scratch, { recursive: true, force: true });
    }
});

