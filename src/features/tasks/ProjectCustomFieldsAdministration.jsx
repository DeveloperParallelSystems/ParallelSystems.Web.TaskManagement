import { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { invalidateTaskDetails, loadWorkspace } from '../../app/store';
import { archiveCustomField, emptyCustomFields, fieldDefinitionError, loadCustomFields, saveCustomField } from './customFields';
import { customFieldTypes } from './customFieldValues';

const typeLabels = { Text: 'Text — enter a note', Number: 'Number — enter an amount', Date: 'Date — choose a date',
    Checkbox: 'Checkbox — choose Yes or No', Person: 'Person — select a staff member' };

export default function ProjectCustomFieldsAdministration({ projectId, disabled = false, onEditingChange }) {
    const dispatch = useDispatch();
    const resource = useSelector((state) => state.workspace.customFields?.[projectId] || emptyCustomFields);
    const revision = useSelector((state) => state.workspace.taskColumnsRevision || 0);
    const epoch = useSelector((state) => state.workspace.taskColumnsEpoch || 0);
    const [draft, setDraft] = useState(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    const [message, setMessage] = useState('');
    const fields = resource.data?.fields || [];
    const stale = resource.invalidated || resource.data?.version !== revision || Boolean(draft && draft.version !== revision) || error?.status === 409;
    const unavailable = !resource.data || !resource.data.canManage || stale;
    const validation = draft ? fieldDefinitionError(draft, fields) : '';

    useEffect(() => {
        dispatch(loadCustomFields(projectId));
    }, [dispatch, projectId, revision, epoch]);
    useEffect(() => {
        onEditingChange({ dirty: Boolean(draft), saving: busy });
    }, [draft, busy, onEditingChange]);
    useEffect(() => () => onEditingChange({ dirty: false, saving: false }), [onEditingChange]);

    async function reload() {
        if (draft && !window.confirm('Discard unsaved field changes and reload project fields?')) {
            return;
        }
        setBusy(true);
        setError(null);
        try {
            await dispatch(loadCustomFields(projectId)).unwrap();
            setDraft(null);
        }
        catch (failure) {
            setError(failure);
        }
        finally {
            setBusy(false);
        }
    }

    async function mutate(field, restore) {
        if (busy || disabled || unavailable || (field ? Boolean(draft) : !draft || validation)) {
            return;
        }
        if (field && !restore && !window.confirm(`Archive “${field.name}”? Saved task values will be retained and hidden until this field is restored.`)) {
            return;
        }
        setBusy(true);
        setError(null);
        setMessage('');
        try {
            if (field) {
                await dispatch(archiveCustomField({ projectId, fieldId: field.id, version: resource.data.version, restore })).unwrap();
            }
            else {
                await dispatch(saveCustomField({ ...draft, projectId })).unwrap();
            }
            setDraft(null);
            dispatch(invalidateTaskDetails());
            dispatch(loadWorkspace());
            setMessage(field ? restore ? 'Field restored. Saved task values are available again.' : 'Field archived. Saved task values are retained.' : 'Project field saved.');
        }
        catch (failure) {
            setError(failure);
        }
        finally {
            setBusy(false);
        }
    }

    return <section className="panel project-custom-fields" aria-labelledby="project-custom-fields-heading">
        <div className="panel-heading"><h2 id="project-custom-fields-heading">Project custom fields</h2>
            <button type="button" className="button" disabled={disabled || busy || Boolean(resource.readId)} onClick={reload}>Reload project fields</button></div>
        <p className="hint">Create fields shared by Development and Drafting in this project. Person fields record information without changing task ownership or access. Types are fixed after creation.</p>
        <p className="hint">For example: Assigned Developer → Person; Date Started → Date.</p>
        {(error || resource.error) && <p className="error" role="alert">{(error || resource.error).message || 'Could not load project fields.'}</p>}
        {stale && resource.data && <p className="hint" role="status">Project fields changed or are refreshing. Reload before saving your field draft.</p>}
        {message && <p role="status">{message}</p>}
        {!resource.data ? <p role="status">Loading project fields…</p> : <>
            <div className="table-wrap"><table><thead><tr><th>Field</th><th>Type</th><th>State</th><th>Actions</th></tr></thead>
                <tbody>{fields.map((field) => <tr key={field.id}><td>{field.name}</td><td>{field.type}</td><td>{field.isArchived ? 'Archived' : 'Active'}</td>
                    <td><button type="button" className="text-button" disabled={disabled || busy || unavailable || Boolean(draft)}
                        aria-label={`Edit ${field.name}`} onClick={() => {
                            setDraft({ ...field, version: resource.data.version });
                            setMessage('');
                        }}>Edit</button>
                    <button type="button" className="text-button" disabled={disabled || busy || unavailable || Boolean(draft)}
                        aria-label={`${field.isArchived ? 'Restore' : 'Archive'} ${field.name}`} onClick={() => mutate(field, field.isArchived)}>{field.isArchived ? 'Restore' : 'Archive'}</button></td>
                </tr>)}</tbody></table></div>
            {!fields.length && <p>No custom fields yet. Add a person, date or other project detail.</p>}
            {!draft && <button type="button" className="button" disabled={disabled || busy || unavailable || fields.length >= 30}
                onClick={() => {
                    setDraft({ name: '', type: 'Text', version: resource.data.version });
                    setMessage('');
                }}>Add field</button>}
            {draft && <form className="form-grid" onSubmit={(event) => {
                event.preventDefault();
                return mutate();
            }}>
                <label className="field"><span>Field name</span><input autoFocus required maxLength={80} value={draft.name}
                    disabled={disabled || busy} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} /></label>
                <label className="field"><span>Field type</span><select value={draft.type} disabled={disabled || busy || Boolean(draft.id)}
                    onChange={(event) => setDraft((current) => ({ ...current, type: event.target.value }))}>
                    {customFieldTypes.map((type) => <option key={type} value={type}>{typeLabels[type]}</option>)}
                </select></label>
                {validation && <p className="hint full">{validation}</p>}
                <div className="full presentation-toolbar-actions"><button type="button" className="button" disabled={busy} onClick={() => setDraft(null)}>Cancel field changes</button>
                    <button className="button primary" disabled={disabled || busy || unavailable || Boolean(validation)}>Save field</button></div>
            </form>}
        </>}
    </section>;
}
