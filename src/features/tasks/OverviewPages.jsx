import { useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { ArrowUpRight, FolderOpen } from 'lucide-react';
import { Stats, TaskCard } from './TasksPage';
import { getProjectContributors, isOverdue } from './workflow';
import { taskKind, workflowBoards } from './taskWorkflow';
import { selectPresentationGroups } from './workflowPresentation';
import { defaultTaskQuery, serializeTaskQuery } from './taskQuery';
import { ContributorAvatars } from './TaskContributors';

export function Dashboard({ onOpen }) {
    const groups = useSelector(selectPresentationGroups);
    const { tasks, people } = useSelector((state) => state.workspace);
    const statusSettings = useSelector((state) => state.workspace.statusSettings?.data);
    const disciplineWorkflows = useSelector((state) => state.workspace.disciplineWorkflows?.data?.items);
    const overdue = tasks.filter((task) => isOverdue(task));
    const blocked = tasks.filter((task) => !task.workflow && ['Blocked', 'Failed Review'].includes(task.status));
    const waiting = tasks.filter((task) => taskKind(task) === 'Review');
    const summaries = workflowBoards(tasks, groups, {
        statusSettings,
        workflows: (disciplineWorkflows || []).map((item) => item.active).filter(Boolean),
    })[0]?.groups || [];
    const overdueByPerson = Object.values(overdue.reduce((counts, task) => {
        const key = task.assigneeId || 'unassigned';
        counts[key] ||= { id: key, name: task.assigneeName || 'Unassigned', count: 0 };
        counts[key].count++;
        return counts;
    }, {})).sort((first, second) => second.count - first.count || first.name.localeCompare(second.name));
    return (
        <>
            <Stats tasks={tasks} />
            <div className="dashboard-grid">
                <section className="panel">
                    <div className="panel-heading">
                        <h2>Work at a glance</h2>
                        <span className="muted">Your visible tasks</span>
                    </div>
                    <div className="progress-list">
                        {!summaries.length && <p role="status">Board layout is unavailable or still loading. Task totals remain available.</p>}
                        {summaries.map((group) => {
                            const count = group.tasks.length;
                            return (
                                <div className="progress-row" key={group.id}>
                                    <div>
                                        <span>{group.name}</span>
                                        <strong>{count}</strong>
                                    </div>
                                    <progress
                                        max={Math.max(1, tasks.length)}
                                        value={count}
                                        aria-label={group.name}
                                    />
                                </div>
                            );
                        })}
                    </div>
                </section>
                <section className="panel">
                    <div className="panel-heading">
                        <h2>Needs attention</h2>
                    </div>
                    <div className="attention">
                        <strong>{overdue.length}</strong>
                        <span>overdue tasks</span>
                        <strong>{blocked.length}</strong>
                        <span>legacy tasks blocked or returned for corrections</span>
                        <strong>{waiting.length}</strong>
                        <span>waiting on review</span>
                    </div>
                    <p className="muted">Review due dates and handoffs to keep work moving.</p>
                </section>
            </div>
            <section className="panel overdue-people" aria-label="Overdue tasks by person">
                <h2>Overdue by current owner</h2>
                {!overdueByPerson.length && <p className="muted">No overdue tasks in your visible work.</p>}
                {overdueByPerson.map((person) => (
                    <div className="progress-row" key={person.id}>
                        <div><span>{person.name}</span><strong>{person.count}</strong></div>
                    </div>
                ))}
            </section>
            <div className="section-heading">
                <h2>{overdue.length ? 'Overdue tasks' : 'Recently updated'}</h2>
            </div>
            <div className="overview-cards">
                {(overdue.length ? overdue : tasks).slice(0, 8).map((task) => (
                    <TaskCard key={task.id} task={task} people={people} onOpen={onOpen} />
                ))}
            </div>
            {!tasks.length && (
                <div className="empty panel">
                    <h2>Your workspace is ready</h2>
                    <p>Task progress and recent activity will appear here as work is assigned.</p>
                </div>
            )}
        </>
    );
}

export function ProjectCard({ project, tasks, people, onOpen }) {
    const completed = tasks.filter((task) => taskKind(task) === 'Completed').length;
    const contributors = getProjectContributors(tasks, project.id);

    return (
        <article className="project-card">
            <button type="button" className="project-card-open" onClick={() => onOpen(project.id)}
                aria-label={`Open ${project.name} tasks`}>
                <div className="project-card-top">
                    <FolderOpen size={24} />
                    <ArrowUpRight size={19} />
                </div>
                <h2>{project.name}</h2>
                <p>{tasks.length} {tasks.length === 1 ? 'task' : 'tasks'} · {completed} completed</p>
                <progress max={Math.max(1, tasks.length)} value={completed} aria-label={`${project.name} completion`} />
            </button>
            <div className="project-contributors">
                <span className="project-contributors-heading">Contributors <span>{contributors.length}</span></span>
                <ContributorAvatars roles={contributors} people={people} groupLabel={`${project.name} contributors`} />
            </div>
        </article>
    );
}

export function ProjectsPage() {
    const { tasks, projects, people } = useSelector((state) => state.workspace);
    const navigate = useNavigate();
    return (
        <>
            <p className="page-note">
                Keep your projects together. Open a project to see its tasks.
            </p>
            <div className="project-grid">
                {projects.map((project) => {
                    const related = tasks.filter((task) => task.projectId === project.id);
                    return (
                        <ProjectCard
                            key={project.id}
                            project={project}
                            tasks={related}
                            people={people}
                            onOpen={(projectId) => {
                                navigate(`/tasks?${serializeTaskQuery({ ...defaultTaskQuery, projectId })}`);
                            }}
                        />
                    );
                })}
            </div>
            {!projects.length && (
                <div className="empty panel">
                    <h2>No projects available</h2>
                    <p>
                        Existing projects will appear here when available to your account. Tasks can also
                        belong to General.
                    </p>
                </div>
            )}
        </>
    );
}
