import { useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useBlocker } from 'react-router-dom';
import { Plus, RefreshCw, Search, Tag } from 'lucide-react';
import { request } from '../../app/api';
import { loadWorkspace } from '../../app/store';
import { saveLabel } from './labelState';
import LabelBadges, { labelStyle } from './LabelBadges';
import './label-design.css';

const blank = { name: '', color: '#2563EB', active: true };
const palette = [
    ['Navy', '#294A69'], ['Green', '#3D6B30'], ['Sage', '#8A9A86'], ['Amber', '#C98A3A'],
    ['Gold', '#D9A441'], ['Purple', '#7A5A9A'], ['Brick', '#A44941'], ['Teal', '#2F7A72'],
];

export function isValidLabelColor(color) {
    return /^#[0-9a-f]{6}$/i.test(color);
}

export function LabelEditorPreview({ label }) {
    return <div className="label-editor-preview">
        <span className="label-eyebrow">Preview</span>
        <span className="task-label" style={labelStyle(label.color)}>
            {label.name.trim() || 'Your label'}{!label.active && ' (inactive)'}
        </span>
    </div>;
}

export function LabelDefinitionTable({ labels, query, status, selectedId, busy, onEdit }) {
    const search = query.trim().toLocaleLowerCase();
    const filtered = labels.filter((label) => label.name.toLocaleLowerCase().includes(search)
        && (status === 'all' || label.active === (status === 'active')))
        .sort((left, right) => left.name.localeCompare(right.name));

    return <div className="label-table-scroll">
        <table className="label-definition-table">
            <caption className="sr-only">Label definitions</caption>
            <thead><tr><th scope="col">Label</th><th scope="col">Color</th><th scope="col">Status</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>{filtered.map((label) => <tr key={label.id} className={selectedId === label.id ? 'is-selected' : undefined}>
                <td><LabelBadges labels={[label]} /></td>
                <td><span className="label-table-color"><span className="label-color-dot" style={{ backgroundColor: labelStyle(label.color).backgroundColor }} aria-hidden="true" />{label.color}</span></td>
                <td><span className={`label-definition-status ${label.active ? 'is-active' : ''}`}><span aria-hidden="true" />{label.active ? 'Active' : 'Inactive'}</span></td>
                <td><button type="button" className="button" disabled={busy} aria-label={`Edit label ${label.name}`} onClick={() => onEdit(label)}>Edit</button></td>
            </tr>)}</tbody>
        </table>
        {!filtered.length && <p className="label-empty" role="status">{labels.length ? 'No labels match your search or status filter.' : 'No labels yet. Create your first label to organize tasks.'}</p>}
    </div>;
}

export default function LabelsPage({ onEditingChange }) {
    const dispatch = useDispatch();
    const labels = useSelector((state) => state.workspace.labels || []);
    const loading = useSelector((state) => state.workspace.status === 'loading');
    const [editor, setEditor] = useState(blank);
    const [dirty, setDirty] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    const [message, setMessage] = useState('');
    const [query, setQuery] = useState('');
    const [status, setStatus] = useState('all');
    const colorValid = isValidLabelColor(editor.color);
    const confirmRef = useRef(null);
    const nameInputRef = useRef(null);
    const blocker = useBlocker(({ currentLocation, nextLocation }) =>
        (dirty || busy) && currentLocation.pathname !== nextLocation.pathname);

    useEffect(() => {
        onEditingChange({ dirty, saving: busy });
    }, [dirty, busy, onEditingChange]);
    useEffect(() => () => onEditingChange({ dirty: false, saving: false }), [onEditingChange]);
    useEffect(() => {
        function beforeUnload(event) {
            if (dirty || busy) {
                event.preventDefault();
                event.returnValue = '';
            }
        }
        window.addEventListener('beforeunload', beforeUnload);
        return () => window.removeEventListener('beforeunload', beforeUnload);
    }, [dirty, busy]);
    useEffect(() => {
        if (blocker.state === 'blocked') {
            if (!dirty && !busy) {
                blocker.proceed();
            }
            else if (!confirmRef.current?.open) {
                confirmRef.current?.showModal();
            }
        }
    }, [blocker, dirty, busy]);

    function edit(label = blank) {
        if (dirty && !window.confirm('Discard the unsaved label definition?')) {
            return;
        }
        setEditor(label);
        setDirty(false);
        setError(null);
        setMessage('');
        nameInputRef.current?.focus({ preventScroll: true });
        nameInputRef.current?.scrollIntoView({ block: 'center' });
    }

    function change(field, value) {
        setEditor((current) => ({ ...current, [field]: value }));
        setDirty(true);
    }

    async function save(event) {
        event.preventDefault();
        if (!colorValid) {
            setError({ message: 'Enter a six-digit hex color, such as #294A69.' });
            return;
        }
        setBusy(true);
        setError(null);
        try {
            const label = await dispatch(saveLabel({ id: editor.id, values: editor })).unwrap();
            setEditor(label);
            setDirty(false);
            setMessage('Label saved. Existing task references are preserved.');
            dispatch(loadWorkspace());
        }
        catch (failure) {
            setError(failure);
        }
        finally {
            setBusy(false);
        }
    }

    async function reload() {
        if (dirty && !window.confirm('Reload this label and discard its unsaved changes?')) {
            return;
        }
        setBusy(true);
        setError(null);
        try {
            const page = await request('/labels');
            const latest = page.items.find((label) => label.id === editor.id);
            if (!latest) {
                throw new Error('This label is no longer available.');
            }
            // Inputs are disabled for the entire reload, so this cannot discard newer typing.
            setEditor(latest);
            setDirty(false);
            dispatch(loadWorkspace());
        }
        catch (failure) {
            setError(failure);
        }
        finally {
            setBusy(false);
        }
    }

    return <section className="label-management label-design" aria-labelledby="labels-heading">
        <header className="label-management-heading">
            <div><p className="label-eyebrow">Workspace administration</p><h1 id="labels-heading">Labels</h1>
                <p className="hint">Organize tasks with shared labels. Changes apply everywhere a label is used.</p></div>
            <div className="label-management-actions">
                <button type="button" className="button" disabled={busy || loading} onClick={() => dispatch(loadWorkspace())}>
                    <RefreshCw size={16} aria-hidden="true" />{loading ? 'Refreshing…' : 'Refresh'}
                </button>
                <button type="button" className="button primary" disabled={busy} onClick={() => edit()}><Plus size={17} aria-hidden="true" />New label</button>
            </div>
        </header>
        <div className="label-management-layout">
            <section className="label-library" aria-labelledby="label-library-heading">
                <div className="label-library-heading"><h2 id="label-library-heading"><Tag size={18} aria-hidden="true" />Label definitions</h2><span>{labels.length} total</span></div>
                <div className="label-library-toolbar">
                    <label className="label-search"><Search size={17} aria-hidden="true" /><input type="search" aria-label="Search labels" placeholder="Search labels" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
                    <div className="label-status-filters" role="group" aria-label="Filter labels by status">
                        {['all', 'active', 'inactive'].map((value) => <button key={value} type="button" aria-pressed={status === value} onClick={() => setStatus(value)}>
                            {value[0].toUpperCase() + value.slice(1)} <span>{labels.filter((label) => value === 'all' || label.active === (value === 'active')).length}</span>
                        </button>)}
                    </div>
                </div>
                <LabelDefinitionTable labels={labels} query={query} status={status} selectedId={editor.id} busy={busy} onEdit={edit} />
                <p className="label-library-note">Inactive labels stay on existing tasks and remain in history.</p>
            </section>
            <form className="label-editor" onSubmit={save} aria-busy={busy} aria-labelledby="label-editor-heading">
                <div><h2 id="label-editor-heading">{editor.id ? 'Edit label' : 'Create label'}</h2><p className="hint">Define a clear name and a recognizable color.</p></div>
                <LabelEditorPreview label={editor} />
                {error && <div className="error" role="alert">{error.message || 'Could not save label.'}
                    {editor.id && <button type="button" className="text-button" disabled={busy} onClick={reload}>Reload label</button>}
                </div>}
                {message && <p role="status">{message}</p>}
                <fieldset className="label-editor-fields" disabled={busy}>
                    <label className="field"><span>Label name</span>
                        <input ref={nameInputRef} required maxLength={80} value={editor.name} onChange={(event) => change('name', event.target.value)} />
                    </label>
                    <div className="label-palette" role="group" aria-label="Label color palette">
                        <span className="label-field-title">Label color</span>
                        <div>{palette.map(([name, color]) => <button key={color} type="button" className="label-palette-swatch" aria-label={`Color ${name}`} aria-pressed={editor.color.toUpperCase() === color}
                            style={{ backgroundColor: color }} onClick={() => change('color', color)} />)}</div>
                    </div>
                    <div className="label-custom-color">
                        <label className="field"><span>Hex color</span><input type="text" required pattern="#[0-9A-Fa-f]{6}" maxLength={7} value={editor.color}
                            aria-invalid={!colorValid} aria-describedby="label-color-help" onChange={(event) => change('color', event.target.value)} /></label>
                        <label className="field"><span>Custom color</span><input type="color" value={colorValid ? editor.color : blank.color} onChange={(event) => change('color', event.target.value.toUpperCase())} /></label>
                    </div>
                    <p id="label-color-help" className={colorValid ? 'hint' : 'error'}>Use # followed by six hexadecimal digits.</p>
                    {editor.id && <label className="checkbox label-active-toggle"><input type="checkbox" checked={editor.active}
                        onChange={(event) => change('active', event.target.checked)} /><span><strong>Active</strong><span>Available for new assignments. Turn off to retire this label while keeping existing tasks.</span></span></label>}
                </fieldset>
                <div className="label-actions">
                    <button className="button primary" disabled={!dirty || busy || !colorValid}>{busy ? 'Saving…' : 'Save label'}</button>
                    <button type="button" className="button" disabled={busy} onClick={() => edit()}>Cancel</button>
                </div>
            </form>
        </div>
        {blocker.state === 'blocked' && <dialog ref={confirmRef} className="project-dialog"
            aria-labelledby="discard-label-title" onCancel={(event) => {
                event.preventDefault();
                blocker.reset();
            }}>
            <div className="drawer-body"><h2 id="discard-label-title">{busy ? 'Saving label…' : 'Discard unsaved label changes?'}</h2>
                <p>{busy ? 'Wait for the request to finish before leaving.' : 'The changes to this label definition have not been saved.'}</p></div>
            <div className="drawer-footer">
                <button className="button" autoFocus onClick={() => blocker.reset()}>Keep editing</button>
                <button className="button primary" disabled={busy} onClick={() => blocker.proceed()}>Discard changes</button>
            </div>
        </dialog>}
    </section>;
}
