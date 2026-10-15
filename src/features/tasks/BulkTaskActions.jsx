import { useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { CheckSquare2 } from 'lucide-react';
import { bulkUpdateTasks, clearBulkResults, loadWorkspace } from '../../app/store.js';
import { staffOptionLabel } from './workflow.js';

export default function BulkTaskActions({ selected, onClear, onOpen }) {
    const dispatch = useDispatch();
    const { people, bulkBusy, bulkResults } = useSelector((state) => state.workspace);
    const [action, setAction] = useState('reassign');
    const [assigneeId, setAssigneeId] = useState('');
    const taskCount = selected.length;
    const selectionLabel = taskCount === 0 ? 'No tasks selected' : `${taskCount} ${taskCount === 1 ? 'task' : 'tasks'} selected`;

    async function submit(event) {
        event.preventDefault();
        const dueDate = new FormData(event.currentTarget).get('dueDate');
        const changes = action === 'reassign' ? { assigneeId: assigneeId || null } : { dueDate: dueDate || null };
        await dispatch(bulkUpdateTasks({ tasks: selected, changes })).unwrap();
        onClear();
        dispatch(loadWorkspace());
    }

    return (
        <section className="panel bulk-panel" aria-label="Bulk task actions">
            <div className="bulk-header">
                <div className="bulk-title">
                    <CheckSquare2 size={18} aria-hidden="true" />
                    <h2>Bulk edit</h2>
                    <span className={`bulk-selection ${taskCount > 0 ? 'has-selection' : ''}`} role="status">
                        {selectionLabel}
                    </span>
                </div>
                {taskCount > 0 && (
                    <button type="button" className="text-button" disabled={bulkBusy} onClick={onClear}>Clear selection</button>
                )}
            </div>
            {taskCount === 0 && bulkResults.length === 0 && (
                <p className="bulk-help">Select tasks in the list to change their owner or due date.</p>
            )}
            {taskCount > 0 && (
                <form onSubmit={submit} className="bulk-form">
                    <label>
                        Action
                        <select value={action} disabled={bulkBusy} onChange={(event) => setAction(event.target.value)}>
                            <option value="reassign">Reassign current owner</option>
                            <option value="due">Set due date</option>
                        </select>
                    </label>
                    {action === 'reassign' ? (
                        <label>
                            New owner (staff)
                            <select value={assigneeId} disabled={bulkBusy} onChange={(event) => setAssigneeId(event.target.value)}>
                                <option value="">Unassigned</option>
                                {people.filter((person) => person.isActive).map((person) => (
                                    <option key={person.id} value={person.id}>{staffOptionLabel(person)}</option>
                                ))}
                            </select>
                        </label>
                    ) : (
                        <label>
                            New due date (blank clears)
                            <input type="date" name="dueDate" disabled={bulkBusy} />
                        </label>
                    )}
                    <button className="button primary" disabled={!selected.length || bulkBusy}>
                        {bulkBusy ? 'Updating…' : `Update ${taskCount} ${taskCount === 1 ? 'task' : 'tasks'}`}
                    </button>
                </form>
            )}
            {taskCount > 0 && <p className="bulk-help">Updates are saved for each task. Status changes preserve the current owner. Any issues will appear here.</p>}
            {bulkResults.length > 0 && (
                <div role="status" className="bulk-results">
                    <strong>{bulkResults.filter((result) => result.success).length} of {bulkResults.length} updated</strong>
                    {bulkResults.map((result) => (
                        <div key={result.id} className={result.success ? '' : 'overdue'}>
                            {result.code}: {result.message}
                            {!result.success && (
                                <button type="button" className="text-button" onClick={() => onOpen(result.id)}>
                                    {result.status === 409 ? 'Reload latest task' : 'Open task'}
                                </button>
                            )}
                        </div>
                    ))}
                    <button type="button" className="text-button" onClick={() => dispatch(clearBulkResults())}>Dismiss results</button>
                </div>
            )}
        </section>
    );
}
