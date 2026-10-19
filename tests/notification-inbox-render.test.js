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

test('inbox renders exact counts, page boundaries, empty unread and request errors', async () => {
    const root = resolve('.tmp');
    mkdirSync(root, { recursive: true });
    const scratch = mkdtempSync(join(root, 'inbox-render-'));
    try {
        const bundle = await build({ configFile: false, plugins: [react()], logLevel: 'silent',
            build: { ssr: 'src/features/tasks/NotificationsPage.jsx', write: false } });
        const file = join(scratch, 'inbox.mjs');
        writeFileSync(file, bundle.output.find((chunk) => chunk.isEntry).code);
        const { default: Inbox } = await import(pathToFileURL(file).href);
        const inbox = { query: { filter: 'all', page: 5 }, data: { page: 5, totalCount: 113, items: [
            { id: 1, taskId: 'task', title: '<Unsafe title>', code: 'TASK-1', message: 'Example', createdAtUtc: '2026-10-20T00:00:00Z' },
        ] } };
        const state = { workspace: { notificationInbox: inbox, notifications: { unreadCount: 106 } } };
        const store = { getState: () => state, subscribe: () => () => {}, dispatch: () => {} };
        const render = (path = '/notifications?filter=all&page=5') => renderToStaticMarkup(React.createElement(Provider, { store },
            React.createElement(StaticRouter, { location: path }, React.createElement(Inbox))));
        const last = render();
        assert.match(last, /106 unread/);
        assert.match(last, /101–113 of 113 notifications/);
        assert.match(last, /Page 5 of 5/);
        assert.match(last, /disabled=""[^>]*>Next/);
        assert.match(last, /&lt;Unsafe title&gt;/);
        assert.match(last, /Mark all as read/);
        inbox.query = { filter: 'unread', page: 1 };
        inbox.data = { page: 1, totalCount: 0, items: [] };
        state.workspace.notifications.unreadCount = 0;
        const empty = render('/notifications?filter=unread&page=1');
        assert.match(empty, /You’re all caught up/);
        assert.match(empty, /aria-pressed="true"[^>]*>Unread/);
        assert.doesNotMatch(empty, /Notification pages/);
        assert.match(empty, /disabled=""[^>]*>Mark all as read/);
        inbox.error = 'Connection unavailable';
        assert.match(render('/notifications?filter=unread&page=1'), /role="alert".*Connection unavailable.*Retry/);
        inbox.error = null;
        inbox.requestId = 'loading';
        assert.match(render('/notifications?filter=unread&page=1'), /Loading notifications/);
    }
    finally {
        rmSync(scratch, { recursive: true, force: true });
    }
});
