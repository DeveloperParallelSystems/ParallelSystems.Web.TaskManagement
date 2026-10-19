import { useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { FolderPlus } from 'lucide-react';
import { loadWorkspace } from '../../app/store';
import { ProjectCard } from '../tasks/OverviewPages';
import ProjectDialog from './ProjectDialog';
import ProjectClientDialog from './ProjectClientDialog';

export default function ClientProjectsPage() {
    const { clientId } = useParams();
    const { clients = [], projects, tasks, people } = useSelector((state) => state.workspace);
    const administrator = useSelector((state) => state.auth.user.role === 'Administrator');
    const navigate = useNavigate();
    const dispatch = useDispatch();
    const [creating, setCreating] = useState(false);
    const [editing, setEditing] = useState(null);
    const client = clients.find((item) => item.id === clientId);
    const unassigned = clientId === 'unassigned';
    if (clientId && !unassigned && !client) {
        return <div className="empty panel"><h2>Client unavailable</h2><Link to="/clients">Back to clients</Link></div>;
    }
    const visible = projects.filter((project) => !clientId || (unassigned
        ? !project.clientId || !clients.some((item) => item.id === project.clientId)
        : project.clientId === clientId));
    return (
        <>
            <div className="section-heading">
                <p className="page-note">{client?.name || (unassigned ? 'Unassigned projects' : 'All projects')} · {visible.length} projects</p>
                {administrator && <button className="button" onClick={() => setCreating(true)}><FolderPlus size={17} />New project</button>}
            </div>
            <div className="project-grid">
                {visible.map((project) => (
                    <div className="client-project" key={project.id}>
                        <ProjectCard project={project} tasks={tasks.filter((task) => task.projectId === project.id)} people={people}
                            onOpen={(id) => navigate(`/projects/${id}/tasks`)} />
                        {administrator && <button className="button project-client-button" onClick={() => setEditing(project)}
                            aria-label={`Change client for ${project.name}`}>Change client</button>}
                    </div>
                ))}
            </div>
            {!visible.length && <div className="empty panel"><h2>No projects here yet</h2>
                <p>{administrator ? 'Create a project here or move an existing project using Change client.' : 'Projects appear when you have access to their tasks.'}</p>
                <Link to="/clients/unassigned/projects">View unassigned projects</Link>
            </div>}
            {creating && <ProjectDialog initialClientId={client?.id || ''} onClose={() => setCreating(false)} onCreated={() => {
                setCreating(false);
                dispatch(loadWorkspace());
            }} />}
            {editing && <ProjectClientDialog project={editing} onClose={() => setEditing(null)} onSaved={() => {
                setEditing(null);
                dispatch(loadWorkspace());
            }} />}
        </>
    );
}
