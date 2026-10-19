import { useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { ArrowDown, ArrowUp, CheckSquare, Pencil, RefreshCw, Trash2 } from 'lucide-react';
import { loadWorkspace } from '../../app/store';
import { deleteChecklistItem, loadTaskChecklist, reorderChecklist, saveChecklistItem } from './checklistState';
import { blankChecklistEditor as blankEditor, finishChecklistReload } from './checklistEditor';
import TaskPanelHeading from './TaskPanelHeading';

export function ChecklistProgress({ summary, compact = false }) {
    if (!summary || (compact && summary.total === 0)) {
        return null;
    }
    return (
        <div className={compact ? 'checklist-progress compact' : 'checklist-progress'}>
            <CheckSquare size={14} aria-hidden="true" />
            <span>{summary.completed}/{summary.total} {compact ? 'complete' : 'items complete'}</span>
            <progress max={Math.max(1, summary.total)} value={summary.completed}
                aria-label={`Checklist: ${summary.completed} of ${summary.total} items complete`} />
        </div>
    );
}

export default function TaskChecklist({ taskId, onEditingChange, onHistoryChange }) {
    const dispatch = useDispatch();
    const checklist = useSelector((state) => state.workspace.checklists[taskId]);
    const [editor, setEditor] = useState(blankEditor);
    const [busy, setBusy] = useState(false);
    const [failure, setFailure] = useState(null);
    const [message, setMessage] = useState('');
    const [confirmation, setConfirmation] = useState(null);
    const confirmRef = useRef(null);
    const inputRef = useRef(null);
    const mounted = useRef(true);
    const dirty = editor.title !== editor.originalTitle;
    const error = failure || checklist?.error;
    const unavailable = [401, 403, 404].includes(checklist?.error?.status);
    const locked = busy || dirty || editor.id !== null;

    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
            onEditingChange({ dirty: false, saving: false });
        };
    }, [onEditingChange]);

    useEffect(() => {
        onEditingChange({ dirty, saving: busy });
    }, [dirty, busy, onEditingChange]);

    useEffect(() => {
        if (!checklist || (checklist.stale && !dirty && !busy && !checklist.error && checklist.status !== 'loading')) {
            dispatch(loadTaskChecklist({ taskId }));
        }
    }, [checklist, dirty, busy, dispatch, taskId]);

    useEffect(() => {
        if (unavailable) {
            setEditor(blankEditor());
            setConfirmation(null);
            setFailure(null);
        }
    }, [unavailable]);

    useEffect(() => {
        function refresh() {
            if (!dirty && !busy && !editor.id && document.visibilityState === 'visible') {
                dispatch(loadTaskChecklist({ taskId }));
            }
        }
        const timer = window.setInterval(refresh, 60000);
        window.addEventListener('focus', refresh);
        return () => {
            window.clearInterval(timer);
            window.removeEventListener('focus', refresh);
        };
    }, [dispatch, taskId, dirty, busy, editor.id]);

    useEffect(() => {
        if (confirmation) {
            confirmRef.current?.showModal();
        }
    }, [confirmation]);

    async function reload() {
        const started = editor;
        setFailure(null);
        setMessage('');
        try {
            await dispatch(loadTaskChecklist({ taskId })).unwrap();
            if (mounted.current) {
                setEditor((current) => finishChecklistReload(current, started));
            }
        }
        catch (error) {
            if (mounted.current) {
                setFailure(error);
            }
        }
    }

    async function mutate(action, successMessage, clearEditor = false, refresh = false) {
        setBusy(true);
        setFailure(null);
        setMessage('');
        try {
            await dispatch(action).unwrap();
            if (!mounted.current) {
                return;
            }
            if (clearEditor) {
                setEditor(blankEditor());
            }
            setMessage(successMessage);
            onHistoryChange();
            dispatch(loadWorkspace());
            if (refresh) {
                try {
                    await dispatch(loadTaskChecklist({ taskId })).unwrap();
                }
                catch (error) {
                    if (mounted.current) {
                        setFailure({ ...error, message: `The item was removed, but the checklist could not refresh: ${error.message}` });
                    }
                }
            }
        }
        catch (error) {
            if (mounted.current) {
                setFailure(error);
            }
        }
        finally {
            if (mounted.current) {
                setBusy(false);
            }
        }
    }

    function submit(event) {
        event.preventDefault();
        const values = editor.id ? { title: editor.title, version: editor.version } :
            { title: editor.title, collectionVersion: checklist.version };
        mutate(saveChecklistItem({ taskId, id: editor.id, values }), editor.id ? 'Checklist item updated.' : 'Checklist item added.', true);
    }

    function move(index, offset) {
        const itemIds = checklist.items.map((item) => item.id);
        [itemIds[index], itemIds[index + offset]] = [itemIds[index + offset], itemIds[index]];
        mutate(reorderChecklist({ taskId, itemIds, collectionVersion: checklist.version }), 'Checklist reordered.');
    }

    function closeConfirmation() {
        confirmRef.current?.close();
        setConfirmation(null);
    }

    function confirm() {
        const action = confirmation;
        closeConfirmation();
        if (action.kind === 'delete') {
            mutate(deleteChecklistItem({ taskId, id: action.item.id, version: action.item.version }), 'Checklist item removed.', false, true);
        }
        else if (action.kind === 'reload') {
            reload();
        }
        else {
            setEditor(blankEditor());
        }
    }

    return (
        <section className="panel task-checklist" aria-labelledby="task-checklist-heading" aria-busy={busy}>
            <div className="panel-heading">
                <TaskPanelHeading id="task-checklist-heading" icon={CheckSquare} title="Checklist">Track the progress of this task.</TaskPanelHeading>
                <button type="button" className="text-button" disabled={busy || checklist?.status === 'loading'}
                    aria-label="Reload checklist" title="Reload checklist"
                    onClick={() => dirty ? setConfirmation({ kind: 'reload' }) : reload()}>
                    <RefreshCw size={15} />
                </button>
            </div>
            {error && <div className="error" role="alert">{error.message}</div>}
            {message && <p className="hint" role="status">{message}</p>}
            {!checklist?.hasLoaded && !error && <p role="status">Loading checklist…</p>}
            {checklist?.hasLoaded && !unavailable && (
                <>
                    <ChecklistProgress summary={checklist.summary} />
                    {!checklist.items.length && <p className="muted checklist-empty">No checklist items yet.</p>}
                    <ul className="checklist-items">
                        {checklist.items.map((item, index) => (
                            <li key={item.id} className={item.completed ? 'checklist-item completed' : 'checklist-item'}>
                                <label className="checklist-item-label">
                                    <input type="checkbox" checked={item.completed} disabled={!checklist.canComplete || locked}
                                        onChange={(event) => mutate(saveChecklistItem({ taskId, id: item.id,
                                            values: { completed: event.target.checked, version: item.version } }),
                                        event.target.checked ? 'Checklist item completed.' : 'Checklist item reopened.')} />
                                    <span>{item.title}</span>
                                </label>
                                {checklist.canManage && <div className="checklist-item-actions">
                                    <button type="button" className="button" disabled={locked || index === 0}
                                        aria-label={`Move ${item.title} up`} onClick={() => move(index, -1)}><ArrowUp size={14} /></button>
                                    <button type="button" className="button" disabled={locked || index === checklist.items.length - 1}
                                        aria-label={`Move ${item.title} down`} onClick={() => move(index, 1)}><ArrowDown size={14} /></button>
                                    <button type="button" className="button" disabled={locked} aria-label={`Edit ${item.title}`}
                                        onClick={() => {
                                            setEditor({ id: item.id, title: item.title, originalTitle: item.title, version: item.version });
                                            setFailure(null);
                                            inputRef.current?.focus();
                                        }}><Pencil size={14} /></button>
                                    <button type="button" className="button" disabled={locked} aria-label={`Delete ${item.title}`}
                                        onClick={() => setConfirmation({ kind: 'delete', item })}><Trash2 size={14} /></button>
                                </div>}
                            </li>
                        ))}
                    </ul>
                    {checklist.canManage && <form className="checklist-editor" onSubmit={submit}>
                        <label className="field">
                            <span>{editor.id ? 'Edit checklist item' : 'New checklist item'}</span>
                            <input ref={inputRef} value={editor.title} maxLength={200} required disabled={busy}
                                placeholder="Add a new checklist item…"
                                onChange={(event) => setEditor((current) => ({ ...current, title: event.target.value }))} />
                        </label>
                        <div className="checklist-editor-actions">
                            <button type="submit" className="button primary"
                                disabled={busy || !editor.title.trim() || (!editor.id && checklist.items.length >= 200)}>
                                {editor.id ? 'Save item' : 'Add item'}
                            </button>
                            {(editor.id || dirty) && <button type="button" className="button" disabled={busy}
                                onClick={() => dirty ? setConfirmation({ kind: 'discard' }) : setEditor(blankEditor())}>Cancel</button>}
                        </div>
                        {checklist.items.length >= 200 && <p className="hint">This checklist has reached its 200-item limit.</p>}
                    </form>}
                    {!checklist.canManage && <p className="hint">You can complete or reopen items. Administrators manage this checklist.</p>}
                </>
            )}
            {confirmation && <dialog ref={confirmRef} className="project-dialog" aria-labelledby="checklist-confirm-title"
                onCancel={(event) => {
                    event.preventDefault();
                    closeConfirmation();
                }}>
                <div className="drawer-body">
                    <h2 id="checklist-confirm-title">{confirmation.kind === 'delete' ? 'Remove checklist item?' : 'Discard checklist draft?'}</h2>
                    <p>{confirmation.kind === 'delete' ? confirmation.item.title : 'Your unsaved checklist text will be discarded.'}</p>
                </div>
                <div className="drawer-footer">
                    <button type="button" className="button" autoFocus onClick={closeConfirmation}>Keep editing</button>
                    <button type="button" className="button primary" onClick={confirm}>
                        {confirmation.kind === 'delete' ? 'Remove item' : confirmation.kind === 'reload' ? 'Discard and reload' : 'Discard draft'}
                    </button>
                </div>
            </dialog>}
        </section>
    );
}
