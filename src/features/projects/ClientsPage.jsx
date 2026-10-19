import { useSelector } from 'react-redux';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Building2, FolderOpen } from 'lucide-react';
import './client-navigation.css';

export default function ClientsPage() {
    const { clients = [], projects, tasks } = useSelector((state) => state.workspace);
    const unassigned = projects.filter((project) => !project.clientId || !clients.some((client) => client.id === project.clientId));
    const groups = clients.map((client) => ({ ...client, count: projects.filter((project) => project.clientId === client.id).length }));
    if (unassigned.length > 0) {
        groups.push({ id: 'unassigned', name: 'Unassigned projects', count: unassigned.length });
    }
    return (
        <>
            <div className="section-heading">
                <p className="page-note">Choose a client, then a project to manage its tasks.</p>
            </div>
            <div className="project-grid">
                {groups.map((client) => (
                    <Link className="project-card client-card" to={`/clients/${client.id}/projects`} key={client.id}>
                        <div className="project-card-top">
                            {client.id === 'unassigned' ? <FolderOpen size={24} /> : <Building2 size={24} />}
                            <ArrowUpRight size={19} />
                        </div>
                        <h2>{client.name}</h2>
                        <p>{client.count} {client.count === 1 ? 'project' : 'projects'}</p>
                    </Link>
                ))}
            </div>
            <div className="general-work-link panel">
                <div><strong>General tasks</strong><p>Tasks that have no project assigned · {tasks.filter((task) => !task.projectId).length} tasks</p></div>
                <Link className="button" to="/projects/general/tasks">Open general tasks</Link>
            </div>
        </>
    );
}
