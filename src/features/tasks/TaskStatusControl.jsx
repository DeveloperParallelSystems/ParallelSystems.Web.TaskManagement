import { useEffect, useState } from 'react';
import { useDispatch } from 'react-redux';
import { request } from '../../app/api.js';
import { loadWorkspace } from '../../app/store.js';
import { allowedDisciplineStatuses } from './liveStatuses.js';

export default function TaskStatusControl({ task, allowedStatuses, settings, disabled, onEditingChange, onChanged, onReload }) {
    const dispatch = useDispatch();
    const [selected, setSelected] = useState(task?.status || 'To Do');
    const [note, setNote] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    const choices = allowedDisciplineStatuses(settings, task?.discipline).filter((item) =>
        item.code === task?.status || allowedStatuses.includes(item.code));
    const names = new Map(settings?.catalog?.map((item) => [item.code, item.name]) || []);
    const dirty = Boolean(task && (selected !== task.status || note));

    useEffect(() => {
        setSelected(task?.status || 'To Do');
        setNote('');
    }, [task?.id, task?.status, task?.version]);
    useEffect(() => {
        onEditingChange({ dirty, saving: busy });
    }, [dirty, busy, onEditingChange]);
    useEffect(() => () => onEditingChange({ dirty: false, saving: false }), [onEditingChange]);

    async function save(event) {
        event.preventDefault();
        if (disabled || busy || !task || selected === task.status || !allowedStatuses.includes(selected) || !choices.some((item) => item.code === selected)) {
            return;
        }
        setBusy(true);
        setError(null);
        try {
            await request(`/tasks/${task.id}/status`, {
                method: 'PUT', body: { status: selected, version: task.version, note },
            });
            await dispatch(loadWorkspace());
            onChanged();
        }
        catch (failure) {
            setError({ message: failure.message, status: failure.status });
        }
        finally {
            setBusy(false);
        }
    }

    return <section className="panel task-workflow-panel" aria-labelledby="task-status-heading">
        <h2 id="task-status-heading">Status</h2>
        <p className="hint">{task?.discipline || 'New task'} · {task ? 'Choose any configured status for this discipline.' : 'New tasks start in To Do.'}</p>
        {error && <p className="error" role="alert">{error.message}
            {error.status === 409 && onReload && <button type="button" className="text-button" disabled={busy} onClick={onReload}>Reload latest task</button>}
        </p>}
        {!task ? <p><strong>To Do</strong></p> : <form onSubmit={save}>
            <fieldset disabled={disabled || busy} className="form-grid">
                <label className="field"><span>Change status</span>
                    <select value={selected} onChange={(event) => setSelected(event.target.value)}>
                        {!choices.some((item) => item.code === task.status) &&
                            <option value={task.status} disabled>{names.get(task.status) || task.status} · current</option>}
                        {choices.map((item) => <option key={item.code} value={item.code}
                            disabled={!allowedStatuses.includes(item.code)}>{item.name}</option>)}
                    </select>
                </label>
                <label className="field full"><span>Status note (optional)</span>
                    <textarea rows={3} maxLength={4000} value={note}
                        onChange={(event) => setNote(event.target.value)} />
                </label>
            </fieldset>
            <div className="form-actions">
                <button className="button primary" disabled={disabled || busy || selected === task.status || !allowedStatuses.includes(selected) || !choices.some((item) => item.code === selected)}>
                    {busy ? 'Changing…' : 'Change status'}
                </button>
                <button type="button" className="button" disabled={!dirty || busy}
                    onClick={() => {
                        setSelected(task.status);
                        setNote('');
                        setError(null);
                    }}>Cancel</button>
            </div>
        </form>}
    </section>;
}
