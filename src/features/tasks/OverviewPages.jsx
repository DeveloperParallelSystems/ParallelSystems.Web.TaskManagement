import { useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { ArrowUpRight, FolderOpen } from 'lucide-react';
import { getProjectContributors } from './workflow';
import { taskKind } from './taskWorkflow';
import { defaultTaskQuery, serializeTaskQuery } from './taskQuery';
import { ContributorAvatars } from './TaskContributors';

export { default as Dashboard } from './ClientDashboard.jsx';

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
