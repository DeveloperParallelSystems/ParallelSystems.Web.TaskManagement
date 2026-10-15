import { useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useBlocker } from 'react-router-dom';
import { Check, RefreshCw } from 'lucide-react';
import { disciplines } from './workflow';
import { buildSimpleStatusDefinition, simpleStatusLimit } from './simpleStatusWorkflow';
import { createDisciplineWorkflowDraft, disableDisciplineWorkflow, loadDisciplineWorkflows,
    publishDisciplineWorkflowDraft, saveDisciplineWorkflowDraft, validateDisciplineWorkflowDraft,
    workflowDefinitionErrors, workflowDraftIsStale, receiveWorkflowSnapshot, savedWorkflowSnapshot } from './disciplineWorkflows';
import './discipline-workflows.css';
import './discipline-workflow-design.css';

const noEditingChange = () => {};
const suggestedStatuses = [
    { id: 'to-do', name: 'To Do' },
    { id: 'in-progress', name: 'In Progress' },
    { id: 'in-review', name: 'In Review' },
    { id: 'completed', name: 'Completed' },
];

export default function DisciplineWorkflowsPage({ onEditingChange = noEditingChange }) {
    const dispatch = useDispatch();
    const resource = useSelector((state) => state.workspace.disciplineWorkflows);
    const [discipline, setDiscipline] = useState(disciplines[0]);
    const [snapshot, setSnapshot] = useState(() => receiveWorkflowSnapshot(null,
        resource.data?.items.find((item) => item.discipline === disciplines[0])));
    const [dirty, setDirty] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    const [message, setMessage] = useState('');
    const [serverErrors, setServerErrors] = useState(null);
    const confirmRef = useRef(null);
    const busyRef = useRef(false);
    const mounted = useRef(true);
    const latest = resource.data?.items.find((item) => item.discipline === discipline);
    const draft = snapshot?.draft;
    const canManage = Boolean(resource.data?.canManage && resource.data.supported !== false);
    const stale = Boolean(snapshot && latest && workflowDraftIsStale(draft, latest.draft));
    const failure = error || resource.error;
    const structuralErrors = draft ? workflowDefinitionErrors(draft.definition) : [];
    const publishingErrors = draft ? workflowDefinitionErrors(draft.definition, true) : [];
    const conflict = stale || failure?.status === 409;
    const blocked = busy || Boolean(resource.writeId);
    const blocker = useBlocker(({ currentLocation, nextLocation }) =>
        (dirty || busyRef.current) && currentLocation.pathname !== nextLocation.pathname);

    // Capture the initial server draft once. Polls never replace an open editing session.
    useEffect(() => {
        if (!snapshot && latest) {
            setSnapshot((current) => receiveWorkflowSnapshot(current, latest));
        }
    }, [snapshot, latest]);
    useEffect(() => {
        if (resource.status === 'idle') {
            dispatch(loadDisciplineWorkflows());
        }
    }, [dispatch, resource.status]);
    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
        };
    }, []);
    useEffect(() => {
        onEditingChange({ dirty, saving: busy });
    }, [dirty, busy, onEditingChange]);
    useEffect(() => () => onEditingChange({ dirty: false, saving: false }), [onEditingChange]);
    useEffect(() => {
        function beforeUnload(event) {
            if (dirty || busyRef.current) {
                event.preventDefault();
                event.returnValue = '';
            }
        }
        window.addEventListener('beforeunload', beforeUnload);
        return () => window.removeEventListener('beforeunload', beforeUnload);
    }, [dirty]);
    useEffect(() => {
        if (blocker.state === 'blocked') {
            if (!dirty && !busy) {
                blocker.proceed();
            }
            else if (!confirmRef.current?.open) {
                confirmRef.current?.showModal();
            }
        }
    }, [blocker, dirty, busy]);

    function adoptPage(page) {
        setSnapshot(structuredClone(page.items.find((item) => item.discipline === discipline)));
        setDirty(false);
        setServerErrors(null);
    }
    function adoptSavedDraft(result) {
        const next = savedWorkflowSnapshot(snapshot || { discipline, active: null, draft: null }, result);
        setSnapshot(next);
        setDirty(false);
        setServerErrors(null);
    }
    async function run(operation, onSuccess) {
        if (busyRef.current) {
            return;
        }
        busyRef.current = true;
        setBusy(true);
        setError(null);
        setMessage('');
        try {
            const result = await dispatch(operation).unwrap();
            if (mounted.current) {
                onSuccess(result);
            }
        }
        catch (failure) {
            if (mounted.current) {
                setError({ ...failure, message: failure.message || 'The request did not finish. Reload the latest workflow before retrying.' });
            }
        }
        finally {
            busyRef.current = false;
            if (mounted.current) {
                setBusy(false);
            }
        }
    }
    function change(definition) {
        setSnapshot((current) => ({ ...current, draft: { ...current.draft, definition } }));
        setDirty(true);
        setServerErrors(null);
        setMessage('');
    }
    function changeStatuses(statuses) {
        change(buildSimpleStatusDefinition(discipline, statuses));
    }
    function addStatus() {
        const statuses = draft.definition.stages.map(({ id, name }) => ({ id, name }));
        let index = 1;
        while (statuses.some((status) => status.id === `status-${index}`)) {
            index++;
        }
        changeStatuses([...statuses, { id: `status-${index}`, name: '' }]);
    }
    function moveStatus(index, direction) {
        const statuses = draft.definition.stages.map(({ id, name }) => ({ id, name }));
        const next = index + direction;
        [statuses[index], statuses[next]] = [statuses[next], statuses[index]];
        changeStatuses(statuses);
    }
    function chooseDiscipline(next) {
        if (blocked || dirty && !window.confirm('Discard your unsaved workflow changes and switch discipline?')) {
            return;
        }
        setDiscipline(next);
        setSnapshot(structuredClone(resource.data?.items.find((item) => item.discipline === next) || null));
        setDirty(false);
        setError(null);
        setMessage('');
        setServerErrors(null);
    }
    function reload() {
        if (blocked || resource.readId || dirty && !window.confirm('Reload the latest workflow and discard your unsaved changes?')) {
            return;
        }
        run(loadDisciplineWorkflows(), (page) => {
            adoptPage(page);
            setMessage('Latest workflow loaded.');
        });
    }
    function save(event) {
        event.preventDefault();
        if (!canManage || !draft || draft.definition.mode !== 'Simple' || !dirty || blocked || conflict || structuralErrors.length) {
            return;
        }
        run(saveDisciplineWorkflowDraft(draft), ({ result }) => {
            adoptSavedDraft(result);
            setMessage('Status draft saved. Publish it to apply to new tasks.');
        });
    }
    function publish() {
        if (!canManage || !draft || draft.definition.mode !== 'Simple' || dirty || blocked || conflict || publishingErrors.length) {
            return;
        }
        if (!window.confirm(`Publish this ${discipline} workflow for new tasks? Existing tasks keep their current workflow version.`)) {
            return;
        }
        run(publishDisciplineWorkflowDraft(draft), ({ page }) => {
            adoptPage(page);
            setMessage('Workflow published for new tasks. Existing tasks keep their current version.');
        });
    }
    function disable() {
        if (!canManage || !latest?.active || blocked || dirty) {
            return;
        }
        if (!window.confirm(`Use Legacy v1 for new ${discipline} tasks? Tasks already using a published version continue using it.`)) {
            return;
        }
        run(disableDisciplineWorkflow({ discipline, expectedActiveVersionId: latest.active.id }), () => {
            setMessage('New tasks will use Legacy v1. Existing tasks keep their current workflow.');
        });
    }

    return <section className="discipline-workflows-management" aria-labelledby="discipline-workflows-heading">
        <header className="workflow-page-heading">
            <div><p className="workflow-eyebrow">Administration</p>
                <h1 id="discipline-workflows-heading">Discipline workflows</h1>
                <p>Choose the statuses shown for new tasks in each discipline. Authorized participants can move a task to any configured status. Existing tasks keep their workflow version, including Legacy v1.</p>
            </div>
            <div className="workflow-discipline-switch" role="group" aria-label="Discipline">
                {disciplines.map((item) => <button type="button" key={item} disabled={blocked}
                    aria-pressed={discipline === item} onClick={() => {
                        if (discipline !== item) {
                            chooseDiscipline(item);
                        }
                    }}>{item}</button>)}
            </div>
        </header>
        {failure && <p className="error" role="alert">{failure.message}</p>}
        {conflict && <p className="error" role="alert">This workflow changed on the server. Your open draft is preserved. Reload the latest workflow before saving or publishing.</p>}
        {message && <p role="status">{message}</p>}
        {resource.data?.supported === false && <p role="status">This server uses Legacy v1. Update the server to configure discipline workflows.</p>}
        {latest && <div className="discipline-active-version">
            <span className="workflow-active-icon"><Check size={18} aria-hidden="true" /></span>
            <div><p className="workflow-eyebrow">New {discipline} tasks use</p>
                <strong>{latest.active ? `${latest.active.definition.name} · Version ${latest.active.versionNumber}` : 'Legacy v1'}</strong></div>
            {latest.active && <button type="button" className="button" disabled={!canManage || blocked || dirty}
                onClick={disable}>Disable for new tasks</button>}
        </div>}
        {latest && <p className="workflow-active-help">Disabling returns new {discipline} tasks to Legacy v1. Tasks already on a published version keep using it. Disable is unavailable while the draft has unsaved changes.</p>}
        {!resource.data && <p>{resource.status === 'loading' ? 'Loading workflows…' : 'Workflows are unavailable. Reload to try again.'}</p>}
        <div className="discipline-workflow-actions">
            <button type="button" className="button" disabled={blocked || Boolean(resource.readId)} onClick={reload}><RefreshCw size={14} aria-hidden="true" />Reload latest workflow</button>
            {!draft && <button type="button" className="button primary" disabled={!canManage || blocked || conflict}
                onClick={() => run(createDisciplineWorkflowDraft({ discipline }), ({ result }) => {
                    const next = savedWorkflowSnapshot(snapshot || { discipline, active: null, draft: null }, result);
                    next.draft.definition = buildSimpleStatusDefinition(discipline, suggestedStatuses);
                    setSnapshot(next);
                    setDirty(true);
                    setMessage('Draft created. Edit and save its statuses, then publish.');
                })}>Create draft</button>}
        </div>
        {draft && canManage && <form className="workflow-designer-layout" onSubmit={save} aria-busy={blocked}>
            <section className="workflow-surface simple-status-editor">
                <div className="discipline-draft-heading">
                    <h2>{discipline} draft · Revision {draft.version}</h2>
                    <span className={`workflow-draft-badge ${dirty ? 'unsaved' : ''}`} role="status">{dirty ? 'Unsaved changes' : 'Saved draft'}</span>
                </div>
                {draft.definition.mode !== 'Simple' ? <>
                    <p>This draft uses the previous detailed workflow setup. Replace its draft settings with a simple status list to edit it here. Published tasks keep their current version.</p>
                    <button type="button" className="button primary" disabled={blocked || conflict}
                        onClick={() => changeStatuses(suggestedStatuses)}>Use simple statuses</button>
                </> : <>
                    <p>Set the names and order of your statuses. The first is used for new tasks; the last is the completion status. Tasks may move between any statuses, including out of the last one.</p>
                    <ol className="simple-status-list">
                        {draft.definition.stages.map((stage, index) => <li key={stage.id}>
                            <span className="simple-status-order">{index + 1}</span>
                            <label htmlFor={`workflow-status-${stage.id}`}>Status {index + 1}</label>
                            <input id={`workflow-status-${stage.id}`} value={stage.name} maxLength={80} disabled={blocked || conflict}
                                onChange={(event) => changeStatuses(draft.definition.stages.map((item, itemIndex) =>
                                    ({ id: item.id, name: itemIndex === index ? event.target.value : item.name })))} />
                            <span className="simple-status-kind">{index === 0 ? 'Start' : index === draft.definition.stages.length - 1 ? 'Completion' : 'Status'}</span>
                            <div className="simple-status-controls">
                                <button type="button" className="button" aria-label={`Move ${stage.name || `status ${index + 1}`} up`}
                                    disabled={blocked || conflict || index === 0} onClick={() => moveStatus(index, -1)}>↑</button>
                                <button type="button" className="button" aria-label={`Move ${stage.name || `status ${index + 1}`} down`}
                                    disabled={blocked || conflict || index === draft.definition.stages.length - 1} onClick={() => moveStatus(index, 1)}>↓</button>
                                <button type="button" className="button" aria-label={`Remove ${stage.name || `status ${index + 1}`}`}
                                    disabled={blocked || conflict || draft.definition.stages.length <= 2}
                                    onClick={() => changeStatuses(draft.definition.stages.filter((_, itemIndex) => itemIndex !== index).map(({ id, name }) => ({ id, name })))}>Remove</button>
                            </div>
                        </li>)}
                    </ol>
                    <button type="button" className="button" disabled={blocked || conflict || draft.definition.stages.length >= simpleStatusLimit}
                        onClick={addStatus}>Add status</button>
                    <p className="hint">Up to {simpleStatusLimit} statuses. Status names must be unique. Only existing task participants and administrators can make moves.</p>
                </>}
            </section>
            <aside className="workflow-publish-rail" aria-label="Workflow publishing">
                <section className="workflow-surface">
                    <h2>Publish statuses</h2>
                    <p>Save the draft, then publish it for new {discipline} tasks. Existing tasks keep their current workflow.</p>
                    <div className="discipline-workflow-actions discipline-save-actions">
                        <button className="button primary" disabled={!dirty || blocked || conflict || structuralErrors.length > 0 || draft.definition.mode !== 'Simple'}>Save draft</button>
                        <button type="button" className="button" disabled={dirty || blocked || conflict}
                            onClick={() => run(validateDisciplineWorkflowDraft(draft), (result) => setServerErrors(result.errors))}>Validate saved draft</button>
                        <button type="button" className="button primary" disabled={draft.definition.mode !== 'Simple' || dirty || blocked || conflict || publishingErrors.length > 0}
                            onClick={publish}>Publish for new tasks</button>
                    </div>
                </section>
                <section className="workflow-surface workflow-validation-panel">
                    <h2>Validation</h2>
                    {structuralErrors.length > 0 && <div className="error" role="alert"><strong>Before saving</strong>
                        <ul>{structuralErrors.map((item) => <li key={item}>{item}</li>)}</ul>
                    </div>}
                    {publishingErrors.length > 0 && <details className="discipline-validation" open>
                        <summary>{publishingErrors.length} item(s) to resolve before publishing</summary>
                        <ul>{publishingErrors.map((item) => <li key={item}>{item}</li>)}</ul>
                    </details>}
                    {!publishingErrors.length && <p className="workflow-validation-success">Local publication checks pass. Server rules are checked when validating or publishing.</p>}
                    {serverErrors && <div role={serverErrors.length ? 'alert' : 'status'} className={serverErrors.length ? 'error' : ''}>
                        {serverErrors.length ? <><strong>Server validation</strong><ul>{serverErrors.map((item, index) => <li key={index}>{item}</li>)}</ul></>
                            : 'Server validation passed for this saved draft.'}
                    </div>}
                </section>
                <section className="workflow-surface workflow-versions">
                    <h2>Versions</h2>
                    <p><strong>Draft · Revision {draft.version}</strong><span>Editing now</span></p>
                    {latest?.active && <p><strong>{latest.active.definition.name} · v{latest.active.versionNumber}</strong><span>Active for new tasks</span></p>}
                    <p><strong>Legacy v1</strong><span>Original status rules · Fallback</span></p>
                    <small>Published versions are immutable. Editing starts a new draft.</small>
                </section>
            </aside>
        </form>}
        {!draft && latest?.active && <section className="workflow-surface"><h2>Active statuses</h2>
            <p>{latest.active.definition.stages.map((stage) => stage.name).join(' → ')}</p></section>}
        {blocker.state === 'blocked' && <dialog ref={confirmRef} className="project-dialog" aria-labelledby="discard-workflow-title"
            onCancel={(event) => {
                event.preventDefault();
                blocker.reset();
            }}>
            <div className="drawer-body">
                <h2 id="discard-workflow-title">{busy ? 'Updating workflow…' : 'Discard unsaved workflow changes?'}</h2>
                <p>{busy ? 'Wait for the request to finish before leaving.' : 'Your workflow changes have not been saved.'}</p>
            </div>
            <div className="drawer-footer">
                <button type="button" className="button" autoFocus onClick={() => blocker.reset()}>Keep editing</button>
                <button type="button" className="button primary" disabled={busy} onClick={() => blocker.proceed()}>Discard changes</button>
            </div>
        </dialog>}
    </section>;
}
