import { useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { X, Save, Clock3, RotateCcw, Link } from 'lucide-react';
import { request } from '../../app/api';
import { saveTask } from '../../app/store';
import { changeTaskField } from './workflow';

const emptyTask = {
    title: '',
    description: '',
    discipline: 'Development',
    projectId: '',
    priority: 'Medium',
    dueDate: '',
    status: 'Backlog',
    originalAssigneeId: '',
    assigneeId: '',
    reviewerId: '',
    releaseOwnerId: '',
    note: '',
    version: 0,
};

export default function TaskDrawer({ id, onClose, onSaved }) {
    const dispatch = useDispatch();
    const { people, projects } = useSelector((state) => state.workspace);
    const administrator = useSelector((state) => state.auth.user.role === 'Administrator');
    const dialogRef = useRef(null);
    const [values, setValues] = useState(emptyTask);
    const [details, setDetails] = useState(null);
    const [loading, setLoading] = useState(id !== 'new');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);
    const [reload, setReload] = useState(0);
    const [dirty, setDirty] = useState(false);
    const [linkMessage, setLinkMessage] = useState('');
    const editable = id === 'new' ? administrator : details?.canEditDetails;
    const allowedStatuses = id === 'new' ? ['Backlog', 'To Do'] : details?.allowedStatuses || [];

    useEffect(() => {
        dialogRef.current.showModal();
    }, []);

    useEffect(() => {
        if (id === 'new') {
            return;
        }
        const controller = new AbortController();
        setLoading(true);
        setError(null);
        request(`/tasks/${id}`, { signal: controller.signal })
            .then((result) => {
                setDetails(result);
                setValues({
                    ...emptyTask,
                    ...result.task,
                    note: '',
                    dueDate: result.task.dueDate?.slice(0, 10) || '',
                    projectId: result.task.projectId || '',
                    assigneeId: result.task.assigneeId || '',
                    reviewerId: result.task.reviewerId || '',
                    releaseOwnerId: result.task.releaseOwnerId || '',
                });
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

    function change(name, value) {
        setDirty(true);
        setValues((current) => changeTaskField(current, name, value));
    }

    async function copyLink() {
        try {
            const url = new URL(`${import.meta.env.BASE_URL}tasks/${id}`, window.location.origin);
            await navigator.clipboard.writeText(url.href);
            setLinkMessage('Task link copied.');
        }
        catch {
            setLinkMessage('Unable to copy. You can copy the task URL from the address bar.');
        }
    }

    function close() {
        if (saving) {
            return;
        }
        if (!dirty || window.confirm('Discard your unsaved changes?')) {
            onClose();
        }
    }

    async function submit(event) {
        event.preventDefault();
        setError(null);
        setSaving(true);
        const payload = { ...values };
        for (const field of ['projectId', 'assigneeId', 'reviewerId', 'releaseOwnerId', 'dueDate']) {
            payload[field] = payload[field] || null;
        }
        try {
            await dispatch(saveTask({ id: id === 'new' ? null : id, values: payload })).unwrap();
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
                <select
                    value={values[name]}
                    disabled={disabled || saving}
                    required={name === 'originalAssigneeId'}
                    onChange={(event) => change(name, event.target.value)}
                >
                    <option value="">
                        {name === 'originalAssigneeId' ? 'Select a person' : 'Unassigned'}
                    </option>
                    {people
                        .filter((person) => person.isActive || person.id === values[name])
                        .map((person) => (
                            <option key={person.id} value={person.id} disabled={!person.isActive}>
                                {person.name}
                                {person.isActive ? '' : ' (inactive)'}
                            </option>
                        ))}
                </select>
            </label>
        );
    }

    return (
        <dialog
            ref={dialogRef}
            className="task-dialog"
            aria-labelledby="task-dialog-title"
            onCancel={(event) => {
                event.preventDefault();
                close();
            }}
            onClick={(event) => {
                if (event.target === dialogRef.current) {
                    close();
                }
            }}
        >
            <div className="drawer">
                <div className="drawer-head">
                    <div>
                        <span className="eyebrow">{details?.task.code || 'NEW TASK'}</span>
                        <h2 id="task-dialog-title">{id === 'new' ? 'Create task' : 'Task details'}</h2>
                        {id !== 'new' && (
                            <button type="button" className="text-button" onClick={copyLink}>
                                <Link size={14} /> Copy task link
                            </button>
                        )}
                        {linkMessage && <p role="status">{linkMessage}</p>}
                    </div>
                    <button
                        type="button"
                        className="icon-button"
                        aria-label="Close task"
                        disabled={saving}
                        onClick={close}
                    >
                        <X size={22} />
                    </button>
                </div>
                {loading ? (
                    <div className="empty">Loading task…</div>
                ) : (
                    <form onSubmit={submit}>
                        <div className="drawer-body">
                            {error && (
                                <div className="error" role="alert">
                                    {error.message || 'Unable to save. Please try again.'}
                                    {id !== 'new' && (
                                        <button
                                            type="button"
                                            className="text-button"
                                            onClick={() => {
                                                if (
                                                    !dirty ||
                                                    window.confirm(
                                                        'Reload the latest task and discard unsaved changes?',
                                                    )
                                                ) {
                                                    setReload((value) => value + 1);
                                                }
                                            }}
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
                                            You can add notes and update the workflow steps available to your
                                            role on this task.
                                        </p>
                                    )}
                                    <fieldset disabled={!editable || saving} className="form-grid">
                                        <label className="field full">
                                            <span>Task title</span>
                                            <input
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
                                            <select
                                                value={values.discipline}
                                                onChange={(event) => change('discipline', event.target.value)}
                                            >
                                                <option>Development</option>
                                                <option>Drafting</option>
                                            </select>
                                        </label>
                                        <label className="field">
                                            <span>Project</span>
                                            <select
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
                                            <select
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
                                            <input
                                                type="date"
                                                value={values.dueDate}
                                                onChange={(event) => change('dueDate', event.target.value)}
                                            />
                                        </label>
                                        {personSelect('originalAssigneeId', 'Original assignee')}
                                        {personSelect('reviewerId', 'Reviewer / QA')}
                                        {personSelect('releaseOwnerId', 'Release owner')}
                                        <label className="field full">
                                            <span>Description</span>
                                            <textarea
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
                                    <div className="section-label">Workflow</div>
                                    <div className="form-grid">
                                        <label className="field">
                                            <span>Status</span>
                                            <select
                                                disabled={saving}
                                                value={values.status}
                                                onChange={(event) => change('status', event.target.value)}
                                            >
                                                {allowedStatuses.map((status) => (
                                                    <option key={status}>{status}</option>
                                                ))}
                                            </select>
                                        </label>
                                        {personSelect(
                                            'assigneeId',
                                            'Assigned to · current owner',
                                            !editable || ['Completed', 'Cancelled'].includes(values.status),
                                        )}
                                        <p className="hint full">
                                            {values.status === 'Failed Review'
                                                ? 'Return the work to the original assignee and explain what needs correcting.'
                                                : 'Status changes suggest the next owner. Release steps are optional after approval.'}
                                        </p>
                                        <label className="field full">
                                            <span>Activity / review note</span>
                                            <textarea
                                                disabled={saving}
                                                rows={3}
                                                maxLength={4000}
                                                required={
                                                    values.status === 'Failed Review' &&
                                                    details?.task.status !== 'Failed Review'
                                                }
                                                value={values.note}
                                                onChange={(event) => change('note', event.target.value)}
                                                placeholder="Add an update, review result, or reason for the change…"
                                            />
                                        </label>
                                    </div>
                                    <div className="section-label">
                                        <Clock3 size={15} /> Task activity
                                    </div>
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
                                                    {activity.status} ·{' '}
                                                    {activity.assigneeName || 'Unassigned'}
                                                </small>
                                                {activity.note && <blockquote>{activity.note}</blockquote>}
                                            </article>
                                        ))}
                                    </div>
                                </>
                            )}
                        </div>
                        <div className="drawer-footer">
                            <button type="button" className="button" disabled={saving} onClick={close}>
                                Cancel
                            </button>
                            <button
                                className="button primary"
                                disabled={saving || (!details && id !== 'new')}
                            >
                                <Save size={16} />
                                {saving ? 'Saving…' : 'Save task'}
                            </button>
                        </div>
                    </form>
                )}
            </div>
        </dialog>
    );
}
