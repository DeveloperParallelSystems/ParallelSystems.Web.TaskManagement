import { useEffect, useRef } from 'react';
import { ChevronDown } from 'lucide-react';

export default function ClientDashboardFilters({ clients, selected, onSelect, due, onDueChange, sort, onSortChange }) {
    const pickerRef = useRef(null);
    useEffect(() => {
        function dismiss(event) {
            const picker = pickerRef.current;
            if (picker && !picker.contains(event.target)) {
                picker.open = false;
            }
        }
        document.addEventListener('pointerdown', dismiss);
        return () => document.removeEventListener('pointerdown', dismiss);
    }, []);

    return <div className="client-dashboard-filters" aria-label="Client dashboard filters">
        <div className="client-dashboard-filter">
            <span id="dashboard-client-picker-label">Clients</span>
            <details ref={pickerRef} className="dashboard-client-picker"
                onBlur={(event) => {
                    if (!event.currentTarget.contains(event.relatedTarget)) {
                        event.currentTarget.open = false;
                    }
                }} onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                        event.preventDefault();
                        event.stopPropagation();
                        pickerRef.current.open = false;
                        pickerRef.current.querySelector('summary').focus();
                    }
                }}>
                <summary aria-labelledby="dashboard-client-picker-label dashboard-client-picker-value">
                    <span id="dashboard-client-picker-value">{selected.length === clients.length && clients.length
                        ? 'All clients' : `${selected.length} selected`}</span>
                    <ChevronDown size={16} aria-hidden="true" />
                </summary>
                <div className="dashboard-client-options">
                    <div className="dashboard-client-actions">
                        <button type="button" className="text-button" onClick={() => onSelect(null)}>Select all</button>
                        <button type="button" className="text-button" onClick={() => onSelect([])}>Clear</button>
                    </div>
                    <div className="dashboard-client-choices" role="group" aria-label="Choose clients">
                        {clients.map((client) => <label className="checkbox" key={client.id}>
                            <input type="checkbox" checked={selected.includes(client.id)} onChange={(event) =>
                                onSelect(event.target.checked ? [...selected, client.id] : selected.filter((id) => id !== client.id))} />
                            <span>{client.name}</span>
                        </label>)}
                        {!clients.length && <p className="muted">No clients available.</p>}
                    </div>
                </div>
            </details>
        </div>
        <label className="client-dashboard-filter">
            <span>Due date</span>
            <select value={due} onChange={(event) => onDueChange(event.target.value)}>
                <option value="all">All dates</option>
                <option value="week">Due this week</option>
                <option value="overdue">Overdue only</option>
            </select>
        </label>
        <label className="client-dashboard-filter">
            <span>Sort clients</span>
            <select value={sort} onChange={(event) => onSortChange(event.target.value)}>
                <option value="overdue">Most overdue</option>
                <option value="projects">Most projects</option>
                <option value="week">Most due this week</option>
                <option value="withoutOwner">Most tasks without owner</option>
                <option value="name">Name (A–Z)</option>
            </select>
        </label>
    </div>;
}
