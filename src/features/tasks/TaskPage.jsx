import { useEffect, useRef, useState } from 'react';
import TaskFollowButton from './TaskFollowButton.jsx';
import { useDispatch, useSelector } from 'react-redux';
import { useBlocker, useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, Save, Clock3, RotateCcw, Link, FileText, Settings2, CheckSquare, Plus } from 'lucide-react';
import { request } from '../../app/api';
import { saveTask } from '../../app/store';
import { disciplines, staffOptionLabel } from './workflow';
import { taskInput } from './taskActions';
import { taskStatusName } from './taskWorkflow';
import { allowedDisciplineStatuses, loadStatusSettings } from './liveStatuses.js';
import './task-detail-design.css';
import { shouldBlockTaskNavigation, taskScopeLocation, withoutParentSelection } from './taskNavigation';
import { projectClientContext, projectClientIds, taskClientId } from '../projects/projectClients';
import TaskDiscussion from './TaskDiscussion';
import TaskPageTabs from './TaskPageTabs';
import TaskPanelHeading from './TaskPanelHeading';
import TaskAttachments from './TaskAttachments';
import TaskChecklist from './TaskChecklist';
import TaskLabels from './TaskLabels';
import TaskLinkedTickets from './TaskLinkedTickets';
import { mergeLinkedTicketVersion } from './linkedTicketState.js';
import TaskCustomFields from './TaskCustomFields';
import { emptyCustomFields, loadCustomFields } from './customFields';
import { customTaskPayload, projectFieldDraft } from './customFieldValues';
import { emptyTaskColumns, loadTaskColumns, taskColumnKey } from './taskColumns';

const emptyTask = {
    title: '',
    description: '',
    discipline: disciplines[0],
    projectId: '',
    clientId: '',
    parentTaskId: '',
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

export default function TaskPage({ id, onClose, onSaved, onEditingChange, onTaskLoaded, projectScope = null }) {
    const dispatch = useDispatch();
    const { people, projects, clients = [], tasks = [] } = useSelector((state) => state.workspace);
    const statusSettings = useSelector((state) => state.workspace.statusSettings?.data);
    const statusSettingsError = useSelector((state) => state.workspace.statusSettings?.error);
    const attachments = useSelector((state) => state.workspace.attachments?.[id]);
    const user = useSelector((state) => state.auth.user);
    const administrator = user.role === 'Administrator';
    const headingRef = useRef(null);
    const confirmRef = useRef(null);
    const navigate = useNavigate();
    const location = useLocation();
    const [values, setValues] = useState(() => {
        const parentTaskId = id === 'new' ? new URLSearchParams(location.search).get('parentTaskId') || '' : '';
        const parent = tasks.find((task) => task.id === parentTaskId);
        const projectId = parent && projects.some((project) => project.id === parent.projectId)
            ? parent.projectId : projectScope && projectScope !== 'general' ? projectScope : '';
        const assignedStaff = id === 'new' && user.userId
            ? people.find((person) => person.isActive && person.userId?.toLowerCase() === user.userId.toLowerCase())
            : null;
        return {
            ...emptyTask,
            assigneeId: assignedStaff?.id || '',
            projectId,
            clientId: parent ? taskClientId(parent, projects, clients) || ''
                : projectClientContext(projects.find((project) => project.id === projectId), clients, location.search) || '',
            parentTaskId,
        };
    });
    const [details, setDetails] = useState(null);
    const [loading, setLoading] = useState(id !== 'new');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);
    const [reload, setReload] = useState(0);
    const [dirty, setDirty] = useState(false);
    const [linkMessage, setLinkMessage] = useState('');
    const [savedPath, setSavedPath] = useState(null);
    const [discussionEditing, setDiscussionEditing] = useState({ dirty: false, saving: false });
    const [attachmentEditing, setAttachmentEditing] = useState({ dirty: false, saving: false });
    const [checklistEditing, setChecklistEditing] = useState({ dirty: false, saving: false });
    const [labelEditing, setLabelEditing] = useState({ dirty: false, saving: false });
    const [linkedTicketEditing, setLinkedTicketEditing] = useState({ dirty: false, saving: false });
    const historyRequest = useRef(null);
    const [activeTab, setActiveTab] = useState('details');
    const [newWorkflowReady, setNewWorkflowReady] = useState(false);
    const [customDrafts, setCustomDrafts] = useState({});
    const [customDraftVersions, setCustomDraftVersions] = useState({});
    const [customReloading, setCustomReloading] = useState(false);
    const customProjectId = projects.some((project) => project.id === values.projectId) ? values.projectId : null;
    const parentCandidates = tasks.filter((task) => (task.projectId || '') === values.projectId &&
        taskClientId(task, projects, clients) === taskClientId(values, projects, clients));
    const customResource = useSelector((state) => state.workspace.customFields?.[customProjectId] || emptyCustomFields);
    const columnRevision = useSelector((state) => state.workspace.taskColumnsRevision || 0);
    const columnEpoch = useSelector((state) => state.workspace.taskColumnsEpoch || 0);
    const columnResource = useSelector((state) => state.workspace.taskColumns?.[
        taskColumnKey({ projectId: customProjectId, discipline: values.discipline })] || emptyTaskColumns);
    const columnsReady = Boolean(columnResource.data && !columnResource.error && !columnResource.invalidated && columnResource.data.version === columnRevision);
    const visibleColumns = columnsReady ? columnResource.data.columns : [];
    const createOriginalFromOwner = id === 'new' && columnsReady && !visibleColumns.includes('originalAssignee');
    const visibleCustomFields = visibleColumns.map((column) => customResource.data?.fields.find(
        (field) => !field.isArchived && column === `custom:${field.id.toLowerCase()}`)).filter(Boolean);
    const customValues = projectFieldDraft(customDrafts, values.projectId, details?.task);
    const customReady = Boolean(customResource.data && !customResource.error && !customResource.invalidated && customResource.data.version === columnRevision);
    const customStale = Object.hasOwn(customDraftVersions, values.projectId) && customDraftVersions[values.projectId] !== columnRevision;
    const editable = id === 'new' || details?.canEditDetails;
    const customSaveBlocked = Boolean(editable && customProjectId && (!customReady || customStale));
    const unsaved = dirty || discussionEditing.dirty || attachmentEditing.dirty || checklistEditing.dirty || labelEditing.dirty || linkedTicketEditing.dirty;
    const pendingSave = saving || customReloading || discussionEditing.saving || attachmentEditing.saving || checklistEditing.saving || labelEditing.saving || linkedTicketEditing.saving;
    const allowedStatuses = id === 'new' ? ['To Do'] : details?.allowedStatuses || [];
    const statusChoices = allowedDisciplineStatuses(statusSettings, values.discipline).filter((status) =>
        status.code === values.status || administrator || allowedStatuses.includes(status.code));
    const disciplineChanged = Boolean(details && values.discipline !== details.task.discipline);
    const disciplineStatusInvalid = disciplineChanged && !statusChoices.some((status) => status.code === values.status);
    const statusDisplayName = statusSettings?.catalog.find((status) => status.code === values.status)?.name || values.status;
    const saveDisabled = pendingSave || customSaveBlocked || disciplineStatusInvalid || linkedTicketEditing.dirty || loading ||
        (!details && id !== 'new') || (id === 'new' && (!newWorkflowReady || !columnsReady)) || (id !== 'new' && !dirty && !labelEditing.dirty);
    let saveMessage = id === 'new' ? 'Not saved yet' : 'All changes saved';
    if (dirty || labelEditing.dirty) {
        saveMessage = 'Unsaved changes';
    }
    const blocker = useBlocker(({ currentLocation, nextLocation }) =>
        shouldBlockTaskNavigation({ dirty: unsaved, saving: pendingSave }, currentLocation, nextLocation),
    );

    useEffect(() => {
        const refresh = () => {
            dispatch(loadTaskColumns({ projectId: customProjectId, discipline: values.discipline }));
            if (customProjectId) {
                dispatch(loadCustomFields(customProjectId));
            }
        };
        refresh();
        window.addEventListener('focus', refresh);
        const timer = window.setInterval(() => {
            if (document.visibilityState === 'visible') {
                refresh();
            }
        }, 60000);
        return () => {
            window.removeEventListener('focus', refresh);
            window.clearInterval(timer);
        };
    }, [dispatch, customProjectId, values.discipline, columnRevision, columnEpoch]);

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
        if (savedPath && !dirty && !saving && blocker.state === 'unblocked') {
            navigate(savedPath,
                { replace: true, state: location.state });
        }
    }, [savedPath, dirty, saving, blocker.state, navigate, location.search]);

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
                onTaskLoaded?.(result.task);
                const actual = taskScopeLocation(result.task, projects, clients, location.search);
                if (location.pathname && (actual.pathname !== location.pathname || actual.search !== location.search)) {
                    navigate(actual, { replace: true, state: location.state });
                }
                setDetails(result);
                const loaded = {
                    ...emptyTask,
                    ...result.task,
                    note: '',
                    dueDate: result.task.dueDate?.slice(0, 10) || '',
                    projectId: result.task.projectId || '',
                    clientId: result.task.clientId || '',
                    assigneeId: result.task.assigneeId || '',
                    reviewerId: result.task.reviewerId || '',
                    releaseOwnerId: result.task.releaseOwnerId || '',
                };
                setValues(loaded);
                setCustomDrafts({});
                setCustomDraftVersions({});
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
    }, [id, reload, projectScope]);

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
        if (id !== 'new' && ['discipline', 'projectId', 'clientId'].includes(name) && !administrator) {
            return;
        }
        if (name === 'projectId' && Object.hasOwn(customDrafts, values.projectId) &&
            !window.confirm('Switch projects? Your project-field edits stay in this form. Saving applies only to the selected project.')) {
            return;
        }
        setDirty(true);
        if (id === 'new' && name === 'discipline') {
            setNewWorkflowReady(false);
        }
        setValues((current) => {
            const next = { ...current, [name]: value };
            if (name === 'projectId' && !projectClientIds(projects.find((project) => project.id === value), clients).includes(current.clientId)) {
                next.clientId = '';
            }
            if (name === 'originalAssigneeId' && !current.assigneeId) {
                next.assigneeId = value;
            }
            return next;
        });
    }

    function changeCustomField(fieldId, value) {
        if (!customReady || !columnsReady || customStale || !editable) {
            return;
        }
        setDirty(true);
        setCustomDrafts((current) => ({ ...current, [values.projectId]: { ...current[values.projectId], [fieldId]: value } }));
        setCustomDraftVersions((current) => ({ ...current, [values.projectId]: customResource.data.version }));
    }

    async function reloadCustomFields() {
        if (customReloading || !customProjectId || customResource.readId) {
            return;
        }
        if (customStale && !window.confirm('Reload project fields? Values for fields no longer active will not be submitted. Other task edits will be kept.')) {
            return;
        }
        setCustomReloading(true);
        try {
            const page = await dispatch(loadCustomFields(customProjectId)).unwrap();
            await dispatch(loadTaskColumns({ projectId: customProjectId, discipline: values.discipline })).unwrap();
            if (Object.hasOwn(customDraftVersions, customProjectId)) {
                setCustomDraftVersions((current) => ({ ...current, [customProjectId]: page.version }));
                const active = new Set(page.fields.filter((field) => !field.isArchived).map((field) => field.id));
                setCustomDrafts((current) => ({ ...current, [customProjectId]: Object.fromEntries(
                    Object.entries(current[customProjectId] || {}).filter(([fieldId]) => active.has(fieldId))) }));
            }
        }
        catch (failure) {
            setError(failure);
        }
        finally {
            setCustomReloading(false);
        }
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
        if (!(dirty || labelEditing.dirty || linkedTicketEditing.dirty) ||
            window.confirm('Reload the latest task and discard unsaved task, action, label and linked-ticket changes?')) {
            setReload((value) => value + 1);
        }
    }

    function keepEditing() {
        confirmRef.current?.close();
        blocker.reset();
    }

    async function submit(event) {
        event.preventDefault();
        if (loading || pendingSave || customSaveBlocked || disciplineStatusInvalid || linkedTicketEditing.dirty || linkedTicketEditing.saving || (id === 'new' && (!newWorkflowReady || !columnsReady))) {
            return;
        }
        if (createOriginalFromOwner && !values.assigneeId) {
            setError({ message: 'Select Assigned To before creating this task.' });
            return;
        }
        setError(null);
        setSaving(true);
        const payload = taskInput(values, { note: '' });
        if (administrator && editable && labelEditing.dirty) {
            payload.labelIds = labelEditing.labelIds;
        }
        if (id === 'new') {
            payload.parentTaskId = values.parentTaskId || null;
            payload.clientId = values.clientId || null;
            if (createOriginalFromOwner) {
                payload.originalAssigneeId = values.assigneeId;
            }
            if (!visibleColumns.includes('qa')) {
                payload.reviewerId = null;
            }
        }
        else if (administrator && (values.clientId || null) !== (details.task.clientId || null)) {
            payload.clientId = values.clientId || null;
        }
        for (const field of ['projectId', 'assigneeId', 'reviewerId', 'releaseOwnerId', 'dueDate']) {
            payload[field] = payload[field] || null;
        }
        try {
            Object.assign(payload, customTaskPayload({ projectId: customProjectId, page: customResource.data,
                revision: columnRevision, values: customDrafts[values.projectId] || {}, canEdit: Boolean(editable),
                error: customResource.error, invalidated: customResource.invalidated }));
            const saved = await dispatch(saveTask({ id: id === 'new' ? null : id, values: payload })).unwrap();
            onTaskLoaded?.({ ...values, ...saved, projectId: payload.projectId });
            if (saved.version !== undefined) {
                setValues((current) => ({ ...current, version: saved.version }));
            }
            else if (id !== 'new') {
                setLoading(true);
            }
            setDirty(false);
            setCustomDrafts({});
            setCustomDraftVersions({});
            setSaving(false);
            if (id === 'new' || (payload.projectId || '') !== (details.task.projectId || '') ||
                Object.hasOwn(payload, 'clientId')) {
                setSavedPath(taskScopeLocation({ ...values, ...saved, projectId: payload.projectId,
                    clientId: Object.hasOwn(payload, 'clientId') ? payload.clientId : values.clientId }, projects, clients, location.search));
            }
            if (id !== 'new') {
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
                    disabled={disabled || saving}
                    required={name === 'originalAssigneeId' || (name === 'assigneeId' && createOriginalFromOwner)}
                    onChange={(event) => change(name, event.target.value)}
                >
                    <option value="">
                        {name === 'originalAssigneeId' || (name === 'assigneeId' && id === 'new') ? 'Select staff' : 'Unassigned'}
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
                            <span className={`task-detail-priority priority-${details.task.priority?.toLowerCase()}`}>
                                {details.task.priority} priority
                            </span>
                            {!loading && <TaskLabels key={`labels-${id}`} task={details.task} integrated compact
                                disabled={saving || linkedTicketEditing.dirty || linkedTicketEditing.saving}
                                onEditingChange={setLabelEditing} onFailure={setError}
                                onSaved={(result, expectedVersion) => {
                                    setDetails((current) => current ? { ...current, task: { ...current.task, ...result } } : current);
                                    setValues((current) => current.version === expectedVersion ? { ...current, ...result } : current);
                                    refreshHistory();
                                }} />}
                        </>}
                        {id === 'new' && <button type="button" className="task-label-add" disabled
                            aria-label="Save this task to assign labels" title="Save this task to assign labels">
                            <Plus size={16} aria-hidden="true" />
                        </button>}
                    </div>
                    <h1 id="task-page-title" ref={headingRef} tabIndex={-1}>
                        {id === 'new' ? 'Create task' : details?.task.title || 'Task details'}
                    </h1>
                    {linkMessage && <p role="status">{linkMessage}</p>}
                </div>
                <div className="task-header-actions">
                    {id !== 'new' && details && <TaskFollowButton taskId={id} />}
                    <span className="muted task-save-state" role="status">{saveMessage}</span>
                    <button type="submit" form="task-details-form" className="button primary" disabled={saveDisabled}
                        onClick={() => setActiveTab('details')}>
                        <Save size={16} />{saving ? 'Saving…' : 'Save'}
                    </button>
                    {id !== 'new' && (
                    <button type="button" className="button task-copy-link" onClick={copyLink}>
                        <Link size={15} /> Copy task link
                    </button>
                    )}
                </div>
            </div>
            <div className="task-detail-toolbar">
                <p className="task-page-subtitle">Create and organize a task with all the necessary details.</p>
                <div className="task-detail-tabs">
                    <TaskPageTabs value={activeTab} onChange={setActiveTab} attachmentsDisabled={id === 'new'}
                        attachmentCount={attachments?.hasLoaded ? attachments.items.length : undefined} />
                </div>
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
                                                    Use Discussion for updates. You can change the status when your assignment permits.
                                                </p>
                                            )}
                                            <div className="task-page-columns">
                                                <section className="panel task-details-panel" aria-labelledby="task-details-heading">
                                                    <TaskPanelHeading id="task-details-heading" icon={FileText} title="Task information">Provide the essential details for this task.</TaskPanelHeading>
                                                    {!loading && (details || id === 'new') && <section className="task-status-owner" aria-label="Status and current owner">
                                                        <label className="field"><span>Status</span>
                                                            <select form="task-details-form" aria-label="Status" value={disciplineStatusInvalid ? '' : values.status}
                                                                required={disciplineChanged} aria-invalid={disciplineStatusInvalid || undefined}
                                                                aria-describedby={disciplineStatusInvalid ? 'task-discipline-status-error' : undefined}
                                                                disabled={saving || id === 'new' || !statusSettings || (!administrator && !allowedStatuses.some((status) => status !== details?.task.status))}
                                                                onChange={(event) => change('status', event.target.value)}>
                                                                {disciplineStatusInvalid && <option value="" disabled>Select a valid status</option>}
                                                                {!disciplineChanged && !statusChoices.some((status) => status.code === values.status) &&
                                                                    <option value={values.status} disabled>{details?.task.statusName || values.status}</option>}
                                                                {statusChoices.map((status) => <option key={status.code} value={status.code}>{status.name}</option>)}
                                                            </select>
                                                            {disciplineStatusInvalid && <span className="error" id="task-discipline-status-error" role="alert">
                                                                {statusDisplayName} isn’t available in {values.discipline}. Select a valid status before saving.
                                                            </span>}
                                                        </label>
                                                        {personSelect('assigneeId', 'Assigned To', !editable)}
                                                        {!statusSettings && <p className="error" role="status">{statusSettingsError?.message || 'Loading statuses…'}
                                                            <button type="button" className="text-button" onClick={() => dispatch(loadStatusSettings())}>Reload statuses</button>
                                                        </p>}
                                                    </section>}
                                                    {!columnsReady && <p className={columnResource.error ? 'error' : 'hint'} role="status">
                                                        {columnResource.error?.message || 'Loading current task field visibility…'} Optional fields will appear when the configuration is available.
                                                        <button type="button" className="text-button" disabled={pendingSave || Boolean(columnResource.readId)}
                                                            onClick={() => dispatch(loadTaskColumns({ projectId: customProjectId, discipline: values.discipline }))}>Reload task columns</button>
                                                    </p>}
                                                    <fieldset disabled={!editable || saving || labelEditing.saving || linkedTicketEditing.saving} className="form-grid">
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
                                                                disabled={(id !== 'new' && !administrator) || !editable}
                                                                onChange={(event) => change('discipline', event.target.value)}
                                                            >
                                                                {disciplines.map((discipline) => <option key={discipline}>{discipline}</option>)}
                                                            </select>
                                                            {disciplineChanged && <span className="hint">Assigned To is unchanged. Fields follow the selected discipline; hidden values are preserved.</span>}
                                                        </label>
                                                        <label className="field">
                                                            <span>Project</span>
                                                            <select form="task-details-form"
                                                                value={values.projectId}
                                                                disabled={(id !== 'new' && !administrator) || (id === 'new' && Boolean(projectScope))}
                                                                onChange={(event) => change('projectId', event.target.value)}
                                                            >
                                                                <option value="">General · no project</option>
                                                                {values.projectId && !customProjectId && <option value={values.projectId}>Current project unavailable</option>}
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
                                                        {visibleColumns.includes('originalAssignee') && personSelect('originalAssigneeId', 'Original assignee')}
                                                        {visibleColumns.includes('qa') && values.workflow?.definition.mode !== 'Simple' && personSelect('reviewerId', 'Reviewer / QA')}
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
                                                        {id === 'new' && administrator && <label className="field full">
                                                            <span>Parent ticket (optional)</span>
                                                            <select form="task-details-form" value={values.parentTaskId}
                                                                onChange={(event) => change('parentTaskId', event.target.value)}>
                                                                <option value="">No parent ticket</option>
                                                                {values.parentTaskId && !tasks.some((task) => task.id === values.parentTaskId) &&
                                                                    <option value={values.parentTaskId}>Selected parent unavailable — choose another or clear it</option>}
                                                                {[
                                                                    { label: 'This client and project', items: parentCandidates },
                                                                    { label: 'Other clients, projects and general tasks', items: tasks.filter((task) => !parentCandidates.includes(task)) },
                                                                ].filter((group) => group.items.length).map((group) => <optgroup key={group.label} label={group.label}>
                                                                    {group.items.map((task) => <option key={task.id} value={task.id}>{task.code} · {task.title}</option>)}
                                                                </optgroup>)}
                                                            </select>
                                                            <span className="hint">Links organize work. Status and owner remain independent.</span>
                                                        </label>}
                                                    </fieldset>
                                                </section>
                                            </div>
                                        </>
                                    )}
                                </div>
                            </form>
                        )}
                        {linkedTicketEditing.dirty && <p className="hint">Link or cancel the ticket selection before saving task details or labels.</p>}
                        {id !== 'new' && <TaskDiscussion taskId={id} readOnly={!editable} onEditingChange={setDiscussionEditing} />}
                    </div>
                    <aside className="task-detail-side" aria-label="Task planning">
                        {!loading && (details || id === 'new') && values.projectId && <section className="panel task-project-fields-panel" aria-labelledby="task-custom-heading">
                            <div className="panel-heading"><TaskPanelHeading id="task-custom-heading" icon={Settings2} title="Project fields">Additional fields specific to this project.</TaskPanelHeading>
                                {customProjectId && <button type="button" className="text-button"
                                    disabled={pendingSave || Boolean(customResource.readId)} onClick={reloadCustomFields} aria-label="Reload project fields" title="Reload project fields"><RotateCcw size={15} /></button>}
                            </div>
                            {!customProjectId ? <p className="hint">Custom fields are unavailable for this historical project.</p>
                                : !customReady ? <p className={customResource.error ? 'error' : 'hint'} role="status">
                                    {customResource.error?.message || 'Loading current project fields…'} Reload project fields before saving.</p>
                                : !columnsReady ? <p className={columnResource.error ? 'error' : 'hint'} role="status">
                                    {columnResource.error?.message || 'Loading current task field visibility…'} Reload project fields to try again.</p>
                                : <><TaskCustomFields fields={visibleCustomFields} values={customValues} people={people}
                                    editable={Boolean(editable)} disabled={pendingSave || customStale}
                                    onChange={changeCustomField} />
                                    {customStale && <p className="error" role="alert">Project fields changed. Your draft is preserved. Reload project fields before saving.</p>}</>}
                            {Object.keys(customDrafts).some((projectId) => projectId !== values.projectId) &&
                                <p className="hint">Field edits for other projects are kept while this form is open. Saving applies only to the selected project.</p>}
                            {editable && <p className="hint task-project-save-hint">Only custom fields you edit are saved. Untouched values are preserved.</p>}
                            {details?.task.projectId && details.task.projectId !== values.projectId &&
                                <p className="hint">Existing values for the selected project are not loaded here. Save the project change and reload the task to view them.</p>}
                        </section>}
                        {id === 'new' && <section className="panel task-checklist"><TaskPanelHeading icon={CheckSquare} title="Checklist">Track the progress of this task.</TaskPanelHeading>
                            <p className="muted">Save this task to add checklist items.</p></section>}
                        {id !== 'new' && <TaskChecklist
                            key={JSON.stringify([id, people.map((person) => [person.id, person.userId, person.accountIsActive])])}
                            taskId={id} onEditingChange={setChecklistEditing} onHistoryChange={refreshHistory} />}
                        {id === 'new' && <section className="panel task-linked-tickets"><TaskPanelHeading icon={Link} title="Linked tickets">Link related tickets or parent/child tasks.</TaskPanelHeading>
                            <p className="muted">Choose an optional parent in Task details. Save this task to add child tickets.</p></section>}
                        {!loading && details && <TaskLinkedTickets key={`linked-tickets-${id}`} task={details.task}
                            disabled={saving || dirty || labelEditing.dirty || labelEditing.saving}
                            onEditingChange={setLinkedTicketEditing} onFailure={setError} onReloadTask={reloadTask}
                            onSaved={(change, expectedVersion) => {
                                setDetails((current) => current ? { ...current, task: mergeLinkedTicketVersion(current.task, change, expectedVersion) } : current);
                                setValues((current) => mergeLinkedTicketVersion(current, change, expectedVersion));
                                refreshHistory();
                                onSaved('Linked tickets updated.');
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
                    taskId={id} readOnly={!editable} onEditingChange={setAttachmentEditing}
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
                                'Your task edits, status change, label and linked-ticket selections, checklist draft, unposted comment draft and queued files will be lost if you leave this page.'}
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
