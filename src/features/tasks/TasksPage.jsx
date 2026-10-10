import { useDispatch, useSelector } from 'react-redux';
import { CalendarDays, Columns3, List, Search, SlidersHorizontal } from 'lucide-react';
import { clearFilters, setFilters, setView } from '../../app/store';
import { dateLabel, filterTasks, groups, initials, isOverdue, statuses, statusTone } from './workflow';

export function Stats({ tasks }) {
    const items = [
        ['Total tasks', tasks.length, 'Across your workspace', 'blue'],
        [
            'In progress',
            tasks.filter((task) => ['In Progress', 'Blocked'].includes(task.status)).length,
            'Work underway',
            'amber',
        ],
        [
            'In review',
            tasks.filter((task) => task.status.includes('Review')).length,
            'Review cycle',
            'purple',
        ],
        [
            'Completed',
            tasks.filter((task) => task.status === 'Completed').length,
            'Officially closed',
            'green',
        ],
    ];
    return (
        <section className="stats" aria-label="Task summary">
            {items.map(([label, count, caption, color]) => (
                <article className={`stat ${color}`} key={label}>
                    <span>{label}</span>
                    <strong>{count}</strong>
                    <small>{caption}</small>
                </article>
            ))}
        </section>
    );
}

export function TaskCard({ task, onOpen }) {
    return (
        <button className="task-card" onClick={() => onOpen(task.id)}>
            <div className="card-top">
                <span className="task-code">{task.code}</span>
                <span className={`priority ${task.priority.toLowerCase()}`}>
                    <i />
                    {task.priority}
                </span>
            </div>
            <h3>{task.title}</h3>
            <div className="project-name">{task.projectName || 'General'}</div>
            <div className="tags">
                <span className="discipline">{task.discipline}</span>
                <span className={`badge ${statusTone(task.status)}`}>{task.status}</span>
            </div>
            <div className="card-footer">
                <span className="owner">
                    <span className="avatar small">{initials(task.assigneeName)}</span>
                    <span>{task.assigneeName || 'Unassigned'}</span>
                </span>
                <span className={isOverdue(task) ? 'due overdue' : 'due'}>
                    <CalendarDays size={12} />
                    {dateLabel(task.dueDate)}
                </span>
            </div>
        </button>
    );
}

export default function TasksPage({ onOpen }) {
    const dispatch = useDispatch();
    const { tasks, filters, projects, view } = useSelector((state) => state.workspace);
    const user = useSelector((state) => state.auth.user);
    const visible = filterTasks(tasks, filters, user.userId);
    let emptyMessage = 'Tasks will appear here when you are assigned as an implementer, owner, reviewer, or release owner.';
    if (tasks.length > 0) {
        emptyMessage = 'Try changing your search or filters.';
    }
    else if (user.role === 'Administrator') {
        emptyMessage = 'Create your first task and bring the team’s next steps together.';
    }

    return (
        <>
            <Stats tasks={tasks} />
            <section className="toolbar" aria-label="Task filters">
                <label className="search">
                    <Search size={17} />
                    <input
                        aria-label="Search tasks or projects"
                        placeholder="Search tasks or projects…"
                        value={filters.search}
                        onChange={(event) => dispatch(setFilters({ search: event.target.value }))}
                    />
                </label>
                <select
                    aria-label="Filter discipline"
                    value={filters.discipline}
                    onChange={(event) => dispatch(setFilters({ discipline: event.target.value }))}
                >
                    <option value="">All disciplines</option>
                    <option>Development</option>
                    <option>Drafting</option>
                </select>
                <select
                    aria-label="Filter status"
                    value={filters.status}
                    onChange={(event) => dispatch(setFilters({ status: event.target.value }))}
                >
                    <option value="">All statuses</option>
                    {statuses.map((status) => (
                        <option key={status}>{status}</option>
                    ))}
                </select>
                <select
                    aria-label="Filter project"
                    value={filters.projectId}
                    onChange={(event) => dispatch(setFilters({ projectId: event.target.value }))}
                >
                    <option value="">All projects</option>
                    {projects.map((project) => (
                        <option key={project.id} value={project.id}>
                            {project.name}
                        </option>
                    ))}
                </select>
                <div className="view-tabs">
                    <button
                        aria-pressed={view === 'board'}
                        className={view === 'board' ? 'active' : ''}
                        onClick={() => dispatch(setView('board'))}
                    >
                        <Columns3 size={15} />
                        Board
                    </button>
                    <button
                        aria-pressed={view === 'list'}
                        className={view === 'list' ? 'active' : ''}
                        onClick={() => dispatch(setView('list'))}
                    >
                        <List size={15} />
                        List
                    </button>
                </div>
            </section>
            <div className="results-bar">
                <span>
                    {visible.length} {visible.length === 1 ? 'task' : 'tasks'}
                </span>
                <label className="checkbox">
                    <input
                        type="checkbox"
                        checked={filters.mine}
                        onChange={(event) => dispatch(setFilters({ mine: event.target.checked }))}
                    />
                    Assigned to me
                </label>
                <button className="text-button" onClick={() => dispatch(clearFilters())}>
                    <SlidersHorizontal size={14} />
                    Reset filters
                </button>
            </div>
            {!visible.length && (
                <section className="empty panel">
                    <div className="empty-icon">✓</div>
                    <h2>{tasks.length ? 'No matching tasks' : 'A clear place to start'}</h2>
                    <p>{emptyMessage}</p>
                </section>
            )}
            {visible.length > 0 && view === 'board' && (
                <div className="board">
                    {groups.map((group) => {
                        const items = visible.filter((task) => group.statuses.includes(task.status));
                        return (
                            <section className={`board-column ${group.color}`} key={group.name}>
                                <div className="column-heading">
                                    <h2>
                                        <i />
                                        {group.name}
                                    </h2>
                                    <span>{items.length}</span>
                                </div>
                                <div className="card-stack">
                                    {items.map((task) => (
                                        <TaskCard key={task.id} task={task} onOpen={onOpen} />
                                    ))}
                                    {!items.length && <p className="column-empty">No tasks in this stage</p>}
                                </div>
                            </section>
                        );
                    })}
                </div>
            )}
            {visible.length > 0 && view === 'list' && (
                <div className="table-wrap">
                    <table>
                        <thead>
                            <tr>
                                <th>Task</th>
                                <th>Discipline</th>
                                <th>Status</th>
                                <th>Priority</th>
                                <th>Assigned to</th>
                                <th>Due</th>
                            </tr>
                        </thead>
                        <tbody>
                            {visible.map((task) => (
                                <tr key={task.id}>
                                    <td>
                                        <button className="table-task" onClick={() => onOpen(task.id)}>
                                            <small>{task.code}</small>
                                            <strong>{task.title}</strong>
                                            <span>{task.projectName || 'General'}</span>
                                        </button>
                                    </td>
                                    <td>{task.discipline}</td>
                                    <td>
                                        <span className={`badge ${statusTone(task.status)}`}>
                                            {task.status}
                                        </span>
                                    </td>
                                    <td>{task.priority}</td>
                                    <td>{task.assigneeName || 'Unassigned'}</td>
                                    <td className={isOverdue(task) ? 'overdue' : ''}>
                                        {dateLabel(task.dueDate)}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
            <aside className="workflow-note">
                <strong>Common workflow for all teams</strong>
                <p>Backlog → To Do → In Progress → Ready for Review → In Review → Approved → Completed</p>
                <small>
                    Failed reviews return to the implementer for correction and re-review. Release steps are
                    optional. Blocked and Cancelled are exception states.
                </small>
            </aside>
        </>
    );
}
