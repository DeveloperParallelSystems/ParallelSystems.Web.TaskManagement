import { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Link, useBlocker } from 'react-router-dom';
import { ArrowDown, ArrowUp, Plus, Save, Trash2 } from 'lucide-react';
import { loadPresentation } from './workflowPresentation';
import { loadWorkspace } from '../../app/store.js';
import { loadStatusSettings, saveStatusSettings, validateStatusSettings } from './liveStatuses.js';
import StatusCatalogTable from './StatusCatalogTable';
import './board-presentation-design.css';
import './discipline-statuses.css';

export default function StatusSettingsPage({ onEditingChange, view = 'discipline' }) {
    const dispatch = useDispatch();
    const resource = useSelector((state) => state.workspace.statusSettings);
    const catalogPage = view === 'catalog';
    const title = catalogPage ? 'Status catalog' : 'Discipline statuses';
    const tasks = useSelector((state) => state.workspace.tasks);
    const [draft, setDraft] = useState(() => resource.data ? structuredClone(resource.data) : null);
    const [discipline, setDiscipline] = useState('Development');
    const [catalogEditing, setCatalogEditing] = useState(false);
    const [catalogReset, setCatalogReset] = useState(0);
    const [dirty, setDirty] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    const [message, setMessage] = useState('');
    const unsaved = dirty || catalogEditing;
    const blocker = useBlocker(({ currentLocation, nextLocation }) =>
        (unsaved || busy) && currentLocation.pathname !== nextLocation.pathname);
    const stale = Boolean(draft && resource.data && draft.version !== resource.data.version);
    const validation = draft ? validateStatusSettings(draft) : '';
    const assigned = draft?.disciplines.find((item) => item.discipline === discipline)?.statuses || [];
    const catalog = draft?.catalog || [];
    const names = new Map(catalog.map((item) => [item.code, item.name]));
    const used = new Set(tasks.filter((task) => task.discipline === discipline).map((task) => task.status));

    useEffect(() => {
        if (!dirty && !catalogEditing && !busy && resource.data) {
            setDraft(structuredClone(resource.data));
        }
    }, [resource.data, dirty, catalogEditing, busy]);
    useEffect(() => {
        onEditingChange({ dirty: unsaved, saving: busy });
        return () => onEditingChange({ dirty: false, saving: false });
    }, [unsaved, busy, onEditingChange]);
    useEffect(() => {
        function beforeUnload(event) {
            if (unsaved || busy) {
                event.preventDefault();
                event.returnValue = '';
            }
        }
        window.addEventListener('beforeunload', beforeUnload);
        return () => window.removeEventListener('beforeunload', beforeUnload);
    }, [unsaved, busy]);
    useEffect(() => {
        if (blocker.state !== 'blocked') {
            return;
        }
        if (!unsaved && !busy) {
            blocker.proceed();
        }
        else if (!busy && window.confirm('Discard unsaved status changes?')) {
            blocker.proceed();
        }
        else {
            blocker.reset();
        }
    }, [blocker, unsaved, busy]);

    function change(next) {
        setDraft(next);
        setDirty(true);
        setMessage('');
        setError(null);
    }

    function assign(code, checked) {
        change({ ...draft, disciplines: draft.disciplines.map((item) => item.discipline !== discipline ? item : {
            ...item, statuses: checked ? [...item.statuses, code] : item.statuses.filter((value) => value !== code),
        }) });
    }

    function move(index, offset) {
        const statuses = [...assigned];
        const destination = index + offset;
        if (index === 0 || destination < 1 || destination >= statuses.length) {
            return;
        }
        [statuses[index], statuses[destination]] = [statuses[destination], statuses[index]];
        change({ ...draft, disciplines: draft.disciplines.map((item) => item.discipline === discipline
            ? { ...item, statuses } : item) });
    }

    async function save(event) {
        event.preventDefault();
        if (!dirty) {
            return;
        }
        await persist(draft, 'Status choices are available immediately on existing and new tasks.');
    }

    async function persist(next, successMessage) {
        if (busy || resource.writeId || stale || validateStatusSettings(next) || !resource.data?.canManage) {
            return false;
        }
        setBusy(true);
        setError(null);
        setMessage('');
        try {
            const result = await dispatch(saveStatusSettings(next)).unwrap();
            setDraft(structuredClone(result));
            setDirty(false);
            setMessage(successMessage);
            dispatch(loadWorkspace());
            dispatch(loadPresentation());
            return true;
        }
        catch (failure) {
            setError(failure);
            return false;
        }
        finally {
            setBusy(false);
        }
    }

    async function reload() {
        if (unsaved && !window.confirm('Discard unsaved status changes?')) {
            return;
        }
        setBusy(true);
        try {
            const result = await dispatch(loadStatusSettings()).unwrap();
            setDraft(structuredClone(result));
            setDirty(false);
            setCatalogEditing(false);
            setCatalogReset((current) => current + 1);
            setError(null);
            setMessage('');
        }
        catch (failure) {
            setError(failure);
        }
        finally {
            setBusy(false);
        }
    }

    return <section className="presentation-management discipline-status-management" aria-labelledby="status-settings-heading">
        <header className="presentation-page-heading">
            <div>
                <p className="presentation-eyebrow">Administration</p>
                <h1 id="status-settings-heading">{title}</h1>
                <p className="hint">{catalogPage ? 'Add and rename shared statuses. Assign them to Development or Drafting under Discipline statuses.' : 'Choose and order the statuses available for each discipline. New tasks start in To Do.'}</p>
                <Link className="text-button" to={catalogPage ? '/discipline-statuses' : '/status-catalog'}>
                    {catalogPage ? 'Manage discipline statuses' : 'Manage status catalog'}
                </Link>
            </div>
            <button type="button" className="button" disabled={busy} onClick={reload}>Reload</button>
        </header>
        {(error || resource.error || stale || validation) && <p className="error" role="alert">
            {error?.message || resource.error?.message || (stale ? 'Settings changed. Reload before saving.' : validation)}
        </p>}
        {message && <p role="status">{message}</p>}
        {!draft ? <p>Loading statuses…</p> : <>
            {!catalogPage && <>
                <div className="view-tabs" role="tablist" aria-label="Discipline">
                    {['Development', 'Drafting'].map((item) => <button type="button" role="tab" key={item}
                        aria-selected={discipline === item} className={discipline === item ? 'active' : ''}
                        onClick={() => setDiscipline(item)}>{item}</button>)}
                </div>
                <section className="panel" aria-label={`${discipline} statuses`}>
                    <h2>{discipline} statuses</h2>
                    <p className="hint">Only these statuses are available in Change status for {discipline} tasks. Use the arrows to set their order. Board presentation controls the shared columns.</p>
                    <ol className="presentation-statuses">
                        {assigned.map((code, index) => <li key={code}>
                            <strong>{names.get(code) || code}</strong>
                            {used.has(code) && <span className="status-usage">In use</span>}
                            <div className="presentation-icon-actions">
                                <button type="button" className="button" aria-label={`Move ${names.get(code) || code} earlier`}
                                    disabled={busy || index < 2} onClick={() => move(index, -1)}><ArrowUp size={15} /></button>
                                <button type="button" className="button" aria-label={`Move ${names.get(code) || code} later`}
                                    disabled={busy || index === 0 || index === assigned.length - 1}
                                    onClick={() => move(index, 1)}><ArrowDown size={15} /></button>
                                <button type="button" className="button" aria-label={`Remove ${names.get(code) || code} from ${discipline}`}
                                    disabled={busy || code === 'To Do' || used.has(code)}
                                    title={used.has(code) ? 'Move tasks out of this status before removing it.' : ''}
                                    onClick={() => assign(code, false)}><Trash2 size={15} /></button>
                            </div>
                        </li>)}
                    </ol>
                    <h3>Available from the catalog</h3>
                    <div className="presentation-statuses status-catalog-choices">
                        {catalog.filter((item) => !assigned.includes(item.code)).map((item) =>
                            <button key={item.code} type="button" className="button" disabled={busy}
                                onClick={() => assign(item.code, true)}><Plus size={15} />{item.name}</button>)}
                    </div>
                </section>
            </>}
            {catalogPage && <StatusCatalogTable key={catalogReset} settings={draft} tasks={tasks} busy={busy}
                disabled={busy || stale || !resource.data?.canManage || Boolean(resource.writeId)}
                onSave={persist} onEditingChange={setCatalogEditing} />}
            {!catalogPage && <div className="form-actions status-settings-actions">
                <button type="button" className="button" disabled={!unsaved || busy} onClick={reload}>Discard changes</button>
                <button type="button" className="button primary" disabled={!dirty || busy || stale || Boolean(validation) || !draft.canManage}
                    onClick={save}><Save size={16} />{busy ? 'Saving…' : 'Save statuses'}</button>
            </div>}
        </>}
    </section>;
}
