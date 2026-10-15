import { useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useSearchParams } from 'react-router-dom';
import { CalendarDays, Columns3, List, Search, SlidersHorizontal, Tags } from 'lucide-react';
import { loadTaskDetail, loadWorkspace, moveTask } from '../../app/store';
import { dateLabel, disciplines, filterTasks, isOverdue, sortTasks, statuses } from './workflow';
import { boardMoveStatuses, taskKind, taskStatusName, taskStatusTone, taskStatusOptions, workflowBoards } from './taskWorkflow';
import { selectPresentationGroups } from './workflowPresentation';
import { defaultTaskQuery, parseTaskQuery, quickViews, serializeTaskQuery, sortOptions } from './taskQuery';
import { canMoveTask, needsReviewNote } from './taskActions';
import { downloadTaskCsv } from './taskCsv';
import { TaskMoveMenu } from './TaskMoves';
import BulkTaskActions from './BulkTaskActions';
import TaskContributors from './TaskContributors';
import { ChecklistProgress } from './TaskChecklist';
import LabelBadges from './LabelBadges';
import TaskCalendar, { useLocalToday } from './TaskCalendar';
import { calendarFilterOptions } from './calendar';

export function Stats({ tasks }) {
    const items = [
        ['Total tasks', tasks.length, 'Across your workspace', 'blue'],
        [
            'In progress',
            tasks.filter((task) => task.workflow ? taskKind(task) === 'Work' : ['In Progress', 'Blocked'].includes(task.status)).length,
            'Work underway',
            'amber',
        ],
        [
            'In review',
            tasks.filter((task) => task.workflow ? taskKind(task) === 'Review' : task.status.includes('Review')).length,
            'Review cycle',
            'purple',
        ],
        [
            'Completed',
            tasks.filter((task) => taskKind(task) === 'Completed').length,
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
        <article className={`task-card priority-${task.priority.toLowerCase()}`}
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
                {task.description && <p className="card-description">{task.description}</p>}
                <div className="tags">
                    <span className="discipline">{task.discipline}</span>
                    <span className={`badge ${taskStatusTone(task)}`}>{taskStatusName(task)}</span>
                </div>
                <ChecklistProgress summary={task.checklistSummary} compact />
                <LabelBadges labels={task.labels} />
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
    const groups = useSelector(selectPresentationGroups);
    const { tasks, projects, people, details, bulkBusy, labels = [] } = useSelector((state) => state.workspace);
    const statusSettings = useSelector((state) => state.workspace.statusSettings?.data);
    const disciplineWorkflows = useSelector((state) => state.workspace.disciplineWorkflows?.data?.items);
    const user = useSelector((state) => state.auth.user);
    const administrator = user.role === 'Administrator';
    const [params, setParams] = useSearchParams();
    const filters = parseTaskQuery(params);
    const view = filters.view;
    const today = useLocalToday();
    const visible = sortTasks(filterTasks(tasks, filters, user.userId, people, new Date(`${today}T12:00:00`)), filters.sort, filters.direction);
    const filterOptions = calendarFilterOptions(tasks, people, projects);
    const dynamicStatuses = taskStatusOptions(tasks.filter((task) => !filters.discipline || task.discipline === filters.discipline), statusSettings, filters.discipline);
    const boardGroups = workflowBoards(visible, groups, { availableTasks: tasks, discipline: filters.discipline, statusSettings,
        workflows: (disciplineWorkflows || []).map((item) => item.active).filter(Boolean) })[0]?.groups || [];
    const [selected, setSelected] = useState({});
    const [dragId, setDragId] = useState(null);
    const [moving, setMoving] = useState(false);
    const [moveError, setMoveError] = useState(null);
    const [mobileStage, setMobileStage] = useState('');
    const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
    const focusSearchOnExpand = useRef(false);
    const searchRef = useRef(null);
    const visibleIds = visible.map((task) => task.id).join(',');
    const canFilterCreator = tasks.some((task) => Object.hasOwn(task, 'createdById'));
    const dragTask = tasks.find((task) => task.id === dragId);
    const dragDetails = details[dragId] && details[dragId].task.version === dragTask?.version &&
        details[dragId].statusSettingsVersion === statusSettings?.version ? details[dragId] : null;
    const mobileStages = boardGroups.map((group) => ({ key: group.id, name: group.name, count: group.tasks.length }));
    const selectedMobileStage = mobileStages.some((stage) => stage.key === mobileStage) ? mobileStage :
        (mobileStages.find((stage) => stage.count > 0) || mobileStages[0])?.key;

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
                if (searchRef.current?.getClientRects().length) {
                    searchRef.current.focus();
                }
                else {
                    focusSearchOnExpand.current = true;
                    setMobileFiltersOpen(true);
                }
            }
        }
        window.addEventListener('keydown', focusSearch);
        return () => {
            window.removeEventListener('keydown', focusSearch);
        };
    }, []);

    useEffect(() => {
        if (mobileFiltersOpen && focusSearchOnExpand.current) {
            searchRef.current?.focus();
            focusSearchOnExpand.current = false;
        }
    }, [mobileFiltersOpen]);

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
        if (details[task.id]?.task.version === task.version &&
            details[task.id]?.statusSettingsVersion === statusSettings?.version) {
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
        if (!dragDetails.liveStatuses && (dragDetails.task.workflow || needsReviewNote(status))) {
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
                <button type="button" className="button mobile-filter-toggle" aria-expanded={mobileFiltersOpen}
                    aria-controls="task-filter-controls" onClick={() => setMobileFiltersOpen((open) => !open)}>
                    <SlidersHorizontal size={15} />
                    {mobileFiltersOpen ? 'Hide filters' : 'Filters'}
                    {filters.search || filters.discipline || filters.projectId || filters.assigneeId ||
                        filters.status || filters.quickView || filters.labelIds.length > 0 ? ' · active' : ''}
                </button>
                <div id="task-filter-controls" className="task-filter-controls" data-mobile-open={mobileFiltersOpen}>
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
                        aria-label="Filter project"
                        value={filters.projectId}
                        onChange={(event) => updateQuery({ projectId: event.target.value })}
                    >
                        <option value="">All projects</option>
                        {filters.projectId && !filterOptions.projects.some((project) => project.id === filters.projectId) &&
                            <option value={filters.projectId}>Selected project unavailable</option>}
                        {filterOptions.projects.map((project) => (
                            <option key={project.id} value={project.id}>
                                {project.name}
                            </option>
                        ))}
                    </select>
                    <select aria-label="Filter assignee (current owner)" value={filters.assigneeId}
                        onChange={(event) => updateQuery({ assigneeId: event.target.value })}>
                        <option value="">All current owners</option>
                        <option value="unassigned">Unassigned</option>
                        {filters.assigneeId && filters.assigneeId !== 'unassigned' &&
                            !filterOptions.owners.some((owner) => owner.id === filters.assigneeId) &&
                            <option value={filters.assigneeId}>Selected owner unavailable</option>}
                        {filterOptions.owners.map((owner) => <option key={owner.id} value={owner.id}>{owner.name}</option>)}
                    </select>
                    <select aria-label="Sort tasks by" value={filters.sort} onChange={(event) => updateQuery({ sort: event.target.value })}>
                        {sortOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                    <details className="task-filter-menu">
                        <summary><SlidersHorizontal size={15} />More filters{filters.status || filters.quickView ? ' · active' : ''}</summary>
                        <div className="filter-popover">
                            <label className="field"><span>Status</span>
                                <select aria-label="Filter status" value={filters.status} onChange={(event) => updateQuery({ status: event.target.value })}>
                                    <option value="">All statuses</option>
                                    {(statusSettings ? [] : statuses).map((status) => <option key={status}>{status}</option>)}
                                    {dynamicStatuses.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                                    {filters.status && !(statusSettings ? [] : statuses).includes(filters.status) && !dynamicStatuses.some((option) => option.value === filters.status) &&
                                        <option value={filters.status}>{statusSettings?.catalog.find((item) => item.code === filters.status)?.name || 'Selected status unavailable'}</option>}
                                </select>
                            </label>
                            <label className="field"><span>Quick view</span>
                                <select aria-label="Quick view" value={filters.quickView} onChange={(event) => updateQuery({ quickView: event.target.value, mine: false })}>
                                    {quickViews.map(([value, label]) => <option key={value} value={value} disabled={value === 'created' && !canFilterCreator}>
                                        {label}{value === 'created' && !canFilterCreator ? ' (unavailable)' : ''}
                                    </option>)}
                                </select>
                            </label>
                            <label className="field"><span>Sort direction</span>
                                <select aria-label="Sort direction" value={filters.direction} onChange={(event) => updateQuery({ direction: event.target.value })}>
                                    <option value="asc">Ascending</option><option value="desc">Descending</option>
                                </select>
                            </label>
                        </div>
                    </details>
                    <details className="task-filter-menu label-filter-menu">
                        <summary><Tags size={15} />Labels{filters.labelIds.length > 0 ? ` · ${filters.labelIds.length}` : ''}</summary>
                        <fieldset className="label-filter filter-popover">
                            <legend>Labels · matches all selected</legend>
                            {labels.map((label) => <label className="checkbox" key={label.id}>
                                <input type="checkbox" checked={filters.labelIds.includes(label.id)} onChange={(event) => {
                                    updateQuery({ labelIds: event.target.checked ? [...filters.labelIds, label.id] : filters.labelIds.filter((id) => id !== label.id) });
                                }} />
                                <LabelBadges labels={[label]} />
                            </label>)}
                            {filters.labelIds.some((id) => !labels.some((label) => label.id === id)) &&
                                <span className="hint">A selected label is unavailable. Reset filters to clear it.</span>}
                            {!labels.length && !filters.labelIds.length && <span className="muted">No labels available.</span>}
                        </fieldset>
                    </details>
                </div>
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
                    <button aria-pressed={view === 'calendar'} className={view === 'calendar' ? 'active' : ''}
                        onClick={() => updateQuery({ view: 'calendar', month: filters.month || today.slice(0, 7) })}>
                        <CalendarDays size={15} />
                        Calendar
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
            {view === 'calendar' && <TaskCalendar tasks={visible} people={people} month={filters.month} today={today}
                onMonthChange={(month) => updateQuery({ month })} onOpen={onOpen} />}
            {view === 'board' && mobileStages.length > 0 && <nav className="mobile-stage-tabs" aria-label="Board stages">
                {mobileStages.map((stage) => <button type="button" key={stage.key} aria-pressed={selectedMobileStage === stage.key}
                    onClick={() => setMobileStage(stage.key)} title={stage.name}>
                    <span>{stage.name} <b>{stage.count}</b></span>
                </button>)}
            </nav>}
            {view === 'board' && groups.length === 0 && (
                <section className="panel" role="status">
                    <p>Board layout is unavailable or still loading. Your tasks are available in list view.</p>
                    <button type="button" className="button" onClick={() => updateQuery({ view: 'list' })}>Show list view</button>
                </section>
            )}
            {view === 'board' && boardGroups.length > 0 && (
                <section className="board" aria-label="Task board"
                    style={{ '--board-columns': Math.min(boardGroups.length, 4) }}>
                    {boardGroups.map((group) => {
                        const moveStatuses = boardMoveStatuses(group, dragTask);
                        return (
                            <section className={`board-column ${group.color}`} key={group.id}
                                data-mobile-active={selectedMobileStage === group.id}>
                                <div className="column-heading">
                                    <h2><i />{group.name}</h2>
                                    <span>{group.tasks.length}</span>
                                </div>
                                {dragId && moveStatuses.length > 0 && (
                                    <div className="drop-targets" aria-label={`Move task to ${group.name}`}>
                                        {moveStatuses.map((status) => {
                                            const allowed = canMoveTask(dragDetails, status, administrator);
                                            return (
                                                <button key={status} type="button" className="drop-target"
                                                    disabled={!allowed || moving}
                                                    onDragOver={(event) => {
                                                        if (allowed && !moving) {
                                                            event.preventDefault();
                                                            event.dataTransfer.dropEffect = 'move';
                                                        }
                                                    }}
                                                    onDrop={(event) => drop(event, status)}
                                                    onClick={(event) => drop(event, status)}>
                                                    {statusSettings?.catalog.find((item) => item.code === status)?.name || taskStatusName({ ...dragTask, status, statusName: null })}
                                                    {!dragDetails ? ' · loading permissions' : ''}
                                                </button>
                                            );
                                        })}
                                    </div>
                                )}
                                <div className="card-stack">
                                    {group.tasks.map((task) => (
                                        <div key={task.id} className="board-task">
                                            <TaskCard task={task} people={people} onOpen={onOpen}
                                                draggable={!moving && !bulkBusy}
                                                onDragStart={(event) => startDrag(event, task)}
                                                onDragEnd={() => setDragId(null)} />
                                            <TaskMoveMenu task={task} onOpen={onOpen} onError={setMoveError} />
                                        </div>
                                    ))}
                                    {!group.tasks.length && <p className="column-empty">No tasks in this stage</p>}
                                </div>
                            </section>
                        );
                    })}
                </section>
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
                                    <td>{task.discipline}<LabelBadges labels={task.labels} /></td>
                                    <td>
                                        <span className={`badge ${taskStatusTone(task)}`}>
                                            {taskStatusName(task)}
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
                <strong>Development and Drafting share this board</strong>
                <p>Filter by discipline to see its statuses. Open a task to see the status changes available to you.</p>
            </aside>
        </>
    );
}
