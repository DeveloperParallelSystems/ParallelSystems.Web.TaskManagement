import test from 'node:test';
import assert from 'node:assert/strict';
import { attachmentError, attachmentSize, maxAttachmentBytes } from '../src/features/tasks/attachmentValidation.js';
import { loadTaskAttachments, removeTaskAttachment } from '../src/features/tasks/attachmentState.js';
import { store, login, logout, loadWorkspace } from '../src/app/store.js';
import { uploadFile } from '../src/app/api.js';

test('attachment selection allows PDFs/images/Office documents and rejects empty, oversized and unsupported files', () => {
    assert.equal(attachmentError({ name: 'review.PDF', size: maxAttachmentBytes }), null);
    assert.equal(attachmentError({ name: 'scan.jpeg', size: 3 }), null);
    assert.equal(attachmentError({ name: 'scan.png', size: 8 }), null);
    for (const extension of ['doc', 'DOCX', 'xls', 'XLSX', 'ppt', 'PPTX']) {
        assert.equal(attachmentError({ name: `document.${extension}`, size: maxAttachmentBytes }), null);
    }
    assert.match(attachmentError({ name: 'document.docm', size: 8 }), /Word, Excel or PowerPoint/);
    assert.match(attachmentError({ name: 'document.zip', size: 8 }), /Word, Excel or PowerPoint/);
    assert.match(attachmentError({ name: 'empty.pdf', size: 0 }), /non-empty/);
    assert.match(attachmentError({ name: 'large.pdf', size: maxAttachmentBytes + 1 }), /10 MB/);
    assert.match(attachmentError({ name: 'script.svg', size: 8 }), /PDF, PNG, JPEG/);
    assert.match(attachmentError({ name: 'bad\nname.pdf', size: 8 }), /filename/);
    assert.equal(attachmentSize(2048), '2 KB');
    assert.equal(attachmentSize(maxAttachmentBytes), '10.0 MB');
});

function signIn() {
    store.dispatch(login.fulfilled({ userId: 'account', role: 'User' }, 'attachment-login'));
}

test('stale attachment reads/removals cannot restore data after logout, binding change or lost access', () => {
    signIn();
    const arg = { taskId: 'task' };
    const item = { id: 'file', version: 2, fileName: 'review.pdf' };
    store.dispatch(loadTaskAttachments.pending('first', arg));
    store.dispatch(loadTaskAttachments.fulfilled([item], 'first', arg));
    store.dispatch(removeTaskAttachment.pending('delete', { ...arg, id: item.id, version: 2 }));
    store.dispatch(loadTaskAttachments.pending('older-read', arg));
    store.dispatch(removeTaskAttachment.fulfilled({ id: item.id }, 'delete', { ...arg, id: item.id }));
    store.dispatch(loadTaskAttachments.fulfilled([item], 'older-read', arg));
    assert.deepEqual(store.getState().workspace.attachments.task.items, []);
    store.dispatch(loadTaskAttachments.pending('late', arg));
    store.dispatch(logout.fulfilled());
    store.dispatch(loadTaskAttachments.fulfilled([item], 'late', arg));
    assert.deepEqual(store.getState().workspace.attachments, {});
    signIn();
    const workspace = { tasks: [{ id: 'task', version: 1 }], people: [{ id: 'staff', userId: 'account' }],
        projects: [], notifications: { items: [], unreadCount: 0 } };
    store.dispatch(loadWorkspace.pending('workspace'));
    store.dispatch(loadWorkspace.fulfilled(workspace, 'workspace'));
    store.dispatch(loadTaskAttachments.pending('binding-read', arg));
    store.dispatch(loadWorkspace.pending('changed'));
    store.dispatch(loadWorkspace.fulfilled({ ...workspace, people: [{ id: 'staff', userId: null }] }, 'changed'));
    store.dispatch(loadTaskAttachments.fulfilled([item], 'binding-read', arg));
    assert.deepEqual(store.getState().workspace.attachments, {});
    store.dispatch(loadTaskAttachments.pending('access-read', arg));
    store.dispatch(loadTaskAttachments.fulfilled([item], 'access-read', arg));
    store.dispatch(loadTaskAttachments.pending('lost', arg));
    store.dispatch(loadTaskAttachments.rejected(null, 'lost', arg, { status: 404, message: 'No access' }));
    assert.deepEqual(store.getState().workspace.attachments.task.items, []);
    assert.equal(store.getState().workspace.attachments.task.hasLoaded, false);
    store.dispatch(logout.fulfilled());
});

test('multipart uploads preserve credentials/header, report progress, abort and clear expired sessions', async () => {
    const original = globalThis.XMLHttpRequest;
    class TestXHR {
        static instances = [];
        constructor() {
            this.headers = {};
            this.upload = {};
            TestXHR.instances.push(this);
        }
        open(method, url) {
            this.method = method;
            this.url = url;
        }
        setRequestHeader(name, value) {
            this.headers[name] = value;
        }
        send(body) {
            this.body = body;
        }
        abort() {
            this.onabort();
        }
    }
    globalThis.XMLHttpRequest = TestXHR;
    try {
        const file = new File(['%PDF-1.4'], 'review.pdf', { type: 'application/pdf' });
        let progress;
        const pending = uploadFile('/tasks/task/attachments', { file, uploadId: 'upload-id',
            onProgress: (value) => {
                progress = value;
            } });
        const xhr = TestXHR.instances.at(-1);
        assert.equal(xhr.url, '/api/task-management/tasks/task/attachments');
        assert.equal(xhr.withCredentials, true);
        assert.equal(xhr.headers['X-Task-Management'], '1');
        assert.equal(xhr.headers['Content-Type'], undefined);
        assert.equal(xhr.body.get('uploadId'), 'upload-id');
        assert.equal(xhr.body.get('file').name, 'review.pdf');
        xhr.upload.onprogress({ lengthComputable: true, loaded: 5, total: 10 });
        assert.equal(progress, 50);
        xhr.status = 201;
        xhr.responseText = JSON.stringify({ id: 'uploaded' });
        xhr.onload();
        assert.deepEqual(await pending, { id: 'uploaded' });
        const controller = new AbortController();
        const cancelled = uploadFile('/tasks/task/attachments', { file, uploadId: 'cancel-id', signal: controller.signal });
        controller.abort();
        await assert.rejects(cancelled, /cancelled/);
        signIn();
        const expired = uploadFile('/tasks/task/attachments', { file, uploadId: 'expire-id' });
        const rejected = TestXHR.instances.at(-1);
        rejected.status = 401;
        rejected.responseText = JSON.stringify({ message: 'Session expired' });
        rejected.onload();
        await assert.rejects(expired, /Session expired/);
        assert.equal(store.getState().auth.user, null);
        assert.deepEqual(store.getState().workspace.attachments, {});
    }
    finally {
        globalThis.XMLHttpRequest = original;
    }
});
