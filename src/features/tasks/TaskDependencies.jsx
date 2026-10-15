import { useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Link, useLocation } from 'react-router-dom';
import { addDependency, loadDependencies, removeDependency } from './dependencyState.js';
import { taskStatusName } from './taskWorkflow';

export default function TaskDependencies({ task, disabled, onEditingChange, onSaved, onFailure, onReloadTask }) {
    const dispatch = useDispatch();
    const location = useLocation();
    const { tasks, dependencies } = useSelector((state) => state.workspace);
    const current = dependencies[task.id];
    const [selected, setSelected] = useState('');
    const [removing, setRemoving] = useState(null);
    const [saving, setSaving] = useState(false);
    const confirmRef = useRef(null);
    const visible = tasks.some((item) => item.id === task.id);
    const dirty = Boolean(selected || removing);
    const wrongVersion = current?.hasLoaded && current.version !== task.version;
    const canManage = current?.canManage;
    const unavailable = disabled || saving || !current?.hasLoaded || current?.stale || wrongVersion;
    const candidates = tasks.filter((item) => item.id !== task.id && !current?.blockedBy.some((related) => related.taskId === item.id));

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
            dispatch(loadDependencies({ taskId: task.id }));
        }
    }, [dispatch, task.id, task.version, visible, current, dirty, saving, disabled]);
    useEffect(() => {
        function refresh() {
            if (visible && !dirty && !saving && !disabled && document.visibilityState === 'visible') {
                dispatch(loadDependencies({ taskId: task.id }));
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

    async function mutate(operation, blockedByTaskId) {
        setSaving(true);
        try {
            const result = await dispatch(operation({ taskId: task.id, blockedByTaskId, version: task.version })).unwrap();
            if (operation === addDependency) {
                setSelected('');
            }
            setRemoving(null);
            onSaved(result.changedTasks.find((item) => item.id === task.id), task.version);
        }
        catch (failure) {
            onFailure(failure);
        }
        finally {
            setSaving(false);
        }
    }

    function relations(items, editable) {
        const visibleItems = items.filter((item) => tasks.some((candidate) => candidate.id === item.taskId));
        return <ul className="dependency-list">
            {!visibleItems.length && <li className="muted">No visible dependencies.</li>}
            {visibleItems.map((item) => {
                const latest = tasks.find((candidate) => candidate.id === item.taskId);
                return <li key={item.taskId}>
                    <Link to={{ pathname: `/tasks/${item.taskId}`, search: location.search }}>
                        <strong>{latest.code || item.code}</strong> {latest.title || item.title}
                    </Link>
                    <span className="muted">{taskStatusName(latest.status ? latest : item)}</span>
                    {editable && <button type="button" className="button" disabled={unavailable}
                        aria-label={`Remove dependency on ${latest.code || item.code}`} onClick={() => setRemoving(item)}>Remove</button>}
                </li>;
            })}
        </ul>;
    }

    if (!visible) {
        return null;
    }
    return <section className="panel task-dependencies" aria-labelledby="dependencies-heading">
        <h2 id="dependencies-heading">Dependencies</h2>
        <p className="hint">These relationships help with planning. They do not prevent status changes, including when linked tasks are completed or cancelled.</p>
        {current?.error && <div className="error" role="alert">{current.error.message}
            <button type="button" className="text-button" disabled={saving || disabled} onClick={() => dispatch(loadDependencies({ taskId: task.id }))}>Retry dependencies</button>
        </div>}
        {wrongVersion && <p className="hint">This task changed. Reload it before editing dependencies.
            <button type="button" className="text-button" disabled={saving || disabled} onClick={onReloadTask}>Reload latest task</button>
        </p>}
        {current?.status === 'loading' && <p role="status">Loading dependencies…</p>}
        {current?.hasLoaded && <>
            <h3>Blocked by</h3>
            {relations(current.blockedBy, canManage)}
            <h3>Blocks</h3>
            {relations(current.blocks, false)}
            {canManage && <p className="hint">To change a “Blocks” relationship, open that task and edit its “Blocked by” list.</p>}
        </>}
        {canManage && <form className="dependency-form" onSubmit={(event) => {
            event.preventDefault();
            if (selected && !unavailable) {
                mutate(addDependency, selected);
            }
        }}>
            <label className="field"><span>Add a blocking task</span>
                <select value={selected} disabled={unavailable} onChange={(event) => setSelected(event.target.value)}>
                    <option value="">Choose a task…</option>
                    {candidates.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.title}</option>)}
                </select>
            </label>
            <div className="dependency-actions">
                <button className="button primary" disabled={!selected || unavailable}>{saving ? 'Saving…' : 'Add dependency'}</button>
                <button type="button" className="button" disabled={!selected || saving} onClick={() => setSelected('')}>Cancel selection</button>
            </div>
        </form>}
        {removing && current?.hasLoaded && <dialog ref={confirmRef} className="project-dialog" aria-labelledby="remove-dependency-title" onCancel={(event) => {
            event.preventDefault();
            if (!saving) {
                setRemoving(null);
            }
        }}>
            <div className="drawer-body"><h2 id="remove-dependency-title">Remove dependency?</h2>
                {current?.error && <p className="error" role="alert">{current.error.message}</p>}
                <p>This task will no longer list {removing.code} as a blocking task. Both tasks and their history will be preserved.</p></div>
            <div className="drawer-footer">
                <button type="button" className="button" disabled={saving} autoFocus onClick={() => setRemoving(null)}>Keep dependency</button>
                <button type="button" className="button primary" disabled={unavailable} onClick={() => mutate(removeDependency, removing.taskId)}>Remove dependency</button>
            </div>
        </dialog>}
    </section>;
}
