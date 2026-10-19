import { useCallback, useState } from 'react';
import { useSelector } from 'react-redux';
import WorkflowPresentationPage from './WorkflowPresentationPage';
import { projectsForClient } from '../projects/projectClients';

export default function BoardPresentationAdministration({ onEditingChange }) {
    const { clients = [], projects = [] } = useSelector((state) => state.workspace);
    const [mode, setMode] = useState('default');
    const [clientId, setClientId] = useState('');
    const [projectId, setProjectId] = useState('');
    const [editing, setEditing] = useState({ dirty: false, saving: false });
    const reportEditing = useCallback((value) => {
        setEditing(value);
        onEditingChange(value);
    }, [onEditingChange]);
    const unassigned = projectsForClient(projects, clients, 'unassigned');
    const availableProjects = projectsForClient(projects, clients, clientId);
    const selectedProject = availableProjects.find((project) => project.id === projectId);
    const selectedClient = clients.find((client) => client.id === clientId);

    function canSwitch() {
        return !editing.saving && (!editing.dirty || window.confirm('Discard your unsaved board changes and switch layouts?'));
    }

    return <>
        <div className="presentation-scope" aria-label="Board presentation scope">
            <label>Layout
                <select value={mode} disabled={editing.saving} onChange={(event) => {
                    if (canSwitch()) {
                        setMode(event.target.value);
                    }
                }}>
                    <option value="default">Default layout</option>
                    <option value="project">Project layout</option>
                </select>
            </label>
            {mode === 'project' && <>
                <label>Client
                    <select value={clientId} disabled={editing.saving} onChange={(event) => {
                        if (canSwitch()) {
                            setClientId(event.target.value);
                            setProjectId('');
                        }
                    }}>
                        <option value="">Select a client</option>
                        {clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
                        {unassigned.length > 0 && <option value="unassigned">Unassigned projects</option>}
                    </select>
                </label>
                <label>Project
                    <select value={selectedProject?.id || ''} disabled={!clientId || editing.saving} onChange={(event) => {
                        if (canSwitch()) {
                            setProjectId(event.target.value);
                        }
                    }}>
                        <option value="">Select a project</option>
                        {availableProjects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
                    </select>
                </label>
            </>}
        </div>
        {mode === 'default' || selectedProject ? <WorkflowPresentationPage
            key={mode === 'default' ? 'default' : selectedProject.id}
            projectId={mode === 'project' ? selectedProject.id : null}
            projectName={mode === 'project' ? selectedProject.name : ''}
            clientName={selectedClient?.name || 'Unassigned projects'}
            onEditingChange={reportEditing} />
            : <p className="hint">Select a client and project to view its board presentation.</p>}
    </>;
}
