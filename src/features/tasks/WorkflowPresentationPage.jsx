import { useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useBlocker } from 'react-router-dom';
import { Check, Info, RefreshCw, Save } from 'lucide-react';
import WorkflowPresentationEditor from './WorkflowPresentationEditor';
import WorkflowPresentationPreview from './WorkflowPresentationPreview';
import { defaultPresentationGroups, loadPresentation, presentationError, savePresentation } from './workflowPresentation';
import './board-presentation-design.css';

export default function WorkflowPresentationPage({ onEditingChange }) {
    const dispatch = useDispatch();
    const resource = useSelector((state) => state.workspace.workflowPresentation);
    const statusSettings = useSelector((state) => state.workspace.statusSettings?.data);
    const tasks = useSelector((state) => state.workspace.tasks);
    const [draft, setDraft] = useState(resource.data);
    const [dirty, setDirty] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    const [message, setMessage] = useState('');
    const unsaved = dirty;
    const pending = busy;
    const confirmRef = useRef(null);
    const blocker = useBlocker(({ currentLocation, nextLocation }) =>
        (unsaved || pending) && currentLocation.pathname !== nextLocation.pathname);
    const canManage = resource.data?.canManage && resource.data.supported && Boolean(draft?.catalogVersion);
    const stale = Boolean(draft && resource.data && (draft.version !== resource.data.version || draft.catalogVersion !== resource.data.catalogVersion ||
        Boolean(statusSettings && statusSettings.version > draft.catalogVersion)));
    const validation = draft ? presentationError(draft.groups, draft.catalog) : '';
    const failure = error || resource.error;

    useEffect(() => {
        dispatch(loadPresentation());
    }, [dispatch]);
    useEffect(() => {
        if (!dirty && !busy && resource.data) {
            setDraft(resource.data);
        }
    }, [resource.data, dirty, busy]);
    useEffect(() => {
        onEditingChange({ dirty: unsaved, saving: pending });
    }, [unsaved, pending, onEditingChange]);
    useEffect(() => () => onEditingChange({ dirty: false, saving: false }), [onEditingChange]);
    useEffect(() => {
        function beforeUnload(event) {
            if (unsaved || pending) {
                event.preventDefault();
                event.returnValue = '';
            }
        }
        window.addEventListener('beforeunload', beforeUnload);
        return () => window.removeEventListener('beforeunload', beforeUnload);
    }, [unsaved, pending]);
    useEffect(() => {
        if (blocker.state === 'blocked') {
            if (!unsaved && !pending) {
                blocker.proceed();
            }
            else if (!confirmRef.current?.open) {
                confirmRef.current?.showModal();
            }
        }
    }, [blocker, unsaved, pending]);

    function change(groups) {
        setDraft((current) => ({ ...current, groups }));
        setDirty(true);
        setMessage('');
    }

    async function reload() {
        if (dirty && !window.confirm('Reload board presentation and discard your unsaved changes?')) {
            return;
        }
        setBusy(true);
        setError(null);
        setMessage('');
        try {
            const result = await dispatch(loadPresentation()).unwrap();
            setDraft(result);
            setDirty(false);
        }
        catch (failure) {
            setError({ message: failure.message || 'Could not reload board presentation. Try again.' });
        }
        finally {
            setBusy(false);
        }
    }

    async function save(event) {
        event.preventDefault();
        if (!canManage || !dirty || pending || stale || validation) {
            return;
        }
        setBusy(true);
        setError(null);
        try {
            const result = await dispatch(savePresentation({ version: draft.version, catalogVersion: draft.catalogVersion, catalog: draft.catalog, groups: draft.groups })).unwrap();
            setDraft(result);
            setDirty(false);
            setMessage('Board presentation saved for everyone. Workflow rules and task statuses are unchanged.');
        }
        catch (failure) {
            setError(failure);
        }
        finally {
            setBusy(false);
        }
    }

    return <section className="presentation-management" aria-labelledby="presentation-heading">
        <header className="presentation-page-heading">
            <div>
                <p className="presentation-eyebrow">Administration · Shared board</p>
                <h1 id="presentation-heading">Board presentation</h1>
                <p className="hint">Arrange the shared board columns. Assign available task statuses under Discipline statuses. Moving a status here changes its board grouping without moving tasks.</p>
            </div>
            <div className="presentation-metadata">
                {draft?.supported && <p>Configuration version <strong>{draft.version}</strong></p>}
                <button type="button" className="button" disabled={pending || Boolean(resource.readId) || Boolean(resource.writeId)}
                    onClick={reload}><RefreshCw size={14} aria-hidden="true" />Reload latest configuration</button>
            </div>
        </header>
        {failure && <p className="error" role="alert">{failure.message}</p>}
        {resource.data?.supported === false && <p role="status">This server uses the earlier board layout. Update the server to configure catalog statuses here.</p>}
        {stale && <p className="error" role="alert">Someone changed the board presentation or status catalog. Your draft is preserved. Reload the latest configuration before saving.</p>}
        {message && <p role="status">{message}</p>}
        <form onSubmit={save} aria-busy={busy}>
            <div className="presentation-toolbar">
                <div className="presentation-draft-summary" role="status">
                    <span className={`presentation-draft-badge ${dirty ? 'unsaved' : ''}`}>
                        {busy ? 'Please wait…' : dirty ? 'Unsaved draft' : draft?.supported === false ? 'Default layout' : draft ? 'Saved layout' : 'Loading layout'}
                    </span>
                    {draft && !validation && <span className="presentation-valid"><Check size={16} aria-hidden="true" />
                        All {draft.catalog?.length || 0} catalog statuses placed exactly once · {draft.groups.length} columns
                    </span>}
                </div>
                <div className="presentation-toolbar-actions">
                    <button type="button" className="button" disabled={pending || !canManage}
                        onClick={() => {
                            if (!dirty || window.confirm('Replace your unsaved layout with the default columns?')) {
                                const defaults = structuredClone(defaultPresentationGroups).map((group) => ({ ...group, statuses: [] }));
                                for (const item of draft.catalog || []) {
                                    const target = defaultPresentationGroups.findIndex((group) => group.statuses.includes(item.boardStatus || item.code));
                                    defaults[target < 0 ? 1 : target].statuses.push(item.code);
                                }
                                change(defaults);
                            }
                        }}>Use default columns</button>
                    <button type="button" className="button" disabled={!dirty || pending || Boolean(resource.readId) || Boolean(resource.writeId)}
                        onClick={reload}>Discard changes</button>
                    <button className="button primary" disabled={!canManage || !dirty || pending || stale || Boolean(validation)}>
                        <Save size={16} aria-hidden="true" />{busy ? 'Please wait…' : 'Save board layout'}
                    </button>
                </div>
            </div>
            {validation && <p className="error" role="alert">{validation}</p>}
            {draft ? <>
                <WorkflowPresentationPreview groups={draft.groups} tasks={tasks} catalog={draft.catalog} statusSettings={statusSettings} />
                <WorkflowPresentationEditor catalog={draft.catalog} groups={draft.groups} onChange={change} disabled={pending || !canManage} />
            </> : <p>Board presentation has not loaded yet.</p>}
        </form>
        <p className="presentation-guidance"><Info size={18} aria-hidden="true" /><span>Every status from the status catalog must appear in exactly one column. Use up to 13 columns; only empty columns can be removed. Development and Drafting use these same columns on the board and dashboard.</span></p>
        {blocker.state === 'blocked' && <dialog ref={confirmRef} className="project-dialog"
            aria-labelledby="discard-presentation-title" onCancel={(event) => {
                event.preventDefault();
                blocker.reset();
            }}>
            <div className="drawer-body">
                <h2 id="discard-presentation-title">{pending ? 'Saving board presentation…' : 'Discard unsaved board presentation?'}</h2>
                <p>{pending ? 'Wait for the request to finish before leaving.' : 'Your board changes have not been saved.'}</p>
            </div>
            <div className="drawer-footer">
                <button type="button" className="button" autoFocus onClick={() => blocker.reset()}>Keep editing</button>
                <button type="button" className="button primary" disabled={pending} onClick={() => blocker.proceed()}>Discard changes</button>
            </div>
        </dialog>}
    </section>;
}
