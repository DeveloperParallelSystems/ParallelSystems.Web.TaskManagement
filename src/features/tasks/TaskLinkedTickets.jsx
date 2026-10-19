import { useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Link, useLocation } from 'react-router-dom';
import { Link as LinkIcon, Plus } from 'lucide-react';
import TaskPanelHeading from './TaskPanelHeading';
import { loadWorkspace } from '../../app/store';
import { addLinkedTicket, loadLinkedTickets, removeLinkedTicket } from './linkedTicketState.js';
import { newChildTaskLocation, linkedTaskPath } from './taskNavigation';
import { taskStatusName } from './taskWorkflow';

export default function TaskLinkedTickets({ task, disabled, onEditingChange, onSaved, onFailure, onReloadTask }) {
    const dispatch = useDispatch();
    const location = useLocation();
    const { tasks, projects = [], linkedTickets } = useSelector((state) => state.workspace);
    const current = linkedTickets?.[task.id];
    const [selected, setSelected] = useState('');
    const [relationship, setRelationship] = useState('child');
    const [removing, setRemoving] = useState(null);
    const [saving, setSaving] = useState(false);
    const confirmRef = useRef(null);
    const visible = tasks.some((item) => item.id === task.id);
    const dirty = Boolean(selected || removing);
    const wrongVersion = current?.hasLoaded && current.version !== task.version;
    const canManage = current?.canManage;
    const unavailable = disabled || saving || !current?.hasLoaded || current?.stale || wrongVersion;
    const parents = (current?.parents || []).filter((item) => tasks.some((candidate) => candidate.id === item.taskId));
    const children = (current?.children || []).filter((item) => tasks.some((candidate) => candidate.id === item.taskId));
    const candidates = tasks.filter((item) => item.id !== task.id &&
        ![...parents, ...children].some((related) => related.taskId === item.id));

    useEffect(() => {
        onEditingChange({ dirty: visible && dirty, saving });
    }, [dirty, saving, visible, onEditingChange]);
    useEffect(() => () => onEditingChange({ dirty: false, saving: false }), [onEditingChange]);
    useEffect(() => {
        if (!current?.hasLoaded) {
            setRemoving(null);
            setSelected('');
        }
    }, [current?.hasLoaded]);
    useEffect(() => {
        if (selected && !tasks.some((item) => item.id === selected)) {
            setSelected('');
        }
        if (removing && !tasks.some((item) => item.id === removing.taskId)) {
            setRemoving(null);
        }
    }, [tasks, selected, removing]);
    useEffect(() => {
        if (visible && !saving && !disabled && current?.status !== 'loading' && !current?.error &&
            (!current || (!dirty && (current.stale || current.version < task.version)))) {
            dispatch(loadLinkedTickets({ taskId: task.id }));
        }
    }, [dispatch, task.id, task.version, visible, current, dirty, saving, disabled]);
    useEffect(() => {
        function refresh() {
            if (visible && !dirty && !saving && !disabled && document.visibilityState === 'visible') {
                dispatch(loadLinkedTickets({ taskId: task.id }));
            }
        }
        const timer = window.setInterval(refresh, 60000);
        window.addEventListener('focus', refresh);
        return () => {
            window.clearInterval(timer);
            window.removeEventListener('focus', refresh);
        };
    }, [dispatch, task.id, visible, dirty, saving, disabled]);
    useEffect(() => {
        if (removing && !confirmRef.current?.open) {
            confirmRef.current?.showModal();
        }
    }, [removing]);

    async function mutate(operation, related, direction) {
        const childTaskId = direction === 'child' ? related.taskId : task.id;
        const parentTaskId = direction === 'child' ? task.id : related.taskId;
        const childVersion = direction === 'child' ? related.version : task.version;
        setSaving(true);
        try {
            const result = await dispatch(operation({ taskId: task.id, childTaskId, parentTaskId, version: task.version, childVersion })).unwrap();
            if (operation === addLinkedTicket) {
                setSelected('');
                setRelationship('child');
            }
            setRemoving(null);
            onSaved(result.changedTasks.find((item) => item.id === task.id), task.version);
        }
        catch (failure) {
            if (failure.status === 409) {
                // A child may have changed independently of the page's context ticket.
                dispatch(loadWorkspace());
            }
            onFailure(failure);
        }
        finally {
            setSaving(false);
        }
    }

    function relations(items, direction) {
        return <ul className="linked-ticket-list">
            {!items.length && <li className="muted">No visible {direction === 'parent' ? 'parent ticket' : 'child tickets'}.</li>}
            {items.map((item) => {
                const latest = tasks.find((candidate) => candidate.id === item.taskId);
                return <li key={item.taskId}>
                    <Link to={{ pathname: linkedTaskPath(latest, projects), search: location.search }}>
                        <strong>{latest.code || item.code}</strong> {latest.title || item.title}
                    </Link>
                    <span className="muted">{taskStatusName(latest.status ? latest : item)}</span>
                    {canManage && <button type="button" className="button" disabled={unavailable}
                        aria-label={`Unlink ${latest.code || item.code}`}
                        onClick={() => setRemoving({ ...item, direction })}>Unlink</button>}
                </li>;
            })}
        </ul>;
    }

    if (!visible) {
        return null;
    }

    let context = 'No visible linked tickets.';
    if (parents.length && children.length) {
        context = 'This child ticket also has child tickets.';
    }
    else if (parents.length) {
        context = 'This is a child ticket.';
    }
    else if (children.length) {
        context = 'This is a parent ticket.';
    }
    else if (canManage) {
        context = 'This is a standalone ticket.';
    }

    return <section className="panel task-linked-tickets" aria-labelledby="linked-tickets-heading">
        <TaskPanelHeading id="linked-tickets-heading" icon={LinkIcon} title="Linked tickets">Link related tickets or parent/child tasks.</TaskPanelHeading>
        <p className="hint">Organize work with one optional parent and child tickets. Each ticket keeps its own status and owner; links do not block progress.</p>
        {current?.error && <div className="error" role="alert">{current.error.message}
            <button type="button" className="text-button" disabled={saving || disabled}
                onClick={() => dispatch(loadLinkedTickets({ taskId: task.id }))}>Retry linked tickets</button>
        </div>}
        {wrongVersion && <p className="hint">This task changed. Reload it before editing linked tickets.
            <button type="button" className="text-button" disabled={saving || disabled} onClick={onReloadTask}>Reload latest task</button>
        </p>}
        {current?.status === 'loading' && <p role="status">Loading linked tickets…</p>}
        {current?.hasLoaded && <>
            <p className="hint">{context}</p>
            {parents.length > 0 && <><h3>Parent ticket</h3>{relations(parents, 'parent')}</>}
            {children.length > 0 && <><h3>Child tickets</h3>{relations(children, 'child')}</>}
        </>}
        {canManage && <details className="linked-ticket-editor">
            <summary><Plus size={15} aria-hidden="true" /> Link a ticket</summary>
            <div className="linked-ticket-editor-body">
                <Link className="button" to={newChildTaskLocation(task, projects)}
                    aria-disabled={unavailable || dirty}
                    onClick={(event) => {
                        if (unavailable || dirty) {
                            event.preventDefault();
                        }
                    }}>Add child ticket</Link>
                <form className="linked-ticket-form" onSubmit={(event) => {
                    event.preventDefault();
                    const related = tasks.find((item) => item.id === selected);
                    if (related && !unavailable) {
                        mutate(addLinkedTicket, { taskId: related.id, version: related.version }, relationship);
                    }
                }}>
                    <label className="field"><span>Relationship</span>
                        <select value={relationship} disabled={unavailable} onChange={(event) => {
                            setRelationship(event.target.value);
                            setSelected('');
                        }}>
                            <option value="child">Link existing child ticket</option>
                            <option value="parent" disabled={parents.length > 0}>Link parent ticket</option>
                        </select>
                    </label>
                    <label className="field"><span>{relationship === 'child' ? 'Existing child ticket' : 'Existing parent ticket'}</span>
                        <select value={selected} disabled={unavailable} onChange={(event) => setSelected(event.target.value)}>
                            <option value="">Choose a ticket…</option>
                            {candidates.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.title}</option>)}
                        </select>
                    </label>
                    <div className="linked-ticket-actions">
                        <button className="button primary" disabled={!selected || unavailable}>{saving ? 'Saving…' : 'Link ticket'}</button>
                        <button type="button" className="button" disabled={!selected || saving} onClick={() => setSelected('')}>Cancel selection</button>
                    </div>
                </form>
            </div>
        </details>}
        {removing && current?.hasLoaded && <dialog ref={confirmRef} className="project-dialog" aria-labelledby="unlink-ticket-title" onCancel={(event) => {
            event.preventDefault();
            if (!saving) {
                setRemoving(null);
            }
        }}>
            <div className="drawer-body"><h2 id="unlink-ticket-title">Unlink ticket?</h2>
                {current?.error && <p className="error" role="alert">{current.error.message}</p>}
                <p>Remove the parent/child link with {removing.code}. Both tickets and their history will be preserved.</p></div>
            <div className="drawer-footer">
                <button type="button" className="button" disabled={saving} autoFocus onClick={() => setRemoving(null)}>Keep link</button>
                <button type="button" className="button primary" disabled={unavailable}
                    onClick={() => mutate(removeLinkedTicket, removing, removing.direction)}>Unlink ticket</button>
            </div>
        </dialog>}
    </section>;
}
