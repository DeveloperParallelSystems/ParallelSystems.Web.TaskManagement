import { useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector, useStore } from 'react-redux';
import { Download, Eye, FileText, Paperclip, RefreshCw, Trash2, Upload, X } from 'lucide-react';
import { request, uploadFile } from '../../app/api';
import { invalidateTaskDetails } from '../../app/store';
import { attachmentAccept, attachmentError, attachmentSize } from './attachmentValidation';
import { createAttachmentUploadId } from './attachmentUploadId';
import { loadTaskAttachments, removeTaskAttachment } from './attachmentState';
import { attachmentPreviewType } from './attachmentPreview.js';
import TaskAttachmentPreview from './TaskAttachmentPreview.jsx';

export default function TaskAttachments({ taskId, onEditingChange, onHistoryChange }) {
    const dispatch = useDispatch();
    const reduxStore = useStore();
    const userId = useSelector((state) => state.auth.user?.userId);
    const attachments = useSelector((state) => state.workspace.attachments[taskId]);
    const [queue, setQueue] = useState([]);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    const [message, setMessage] = useState('');
    const [removing, setRemoving] = useState(null);
    const [dragOver, setDragOver] = useState(false);
    const [downloading, setDownloading] = useState(null);
    const [previewId, setPreviewId] = useState(null);
    const inputRef = useRef(null);
    const dialogRef = useRef(null);
    const controllers = useRef(new Set());
    const alive = useRef(true);
    const stop = useRef(false);
    const dirty = queue.some((item) => ['queued', 'failed', 'cancelled'].includes(item.status));

    function sessionIsCurrent() {
        return alive.current && reduxStore.getState().auth.user?.userId === userId;
    }

    useEffect(() => {
        alive.current = true;
        return () => {
            alive.current = false;
            stop.current = true;
            for (const controller of controllers.current) {
                controller.abort();
            }
            controllers.current.clear();
            onEditingChange({ dirty: false, saving: false });
        };
    }, [onEditingChange]);

    useEffect(() => {
        onEditingChange({ dirty, saving: busy });
    }, [dirty, busy, onEditingChange]);

    useEffect(() => {
        if (!attachments) {
            dispatch(loadTaskAttachments({ taskId }));
        }
    }, [attachments, dispatch, taskId]);

    useEffect(() => {
        if (previewId && (!attachments?.hasLoaded || !attachments.items.some((item) => item.id === previewId))) {
            setPreviewId(null);
        }
    }, [attachments, previewId]);

    useEffect(() => {
        if (removing) {
            dialogRef.current?.showModal();
        }
    }, [removing]);

    function update(id, values) {
        if (sessionIsCurrent()) {
            setQueue((current) => current.map((item) => item.id === id ? { ...item, ...values } : item));
        }
    }

    function choose(files) {
        if (busy) {
            return;
        }
        const selected = Array.from(files).map((file) => {
            const invalid = attachmentError(file);
            return { id: createAttachmentUploadId(), file, status: invalid ? 'invalid' : 'queued', error: invalid, progress: 0 };
        });
        setQueue((current) => [...current, ...selected]);
        setError(null);
        setMessage('');
    }

    async function upload(items) {
        if (busy) {
            return;
        }
        setBusy(true);
        setError(null);
        stop.current = false;
        let saved = 0;
        for (const item of items) {
            if (stop.current || !sessionIsCurrent()) {
                break;
            }
            const controller = new AbortController();
            controllers.current.add(controller);
            update(item.id, { status: 'uploading', progress: 0, error: null });
            try {
                await uploadFile(`/tasks/${taskId}/attachments`, {
                    file: item.file, uploadId: item.id, signal: controller.signal,
                    onProgress: (progress) => update(item.id, { progress }),
                });
                if (!sessionIsCurrent()) {
                    break;
                }
                update(item.id, { status: 'saved', progress: 100 });
                saved++;
            }
            catch (failure) {
                if (!sessionIsCurrent()) {
                    break;
                }
                update(item.id, { status: controller.signal.aborted ? 'cancelled' : 'failed', error: failure.message });
                if ([401, 403, 404].includes(failure.status)) {
                    setError(failure.message);
                    setQueue([]);
                    stop.current = true;
                }
            }
            finally {
                controllers.current.delete(controller);
            }
        }
        if (sessionIsCurrent()) {
            setBusy(false);
            setMessage(saved ? `${saved} file${saved === 1 ? '' : 's'} uploaded.` : 'No new files uploaded.');
            dispatch(loadTaskAttachments({ taskId }));
            if (saved) {
                dispatch(invalidateTaskDetails());
                onHistoryChange();
            }
        }
    }

    function cancelUploads() {
        stop.current = true;
        for (const controller of controllers.current) {
            controller.abort();
        }
    }

    function cancelRemove() {
        dialogRef.current?.close();
        setRemoving(null);
    }

    async function remove() {
        const item = removing;
        cancelRemove();
        setBusy(true);
        setError(null);
        const result = await dispatch(removeTaskAttachment({ taskId, id: item.id, version: item.version }));
        if (!sessionIsCurrent()) {
            return;
        }
        setBusy(false);
        if (removeTaskAttachment.fulfilled.match(result)) {
            setMessage(`${item.fileName} removed.`);
            dispatch(invalidateTaskDetails());
            onHistoryChange();
        }
        else {
            setError(result.payload?.message || 'Could not remove attachment.');
            if (result.payload?.status === 409) {
                dispatch(loadTaskAttachments({ taskId }));
            }
        }
    }

    async function download(item) {
        const controller = new AbortController();
        controllers.current.add(controller);
        setDownloading(item.id);
        setError(null);
        try {
            const blob = await request(`/tasks/${taskId}/attachments/${item.id}/content`, {
                responseType: 'blob', signal: controller.signal,
            });
            if (!sessionIsCurrent() || controller.signal.aborted) {
                return;
            }
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement('a');
            anchor.href = url;
            anchor.download = item.fileName;
            anchor.click();
            window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
        catch (failure) {
            if (sessionIsCurrent() && !controller.signal.aborted) {
                setError(failure.message);
                if ([403, 404].includes(failure.status)) {
                    dispatch(loadTaskAttachments({ taskId }));
                }
            }
        }
        finally {
            controllers.current.delete(controller);
            if (sessionIsCurrent()) {
                setDownloading(null);
            }
        }
    }

    const pending = queue.filter((item) => ['queued', 'failed', 'cancelled'].includes(item.status));
    const previewItem = attachments?.hasLoaded && attachments.items.find((item) => item.id === previewId);
    return (
        <section className="panel task-attachments" aria-labelledby="attachments-title" aria-busy={busy}>
            <div className="panel-heading attachment-heading">
                <h2 id="attachments-title"><Paperclip size={18} /> Attachments</h2>
                <div className="attachment-actions">
                    <button type="button" className="button" disabled={busy || attachments?.status === 'loading'}
                        onClick={() => dispatch(loadTaskAttachments({ taskId }))}><RefreshCw size={15} /> Refresh</button>
                    <button type="button" className="button primary" disabled={busy} onClick={() => inputRef.current?.click()}>
                        <Upload size={15} /> Add files
                    </button>
                </div>
            </div>
            <p className="muted">PDF, images (PNG/JPEG), Word, Excel or PowerPoint · up to 10 MB each. Files upload separately from saving the task.</p>
            {error && <div className="error" role="alert">{error}</div>}
            {attachments?.error && <div className="error" role="alert">{attachments.error}</div>}
            {message && <p role="status">{message}</p>}
            <input ref={inputRef} type="file" className="sr-only" aria-label="Choose attachments" accept={attachmentAccept} multiple
                disabled={busy} onChange={(event) => {
                    choose(event.target.files);
                    event.target.value = '';
                }} />
            <div className={`attachment-dropzone${dragOver ? ' is-dragging' : ''}`}
                onDragOver={(event) => {
                    event.preventDefault();
                    setDragOver(!busy);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(event) => {
                    event.preventDefault();
                    setDragOver(false);
                    choose(event.dataTransfer.files);
                }}>
                <Upload size={24} aria-hidden="true" />
                <span>Drag files here, or use Add files.</span>
            </div>
            {queue.length > 0 && (
                <div className="attachment-queue">
                    <h3>Upload queue</h3>
                    <ul className="attachment-list" aria-label="Upload queue">
                        {queue.map((item) => (
                            <li key={item.id} className="attachment-row">
                                <FileText size={20} aria-hidden="true" />
                                <div className="attachment-info">
                                    <strong>{item.file.name}</strong>
                                    <span className="muted">{attachmentSize(item.file.size)} · {item.status === 'uploading' && item.progress === 100 ?
                                        'Finishing upload…' : item.status}</span>
                                    {item.status === 'uploading' && <progress value={item.progress} max="100" aria-label={`Uploading ${item.file.name}`} />}
                                    {item.error && <span className="error-text" role="status">{item.error}</span>}
                                </div>
                                {['failed', 'cancelled'].includes(item.status) && <button type="button" className="text-button" disabled={busy}
                                    onClick={() => upload([item])}>Retry</button>}
                                <button type="button" className="icon-button" disabled={busy} aria-label={`Clear ${item.file.name} from queue`}
                                    onClick={() => setQueue((current) => current.filter((entry) => entry.id !== item.id))}><X size={16} /></button>
                            </li>
                        ))}
                    </ul>
                    <div className="attachment-actions">
                        <button type="button" className="button primary" disabled={busy || !pending.length} onClick={() => upload(pending)}>
                            <Upload size={15} /> Upload files
                        </button>
                        {busy && <button type="button" className="button" onClick={cancelUploads}>Cancel uploads</button>}
                        {!busy && <button type="button" className="button" onClick={() => setQueue([])}>Clear queue</button>}
                    </div>
                </div>
            )}
            <h3>Uploaded files</h3>
            <p className="muted">Preview is available for PDFs and PNG/JPEG images.</p>
            {attachments?.status === 'loading' && <p role="status">Loading attachments…</p>}
            {attachments?.hasLoaded && !attachments.items.length && <p className="muted">No attachments yet.</p>}
            <ul className="attachment-list" aria-label="Uploaded attachments">
                {attachments?.items.map((item) => (
                    <li className="attachment-row" key={item.id}>
                        <FileText size={22} aria-hidden="true" />
                        <div className="attachment-info">
                            <strong>{item.fileName}</strong>
                            <span className="muted">{attachmentSize(item.sizeBytes)} · {item.uploadedByName} · {new Date(item.createdAtUtc).toLocaleString()}</span>
                        </div>
                        <div className="attachment-actions">
                            {attachmentPreviewType(item) && <button type="button" className="button" onClick={() => setPreviewId(item.id)}
                                aria-label={`Preview ${item.fileName}`}><Eye size={15} aria-hidden="true" /> Preview</button>}
                            <button type="button" className="button" disabled={Boolean(downloading)} onClick={() => download(item)}
                                aria-label={`Download ${item.fileName}`}><Download size={15} /> {downloading === item.id ? 'Downloading…' : 'Download'}</button>
                            {item.canDelete && <button type="button" className="icon-button" disabled={busy}
                                aria-label={`Remove ${item.fileName}`} onClick={() => setRemoving(item)}><Trash2 size={16} /></button>}
                        </div>
                    </li>
                ))}
            </ul>
            {previewItem && <TaskAttachmentPreview key={`${taskId}:${previewItem.id}:${previewItem.version}:${userId}`}
                taskId={taskId} attachment={previewItem} downloading={Boolean(downloading)}
                onClose={() => setPreviewId(null)} onDownload={() => download(previewItem)} />}
            {removing && <dialog ref={dialogRef} className="project-dialog" aria-labelledby="remove-attachment-title"
                aria-describedby="remove-attachment-description" onCancel={(event) => {
                    event.preventDefault();
                    cancelRemove();
                }}>
                <div className="drawer-body">
                    <h2 id="remove-attachment-title">Remove attachment?</h2>
                    <p id="remove-attachment-description">Remove {removing.fileName} from this task? A record remains in History.</p>
                </div>
                <div className="drawer-footer">
                    <button type="button" className="button" autoFocus onClick={cancelRemove}>Cancel</button>
                    <button type="button" className="button primary" onClick={remove}>Remove</button>
                </div>
            </dialog>}
        </section>
    );
}
