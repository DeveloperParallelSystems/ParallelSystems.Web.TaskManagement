import { useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector, useStore } from 'react-redux';
import { Download, RefreshCw, X } from 'lucide-react';
import { loadAttachmentPreview } from './attachmentPreview.js';
import { loadTaskAttachments } from './attachmentState.js';

export function AttachmentPreviewContent({ attachment, resource, onError }) {
    if (resource.type.startsWith('image/')) {
        return <img className="attachment-preview-image" src={resource.url} alt={attachment.fileName} onError={onError} />;
    }
    return <object className="attachment-preview-pdf" data={resource.url} type="application/pdf"
        aria-label={`Preview of ${attachment.fileName}`}>
        <p className="attachment-preview-fallback">Your browser cannot display this PDF here. Use Download to open it.</p>
    </object>;
}

export default function TaskAttachmentPreview({ taskId, attachment, onClose, onDownload, downloading }) {
    const dispatch = useDispatch();
    const reduxStore = useStore();
    const userId = useSelector((state) => state.auth.user?.userId);
    const dialogRef = useRef(null);
    const [resource, setResource] = useState(null);
    const [error, setError] = useState(null);
    const [reload, setReload] = useState(0);

    useEffect(() => {
        const dialog = dialogRef.current;
        dialog.showModal();
        return () => dialog.close();
    }, []);

    useEffect(() => {
        const controller = new AbortController();
        let objectUrl = null;
        setResource(null);
        setError(null);
        loadAttachmentPreview(taskId, attachment, controller.signal)
            .then((preview) => {
                if (controller.signal.aborted || reduxStore.getState().auth.user?.userId !== userId) {
                    URL.revokeObjectURL(preview.url);
                    return;
                }
                objectUrl = preview.url;
                setResource(preview);
            })
            .catch((failure) => {
                if (controller.signal.aborted || reduxStore.getState().auth.user?.userId !== userId) {
                    return;
                }
                setError(failure.message || 'Could not load this preview.');
                if ([403, 404].includes(failure.status)) {
                    dispatch(loadTaskAttachments({ taskId }));
                }
            });
        return () => {
            controller.abort();
            if (objectUrl) {
                URL.revokeObjectURL(objectUrl);
            }
        };
    }, [attachment.id, attachment.version, taskId, userId, reload, dispatch, reduxStore]);

    return <dialog ref={dialogRef} className="project-dialog attachment-preview-dialog"
        aria-labelledby="attachment-preview-title" onCancel={(event) => {
            event.preventDefault();
            onClose();
        }}>
        <div className="attachment-preview-heading">
            <h2 id="attachment-preview-title">{attachment.fileName}</h2>
            <button type="button" className="icon-button" autoFocus aria-label="Close attachment preview" onClick={onClose}>
                <X size={20} aria-hidden="true" />
            </button>
        </div>
        <div className="attachment-preview-body" aria-busy={!resource && !error}>
            {error && <div className="attachment-preview-fallback">
                <p className="error" role="alert">{error}</p>
                <button type="button" className="button" onClick={() => setReload((current) => current + 1)}>
                    <RefreshCw size={15} aria-hidden="true" /> Retry preview
                </button>
            </div>}
            {!error && resource && <AttachmentPreviewContent attachment={attachment} resource={resource}
                onError={() => setError('This image could not be displayed. Try downloading the file instead.')} />}
            {!error && !resource && <p role="status">Loading preview…</p>}
        </div>
        <div className="attachment-preview-footer">
            <p className="muted">If the preview is unavailable, download the file to open it.</p>
            <button type="button" className="button" disabled={Boolean(downloading)} onClick={onDownload}>
                <Download size={15} aria-hidden="true" /> {downloading ? 'Downloading…' : 'Download'}
            </button>
        </div>
    </dialog>;
}
