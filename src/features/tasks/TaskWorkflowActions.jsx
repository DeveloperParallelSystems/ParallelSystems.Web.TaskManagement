import { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { transitionTask } from './taskTransitions';
import { taskStatusName } from './taskWorkflow';
import { taskDisciplineStatusOptions } from './disciplineStatusOptions';

export default function TaskWorkflowActions({ details, disabled, onEditingChange, onSaved, onReload }) {
    const dispatch = useDispatch();
    const task = details.task;
    const current = useSelector((state) => state.workspace.tasks.find((item) => item.id === task.id));
    const configuration = useSelector((state) => state.workspace.disciplineWorkflows?.data);
    const [actionId, setActionId] = useState('');
    const [note, setNote] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    const choices = taskDisciplineStatusOptions(task, configuration, details.allowedStatuses);
    const availableActions = (details.allowedTransitions || []).filter((item) =>
        choices.some((choice) => choice.status === item.toStageId));
    const action = availableActions.find((item) => item.id === actionId);
    const target = task.workflow.definition.stages.find((stage) => stage.id === action?.toStageId);
    const dirty = Boolean(actionId || note);
    const stale = current && current.version !== task.version;
    const simple = task.workflow.definition.mode === 'Simple';

    useEffect(() => {
        onEditingChange({ dirty, saving: busy });
    }, [dirty, busy, onEditingChange]);
    useEffect(() => () => onEditingChange({ dirty: false, saving: false }), [onEditingChange]);

    async function submit(event) {
        event.preventDefault();
        if (disabled || busy || stale || !current || !action || !details.allowedStatuses.includes(action.toStageId)) {
            return;
        }
        setBusy(true);
        setError(null);
        try {
            const result = await dispatch(transitionTask({ id: task.id, transitionId: action.id, version: task.version, note })).unwrap();
            setActionId('');
            setNote('');
            onSaved(result);
        }
        catch (failure) {
            setError(failure);
        }
        finally {
            setBusy(false);
        }
    }

    if (!current) {
        return null;
    }
    return <section className="panel task-workflow-actions" aria-labelledby="workflow-actions-heading">
        <h2 id="workflow-actions-heading">{simple ? 'Change status' : 'Workflow actions'}</h2>
        <p>{task.workflow.definition.name} · version {task.workflow.versionNumber} · {taskStatusName(task)}</p>
        <p className="hint">{simple ? 'Choose any configured status. Save other task changes before moving it.' : 'Actions follow this task’s published workflow. Save task details and label/dependency changes before continuing.'}</p>
        {(error || stale) && <div className="error" role="alert">
            {error?.message || 'This task changed. Reload it before continuing.'}
            <button type="button" className="text-button" disabled={busy} onClick={onReload}>Reload latest task</button>
        </div>}
        {!availableActions.length ? <p className="muted">{!configuration ? 'Discipline statuses are loading or unavailable.' : simple ? 'No configured status changes are available to you.' : 'No configured workflow actions are available to you. Required handlers must be assigned before an action can proceed.'}</p> :
            <form onSubmit={submit}>
                <fieldset className="form-grid" disabled={disabled || busy || Boolean(stale)}>
                    <label className="field"><span>{simple ? 'Move to status' : 'Action'}</span>
                        <select required value={actionId} onChange={(event) => setActionId(event.target.value)}>
                            <option value="">{simple ? 'Select a status' : 'Select an action'}</option>
                            {availableActions.map((item) =>
                                <option key={item.id} value={item.id}>
                                    {simple ? choices.find((choice) => choice.status === item.toStageId).name : item.name}
                                </option>)}
                        </select>
                    </label>
                    {target && !simple && <p className="hint">Next stage: {target.name}. Handler: {target.ownerRole === 'None' ? 'No current owner' : target.ownerRole}.</p>}
                    <label className="field full"><span>{simple ? 'Status note' : 'Action note'}{action?.requireNote || action?.kind === 'FailReview' ? ' (required)' : ''}</span>
                        <textarea value={note} rows={3} maxLength={4000} required={Boolean(action?.requireNote || action?.kind === 'FailReview')}
                            onChange={(event) => setNote(event.target.value)} />
                    </label>
                    <div className="form-actions">
                        <button className="button primary" disabled={!action}>{busy ? 'Applying…' : simple ? 'Change status' : 'Apply action'}</button>
                    </div>
                </fieldset>
            </form>}
        {(availableActions.length > 0 || dirty) && <button type="button" className="button" disabled={busy || !dirty} onClick={() => {
            setActionId('');
            setNote('');
            setError(null);
        }}>Cancel action</button>}
    </section>;
}
