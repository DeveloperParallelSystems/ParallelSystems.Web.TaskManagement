import { useCallback, useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useBlocker } from 'react-router-dom';
import { TaskCard } from './TasksPage';
import TaskColumnContent from './TaskColumnContent';
import ProjectCustomFieldsAdministration from './ProjectCustomFieldsAdministration';
import { columnError, columnLabels, defaultTaskColumns, loadTaskColumns, requiredTaskColumns, saveTaskColumns, useDefaultTaskColumns, useTaskColumnProfiles } from './taskColumns';
import './board-presentation-design.css';
import './task-columns.css';

export default function TaskColumnsAdministration({ onEditingChange }) {
    const { clients = [], projects = [] } = useSelector((state) => state.workspace);
    const [mode, setMode] = useState('default');
    const [clientId, setClientId] = useState('');
    const [projectId, setProjectId] = useState('');
    const [discipline, setDiscipline] = useState('Development');
    const [editing, setEditing] = useState({ dirty: false, saving: false });
    const reportEditing = useCallback((value) => {
        setEditing(value);
        onEditingChange(value);
    }, [onEditingChange]);
    const clientIds = new Set(clients.map((client) => client.id));
    const unassigned = projects.filter((project) => !clientIds.has(project.clientId));
    const available = clientId === 'unassigned' ? unassigned : projects.filter((project) => project.clientId === clientId);
    const project = available.find((item) => item.id === projectId);

    function switchScope(update) {
        if (!editing.saving && (!editing.dirty || window.confirm('Discard unsaved task column changes and switch profiles?'))) {
            update();
        }
    }

    return <>
        <div className="presentation-scope" aria-label="Task column scope">
            <label>Profile<select value={mode} disabled={editing.saving} onChange={(event) => switchScope(() => setMode(event.target.value))}>
                <option value="default">Shared defaults</option><option value="project">Project override</option>
            </select></label>
            <label>Discipline<select value={discipline} disabled={editing.saving} onChange={(event) => switchScope(() => setDiscipline(event.target.value))}>
                {Object.keys(defaultTaskColumns).map((name) => <option key={name}>{name}</option>)}
            </select></label>
            {mode === 'project' && <>
                <label>Client<select value={clientId} disabled={editing.saving} onChange={(event) => switchScope(() => {
                    setClientId(event.target.value);
                    setProjectId('');
                })}>
                    <option value="">Select a client</option>
                    {clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
                    {unassigned.length > 0 && <option value="unassigned">Unassigned projects</option>}
                </select></label>
                <label>Project<select value={project?.id || ''} disabled={!clientId || editing.saving} onChange={(event) => switchScope(() => setProjectId(event.target.value))}>
                    <option value="">Select a project</option>
                    {available.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select></label>
            </>}
        </div>
        {mode === 'default' || project ? <TaskColumnsEditor key={`${mode}:${project?.id}:${discipline}`}
            projectId={mode === 'project' ? project.id : null} projectName={project?.name} discipline={discipline} onEditingChange={reportEditing} />
            : <p className="hint">Select a client and project to view its task columns.</p>}
    </>;
}

export function TaskColumnsEditor({ projectId = null, projectName = '', discipline, onEditingChange }) {
    const dispatch = useDispatch();
    const resource = useTaskColumnProfiles(projectId)[discipline];
    const revision = useSelector((state) => state.workspace.taskColumnsRevision || 0);
    const { tasks = [], people = [] } = useSelector((state) => state.workspace);
    const [draft, setDraft] = useState(resource.data);
    const [dirty, setDirty] = useState(false);
    const [busy, setBusy] = useState(false);
    const [customizing, setCustomizing] = useState(false);
    const [error, setError] = useState(null);
    const [message, setMessage] = useState('');
    const [definitionEditing, setDefinitionEditing] = useState({ dirty: false, saving: false });
    const unsaved = dirty || definitionEditing.dirty;
    const pending = busy || definitionEditing.saving;
    const confirmRef = useRef(null);
    const blocker = useBlocker(({ currentLocation, nextLocation }) => (unsaved || pending) && currentLocation.pathname !== nextLocation.pathname);
    const stale = Boolean(error?.status === 409 || draft && (draft.version < revision || resource.data && draft.version !== resource.data.version));
    const canManage = Boolean(resource.data?.canManage);
    const canEdit = canManage && (!projectId || !draft?.usesDefault || customizing);
    const disabled = pending || definitionEditing.dirty || !canEdit || stale;
    const fieldLabels = columnLabels(draft?.customFields);
    const sample = tasks.find((task) => task.discipline === discipline && (!projectId || task.projectId === projectId)) || {
        id: 'preview', code: 'TASK-123', title: 'Example task', discipline, status: 'To Do', priority: 'Medium', projectName,
    };

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
        const warn = (event) => {
            if (unsaved || pending) {
                event.preventDefault();
                event.returnValue = '';
            }
        };
        window.addEventListener('beforeunload', warn);
        return () => window.removeEventListener('beforeunload', warn);
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

    function change(columns) {
        setDraft((current) => ({ ...current, columns }));
        setDirty(true);
        setMessage('');
    }

    function move(field, direction) {
        const columns = [...draft.columns];
        const index = columns.indexOf(field);
        [columns[index], columns[index + direction]] = [columns[index + direction], columns[index]];
        change(columns);
    }

    async function run(kind) {
        if (pending || definitionEditing.dirty || kind !== 'reload' && (!canManage || stale)) {
            return;
        }
        if (kind === 'reload' && dirty && !window.confirm('Discard unsaved task column changes and reload?')) {
            return;
        }
        if (kind === 'reset' && !window.confirm('Replace this project’s task columns with the shared default? Future default changes will apply.')) {
            return;
        }
        setBusy(true);
        setError(null);
        setMessage('');
        try {
            const input = { ...draft, projectId, discipline };
            const thunk = kind === 'reload' ? loadTaskColumns : kind === 'reset' ? useDefaultTaskColumns : saveTaskColumns;
            const result = await dispatch(thunk(input)).unwrap();
            setDraft(result);
            setDirty(false);
            setCustomizing(false);
            setMessage(kind === 'reload' ? 'Latest task columns loaded.' : kind === 'reset' ? 'This project now uses the shared default.' : 'Task columns saved.');
        }
        catch (failure) {
            setError(failure);
        }
        finally {
            setBusy(false);
        }
    }

    return <section className="presentation-management" aria-labelledby="task-columns-heading">
        <header className="presentation-page-heading"><div>
            <p className="presentation-eyebrow">Administration · {projectId ? projectName || 'Project override' : 'Shared defaults'}</p>
            <h1 id="task-columns-heading">Task columns · {discipline}</h1>
            <p className="hint">Choose information shown in task lists and opened task details. {projectId
                ? 'This profile applies only inside this project.'
                : 'These defaults apply to inheriting projects, General tasks and cross-project lists.'}</p>
            <p className="hint">Task, Discipline, Status, Priority, Assigned To and Due are always visible and can be reordered. Original assignee and QA are optional. Assigned To shows the current owner. Column visibility does not change assignments or workflow.</p>
        </div><button type="button" className="button" disabled={pending || definitionEditing.dirty || Boolean(resource.readId)} onClick={() => run('reload')}>Reload latest configuration</button></header>
        {(error || resource.error) && <p className="error" role="alert">{(error || resource.error).status === 409
            ? 'Task columns changed. Your draft is preserved. Reload the latest configuration before saving.'
            : (error || resource.error).message || 'Could not load task columns.'}</p>}
        {stale && <p className="error" role="alert">Task columns changed. Your draft is preserved. Reload the latest configuration before saving.</p>}
        {message && <p role="status">{message}</p>}
        {projectId && <ProjectCustomFieldsAdministration projectId={projectId} disabled={dirty || busy} onEditingChange={setDefinitionEditing} />}
        {!draft ? <p role="status">Task columns are unavailable or still loading.</p> : <>
            <div className="presentation-toolbar"><span role="status">{busy ? 'Please wait…' : dirty ? 'Unsaved changes' : projectId && draft.usesDefault ? 'Using default' : 'Saved configuration'}</span>
                <div className="presentation-toolbar-actions">
                    {projectId && draft.usesDefault && !customizing && <button className="button" disabled={pending || definitionEditing.dirty || !canManage || stale} onClick={() => {
                        setCustomizing(true);
                        setDirty(true);
                    }}>Customize this project</button>}
                    {projectId && !draft.usesDefault && <button className="button" disabled={pending || definitionEditing.dirty || !canManage || stale} onClick={() => run('reset')}>Use default</button>}
                    <button className="button" disabled={pending || definitionEditing.dirty || !dirty || Boolean(resource.readId)} onClick={() => run('reload')}>Discard changes</button>
                    <button className="button primary" disabled={disabled || !dirty || Boolean(columnError(draft.columns, draft.customFields))} onClick={() => run('save')}>Save task columns</button>
                </div>
            </div>
            <div className="task-columns-layout"><fieldset className="task-columns-editor" disabled={disabled}>
                <legend>Visible fields and order</legend>
                {[...draft.columns, ...Object.keys(fieldLabels).filter((field) => !draft.columns.includes(field))].map((field) => {
                    const index = draft.columns.indexOf(field);
                    const required = requiredTaskColumns.includes(field);
                    return <div className="task-column-option" key={field}>
                        <label className="checkbox"><input type="checkbox" aria-label={`Show ${fieldLabels[field]}`} disabled={required || disabled}
                            checked={index >= 0} onChange={(event) => change(event.target.checked ? [...draft.columns, field] : draft.columns.filter((item) => item !== field))} />
                            {fieldLabels[field]}{required && <small>Required</small>}</label>
                        <button type="button" className="button" aria-label={`Move ${fieldLabels[field]} up`} disabled={disabled || index <= 0} onClick={() => move(field, -1)}>↑</button>
                        <button type="button" className="button" aria-label={`Move ${fieldLabels[field]} down`} disabled={disabled || index < 0 || index === draft.columns.length - 1} onClick={() => move(field, 1)}>↓</button>
                    </div>;
                })}
            </fieldset><section className="task-columns-preview" aria-label="Task column preview">
                <h2>List preview</h2><div className="table-wrap"><table><thead><tr>{draft.columns.map((field) => <th key={field}>{fieldLabels[field]}</th>)}</tr></thead>
                    <tbody><tr>{draft.columns.map((field) => <td key={field}><TaskColumnContent field={field} task={sample} people={people} customFields={draft.customFields} onOpen={() => {}} /></td>)}</tr></tbody>
                </table></div>
                <h2>Card preview</h2><p className="hint">Cards always show the six required fields. Open a task to view its configured optional and project fields.</p>
                <TaskCard task={sample} people={people} onOpen={() => {}} />
            </section></div>
        </>}
        {blocker.state === 'blocked' && <dialog ref={confirmRef} className="project-dialog" aria-labelledby="discard-columns-title" onCancel={(event) => {
            event.preventDefault();
            blocker.reset();
        }}><div className="drawer-body"><h2 id="discard-columns-title">{pending ? 'Saving task columns…' : 'Discard unsaved task columns?'}</h2>
            <p>{pending ? 'Wait for the request to finish before leaving.' : 'Your changes have not been saved.'}</p></div>
            <div className="drawer-footer"><button className="button" autoFocus onClick={() => blocker.reset()}>Keep editing</button>
                <button className="button primary" disabled={pending} onClick={() => blocker.proceed()}>Discard changes</button></div></dialog>}
    </section>;
}
