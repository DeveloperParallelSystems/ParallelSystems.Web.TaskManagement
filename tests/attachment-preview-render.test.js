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

test('attachment previews render supported controls and release files on close or session change', async () => {
    const root = resolve('.tmp');
    mkdirSync(root, { recursive: true });
    const scratch = mkdtempSync(join(root, 'attachment-preview-'));
    const originalFetch = globalThis.fetch;
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    try {
        const hooksPath = join(scratch, 'hooks.js');
        writeFileSync(hooksPath, `
let state;
let callbacks = [];
let changes = [];
export const dialog = { showModal() {}, close() {} };
export function reset() {
    state = { auth: { user: { userId: 'account' } } };
    callbacks = [];
    changes = [];
}
export function replaceUser() {
    state.auth.user = { userId: 'other-account' };
}
export function updates() {
    return changes;
}
export function mount() {
    return callbacks.map((effect) => effect());
}
export function useState(initial) {
    return [initial, (value) => changes.push(value)];
}
export function useRef() {
    return { current: dialog };
}
export function useEffect(effect) {
    callbacks.push(effect);
}
export function useSelector(select) {
    return select(state);
}
export function useStore() {
    return { getState: () => state };
}
export function useDispatch() {
    return () => {};
}
`);
        const entry = join(scratch, 'entry.jsx');
        writeFileSync(entry, "export { default as Preview, AttachmentPreviewContent } from '../../src/features/tasks/TaskAttachmentPreview.jsx';\n" +
            "export { default as TaskAttachments } from '../../src/features/tasks/TaskAttachments.jsx';\n" +
            "export { reset, replaceUser, updates, mount } from './hooks.js';\n");
        const bundle = await build({ configFile: false, logLevel: 'silent', plugins: [{
            name: 'preview-lifecycle-hooks', enforce: 'pre', transform(source, id) {
                if (id.replaceAll('\\', '/').endsWith('/src/features/tasks/TaskAttachmentPreview.jsx')) {
                    return source.replace(/from '(react|react-redux)'/g,
                        `from ${JSON.stringify(hooksPath.replaceAll('\\', '/'))}`);
                }
            },
        }, react()], build: { ssr: entry, write: false } });
        const modulePath = join(scratch, 'preview.mjs');
        writeFileSync(modulePath, bundle.output.find((chunk) => chunk.isEntry).code);
        const { Preview, AttachmentPreviewContent, TaskAttachments, reset, replaceUser, updates, mount } =
            await import(pathToFileURL(modulePath).href);
        const attachment = { id: 'file', fileName: 'review.pdf', contentType: 'application/pdf', version: 1 };
        const state = { auth: { user: { userId: 'account' } }, workspace: { attachments: { task: {
            hasLoaded: true, items: [attachment,
                { ...attachment, id: 'image', fileName: 'photo.png', contentType: 'image/png' },
                { ...attachment, id: 'word', fileName: 'notes.docx', contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }],
        } } } };
        const store = { getState: () => state, subscribe: () => () => {}, dispatch: () => {} };
        const list = renderToStaticMarkup(React.createElement(Provider, { store }, React.createElement(TaskAttachments, {
            taskId: 'task', onEditingChange() {}, onHistoryChange() {},
        })));
        assert.match(list, /aria-label="Preview review.pdf"/);
        assert.match(list, /aria-label="Preview photo.png"/);
        assert.doesNotMatch(list, /aria-label="Preview notes.docx"/);
        assert.match(list, /aria-label="Download notes.docx"/);
        const readOnlyList = renderToStaticMarkup(React.createElement(Provider, { store }, React.createElement(TaskAttachments, {
            taskId: 'task', readOnly: true, onEditingChange() {}, onHistoryChange() {},
        })));
        assert.match(readOnlyList, /aria-label="Preview review.pdf"/);
        assert.match(readOnlyList, /aria-label="Download notes.docx"/);
        assert.doesNotMatch(readOnlyList, /Add files|attachment-dropzone|aria-label="Remove /);
        const pdf = renderToStaticMarkup(React.createElement(AttachmentPreviewContent, {
            attachment, resource: { type: 'application/pdf', url: 'blob:private-file' },
        }));
        assert.match(pdf, /<object[^>]*data="blob:private-file"[^>]*type="application\/pdf"/);
        assert.match(pdf, /Your browser cannot display this PDF here/);
        const image = renderToStaticMarkup(React.createElement(AttachmentPreviewContent, {
            attachment: { fileName: '<photo>.png' }, resource: { type: 'image/png', url: 'blob:private-image' },
        }));
        assert.match(image, /alt="&lt;photo&gt;.png"/);

        const props = { taskId: 'task', attachment, onClose() {}, onDownload() {} };
        const created = [];
        const revoked = [];
        URL.createObjectURL = () => {
            const url = `blob:file-${created.length}`;
            created.push(url);
            return url;
        };
        URL.revokeObjectURL = (url) => revoked.push(url);
        let finish;
        globalThis.fetch = () => new Promise((resolveFetch) => {
            finish = () => resolveFetch(new Response(new Blob(['%PDF-1.4'], { type: 'application/pdf' })));
        });
        const settle = () => new Promise((resolveTick) => setImmediate(resolveTick));

        reset();
        const loading = renderToStaticMarkup(Preview(props));
        assert.match(loading, /<dialog[^>]*aria-labelledby="attachment-preview-title"/);
        assert.match(loading, /Close attachment preview|Loading preview/);
        const cancelBeforeResponse = mount();
        cancelBeforeResponse.forEach((cleanup) => cleanup());
        finish();
        await settle();
        assert.deepEqual(created, []);

        reset();
        Preview(props);
        const closeAfterResponse = mount();
        finish();
        await settle();
        assert.ok(updates().some((update) => update?.url === 'blob:file-0'));
        closeAfterResponse.forEach((cleanup) => cleanup());
        assert.deepEqual(revoked, ['blob:file-0']);

        reset();
        Preview(props);
        const closeAfterSessionChange = mount();
        replaceUser();
        finish();
        await settle();
        assert.deepEqual(revoked, ['blob:file-0', 'blob:file-1']);
        assert.ok(!updates().some((update) => update?.url));
        closeAfterSessionChange.forEach((cleanup) => cleanup());
    }
    finally {
        globalThis.fetch = originalFetch;
        URL.createObjectURL = originalCreate;
        URL.revokeObjectURL = originalRevoke;
        assert.ok(scratch.startsWith(root + '\\') || scratch.startsWith(root + '/'));
        rmSync(scratch, { recursive: true, force: true });
    }
});
