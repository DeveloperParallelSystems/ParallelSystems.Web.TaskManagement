import { statuses } from './workflow';

export default function TaskStageOverview({ task }) {
    const stages = task.workflow?.definition.stages || statuses.map((status) => ({ id: status, name: status }));

    return (
        <section className="panel task-stage-overview" aria-labelledby="task-stage-overview-heading">
            <div className="task-stage-overview-heading">
                <h2 id="task-stage-overview-heading">Workflow stages</h2>
                <span className="muted">Current stage highlighted</span>
            </div>
            <ul className="task-stage-list">
                {stages.map((stage) => (
                    <li key={stage.id} aria-current={stage.id === task.status ? 'step' : undefined}>
                        <span className="task-stage-marker" aria-hidden="true" />
                        <span>{stage.name}</span>
                        {stage.id === task.status && <span className="task-stage-current">Current</span>}
                    </li>
                ))}
            </ul>
        </section>
    );
}
