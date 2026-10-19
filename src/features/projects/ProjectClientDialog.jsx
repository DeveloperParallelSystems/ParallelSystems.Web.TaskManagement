import { useEffect, useRef, useState } from 'react';
import { useSelector } from 'react-redux';
import { request } from '../../app/api';

export default function ProjectClientDialog({ project, onClose, onSaved }) {
    const clients = useSelector((state) => state.workspace.clients || []);
    const dialog = useRef(null);
    const [clientId, setClientId] = useState(project.clientId || '');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    useEffect(() => {
        dialog.current.showModal();
    }, []);

    function close() {
        if (!saving && (clientId === (project.clientId || '') || window.confirm('Discard client assignment changes?'))) {
            onClose();
        }
    }

    async function submit(event) {
        event.preventDefault();
        setSaving(true);
        setError('');
        try {
            await request(`/projects/${project.id}/client`, { method: 'PUT', body: { clientId: clientId || null } });
            onSaved();
        }
        catch (failure) {
            setError(failure.message || 'Unable to change client.');
            setSaving(false);
        }
    }

    return (
        <dialog ref={dialog} className="project-dialog" aria-labelledby="project-client-title" onCancel={(event) => {
            event.preventDefault();
            close();
        }}>
            <form onSubmit={submit}>
                <div className="drawer-head"><h2 id="project-client-title">Change client</h2></div>
                <div className="drawer-body">
                    <p>{project.name}</p>
                    {error && <div className="error" role="alert">{error}</div>}
                    <label className="field"><span>Client (optional)</span>
                        <select autoFocus value={clientId} disabled={saving} onChange={(event) => setClientId(event.target.value)}>
                            <option value="">No client · unassigned</option>
                            {clients.map((client) => <option value={client.id} key={client.id}>{client.name}</option>)}
                        </select>
                    </label>
                </div>
                <div className="drawer-footer">
                    <button type="button" className="button" onClick={close} disabled={saving}>Cancel</button>
                    <button className="button primary" disabled={saving}>{saving ? 'Saving…' : 'Save client'}</button>
                </div>
            </form>
        </dialog>
    );
}
