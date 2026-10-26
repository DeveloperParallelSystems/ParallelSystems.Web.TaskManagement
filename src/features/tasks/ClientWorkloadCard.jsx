import { useId, useState } from 'react';
import { Building2, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Clock3, FolderOpen } from 'lucide-react';
import { dashboardTaskOverdue } from './clientDashboard.js';
import { dateLabel } from './workflow.js';
import { taskStatusName } from './taskWorkflow.js';
import { taskPersonName } from './taskColumns.js';

const pageSize = 5;

export default function ClientWorkloadCard({ group, people, today, onOpen, other = false }) {
    const [expanded, setExpanded] = useState(false);
    const [requestedPage, setRequestedPage] = useState(1);
    const detailsId = useId();
    const { summary, tasks } = group;
    const pageCount = Math.max(1, Math.ceil(tasks.length / pageSize));
    const page = Math.min(requestedPage, pageCount);
    const start = (page - 1) * pageSize;
    const Icon = other ? FolderOpen : Building2;

    return <article className="client-workload-card" aria-label={`${group.name} workload`}>
        <div className="client-workload-heading">
            <span className="client-workload-icon"><Icon size={20} aria-hidden="true" /></span>
            {summary.overdue > 0 && <span className="client-workload-overdue"><Clock3 size={13} aria-hidden="true" />
                {summary.overdue} overdue
            </span>}
        </div>
        <h3>{group.name}</h3>
        <p className="client-workload-total"><strong>{summary.total}</strong> {summary.total === 1 ? 'task' : 'tasks'}</p>
        <dl className="client-workload-metrics" aria-label={`${group.name} task metrics`}>
            <div><dt>Projects</dt><dd>{group.projectCount}</dd></div>
            <div><dt>Overdue tasks</dt><dd className={summary.overdue > 0 ? 'overdue' : undefined}>{summary.overdue}</dd></div>
            <div><dt>Due this week</dt><dd>{summary.dueThisWeek}</dd></div>
            <div><dt>Tasks without owner</dt><dd>{summary.withoutOwner}</dd></div>
        </dl>
        <button type="button" className="button client-workload-toggle" aria-expanded={expanded}
            aria-controls={detailsId} onClick={() => setExpanded((current) => !current)}>
            {expanded ? 'Hide tasks' : 'View tasks'}
            {expanded ? <ChevronUp size={15} aria-hidden="true" /> : <ChevronDown size={15} aria-hidden="true" />}
        </button>
        <div id={detailsId} hidden={!expanded} className="client-workload-details">
            {expanded && <>
                {!tasks.length && <p className="muted">No visible tasks match this due date filter.</p>}
                <ul className="client-workload-tasks">
                    {tasks.slice(start, start + pageSize).map((task) => <li key={task.id}>
                        <button type="button" className="client-workload-task" onClick={() => onOpen(task.id)}>
                            <span className="task-code">{task.code}</span>
                            <strong>{task.title}</strong>
                            <span>{taskStatusName(task)} · {taskPersonName(task, people, 'assignedTo')}</span>
                            <span className={dashboardTaskOverdue(task, today) ? 'overdue' : undefined}>{dateLabel(task.dueDate)}</span>
                        </button>
                    </li>)}
                </ul>
                {tasks.length > 0 && <div className="client-workload-pagination">
                    <span role="status">{start + 1}–{Math.min(start + pageSize, tasks.length)} of {tasks.length}</span>
                    {pageCount > 1 && <div>
                        <button type="button" className="icon-button" disabled={page === 1}
                            aria-label={`Previous ${group.name} tasks`} onClick={() => setRequestedPage(page - 1)}><ChevronLeft size={16} /></button>
                        <button type="button" className="icon-button" disabled={page === pageCount}
                            aria-label={`Next ${group.name} tasks`} onClick={() => setRequestedPage(page + 1)}><ChevronRight size={16} /></button>
                    </div>}
                </div>}
            </>}
        </div>
    </article>;
}
