import { useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useBlocker } from 'react-router-dom';
import { Check, Info, RefreshCw, Save } from 'lucide-react';
import WorkflowPresentationEditor from './WorkflowPresentationEditor';
import WorkflowPresentationPreview from './WorkflowPresentationPreview';
import { defaultPresentationGroups, emptyPresentation, loadPresentation, presentationError, savePresentation } from './workflowPresentation';
import { loadProjectPresentation, saveProjectPresentation, useDefaultPresentation, useProjectPresentation } from './projectBoardPresentation';
import './board-presentation-design.css';

export default function WorkflowPresentationPage({ onEditingChange, projectId = null, projectName = '', clientName = '' }) {
    const dispatch = useDispatch();
    const resource = useSelector((state) => projectId
        ? state.workspace.projectPresentations?.[projectId] || emptyPresentation
        : state.workspace.workflowPresentation);
    useProjectPresentation(projectId);
    const statusSettings = useSelector((state) => state.workspace.statusSettings?.data);
    const workspaceTasks = useSelector((state) => state.workspace.tasks);
    const tasks = projectId ? workspaceTasks.filter((task) => task.projectId === projectId) : workspaceTasks;
    const [draft, setDraft] = useState(resource.data);
    const [dirty, setDirty] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    const [message, setMessage] = useState('');
    const [customizing, setCustomizing] = useState(false);
    const unsaved = dirty;
    const pending = busy;
    const confirmRef = useRef(null);
    const blocker = useBlocker(({ currentLocation, nextLocation }) =>
        (unsaved || pending) && currentLocation.pathname !== nextLocation.pathname);
    const canManage = resource.data?.canManage && resource.data.supported && Boolean(draft?.catalogVersion);
    const canEdit = canManage && (!projectId || !draft?.usesDefault || customizing);
    const stale = Boolean(draft && resource.data && (draft.version !== resource.data.version || draft.catalogVersion !== resource.data.catalogVersion ||
        draft.projectVersion !== resource.data.projectVersion ||
        Boolean(statusSettings && statusSettings.version > draft.catalogVersion)));
    const validation = draft ? presentationError(draft.groups, draft.catalog) : '';
    const failure = error || resource.error;
    const saveLabel = projectId ? 'Save project layout' : 'Save default layout';

    useEffect(() => {
        if (!projectId) {
            dispatch(loadPresentation());
        }
    }, [dispatch, projectId]);
    useEffect(() => {
        if (!dirty && !busy) {
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
            const result = await dispatch(projectId ? loadProjectPresentation(projectId) : loadPresentation()).unwrap();
            setDraft(result);
            setDirty(false);
            setCustomizing(false);
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
        if (!canEdit || !dirty || pending || stale || validation) {
            return;
        }
        setBusy(true);
        setError(null);
        try {
            const input = { ...draft, projectId };
            const result = await dispatch(projectId ? saveProjectPresentation(input) : savePresentation(input)).unwrap();
            setDraft(result);
            setDirty(false);
            setCustomizing(false);
            setMessage(projectId ? 'Project layout saved.' : 'Default layout saved for all projects using the default.');
        }
        catch (failure) {
            setError(failure);
        }
        finally {
            setBusy(false);
        }
    }

    async function resetToDefault() {
        if (!canManage || pending || stale || !window.confirm('Replace this project’s custom layout with the shared default? Unsaved changes will be discarded. Future default changes will apply to this project.')) {
            return;
        }
        setBusy(true);
        setError(null);
        try {
            const result = await dispatch(useDefaultPresentation({ ...draft, projectId })).unwrap();
            setDraft(result);
            setDirty(false);
            setCustomizing(false);
            setMessage('This project now uses the shared default layout.');
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
                <p className="presentation-eyebrow">Administration · {projectId ? 'Project layout' : 'Default layout'}</p>
                <h1 id="presentation-heading">Board presentation</h1>
                {projectId && <p><strong>{clientName} / {projectName}</strong></p>}
                <p className="hint">{projectId ? 'Customize columns for this project, or follow the shared default.' : 'Changes apply to every project using the default, General tasks, and the dashboard. Custom project layouts are unaffected.'} Task statuses and workflow rules stay unchanged.</p>
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
                    {projectId && draft && <span className="presentation-draft-badge">{draft.usesDefault ? 'Using default' : 'Custom layout'}</span>}
                    <span className={`presentation-draft-badge ${dirty ? 'unsaved' : ''}`}>
                        {busy ? 'Please wait…' : dirty ? 'Unsaved draft' : draft?.supported === false ? 'Default layout' : draft ? 'Saved layout' : 'Loading layout'}
                    </span>
                    {draft && !validation && <span className="presentation-valid"><Check size={16} aria-hidden="true" />
                        All {draft.catalog?.length || 0} catalog statuses placed exactly once · {draft.groups.length} columns
                    </span>}
                </div>
                <div className="presentation-toolbar-actions">
                    {projectId && draft?.usesDefault && !customizing && <button type="button" className="button primary"
                        disabled={pending || !canManage || stale} onClick={() => {
                            setCustomizing(true);
                            setDirty(true);
                            setMessage('Changes will apply to this project only after saving.');
                        }}>Customize this project</button>}
                    {projectId && draft && !draft.usesDefault && <button type="button" className="button"
                        disabled={pending || !canManage || stale} onClick={resetToDefault}>Use default layout</button>}
                    {!projectId && <button type="button" className="button" disabled={pending || !canEdit}
                        onClick={() => {
                            if (!dirty || window.confirm('Replace your unsaved layout with the default columns?')) {
                                const defaults = structuredClone(defaultPresentationGroups).map((group) => ({ ...group, statuses: [] }));
                                for (const item of draft.catalog || []) {
                                    const target = defaultPresentationGroups.findIndex((group) => group.statuses.includes(item.boardStatus || item.code));
                                    defaults[target < 0 ? 1 : target].statuses.push(item.code);
                                }
                                change(defaults);
                            }
                        }}>Use default columns</button>}
                    <button type="button" className="button" disabled={!dirty || pending || Boolean(resource.readId) || Boolean(resource.writeId)}
                        onClick={reload}>Discard changes</button>
                    <button className="button primary" disabled={!canEdit || !dirty || pending || stale || Boolean(validation)}>
                        <Save size={16} aria-hidden="true" />{busy ? 'Please wait…' : saveLabel}
                    </button>
                </div>
            </div>
            {validation && <p className="error" role="alert">{validation}</p>}
            {draft ? <>
                <WorkflowPresentationPreview groups={draft.groups} tasks={tasks} catalog={draft.catalog} statusSettings={statusSettings} projectOnly={Boolean(projectId)} />
                <WorkflowPresentationEditor catalog={draft.catalog} groups={draft.groups} onChange={change} disabled={pending || !canEdit || stale} />
            </> : <p>Board presentation has not loaded yet.</p>}
        </form>
        <p className="presentation-guidance"><Info size={18} aria-hidden="true" /><span>Every status from the status catalog must appear in exactly one column. Use up to 13 columns; only empty columns can be removed. Both disciplines use the selected layout. Project customization does not change the dashboard.</span></p>
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
