import test from 'node:test';
import assert from 'node:assert/strict';
import { attachmentPreviewType, loadAttachmentPreview } from '../src/features/tasks/attachmentPreview.js';

const pdf = { id: 'file', fileName: 'review.pdf', contentType: 'application/pdf' };

test('previews require a PDF, PNG or JPEG with matching metadata and extension', () => {
    for (const [fileName, contentType] of [
        ['review.PDF', 'application/pdf'], ['photo.png', 'image/png'],
        ['photo.JPG', 'image/jpeg'], ['photo.jpeg', 'image/jpeg'],
    ]) {
        assert.equal(attachmentPreviewType({ fileName, contentType }), contentType);
    }
    for (const attachment of [
        { fileName: 'page.html', contentType: 'text/html' },
        { fileName: 'drawing.svg', contentType: 'image/svg+xml' },
        { fileName: 'page.pdf', contentType: 'text/html' },
        { fileName: 'page.html', contentType: 'application/pdf' },
        { fileName: 'photo.png', contentType: 'image/jpeg' },
        { fileName: 'old.pdf', contentType: null },
        { fileName: 'document.docx', contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
    ]) {
        assert.equal(attachmentPreviewType(attachment), null);
    }
});

test('preview uses the existing private download endpoint with credentials and an abortable blob response', async () => {
    const originalFetch = globalThis.fetch;
    const controller = new AbortController();
    const objectUrls = [];
    globalThis.fetch = async (url, options) => {
        assert.equal(url, '/api/task-management/tasks/task/attachments/file/content');
        assert.equal(options.credentials, 'include');
        assert.equal(options.cache, 'no-store');
        assert.equal(options.headers['X-Task-Management'], '1');
        assert.ok(options.signal instanceof AbortSignal);
        return new Response(new Blob(['%PDF-1.4'], { type: 'application/pdf' }));
    };
    try {
        const preview = await loadAttachmentPreview('task', pdf, controller.signal, undefined, {
            createObjectURL(blob) {
                objectUrls.push(blob);
                return 'blob:private-preview';
            },
        });
        assert.deepEqual(preview, { type: 'application/pdf', url: 'blob:private-preview' });
        assert.equal(objectUrls.length, 1);
        assert.equal(await objectUrls[0].text(), '%PDF-1.4');
    }
    finally {
        globalThis.fetch = originalFetch;
    }
});

test('unsupported files, wrong response types and denied downloads never allocate a preview URL', async () => {
    const signal = new AbortController().signal;
    const urls = { createObjectURL() {
        assert.fail('Rejected content must not receive a preview URL.');
    } };
    await assert.rejects(loadAttachmentPreview('task', { ...pdf, fileName: 'document.docx' }, signal,
        () => assert.fail('Unsupported previews must not fetch the file.'), urls), /Preview is available/);
    for (const type of ['text/html', 'application/json', 'image/svg+xml']) {
        await assert.rejects(loadAttachmentPreview('task', pdf, signal,
            async () => new Blob(['not a PDF'], { type }), urls), /could not be previewed/);
    }
    const denied = Object.assign(new Error('No longer available.'), { status: 404 });
    await assert.rejects(loadAttachmentPreview('task', pdf, signal, async () => {
        throw denied;
    }, urls), (failure) => failure === denied);
});

test('closing during a fetch or before it starts cannot allocate a late preview URL', async () => {
    const controller = new AbortController();
    const urls = { createObjectURL() {
        assert.fail('Cancelled requests must not receive a preview URL.');
    } };
    let finish;
    const pending = loadAttachmentPreview('task', pdf, controller.signal,
        () => new Promise((resolve) => {
            finish = resolve;
        }), urls);
    controller.abort();
    finish(new Blob(['%PDF-1.4'], { type: 'application/pdf' }));
    await assert.rejects(pending, { name: 'AbortError' });
    await assert.rejects(loadAttachmentPreview('task', pdf, controller.signal,
        () => assert.fail('A cancelled preview must not fetch.'), urls), { name: 'AbortError' });
});
