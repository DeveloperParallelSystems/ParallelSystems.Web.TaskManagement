import { useState } from 'react';
import { useSelector } from 'react-redux';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Building2, FolderOpen } from 'lucide-react';
import './client-navigation.css';
import { projectsForClient } from './projectClients';

export default function ClientsPage() {
    const { clients = [], projects, tasks } = useSelector((state) => state.workspace);
    const [search, setSearch] = useState('');
    const unassigned = projectsForClient(projects, clients, 'unassigned', tasks);
    const groups = clients.map((client) => ({ ...client, count: projectsForClient(projects, clients, client.id).length }));
    if (unassigned.length > 0) {
        groups.push({ id: 'unassigned', name: 'Unassigned projects', count: unassigned.length });
    }
    const query = search.trim().toLowerCase();
    const filtered = groups.filter((client) => client.name.toLowerCase().includes(query));
    return (
        <>
            <div className="section-heading">
                <p className="page-note">Choose a client, then a project to manage its tasks.</p>
            </div>
            <div className="panel client-directory-toolbar">
                <div>
                    <h2><Building2 size={16} aria-hidden="true" /> Clients</h2>
                    <p role="status">{filtered.length} of {groups.length} displayed</p>
                </div>
                <input type="search" className="client-search-input" aria-label="Search clients"
                    value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search clients…" />
            </div>
            <div className="project-grid">
                {filtered.map((client) => (
                    <Link className="project-card client-card" to={`/clients/${client.id}/projects`} key={client.id}>
                        <div className="project-card-top">
                            {client.id === 'unassigned' ? <FolderOpen size={24} /> : <Building2 size={24} />}
                            <ArrowUpRight size={19} />
                        </div>
                        <h2>{client.name}</h2>
                        <p>{client.count} {client.count === 1 ? 'project' : 'projects'}</p>
                    </Link>
                ))}
                {!filtered.length && <p className="empty">No clients match your search.</p>}
            </div>
            <div className="general-work-link panel">
                <div><strong>General tasks</strong><p>Tasks that have no project assigned · {tasks.filter((task) => !task.projectId).length} tasks</p></div>
                <Link className="button" to="/projects/general/tasks">Open general tasks</Link>
            </div>
        </>
    );
}
