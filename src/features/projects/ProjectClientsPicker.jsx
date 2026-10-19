import './client-navigation.css';

export default function ProjectClientsPicker({ clients, clientIds, onChange, disabled = false }) {
    return (
        <fieldset className="project-clients-picker" disabled={disabled}>
            <legend>Clients (optional)</legend>
            <p className="project-dialog-help">Choose all clients for this project. Existing unassigned tasks stay in Unassigned until you move them to a client workspace.</p>
            <div className="project-clients-options">
                {clients.map((client) => (
                    <label className="checkbox" key={client.id}>
                        <input type="checkbox" checked={clientIds.includes(client.id)} disabled={disabled}
                            onChange={(event) => onChange(event.target.checked
                                ? [...clientIds, client.id] : clientIds.filter((id) => id !== client.id))} />
                        <span>{client.name}</span>
                    </label>
                ))}
                {!clients.length && <p className="hint">No clients are available.</p>}
            </div>
        </fieldset>
    );
}
