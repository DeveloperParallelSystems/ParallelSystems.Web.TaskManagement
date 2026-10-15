import { useEffect, useId, useRef, useState } from 'react';
import { Pencil, Plus, Save, Trash2 } from 'lucide-react';
import { catalogDeleteReason, removeCatalogStatus, saveCatalogName } from './statusCatalog';
import './status-catalog.css';

export default function StatusCatalogTable({ settings, tasks, disabled, busy, onSave, onEditingChange }) {
    const [editor, setEditor] = useState(null);
    const [error, setError] = useState('');
    const inputRef = useRef(null);
    const reasonId = useId();

    useEffect(() => {
        onEditingChange(Boolean(editor));
        return () => onEditingChange(false);
    }, [editor, onEditingChange]);
    useEffect(() => {
        if (editor) {
            inputRef.current?.focus();
        }
    }, [editor?.code]);

    function edit(item = { code: null, name: '' }) {
        if (editor && !window.confirm('Discard the unsaved status name?')) {
            return;
        }
        setError('');
        setEditor({ code: item.code, name: item.name });
    }

    async function save(event) {
        event.preventDefault();
        if (disabled || !editor) {
            return;
        }
        setError('');
        try {
            const next = saveCatalogName(settings, editor);
            const message = editor.code ? 'Status updated.' : 'Status added. Assign it under Discipline statuses.';
            if (await onSave(next, message)) {
                setEditor(null);
            }
        }
        catch (failure) {
            setError(failure.message);
        }
    }

    async function remove(item) {
        if (disabled || editor || catalogDeleteReason(settings, tasks, item.code)) {
            return;
        }
        if (!window.confirm(`Delete the unused status “${item.name}” from the catalog?`)) {
            return;
        }
        setError('');
        try {
            await onSave(removeCatalogStatus(settings, tasks, item.code), 'Status deleted.');
        }
        catch (failure) {
            setError(failure.message);
        }
    }

    return <section className="panel status-catalog-panel" aria-label="Shared status catalog" aria-busy={busy}>
        <div className="status-catalog-heading">
            <div>
                <h2>Shared status catalog</h2>
                <p className="hint">Add or edit shared names. Delete is available only for unused, unassigned statuses.</p>
            </div>
            <button type="button" className="button primary" disabled={disabled} onClick={() => edit()}>
                <Plus size={16} aria-hidden="true" />Add status
            </button>
        </div>
        {error && <p className="error" role="alert">{error}</p>}
        {editor && <form className="status-catalog-editor" onSubmit={save} aria-labelledby="catalog-editor-title">
            <h3 id="catalog-editor-title">{editor.code ? 'Edit status' : 'Add status'}</h3>
            <label className="field"><span>Status name</span>
                <input ref={inputRef} value={editor.name} required maxLength={80} disabled={busy}
                    onChange={(event) => setEditor({ ...editor, name: event.target.value })} />
            </label>
            <div className="form-actions">
                <button className="button primary" disabled={disabled || !editor.name.trim()}>
                    <Save size={16} aria-hidden="true" />{busy ? 'Saving…' : 'Save status'}
                </button>
                <button type="button" className="button" disabled={busy} onClick={() => {
                    setEditor(null);
                    setError('');
                }}>Cancel</button>
            </div>
        </form>}
        <div className="status-catalog-scroll" tabIndex={0} role="region" aria-label="Status catalog table">
            <table className="status-catalog-table">
                <caption className="sr-only">Shared status definitions and deletion availability</caption>
                <thead><tr>
                    <th scope="col">Status</th>
                    <th scope="col">Type</th>
                    <th scope="col">Assigned disciplines</th>
                    <th scope="col">Usage</th>
                    <th scope="col">Actions</th>
                </tr></thead>
                <tbody>{settings.catalog.map((item, index) => {
                    const reason = catalogDeleteReason(settings, tasks, item.code);
                    const assigned = settings.disciplines.filter((entry) => entry.statuses.includes(item.code));
                    const inUse = tasks.some((task) => task.status === item.code);
                    const descriptionId = `${reasonId}-${index}`;
                    let usage = assigned.length ? 'Assigned' : 'Unused';
                    if (inUse) {
                        usage = 'In use by tasks';
                    }
                    return <tr key={item.code}>
                        <th scope="row">{item.name}</th>
                        <td>{item.isCustom === false ? 'Default' : 'Custom'}</td>
                        <td>{assigned.map((entry) => entry.discipline).join(', ') || 'Unassigned'}</td>
                        <td><span className={`status-catalog-usage ${inUse ? 'in-use' : ''}`}>
                            {usage}
                        </span>
                            {reason && <small id={descriptionId}>{reason}</small>}
                        </td>
                        <td><div className="status-catalog-actions">
                            <button type="button" className="button" aria-label={`Edit ${item.name}`}
                                disabled={disabled || item.code === 'To Do'} title={item.code === 'To Do' ? reason : undefined}
                                onClick={() => edit(item)}><Pencil size={14} aria-hidden="true" />Edit</button>
                            <button type="button" className="button" aria-label={`Delete ${item.name}`}
                                disabled={disabled || Boolean(editor) || Boolean(reason)} aria-describedby={reason ? descriptionId : undefined}
                                onClick={() => remove(item)}><Trash2 size={14} aria-hidden="true" />Delete</button>
                        </div></td>
                    </tr>;
                })}</tbody>
            </table>
        </div>
    </section>;
}
