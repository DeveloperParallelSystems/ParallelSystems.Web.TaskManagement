import { useEffect, useRef, useState } from 'react';
import { useSelector } from 'react-redux';
import { request } from '../../app/api';
import ProjectClientsPicker from './ProjectClientsPicker';
import { projectClientIds } from './projectClients';

export default function ProjectClientDialog({ project, onClose, onSaved }) {
    const clients = useSelector((state) => state.workspace.clients || []);
    const dialog = useRef(null);
    const [initialClientIds] = useState(() => projectClientIds(project, clients));
    const [clientIds, setClientIds] = useState(initialClientIds);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    useEffect(() => {
        dialog.current.showModal();
    }, []);

    function close() {
        const unchanged = clientIds.length === initialClientIds.length && clientIds.every((id) => initialClientIds.includes(id));
        if (!saving && (unchanged || window.confirm('Discard client assignment changes?'))) {
            onClose();
        }
    }

    async function submit(event) {
        event.preventDefault();
        setSaving(true);
        setError('');
        try {
            await request(`/projects/${project.id}/clients`, { method: 'PUT', body: { clientIds } });
            onSaved();
        }
        catch (failure) {
            setError(failure.message || 'Unable to change clients.');
            setSaving(false);
        }
    }

    return (
        <dialog ref={dialog} className="project-dialog" aria-labelledby="project-client-title" onCancel={(event) => {
            event.preventDefault();
            close();
        }}>
            <form onSubmit={submit}>
                <div className="drawer-head"><h2 id="project-client-title">Manage clients</h2></div>
                <div className="drawer-body">
                    <p>{project.name}</p>
                    {error && <div className="error" role="alert">{error}</div>}
                    <ProjectClientsPicker clients={clients} clientIds={clientIds} onChange={setClientIds} disabled={saving} />
                </div>
                <div className="drawer-footer">
                    <button type="button" className="button" onClick={close} disabled={saving}>Cancel</button>
                    <button className="button primary" disabled={saving}>{saving ? 'Saving…' : 'Save clients'}</button>
                </div>
            </form>
        </dialog>
    );
}
