export default function WorkflowPresentationPreview({ groups, tasks, statusSettings, catalog = null }) {
    const statusName = (code) => catalog?.find((item) => item.code === code)?.name || code;
    const counts = new Map();
    for (const task of tasks) {
        const status = catalog ? task.status : statusSettings?.catalog.find((item) => item.code === task.status)?.boardStatus || task.statusBoardStatus || task.status;
        if (catalog || statusSettings || !task.workflow) {
            counts.set(status, (counts.get(status) || 0) + 1);
        }
    }

    function countLabel(name, count) {
        return `${name}: ${count} ${count === 1 ? 'task' : 'tasks'}`;
    }

    return <section className="presentation-preview" aria-labelledby="presentation-preview-title">
        <div className="presentation-section-heading">
            <h2 id="presentation-preview-title">Live preview</h2>
            <p>Board and dashboard grouping · Counts include visible {catalog || statusSettings ? 'tasks' : 'Legacy v1 tasks'}</p>
        </div>
        <div className="presentation-preview-grid">
            {groups.map((group) => {
                const total = group.statuses.reduce((sum, status) => sum + (counts.get(status) || 0), 0);
                return <section key={group.id} className={`presentation-preview-column ${group.color}`}>
                    <h3><i aria-hidden="true" /><span>{group.name || 'Unnamed column'}</span>
                        <span className="presentation-count" aria-label={countLabel(group.name, total)}>{total}</span></h3>
                    <ul>{group.statuses.map((status) => <li key={status}>
                        <span>{statusName(status)}</span><span aria-label={countLabel(statusName(status), counts.get(status) || 0)}>{counts.get(status) || 0}</span>
                    </li>)}</ul>
                    {!group.statuses.length && <p className="hint">No statuses yet</p>}
                </section>;
            })}
        </div>
    </section>;
}
