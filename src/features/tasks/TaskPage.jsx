import { useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useBlocker, useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, Save, Clock3, RotateCcw, Link } from 'lucide-react';
import { request } from '../../app/api';
import { saveTask } from '../../app/store';
import { disciplines, staffOptionLabel } from './workflow';
import { taskInput } from './taskActions';
import { taskStatusName, taskStatusTone } from './taskWorkflow';
import TaskStatusControl from './TaskStatusControl';
import { loadStatusSettings } from './liveStatuses.js';
import './task-detail-design.css';
import { shouldBlockTaskNavigation } from './taskNavigation';
import TaskDiscussion from './TaskDiscussion';
import TaskPageTabs from './TaskPageTabs';
import TaskAttachments from './TaskAttachments';
import TaskChecklist from './TaskChecklist';
import TaskLabels from './TaskLabels';
import TaskDependencies from './TaskDependencies';
import { mergeDependencyVersion } from './dependencyState.js';

const emptyTask = {
    title: '',
    description: '',
    discipline: disciplines[0],
    projectId: '',
    priority: 'Medium',
    dueDate: '',
    status: 'To Do',
    originalAssigneeId: '',
    assigneeId: '',
    reviewerId: '',
    releaseOwnerId: '',
    note: '',
    version: 0,
};

export default function TaskPage({ id, onClose, onSaved, onEditingChange }) {
    const dispatch = useDispatch();
    const { people, projects } = useSelector((state) => state.workspace);
    const statusSettings = useSelector((state) => state.workspace.statusSettings?.data);
    const statusSettingsError = useSelector((state) => state.workspace.statusSettings?.error);
    const administrator = useSelector((state) => state.auth.user.role === 'Administrator');
    const headingRef = useRef(null);
    const confirmRef = useRef(null);
    const navigate = useNavigate();
    const location = useLocation();
    const [values, setValues] = useState(emptyTask);
    const [details, setDetails] = useState(null);
    const [loading, setLoading] = useState(id !== 'new');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);
    const [reload, setReload] = useState(0);
    const [dirty, setDirty] = useState(false);
    const [linkMessage, setLinkMessage] = useState('');
    const [createdId, setCreatedId] = useState(null);
    const [discussionEditing, setDiscussionEditing] = useState({ dirty: false, saving: false });
    const [attachmentEditing, setAttachmentEditing] = useState({ dirty: false, saving: false });
    const [checklistEditing, setChecklistEditing] = useState({ dirty: false, saving: false });
    const [labelEditing, setLabelEditing] = useState({ dirty: false, saving: false });
    const [dependencyEditing, setDependencyEditing] = useState({ dirty: false, saving: false });
    const historyRequest = useRef(null);
    const [activeTab, setActiveTab] = useState('details');
    const [workflowEditing, setWorkflowEditing] = useState({ dirty: false, saving: false });
    const [newWorkflowReady, setNewWorkflowReady] = useState(false);
    const unsaved = dirty || discussionEditing.dirty || attachmentEditing.dirty || checklistEditing.dirty || labelEditing.dirty || dependencyEditing.dirty || workflowEditing.dirty;
    const pendingSave = saving || discussionEditing.saving || attachmentEditing.saving || checklistEditing.saving || labelEditing.saving || dependencyEditing.saving || workflowEditing.saving;
    const editable = id === 'new' ? administrator : details?.canEditDetails;
    const allowedStatuses = id === 'new' ? ['To Do'] : details?.allowedStatuses || [];
    let saveMessage = id === 'new' ? 'Not saved yet' : 'Task details saved';
    if (dirty) {
        saveMessage = 'Unsaved changes';
    }
    const blocker = useBlocker(({ currentLocation, nextLocation }) =>
        shouldBlockTaskNavigation({ dirty: unsaved, saving: pendingSave }, currentLocation, nextLocation),
    );

    useEffect(() => {
        if (id !== 'new' || newWorkflowReady || !statusSettings) {
            return;
        }
        setValues((current) => ({ ...current, workflow: null, workflowVersionId: null, status: 'To Do' }));
        setNewWorkflowReady(true);
    }, [id, values.discipline, newWorkflowReady, statusSettings]);

    useEffect(() => {
        if (id !== 'new') {
            headingRef.current?.focus();
        }
    }, [id]);

    useEffect(() => {
        onEditingChange({ dirty: unsaved, saving: pendingSave });
    }, [unsaved, pendingSave, onEditingChange]);

    useEffect(() => {
        return () => {
            historyRequest.current?.abort();
            onEditingChange({ dirty: false, saving: false });
        };
    }, [onEditingChange]);

    useEffect(() => {
        if (blocker.state === 'blocked') {
            if (!unsaved && !pendingSave) {
                blocker.proceed();
            }
            else if (!confirmRef.current?.open) {
                confirmRef.current?.showModal();
            }
        }
    }, [blocker, unsaved, pendingSave]);

    useEffect(() => {
        function beforeUnload(event) {
            if (unsaved || pendingSave) {
                event.preventDefault();
                event.returnValue = '';
            }
        }
        function escape(event) {
            if (event.key === 'Escape' && !document.querySelector('dialog[open]') &&
                !event.defaultPrevented && !pendingSave) {
                event.preventDefault();
                onClose();
            }
        }
        window.addEventListener('beforeunload', beforeUnload);
        window.addEventListener('keydown', escape);
        return () => {
            window.removeEventListener('beforeunload', beforeUnload);
            window.removeEventListener('keydown', escape);
        };
    }, [unsaved, pendingSave, onClose]);

    useEffect(() => {
        if (createdId && !dirty && !saving && blocker.state === 'unblocked') {
            navigate({ pathname: `/tasks/${createdId}`, search: location.search }, { replace: true });
        }
    }, [createdId, dirty, saving, blocker.state, navigate, location.search]);

    useEffect(() => {
        if (id === 'new') {
            return;
        }
        const controller = new AbortController();
        setLoading(true);
        setDetails(null);
        setError(null);
        request(`/tasks/${id}`, { signal: controller.signal })
            .then((result) => {
                setDetails(result);
                const loaded = {
                    ...emptyTask,
                    ...result.task,
                    note: '',
                    dueDate: result.task.dueDate?.slice(0, 10) || '',
                    projectId: result.task.projectId || '',
                    assigneeId: result.task.assigneeId || '',
                    reviewerId: result.task.reviewerId || '',
                    releaseOwnerId: result.task.releaseOwnerId || '',
                };
                setValues(loaded);
                setDirty(false);
                setLoading(false);
            })
            .catch((failure) => {
                if (failure.name !== 'AbortError') {
                    setError({ message: failure.message });
                    setLoading(false);
                }
            });
        return () => {
            controller.abort();
        };
    }, [id, reload]);

    useEffect(() => {
        if (id === 'new' || !statusSettings?.version) {
            return;
        }
        const controller = new AbortController();
        request('/tasks/' + id, { signal: controller.signal }).then((fresh) => {
            // Refresh permissions without overwriting unsaved task or panel drafts.
            setDetails((current) => current && current.task.version === fresh.task.version ? {
                ...current, allowedStatuses: fresh.allowedStatuses, liveStatuses: fresh.liveStatuses,
                canEditDetails: fresh.canEditDetails,
            } : current);
        }).catch((failure) => {
            if (failure.name !== 'AbortError') {
                setError({ message: failure.message, status: failure.status });
            }
        });
        return () => controller.abort();
    }, [id, statusSettings?.version]);

    function change(name, value) {
        setDirty(true);
        if (id === 'new' && name === 'discipline') {
            setNewWorkflowReady(false);
        }
        setValues((current) => {
            const next = { ...current, [name]: value };
            if (name === 'originalAssigneeId' && !current.assigneeId) {
                next.assigneeId = value;
            }
            return next;
        });
    }

    async function refreshHistory() {
        historyRequest.current?.abort();
        const controller = new AbortController();
        historyRequest.current = controller;
        try {
            const latest = await request(`/tasks/${id}`, { signal: controller.signal });
            setDetails((current) => current ? { ...current, activity: latest.activity } : current);
        }
        catch (failure) {
            if (!controller.signal.aborted) {
                setError({ message: `The change was saved, but History could not refresh: ${failure.message}` });
                if (failure.status === 404) {
                    setDetails(null);
                }
            }
        }
    }

    async function copyLink() {
        try {
            const url = new URL(`${import.meta.env.BASE_URL}tasks/${id}`, window.location.origin);
            url.search = window.location.search;
            await navigator.clipboard.writeText(url.href);
            setLinkMessage('Task link copied.');
        }
        catch {
            setLinkMessage('Unable to copy. You can copy the task URL from the address bar.');
        }
    }

    function close() {
        if (pendingSave) {
            return;
        }
        onClose();
    }

    function reloadTask() {
        if (pendingSave) {
            return;
        }
        if (!(dirty || labelEditing.dirty || dependencyEditing.dirty || workflowEditing.dirty) ||
            window.confirm('Reload the latest task and discard unsaved task, action, label and dependency changes?')) {
            setReload((value) => value + 1);
        }
    }

    function keepEditing() {
        confirmRef.current?.close();
        blocker.reset();
    }

    async function submit(event) {
        event.preventDefault();
        if (workflowEditing.dirty || workflowEditing.saving || labelEditing.dirty || labelEditing.saving || dependencyEditing.dirty || dependencyEditing.saving || (id === 'new' && !newWorkflowReady)) {
            return;
        }
        setError(null);
        setSaving(true);
        const payload = taskInput(values, { note: values.note });
        for (const field of ['projectId', 'assigneeId', 'reviewerId', 'releaseOwnerId', 'dueDate']) {
            payload[field] = payload[field] || null;
        }
        try {
            const saved = await dispatch(saveTask({ id: id === 'new' ? null : id, values: payload })).unwrap();
            setDirty(false);
            setSaving(false);
            if (id === 'new') {
                setCreatedId(saved.id);
            }
            else {
                setReload((value) => value + 1);
            }
            onSaved(id === 'new' ? 'Task created.' : 'Task updated.');
        }
        catch (failure) {
            setError(failure);
            setSaving(false);
        }
    }

    function personSelect(name, label, disabled = !editable) {
        return (
            <label className="field">
                <span>{label}</span>
                <select form="task-details-form"
                    value={values[name]}
                    disabled={disabled || saving || workflowEditing.saving}
                    required={name === 'originalAssigneeId'}
                    onChange={(event) => change(name, event.target.value)}
                >
                    <option value="">
                        {name === 'originalAssigneeId' ? 'Select staff' : 'Unassigned'}
                    </option>
                    {people
                        .filter((person) => person.isActive || person.id === values[name])
                        .map((person) => (
                            <option key={person.id} value={person.id} disabled={!person.isActive}>
                                {staffOptionLabel(person)}
                            </option>
                        ))}
                </select>
            </label>
        );
    }

    if (id === 'new' && !administrator) {
        return (
            <section className="panel">
                <h1>Task creation is restricted</h1>
                <p>Only administrators can create tasks.</p>
                <button className="button" onClick={onClose}>Back to tasks</button>
            </section>
        );
    }

    return (
        <section className="task-page task-detail-design" aria-labelledby="task-page-title">
            <button type="button" className="text-button task-back" disabled={pendingSave} onClick={close}>
                <ArrowLeft size={16} /> Back to tasks
            </button>
            <div className="task-page-heading">
                <div className="task-page-title">
                    <div className="task-detail-meta">
                        <span className="eyebrow">{details?.task.code || (id === 'new' ? 'NEW TASK' : 'TASK')}</span>
                        {details && <>
                            <span className={`badge ${taskStatusTone(details.task)}`}>{taskStatusName(details.task)}</span>
                            <span className={`task-detail-priority priority-${details.task.priority?.toLowerCase()}`}>
                                {details.task.priority} priority
                            </span>
                        </>}
                    </div>
                    <h1 id="task-page-title" ref={headingRef} tabIndex={-1}>
                        {id === 'new' ? 'Create task' : details?.task.title || 'Task details'}
                    </h1>
                    {linkMessage && <p role="status">{linkMessage}</p>}
                </div>
                {id !== 'new' && (
                    <button type="button" className="button task-copy-link" onClick={copyLink}>
                        <Link size={15} /> Copy task link
                    </button>
                )}
            </div>
            <div className="task-detail-tabs">
                <TaskPageTabs value={activeTab} onChange={setActiveTab} attachmentsDisabled={id === 'new'} />
            </div>
            <div id="task-details-panel" className="task-tab-panel" role="tabpanel"
                aria-labelledby="task-details-tab" tabIndex={0} hidden={activeTab !== 'details'}>
                <div className="task-detail-workspace">
                    <div className="task-detail-main">
                        {loading ? (
                            <div className="empty">Loading task…</div>
                        ) : (
                            <form id="task-details-form" onSubmit={submit} aria-busy={saving}>
                                <div className="task-page-body">
                                    {error && (
                                        <div className="error" role="alert">
                                            {error.message || 'Unable to save. Please try again.'}
                                            {id !== 'new' && (
                                                <button
                                                    type="button"
                                                    className="text-button"
                                                    disabled={pendingSave}
                                                    onClick={reloadTask}
                                                >
                                                    <RotateCcw size={14} /> Reload latest task
                                                </button>
                                            )}
                                        </div>
                                    )}
                                    {(details || id === 'new') && (
                                        <>
                                            {!editable && (
                                                <p className="hint">
                                                    You can add notes and change the status when your assignment permits.
                                                </p>
                                            )}
                                            <div className="task-page-columns">
                                                <section className="panel task-details-panel" aria-labelledby="task-details-heading">
                                                    <h2 id="task-details-heading">Task details</h2>
                                                    <fieldset disabled={!editable || saving || labelEditing.saving || dependencyEditing.saving || workflowEditing.saving} className="form-grid">
                                                        <p className="hint full">Assign staff from Staff Information. Staff without an account can be assigned now.</p>
                                                        <label className="field full">
                                                            <span>Task title</span>
                                                            <input form="task-details-form"
                                                                autoFocus={id === 'new'}
                                                                required
                                                                maxLength={130}
                                                                value={values.title}
                                                                onChange={(event) => change('title', event.target.value)}
                                                                placeholder="What needs to be done?"
                                                            />
                                                        </label>
                                                        <label className="field">
                                                            <span>Discipline</span>
                                                            <select form="task-details-form"
                                                                value={values.discipline}
                                                                disabled={id !== 'new' && Boolean(values.workflow)}
                                                                onChange={(event) => change('discipline', event.target.value)}
                                                            >
                                                                {disciplines.map((discipline) => <option key={discipline}>{discipline}</option>)}
                                                            </select>
                                                        </label>
                                                        <label className="field">
                                                            <span>Project</span>
                                                            <select form="task-details-form"
                                                                value={values.projectId}
                                                                onChange={(event) => change('projectId', event.target.value)}
                                                            >
                                                                <option value="">General · no project</option>
                                                                {projects.map((project) => (
                                                                    <option key={project.id} value={project.id}>
                                                                        {project.name}
                                                                    </option>
                                                                ))}
                                                            </select>
                                                        </label>
                                                        <label className="field">
                                                            <span>Priority</span>
                                                            <select form="task-details-form"
                                                                value={values.priority}
                                                                onChange={(event) => change('priority', event.target.value)}
                                                            >
                                                                {['Low', 'Medium', 'High', 'Urgent'].map((priority) => (
                                                                    <option key={priority}>{priority}</option>
                                                                ))}
                                                            </select>
                                                        </label>
                                                        <label className="field">
                                                            <span>Due date</span>
                                                            <input form="task-details-form"
                                                                type="date"
                                                                value={values.dueDate}
                                                                onChange={(event) => change('dueDate', event.target.value)}
                                                            />
                                                        </label>
                                                        {personSelect('originalAssigneeId', 'Original assignee')}
                                                        {values.workflow?.definition.mode !== 'Simple' && personSelect('reviewerId', 'Reviewer / QA')}
                                                        {values.workflow?.definition.mode !== 'Simple' && personSelect('releaseOwnerId', 'Release owner')}
                                                        <label className="field full">
                                                            <span>Description</span>
                                                            <textarea form="task-details-form"
                                                                rows={4}
                                                                maxLength={10000}
                                                                value={values.description}
                                                                onChange={(event) =>
                                                                    change('description', event.target.value)
                                                                }
                                                                placeholder="Describe the work and what a successful result looks like…"
                                                            />
                                                        </label>
                                                    </fieldset>
                                                </section>
                                            </div>
                                        </>
                                    )}
                                </div>
                                {(details || id === 'new') && (
                                    <div className="task-page-footer">
                                        <span className="muted" role="status">
                                            {saveMessage}
                                        </span>
                                        <button type="button" className="button" disabled={pendingSave} onClick={close}>
                                            Back to tasks
                                        </button>
                                        <button
                                            className="button primary"
                                            disabled={saving || workflowEditing.dirty || workflowEditing.saving || labelEditing.dirty || labelEditing.saving || dependencyEditing.dirty || dependencyEditing.saving || (!details && id !== 'new') || (id === 'new' && !newWorkflowReady)}
                                        >
                                            <Save size={16} />
                                            {saving ? 'Saving…' : 'Save task'}
                                        </button>
                                    </div>
                                )}
                            </form>
                        )}
                        {labelEditing.dirty && <p className="hint">Save or cancel label changes before saving task details.</p>}
                        {dependencyEditing.dirty && <p className="hint">Add or cancel the dependency selection before saving task details or labels.</p>}
                        {workflowEditing.dirty && <p className="hint">Apply or cancel the status change before saving task details, labels or dependencies.</p>}
                        {id === 'new' && <section className="panel task-label-panel"><h2>Labels</h2>
                            <p className="muted">Save this task to assign labels.</p></section>}
                        {!loading && details && <TaskLabels key={`labels-${id}`} task={details.task}
                            disabled={saving || dependencyEditing.dirty || dependencyEditing.saving || workflowEditing.dirty || workflowEditing.saving}
                            onEditingChange={setLabelEditing} onFailure={setError}
                            onSaved={(result, expectedVersion) => {
                                setDetails((current) => current ? { ...current, task: { ...current.task, ...result } } : current);
                                setValues((current) => current.version === expectedVersion ? { ...current, ...result } : current);
                                refreshHistory();
                            }} />}
                        {id !== 'new' && <TaskDiscussion taskId={id} onEditingChange={setDiscussionEditing} />}
                    </div>
                    <aside className="task-detail-side" aria-label="Status and task planning">
                        {!statusSettings && <section className="panel" role="status">
                            <h2>Status choices unavailable</h2>
                            <p>{statusSettingsError?.message || 'Loading the discipline’s statuses…'}</p>
                            <button type="button" className="button" onClick={() => dispatch(loadStatusSettings())}>
                                Reload statuses
                            </button>
                        </section>}
                        {statusSettings && !loading && (details || id === 'new') && <TaskStatusControl
                            task={details?.task || null} allowedStatuses={allowedStatuses} settings={statusSettings}
                            disabled={dirty || saving || labelEditing.dirty || labelEditing.saving || dependencyEditing.dirty || dependencyEditing.saving}
                            onEditingChange={setWorkflowEditing} onReload={reloadTask} onChanged={() => {
                                setReload((value) => value + 1);
                                onSaved('Task status changed.');
                            }} />}
                        {!loading && (details || id === 'new') && <section className="panel task-assignment-panel"
                            aria-labelledby="task-assignment-heading">
                            <h2 id="task-assignment-heading">Assignment and activity</h2>
                            <div className="form-grid">
                                {personSelect('assigneeId', 'Assigned to · current owner', !editable)}
                                <label className="field full"><span>Activity note</span>
                                    <textarea form="task-details-form" rows={3} maxLength={4000}
                                        disabled={saving || workflowEditing.saving}
                                        value={values.note} onChange={(event) => change('note', event.target.value)}
                                        placeholder="Add an update…" />
                                </label>
                            </div>
                        </section>}
                        {id === 'new' && <section className="panel task-checklist"><h2>Checklist</h2>
                            <p className="muted">Save this task to add checklist items.</p></section>}
                        {id !== 'new' && <TaskChecklist
                            key={JSON.stringify([id, people.map((person) => [person.id, person.userId, person.accountIsActive])])}
                            taskId={id} onEditingChange={setChecklistEditing} onHistoryChange={refreshHistory} />}
                        {id === 'new' && <section className="panel task-dependencies"><h2>Dependencies</h2>
                            <p className="muted">Save this task to add dependencies.</p></section>}
                        {!loading && details && <TaskDependencies key={`dependencies-${id}`} task={details.task}
                            disabled={saving || labelEditing.dirty || labelEditing.saving || workflowEditing.dirty || workflowEditing.saving}
                            onEditingChange={setDependencyEditing} onFailure={setError} onReloadTask={reloadTask}
                            onSaved={(change, expectedVersion) => {
                                setDetails((current) => current ? { ...current, task: mergeDependencyVersion(current.task, change, expectedVersion) } : current);
                                setValues((current) => mergeDependencyVersion(current, change, expectedVersion));
                                refreshHistory();
                                onSaved('Task dependency updated.');
                            }} />}
                    </aside>
                </div>
            </div>
            <div id="task-history-panel" className="task-tab-panel" role="tabpanel"
                aria-labelledby="task-history-tab" tabIndex={0} hidden={activeTab !== 'history'}>
                {details && (
                    <section className="panel task-activity-panel" aria-labelledby="task-activity-heading">
                        <h2 id="task-activity-heading">
                            <Clock3 size={15} /> History
                        </h2>
                        <div className="activity-list">
                            {!details?.activity.length && (
                                <p className="muted">
                                    Activity will appear here when the task is saved.
                                </p>
                            )}
                            {details?.activity.map((activity) => (
                                <article className="activity" key={activity.id}>
                                    <div className="activity-heading">
                                        <strong>{activity.actorName}</strong>
                                        <time>
                                            {new Date(activity.createdAtUtc).toLocaleString()}
                                        </time>
                                    </div>
                                    <p>{activity.summary}</p>
                                    <small>
                                        {statusSettings?.catalog.find((item) => item.code === activity.status)?.name || taskStatusName({ ...details.task, status: activity.status, statusName: null })} ·{' '}
                                        {activity.assigneeName || 'Unassigned'}
                                    </small>
                                    {activity.note && <blockquote>{activity.note}</blockquote>}
                                </article>
                            ))}
                        </div>
                    </section>
                )}
                {!details && (
                    <section className="panel task-activity-panel">
                        <h2>History</h2>
                        <p className="muted">{loading ? 'Loading history…' : id === 'new' ?
                            'Save this task to start its history.' : 'History is unavailable until the task loads.'}</p>
                    </section>
                )}
            </div>
            <div id="task-attachments-panel" className="task-tab-panel" role="tabpanel"
                aria-labelledby="task-attachments-tab" tabIndex={0} hidden={activeTab !== 'attachments'}>
                {id !== 'new' && <TaskAttachments
                    key={JSON.stringify(people.map((person) => [person.id, person.userId, person.accountIsActive]))}
                    taskId={id} active={activeTab === 'attachments'} onEditingChange={setAttachmentEditing}
                    onHistoryChange={refreshHistory} />}
            </div>
            {blocker.state === 'blocked' && (
                <dialog
                    ref={confirmRef}
                    className="project-dialog"
                    aria-labelledby="discard-task-title"
                    aria-describedby="discard-task-description"
                    onCancel={(event) => {
                        event.preventDefault();
                        keepEditing();
                    }}
                >
                    <div className="drawer-body">
                        <h2 id="discard-task-title">{pendingSave ? 'Saving changes…' : 'Discard your unsaved changes?'}</h2>
                        <p id="discard-task-description">
                            {pendingSave ? 'Wait for the save to finish before leaving this task.' :
                                'Your task edits, status change, label and dependency selections, checklist draft, unposted comment draft and queued files will be lost if you leave this page.'}
                        </p>
                    </div>
                    <div className="drawer-footer">
                        <button type="button" className="button" autoFocus onClick={keepEditing}>
                            Keep editing
                        </button>
                        <button type="button" className="button primary" disabled={pendingSave} onClick={() => blocker.proceed()}>
                            Discard changes
                        </button>
                    </div>
                </dialog>
            )}
        </section>
    );
}
