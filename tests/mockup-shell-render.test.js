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

test('shell omits saved views and retains mobile navigation with administrator-only configuration', async () => {
    const scratchRoot = resolve('.tmp');
    mkdirSync(scratchRoot, { recursive: true });
    const scratch = mkdtempSync(join(scratchRoot, 'mockup-shell-'));
    try {
        const bundle = await build({ configFile: false, plugins: [react()], logLevel: 'silent',
            build: { ssr: 'src/App.jsx', write: false } });
        const modulePath = join(scratch, 'app.mjs');
        writeFileSync(modulePath, bundle.output.find((chunk) => chunk.isEntry).code);
        const { default: App } = await import(pathToFileURL(modulePath).href);
        const state = {
            auth: { status: 'authenticated', user: { userId: 'account', role: 'User', name: '<Staff name>' } },
            workspace: { tasks: [], projects: [], people: [], details: {}, labels: [], hasLoaded: true, status: 'ready',
                notifications: { items: [], unreadCount: 2 }, workflowPresentation: { data: null, error: null } },
        };
        const store = { getState: () => state, subscribe: () => () => {}, dispatch: () => {} };
        function render(path = '/tasks') {
            return renderToStaticMarkup(React.createElement(Provider, { store }, React.createElement(StaticRouter,
                { location: path }, React.createElement(App))));
        }
        const user = render();
        assert.doesNotMatch(user, /aria-label="Administration"/);
        assert.match(user, /New task/);
        assert.doesNotMatch(render('/dashboard'), /New task/);
        assert.doesNotMatch(user, /SAVED VIEWS|aria-label="Saved views"|href="\/tasks\?quick=/);
        assert.match(user, /aria-label="Search workspace tasks"/);
        assert.match(user, /aria-controls="workspace-navigation"/);
        assert.match(user, /aria-label="Mobile workspace"/);
        assert.match(user, /&lt;Staff name&gt;/);
        assert.doesNotMatch(user, /<Staff name>/);
        state.auth.user.role = 'Administrator';
        const admin = render();
        assert.doesNotMatch(admin, /SAVED VIEWS|aria-label="Saved views"|href="\/tasks\?quick=/);
        assert.match(admin, /aria-label="Administration"/);
        assert.match(admin, /href="\/discipline-statuses"/);
        assert.match(admin, /href="\/status-catalog"/);
        assert.match(admin, /New task/);
        assert.doesNotMatch(render('/dashboard'), /New task/);
        const calendar = render('/tasks?view=calendar');
        assert.match(calendar, /<a(?=[^>]*href="\/tasks\?view=calendar")(?=[^>]*class="active")[^>]*>/);
        const mobileNav = calendar.match(/<nav class="mobile-bottom-nav"[^>]*>(.*?)<\/nav>/s)[1];
        assert.equal((mobileNav.match(/aria-current="page"/g) || []).length, 1);
    }
    finally {
        assert.ok(scratch.startsWith(scratchRoot + '\\') || scratch.startsWith(scratchRoot + '/'));
        rmSync(scratch, { recursive: true, force: true });
    }
});
