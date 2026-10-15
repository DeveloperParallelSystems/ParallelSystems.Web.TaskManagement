import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import DisciplineWorkflowMap, { participantNames, workflowMoveLabel } from './DisciplineWorkflowMap';
import { removeWorkflowStage, workflowActionKinds, workflowActorRoles, workflowOwnerRoles,
    workflowStageColors, workflowStageKinds } from './disciplineWorkflows';

function nextId(items, prefix) {
    let number = 1;
    while (items.some((item) => item.id === `${prefix}-${number}`)) {
        number++;
    }
    return `${prefix}-${number}`;
}

function reorder(items, index, offset) {
    const result = [...items];
    const target = index + offset;
    if (target < 0 || target >= result.length) {
        return items;
    }
    [result[index], result[target]] = [result[target], result[index]];
    return result;
}

function StageSelect({ label, value, stages, onChange, nonterminalOnly = false }) {
    return <label className="field"><span>{label}</span>
        <select value={value} onChange={(event) => onChange(event.target.value)}>
            <option value="">Choose a stage</option>
            {stages.filter((stage) => !nonterminalOnly || !['Completed', 'Cancelled'].includes(stage.kind))
                .map((stage) => <option key={stage.id} value={stage.id}>{stage.name || stage.id}</option>)}
        </select>
    </label>;
}

export default function DisciplineWorkflowEditor({ definition, onChange, disabled, heading }) {
    const { stages, transitions } = definition;
    function changeStage(id, changes) {
        onChange({ ...definition, stages: stages.map((stage) => stage.id === id ? { ...stage, ...changes } : stage) });
    }
    function changeAction(id, changes) {
        onChange({ ...definition, transitions: transitions.map((action) => action.id === id ? { ...action, ...changes } : action) });
    }
    function changeStageKind(stage, kind) {
        let ownerRole = stage.ownerRole;
        if (['Completed', 'Cancelled'].includes(kind)) {
            ownerRole = 'None';
        }
        else if (kind === 'Review') {
            ownerRole = 'Reviewer';
        }
        else if (kind === 'Release') {
            ownerRole = 'Release';
        }
        changeStage(stage.id, { kind, ownerRole });
    }
    function changeActionKind(action, kind) {
        let actorRoles = action.actorRoles;
        if (['Approve', 'FailReview'].includes(kind)) {
            actorRoles = ['Reviewer'];
        }
        else if (kind === 'Release') {
            actorRoles = ['Release'];
        }
        else if (['Cancel', 'Reopen'].includes(kind)) {
            actorRoles = ['Administrator'];
        }
        changeAction(action.id, { kind, actorRoles, requireNote: kind === 'FailReview' || action.requireNote });
    }
    function removeStage(stage) {
        const attached = transitions.filter((action) => action.fromStageId === stage.id || action.toStageId === stage.id).length;
        if (window.confirm(`Remove ${stage.name || stage.id} and its ${attached} connected action(s) from this draft?`)) {
            onChange(removeWorkflowStage(definition, stage.id));
        }
    }

    return <fieldset className="discipline-workflow-editor" disabled={disabled}>
        <legend className="sr-only">Workflow definition</legend>
        <section className="workflow-surface workflow-definition-heading">
            {heading}
            <div className="form-grid">
                <label className="field"><span>Workflow name</span>
                    <input maxLength={80} value={definition.name} onChange={(event) => onChange({ ...definition, name: event.target.value })} />
                </label>
                <StageSelect label="Start stage" value={definition.startStageId} stages={stages} nonterminalOnly
                    onChange={(startStageId) => onChange({ ...definition, startStageId })} />
            </div>
        </section>
        <DisciplineWorkflowMap definition={definition} />
        <div className="workflow-section-heading">
            <div><h2>Stages <span>{stages.length} / 30</span></h2>
                <p>Choose who handles each stage using existing task participants. Stage IDs stay fixed when names change.</p></div>
            <button type="button" className="button workflow-add" disabled={stages.length >= 30} onClick={() => onChange({
                ...definition, stages: [...stages, { id: nextId(stages, 'stage'), name: 'New stage', kind: 'Work', color: 'blue', ownerRole: 'Owner' }],
            })}><Plus size={15} aria-hidden="true" />Add stage</button>
        </div>
        <div className="discipline-stage-grid">
            {stages.map((stage, index) => <section className={`discipline-stage ${stage.color}`} key={stage.id}
                aria-label={`Stage ${index + 1}: ${stage.name || stage.id}`}>
                <div className="column-heading"><h3><i />Stage {index + 1}</h3><code>{stage.id}</code></div>
                <label className="field"><span>Stage name</span>
                    <input maxLength={80} value={stage.name} onChange={(event) => changeStage(stage.id, { name: event.target.value })} />
                </label>
                <div className="form-grid">
                    <label className="field"><span>Stage kind</span>
                        <select value={stage.kind} onChange={(event) => changeStageKind(stage, event.target.value)}>
                            {workflowStageKinds.map((kind) => <option key={kind}>{kind}</option>)}
                        </select>
                    </label>
                    <label className="field"><span>Owner role</span>
                        <select value={stage.ownerRole} onChange={(event) => changeStage(stage.id, { ownerRole: event.target.value })}>
                            {workflowOwnerRoles.map((role) => <option key={role}>{role}</option>)}
                        </select>
                    </label>
                </div>
                <div className="workflow-theme" role="group" aria-label={`Theme color for ${stage.name || stage.id}`}>
                    <span>Theme color</span>
                    <div className="workflow-swatches">{workflowStageColors.map((color) =>
                        <button key={color} type="button" className={`workflow-swatch ${color}`}
                            aria-label={`${color} theme color`} aria-pressed={stage.color === color}
                            onClick={() => changeStage(stage.id, { color })} />)}</div>
                </div>
                <div className="discipline-workflow-actions">
                    <button type="button" className="button" disabled={index === 0} aria-label={`Move ${stage.name} earlier`}
                        onClick={() => onChange({ ...definition, stages: reorder(stages, index, -1) })}>Move earlier</button>
                    <button type="button" className="button" disabled={index === stages.length - 1} aria-label={`Move ${stage.name} later`}
                        onClick={() => onChange({ ...definition, stages: reorder(stages, index, 1) })}>Move later</button>
                    <button type="button" className="button" aria-label={`Remove stage ${stage.name}`}
                        onClick={() => removeStage(stage)}><Trash2 size={15} aria-hidden="true" /></button>
                </div>
            </section>)}
        </div>
        <div className="workflow-section-heading">
            <div><h2>Actions <span>{transitions.length} / 100</span></h2>
                <p>Actions define every permitted move, including returns after failed review. Retry loops are allowed when stages still have a path to completion.</p></div>
            <button type="button" className="button workflow-add" disabled={transitions.length >= 100} onClick={() => onChange({
                ...definition, transitions: [...transitions, { id: nextId(transitions, 'action'), name: 'New action', kind: 'Progress',
                    fromStageId: stages[0]?.id || '', toStageId: stages.at(-1)?.id || '', actorRoles: ['Owner'], requireNote: false }],
            })}><Plus size={15} aria-hidden="true" />Add action</button>
        </div>
        <div className="discipline-action-list">
            {transitions.map((action, index) => <details className={`discipline-action ${action.kind === 'FailReview' ? 'failed-review' : ''}`} key={action.id}>
                <summary className="workflow-action-summary" aria-label={`Edit action ${action.name || action.id}`}>
                    <span className="workflow-action-number">{index + 1}</span>
                    <span><strong>{action.name || action.id}</strong><small>{action.kind}</small></span>
                    <span className="workflow-action-move">{workflowMoveLabel(definition, action)}</span>
                    <span className="workflow-role-badges">{action.actorRoles.length ? action.actorRoles.map((role) =>
                        <span key={role}>{participantNames[role]}</span>) : 'No participants selected'}</span>
                    <span>{action.requireNote ? 'Note required' : 'Note optional'}</span>
                    <span className="workflow-action-edit">Edit</span>
                </summary>
                <div className="workflow-action-fields">
                    <div className="column-heading"><h3>Action {index + 1}</h3><code>{action.id}</code></div>
                    <div className="form-grid">
                        <label className="field"><span>Action name</span>
                            <input maxLength={80} value={action.name} onChange={(event) => changeAction(action.id, { name: event.target.value })} />
                        </label>
                        <label className="field"><span>Action kind</span>
                            <select value={action.kind} onChange={(event) => changeActionKind(action, event.target.value)}>
                                {workflowActionKinds.map((kind) => <option key={kind}>{kind}</option>)}
                            </select>
                        </label>
                        <StageSelect label="From stage" value={action.fromStageId} stages={stages}
                            onChange={(fromStageId) => changeAction(action.id, { fromStageId })} />
                        <StageSelect label={action.kind === 'FailReview' ? 'Failed review destination' : 'To stage'} value={action.toStageId} stages={stages}
                            onChange={(toStageId) => changeAction(action.id, { toStageId })} />
                    </div>
                    <fieldset className="discipline-role-options">
                        <legend>Allowed participants</legend>
                        {workflowActorRoles.map((role) => <label key={role}>
                            <input type="checkbox" checked={action.actorRoles.includes(role)} onChange={(event) => changeAction(action.id, {
                                actorRoles: event.target.checked ? [...action.actorRoles, role] : action.actorRoles.filter((item) => item !== role),
                            })} />{participantNames[role]}
                        </label>)}
                    </fieldset>
                    <label className="discipline-note-option">
                        <input type="checkbox" checked={action.requireNote} disabled={action.kind === 'FailReview'}
                            onChange={(event) => changeAction(action.id, { requireNote: event.target.checked })} />
                        Require a note{action.kind === 'FailReview' ? ' (required for failed review)' : ''}
                    </label>
                    <div className="discipline-workflow-actions">
                        <button type="button" className="button" disabled={index === 0} aria-label={`Move action ${action.name} earlier`}
                            onClick={() => onChange({ ...definition, transitions: reorder(transitions, index, -1) })}>Move earlier</button>
                        <button type="button" className="button" disabled={index === transitions.length - 1} aria-label={`Move action ${action.name} later`}
                            onClick={() => onChange({ ...definition, transitions: reorder(transitions, index, 1) })}>Move later</button>
                        <button type="button" className="button" aria-label={`Remove action ${action.name}`} onClick={() => {
                            if (window.confirm(`Remove ${action.name || action.id} from this draft?`)) {
                                onChange({ ...definition, transitions: transitions.filter((item) => item.id !== action.id) });
                            }
                        }}>Remove action</button>
                    </div>
                </div>
            </details>)}
        </div>
    </fieldset>;
}

export function DisciplineWorkflowPreview({ definition, compact = false }) {
    const [currentId, setCurrentId] = useState(definition.startStageId);
    useEffect(() => setCurrentId(definition.startStageId), [definition]);
    const current = definition.stages.find((stage) => stage.id === currentId);
    const outgoing = definition.transitions.filter((action) => action.fromStageId === currentId);
    return <section className="discipline-workflow-preview" aria-labelledby="workflow-preview-title">
        <h3 id="workflow-preview-title">Workflow preview</h3>
        <p className="hint">Try configured actions below. This preview shows all configured roles; real task access and assigned participants are checked when an action is used.</p>
        <div className={`discipline-preview-current ${current?.color || 'gray'}`} aria-live="polite">
            <strong>Current stage: {current?.name || 'Choose a start stage'}</strong>
            {current && <span>Owner: {current.ownerRole} · {current.kind}</span>}
        </div>
        <div className="discipline-workflow-actions">
            {outgoing.map((action) => <button type="button" className="button" key={action.id}
                disabled={!definition.stages.some((stage) => stage.id === action.toStageId)}
                onClick={() => setCurrentId(action.toStageId)}>{action.name || action.id}</button>)}
            <button type="button" className="button" onClick={() => setCurrentId(definition.startStageId)}>Restart preview</button>
        </div>
        {!compact && <div className="discipline-stage-grid">
            {definition.stages.map((stage) => <section className={`discipline-stage ${stage.color}`} key={stage.id}>
                <h4>{stage.name || stage.id}{stage.id === definition.startStageId ? ' · Start' : ''}</h4>
                <p className="hint">{stage.kind} · Owner: {stage.ownerRole}</p>
                <ul className="discipline-preview-edges">
                    {definition.transitions.filter((action) => action.fromStageId === stage.id).map((action) => <li key={action.id}>
                        <strong>{action.name || action.id}</strong> → {definition.stages.find((target) => target.id === action.toStageId)?.name || 'Missing destination'}
                        <span>{action.kind} · {action.actorRoles.join(', ') || 'No participants'}{action.requireNote ? ' · Note required' : ''}</span>
                    </li>)}
                </ul>
            </section>)}
        </div>}
    </section>;
}
