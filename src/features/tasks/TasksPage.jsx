import { useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useSearchParams } from 'react-router-dom';
import { CalendarDays, Columns3, List, Search, SlidersHorizontal } from 'lucide-react';
import { loadTaskDetail, loadWorkspace, moveTask } from '../../app/store';
import { dateLabel, disciplines, filterTasks, groups, isOverdue, sortTasks, statuses, statusTone } from './workflow';
import { defaultTaskQuery, parseTaskQuery, quickViews, serializeTaskQuery, sortOptions } from './taskQuery';
import { canMoveTask, needsReviewNote } from './taskActions';
import { downloadTaskCsv } from './taskCsv';
import { TaskMoveMenu } from './TaskMoves';
import BulkTaskActions from './BulkTaskActions';
import TaskContributors from './TaskContributors';

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

export function TaskCard({ task, people = [], onOpen, draggable = false, onDragStart, onDragEnd }) {
    return (
        <article className="task-card"
            draggable={draggable} onDragStart={onDragStart} onDragEnd={onDragEnd}>
            <button type="button" className="task-card-open" onClick={() => onOpen(task.id)}
                aria-label={`Open ${task.code}: ${task.title}`}>
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
            </button>
            <div className="card-footer">
                <TaskContributors task={task} people={people} />
                <span className={isOverdue(task) ? 'due overdue' : 'due'}>
                    <CalendarDays size={12} />
                    {dateLabel(task.dueDate)}
                </span>
            </div>
            {task.assigneeName && <div className="card-owner">Current owner: {task.assigneeName}</div>}
        </article>
    );
}

export default function TasksPage({ onOpen }) {
    const dispatch = useDispatch();
    const { tasks, projects, people, details, bulkBusy } = useSelector((state) => state.workspace);
    const user = useSelector((state) => state.auth.user);
    const administrator = user.role === 'Administrator';
    const [params, setParams] = useSearchParams();
    const filters = parseTaskQuery(params);
    const view = filters.view;
    const visible = sortTasks(filterTasks(tasks, filters, user.userId, people), filters.sort, filters.direction);
    const [selected, setSelected] = useState({});
    const [dragId, setDragId] = useState(null);
    const [moving, setMoving] = useState(false);
    const [moveError, setMoveError] = useState(null);
    const searchRef = useRef(null);
    const visibleIds = visible.map((task) => task.id).join(',');
    const canFilterCreator = tasks.some((task) => Object.hasOwn(task, 'createdById'));
    const dragTask = tasks.find((task) => task.id === dragId);
    const dragDetails = details[dragId]?.task.version === dragTask?.version ? details[dragId] : null;

    function updateQuery(changes) {
        setParams(serializeTaskQuery({ ...filters, ...changes }, params), { replace: true });
    }

    useEffect(() => {
        if (!bulkBusy) {
            setSelected((current) => Object.fromEntries(Object.entries(current).filter(([id]) => visibleIds.split(',').includes(id))));
        }
    }, [visibleIds, bulkBusy]);

    useEffect(() => {
        function focusSearch(event) {
            const editing = event.target.closest('input, textarea, select, [contenteditable="true"]');
            if (event.key === '/' && !editing && !event.ctrlKey && !event.metaKey && !event.altKey && !document.querySelector('dialog[open]')) {
                event.preventDefault();
                searchRef.current?.focus();
            }
        }
        window.addEventListener('keydown', focusSearch);
        return () => {
            window.removeEventListener('keydown', focusSearch);
        };
    }, []);

    function toggleSelected(task, checked) {
        setSelected((current) => {
            const next = { ...current };
            if (checked) {
                next[task.id] = { id: task.id, code: task.code, version: task.version };
            }
            else {
                delete next[task.id];
            }
            return next;
        });
    }

    async function startDrag(event, task) {
        event.dataTransfer.setData('text/plain', task.id);
        event.dataTransfer.effectAllowed = 'move';
        setDragId(task.id);
        setMoveError(null);
        if (details[task.id]?.task.version === task.version) {
            return;
        }
        try {
            const fresh = await dispatch(loadTaskDetail({ id: task.id })).unwrap();
            if (fresh.task.version !== task.version) {
                setMoveError({ id: task.id, status: 409, message: 'This task changed. Reload latest task before moving it.' });
                dispatch(loadWorkspace());
            }
        }
        catch (error) {
            setMoveError({ ...error, id: task.id });
        }
    }

    async function drop(event, status) {
        event.preventDefault();
        if (moving || (event.dataTransfer && event.dataTransfer.getData('text/plain') !== dragId) || !canMoveTask(dragDetails, status, administrator)) {
            return;
        }
        const id = dragId;
        setDragId(null);
        if (needsReviewNote(status)) {
            onOpen(id, status);
            return;
        }
        setMoving(true);
        try {
            await dispatch(moveTask({ id, status, details: dragDetails })).unwrap();
            dispatch(loadWorkspace());
        }
        catch (error) {
            setMoveError({ ...error, id });
        }
        finally {
            setMoving(false);
        }
    }
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
                        ref={searchRef}
                        aria-label="Search tasks or projects"
                        placeholder="Search tasks, descriptions or people…"
                        value={filters.search}
                        onChange={(event) => updateQuery({ search: event.target.value })}
                    />
                </label>
                <select
                    aria-label="Filter discipline"
                    value={filters.discipline}
                    onChange={(event) => updateQuery({ discipline: event.target.value })}
                >
                    <option value="">All disciplines</option>
                    {disciplines.map((discipline) => <option key={discipline}>{discipline}</option>)}
                </select>
                <select
                    aria-label="Filter status"
                    value={filters.status}
                    onChange={(event) => updateQuery({ status: event.target.value })}
                >
                    <option value="">All statuses</option>
                    {statuses.map((status) => (
                        <option key={status}>{status}</option>
                    ))}
                </select>
                <select
                    aria-label="Filter project"
                    value={filters.projectId}
                    onChange={(event) => updateQuery({ projectId: event.target.value })}
                >
                    <option value="">All projects</option>
                    {projects.map((project) => (
                        <option key={project.id} value={project.id}>
                            {project.name}
                        </option>
                    ))}
                </select>
                <select aria-label="Quick view" value={filters.quickView} onChange={(event) => updateQuery({ quickView: event.target.value, mine: false })}>
                    {quickViews.map(([value, label]) => (
                        <option key={value} value={value} disabled={value === 'created' && !canFilterCreator}>
                            {label}{value === 'created' && !canFilterCreator ? ' (unavailable)' : ''}
                        </option>
                    ))}
                </select>
                <select aria-label="Sort tasks by" value={filters.sort} onChange={(event) => updateQuery({ sort: event.target.value })}>
                    {sortOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
                <select aria-label="Sort direction" value={filters.direction} onChange={(event) => updateQuery({ direction: event.target.value })}>
                    <option value="asc">Ascending</option>
                    <option value="desc">Descending</option>
                </select>
                <div className="view-tabs">
                    <button
                        aria-pressed={view === 'board'}
                        className={view === 'board' ? 'active' : ''}
                        onClick={() => updateQuery({ view: 'board' })}
                    >
                        <Columns3 size={15} />
                        Board
                    </button>
                    <button
                        aria-pressed={view === 'list'}
                        className={view === 'list' ? 'active' : ''}
                        onClick={() => updateQuery({ view: 'list' })}
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
                        onChange={(event) => updateQuery({ mine: event.target.checked })}
                    />
                    Assigned to me
                </label>
                <button className="text-button" onClick={() => setParams(serializeTaskQuery(defaultTaskQuery, params), { replace: true })}>
                    <SlidersHorizontal size={14} />
                    Reset filters
                </button>
                <button className="button" disabled={!visible.length} onClick={() => downloadTaskCsv(visible, people)}>Export CSV</button>
            </div>
            {filters.quickView === 'created' && !canFilterCreator && (
                <p className="hint">Created by me isn’t available yet. Choose another quick view.</p>
            )}
            {moveError && (
                <div role="alert" className="error">
                    {moveError.message || 'Unable to move task.'}
                    <button className="text-button" onClick={() => onOpen(moveError.id)}>Reload latest task</button>
                    <button className="text-button" onClick={() => setMoveError(null)}>Dismiss</button>
                </div>
            )}
            {moving && <p role="status">Moving task…</p>}
            {administrator && view === 'list' && (
                <BulkTaskActions selected={Object.values(selected)} onClear={() => setSelected({})} onOpen={onOpen} />
            )}
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
                                {dragId && (
                                    <div className="drop-targets" aria-label={`Move task to ${group.name}`}>
                                        {group.statuses.map((status) => {
                                            const allowed = canMoveTask(dragDetails, status, administrator);
                                            return (
                                                <button
                                                    key={status}
                                                    type="button"
                                                    className="drop-target"
                                                    disabled={!allowed || moving}
                                                    onDragOver={(event) => {
                                                        if (allowed && !moving) {
                                                            event.preventDefault();
                                                            event.dataTransfer.dropEffect = 'move';
                                                        }
                                                    }}
                                                    onDrop={(event) => drop(event, status)}
                                                    onClick={(event) => drop(event, status)}
                                                >
                                                    {status}{!dragDetails ? ' · loading permissions' : ''}
                                                </button>
                                            );
                                        })}
                                    </div>
                                )}
                                <div className="card-stack">
                                    {items.map((task) => (
                                        <div key={task.id} className="board-task">
                                            <TaskCard task={task} people={people} onOpen={onOpen} draggable={!moving && !bulkBusy}
                                                onDragStart={(event) => startDrag(event, task)} onDragEnd={() => setDragId(null)} />
                                            <TaskMoveMenu task={task} onOpen={onOpen} onError={setMoveError} />
                                        </div>
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
                                {administrator && (
                                    <th>
                                        <input type="checkbox" aria-label="Select all filtered tasks" disabled={bulkBusy}
                                            checked={visible.length > 0 && visible.every((task) => selected[task.id])}
                                            onChange={(event) => {
                                                setSelected(event.target.checked ? Object.fromEntries(visible.map((task) => [task.id, { id: task.id, code: task.code, version: task.version }])) : {});
                                            }} />
                                    </th>
                                )}
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
                                    {administrator && (
                                        <td><input type="checkbox" aria-label={`Select ${task.code}`} checked={Boolean(selected[task.id])}
                                            disabled={bulkBusy} onChange={(event) => toggleSelected(task, event.target.checked)} /></td>
                                    )}
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
