import { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Search, X } from 'lucide-react';
import { assignTaskLabels, labelOptions } from './labelState.js';
import LabelBadges, { labelStyle } from './LabelBadges';
import './label-design.css';

export function LabelPickerChoices({ options, selected, query, onToggle }) {
    const search = query.trim().toLocaleLowerCase();
    const matching = options.filter((label) => label.name.toLocaleLowerCase().includes(search));

    return <div className="label-picker-choices">
        {matching.map((label) => <label className={`checkbox label-picker-choice ${selected.includes(label.id) ? 'is-selected' : ''}`} key={label.id}>
            <input type="checkbox" checked={selected.includes(label.id)}
                disabled={!selected.includes(label.id) && selected.length >= 20}
                onChange={(event) => onToggle(label.id, event.target.checked)} />
            <span className="label-color-dot" style={{ backgroundColor: labelStyle(label.color).backgroundColor }} aria-hidden="true" />
            <span>{label.name}{!label.active && ' (inactive)'}</span>
        </label>)}
        {!matching.length && <p className="label-empty" role="status">{options.length ? 'No labels match your search.' : 'Create label definitions on the Labels page first.'}</p>}
    </div>;
}

export default function TaskLabels({ task, disabled, onEditingChange, onSaved, onFailure, integrated = false }) {
    const dispatch = useDispatch();
    const { labels = [], tasks } = useSelector((state) => state.workspace);
    const administrator = useSelector((state) => state.auth.user?.role === 'Administrator');
    const [selected, setSelected] = useState(() => (task.labels || []).map((label) => label.id));
    const [dirty, setDirty] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);
    const [query, setQuery] = useState('');
    const visible = tasks.some((item) => item.id === task.id);
    const definitions = new Map(labels.map((label) => [label.id, label]));
    for (const assigned of task.labels || []) {
        const definition = definitions.get(assigned.id);
        if (!definition || assigned.version > definition.version) {
            definitions.set(assigned.id, assigned);
        }
    }
    const options = labelOptions([...definitions.values()], task.labels, selected);
    const selectedLabels = options.filter((label) => selected.includes(label.id));

    function toggleLabel(id, checked) {
        setSelected((current) => checked ? [...current, id] : current.filter((selectedId) => selectedId !== id));
        setDirty(true);
    }

    useEffect(() => {
        onEditingChange({ dirty, saving, ...(integrated ? { labelIds: selected } : {}) });
    }, [dirty, saving, selected, integrated, onEditingChange]);
    useEffect(() => () => onEditingChange({ dirty: false, saving: false }), [onEditingChange]);
    useEffect(() => {
        if (integrated) {
            setSelected((task.labels || []).map((label) => label.id));
            setDirty(false);
            setError(null);
        }
    }, [integrated, task.id, task.version]);

    async function save(event) {
        event.preventDefault();
        setSaving(true);
        setError(null);
        try {
            const result = await dispatch(assignTaskLabels({ taskId: task.id, labelIds: selected, version: task.version })).unwrap();
            setSelected(result.labels.map((label) => label.id));
            setDirty(false);
            onSaved(result, task.version);
        }
        catch (failure) {
            setError(failure);
            onFailure(failure);
        }
        finally {
            setSaving(false);
        }
    }

    if (!visible) {
        return null;
    }
    return <section className="panel task-label-panel label-design" aria-labelledby="task-label-heading">
        <h2 id="task-label-heading">Labels</h2>
        {!administrator && <LabelBadges labels={task.labels} />}
        {!task.labels?.length && !dirty && <p className="muted">No labels assigned.</p>}
        {administrator && <form onSubmit={integrated ? (event) => event.preventDefault() : save}>
            <p className="hint">{integrated ? 'Select up to 20 labels. Changes are included when you Save the task.' : 'Select up to 20 labels. Save labels separately from task details.'}</p>
            {error && <p className="error" role="alert">{error.message}</p>}
            <fieldset className="label-options" disabled={saving || disabled}>
                <legend>Available labels</legend>
                <div className="label-picker-input">
                    {selectedLabels.map((label) => <span className="label-selected-chip" key={label.id} style={labelStyle(label.color)}>
                        <span>{label.name}{!label.active && ' (inactive)'}</span>
                        <button type="button" aria-label={`Remove ${label.name}`} onClick={() => toggleLabel(label.id, false)}><X size={13} aria-hidden="true" /></button>
                    </span>)}
                    <label className="label-picker-search"><Search size={15} aria-hidden="true" /><input type="search" aria-label="Find a label" placeholder="Find a label" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
                </div>
                <div className="label-picker-menu">
                    <LabelPickerChoices options={options} selected={selected} query={query} onToggle={toggleLabel} />
                    <p className="label-picker-note">{selected.length} of 20 selected. Inactive labels already on this task can be removed.</p>
                </div>
            </fieldset>
            <div className="label-actions">
                {!integrated && <button className="button primary" disabled={!dirty || saving || disabled}>{saving ? 'Saving…' : 'Save labels'}</button>}
                <button type="button" className="button" disabled={!dirty || saving || disabled} onClick={() => {
                    setSelected((task.labels || []).map((label) => label.id));
                    setDirty(false);
                    setError(null);
                }}>Cancel label changes</button>
            </div>
        </form>}
    </section>;
}
