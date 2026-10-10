import { useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import { ArrowUpRight, FolderOpen } from 'lucide-react';
import { clearFilters, setFilters } from '../../app/store';
import { Stats, TaskCard } from './TasksPage';
import { groups, isOverdue } from './workflow';

export function Dashboard({ onOpen }) {
    const { tasks } = useSelector((state) => state.workspace);
    const overdue = tasks.filter((task) => isOverdue(task));
    const blocked = tasks.filter((task) => ['Blocked', 'Failed Review'].includes(task.status));
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
                        {groups.map((group) => {
                            const count = tasks.filter((task) => group.statuses.includes(task.status)).length;
                            return (
                                <div className="progress-row" key={group.name}>
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
                        <span>blocked or returned for corrections</span>
                    </div>
                    <p className="muted">Review due dates and handoffs to keep work moving.</p>
                </section>
            </div>
            <div className="section-heading">
                <h2>{overdue.length ? 'Overdue tasks' : 'Recently updated'}</h2>
            </div>
            <div className="overview-cards">
                {(overdue.length ? overdue : tasks).slice(0, 8).map((task) => (
                    <TaskCard key={task.id} task={task} onOpen={onOpen} />
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

export function ProjectsPage() {
    const { tasks, projects } = useSelector((state) => state.workspace);
    const dispatch = useDispatch();
    const navigate = useNavigate();
    return (
        <>
            <p className="page-note">
                Keep your projects together. Open a project to see its tasks.
            </p>
            <div className="project-grid">
                {projects.map((project) => {
                    const related = tasks.filter((task) => task.projectId === project.id);
                    const completed = related.filter((task) => task.status === 'Completed').length;
                    return (
                        <button
                            className="project-card"
                            key={project.id}
                            onClick={() => {
                                dispatch(clearFilters());
                                dispatch(setFilters({ projectId: project.id }));
                                navigate('/tasks');
                            }}
                        >
                            <div className="project-card-top">
                                <FolderOpen size={24} />
                                <ArrowUpRight size={19} />
                            </div>
                            <h2>{project.name}</h2>
                            <p>
                                {related.length} tasks · {completed} completed
                            </p>
                            <progress
                                max={Math.max(1, related.length)}
                                value={completed}
                                aria-label={`${project.name} completion`}
                            />
                        </button>
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
