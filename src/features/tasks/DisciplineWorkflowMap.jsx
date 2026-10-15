export const participantNames = {
    Original: 'Original assignee',
    Owner: 'Current owner',
    Reviewer: 'Reviewer',
    Release: 'Release owner',
    Administrator: 'Administrator',
    None: 'No owner',
};

export function workflowMoveLabel(definition, action) {
    const name = (id) => definition.stages.find((stage) => stage.id === id)?.name || 'Missing stage';
    return `${name(action.fromStageId)} → ${name(action.toStageId)}`;
}

export default function DisciplineWorkflowMap({ definition }) {
    const returns = new Set(['FailReview', 'Cancel', 'Reopen']);
    return <section className="workflow-map workflow-surface" aria-label="Workflow map">
        <h2>Workflow map</h2>
        <p>Stages in display order. Connections below show the configured moves.</p>
        <div className="workflow-map-stages">
            {definition.stages.map((stage) => <div key={stage.id} className={`workflow-map-stage ${stage.color}`}>
                <strong>{stage.name || stage.id}</strong>
                {stage.id === definition.startStageId && <span className="workflow-start">Start</span>}
                <span>{stage.kind}</span>
                <span>{participantNames[stage.ownerRole]}</span>
            </div>)}
        </div>
        {[false, true].map((isReturn) => <div className="workflow-map-connections" key={String(isReturn)}>
            <h3>{isReturn ? 'Returns & exits' : 'Stage actions'}</h3>
            {definition.transitions.filter((action) => returns.has(action.kind) === isReturn).map((action) =>
                <span key={action.id} className={`workflow-connection ${action.kind === 'FailReview' ? 'failed-review' : ''}`}>
                    <strong>{action.name || action.id}:</strong> {workflowMoveLabel(definition, action)}
                </span>)}
        </div>)}
    </section>;
}
