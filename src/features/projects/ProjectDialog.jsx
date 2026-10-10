import { useEffect, useRef, useState } from 'react';
import { useDispatch } from 'react-redux';
import { FolderPlus, X } from 'lucide-react';
import { createProject } from '../../app/store';

export default function ProjectDialog({ onClose, onCreated }) {
    const dispatch = useDispatch();
    const dialogRef = useRef(null);
    const [name, setName] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        dialogRef.current.showModal();
    }, []);

    function close() {
        if (saving) {
            return;
        }
        if (!name.trim() || window.confirm('Discard this new project?')) {
            onClose();
        }
    }

    async function submit(event) {
        event.preventDefault();
        const trimmedName = name.trim();
        if (!trimmedName) {
            setError('Enter a project name.');
            return;
        }
        setError(null);
        setSaving(true);
        try {
            const project = await dispatch(createProject(trimmedName)).unwrap();
            onCreated(project);
        }
        catch (failure) {
            setError(failure || 'Unable to create the project. Please try again.');
            setSaving(false);
        }
    }

    return (
        <dialog
            ref={dialogRef}
            className="project-dialog"
            aria-labelledby="project-dialog-title"
            onCancel={(event) => {
                event.preventDefault();
                close();
            }}
            onClick={(event) => {
                if (event.target === dialogRef.current) {
                    close();
                }
            }}
        >
            <div className="drawer-head">
                <div>
                    <span className="eyebrow">YOUR WORKSPACE</span>
                    <h2 id="project-dialog-title">New project</h2>
                </div>
                <button type="button" className="icon-button" aria-label="Close project" disabled={saving} onClick={close}>
                    <X size={22} />
                </button>
            </div>
            <form onSubmit={submit}>
                <div className="drawer-body">
                    {error && <div className="error" role="alert">{error}</div>}
                    <label className="field">
                        <span>Project name</span>
                        <input
                            autoFocus
                            autoComplete="off"
                            required
                            maxLength={500}
                            disabled={saving}
                            value={name}
                            onChange={(event) => setName(event.target.value)}
                            placeholder="Enter a project name"
                        />
                    </label>
                    <p className="project-dialog-help">The project will be available when creating or editing tasks.</p>
                </div>
                <div className="drawer-footer">
                    <button type="button" className="button" disabled={saving} onClick={close}>Cancel</button>
                    <button className="button primary" disabled={saving}>
                        <FolderPlus size={16} />
                        {saving ? 'Creating…' : 'Create project'}
                    </button>
                </div>
            </form>
        </dialog>
    );
}
