import { useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { bulkUpdateTasks, loadWorkspace } from '../../app/store.js';
import { projectClientIds, tasksForProjectClient } from './projectClients.js';
import { unassignedTaskMove } from './unassignedTaskMove.js';

export default function MoveUnassignedTasksDialog({ project, onClose }) {
    const dispatch = useDispatch();
    const { clients = [], projects, tasks, bulkBusy } = useSelector(state => state.workspace);
    const administrator = useSelector(state => state.auth.user?.role === 'Administrator');
    const dialog = useRef(null);
    const [targets] = useState(() => tasksForProjectClient(tasks, project, clients, null));
    const [clientId, setClientId] = useState('');
    const [saving, setSaving] = useState(false);
    const [results, setResults] = useState(null);
    const [error, setError] = useState('');
    const currentProject = projects.find(item => item.id === project.id);
    const destinations = projectClientIds(currentProject, clients);
    const taskLabel = targets.length === 1 ? 'task' : 'tasks';
    useEffect(() => {
        dialog.current.showModal();
    }, []);

    function close() {
        if (!saving) {
            onClose();
        }
    }

    async function submit(event) {
        event.preventDefault();
        if (saving || bulkBusy || results || !administrator) {
            return;
        }
        setError('');
        setSaving(true);
        try {
            const move = unassignedTaskMove(currentProject, clients, targets, clientId);
            const moved = await dispatch(bulkUpdateTasks(move)).unwrap();
            setResults(moved);
            await dispatch(loadWorkspace()).unwrap();
        }
        catch (failure) {
            setError(failure.message || 'Unable to move or refresh tasks. Close and refresh before trying again.');
        }
        finally {
            setSaving(false);
        }
    }

    return (
        <dialog ref={dialog} className="project-dialog" aria-labelledby="move-unassigned-title" onCancel={event => {
            event.preventDefault();
            close();
        }}>
            <form onSubmit={submit}>
                <div className="drawer-head"><h2 id="move-unassigned-title">Move all unassigned tasks</h2></div>
                <div className="drawer-body">
                    <p>{project.name} · {targets.length} unassigned {taskLabel}</p>
                    <p>Choose the client whose workspace should contain these tasks. Their owners, status, history and project-field values are kept.</p>
                    {error && <div className="error" role="alert">{error}</div>}
                    <label className="field">
                        <span>Destination client</span>
                        <select aria-label="Destination client" required value={clientId} disabled={saving || Boolean(results)}
                            onChange={event => setClientId(event.target.value)}>
                            <option value="">Choose a client</option>
                            {clients.filter(client => destinations.includes(client.id)).map(client => (
                                <option key={client.id} value={client.id}>{client.name}</option>
                            ))}
                        </select>
                    </label>
                    {!destinations.length && <p>Link a client using Manage clients first.</p>}
                    <p>Tasks are moved individually. Any task changed by someone else will stay where it is and be listed below.</p>
                    {results && <div role="status">
                        <strong>{results.filter(result => result.success).length} of {results.length} tasks moved.</strong>
                        {results.filter(result => !result.success).map(result => (
                            <p key={result.id}>{result.code || result.id}: {result.message}</p>
                        ))}
                        <p>Close this window to review any remaining unassigned tasks.</p>
                    </div>}
                </div>
                <div className="drawer-footer">
                    <button type="button" className="button" onClick={close} disabled={saving}>{results ? 'Done' : 'Cancel'}</button>
                    {!results && <button className="button primary" disabled={saving || bulkBusy || !administrator || !destinations.includes(clientId) || !targets.length}>
                        {saving ? 'Moving…' : `Move ${targets.length} ${taskLabel}`}
                    </button>}
                </div>
            </form>
        </dialog>
    );
}
