import { useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { loadTaskDetail, loadWorkspace, moveTask } from '../../app/store.js';
import { canMoveTask } from './taskActions.js';
import { allowedDisciplineStatuses } from './liveStatuses.js';

export function TaskMoveMenu({ task, onError }) {
    const dispatch = useDispatch();
    const administrator = useSelector((state) => state.auth.user.role === 'Administrator');
    const cached = useSelector((state) => state.workspace.details[task.id]);
    const settings = useSelector((state) => state.workspace.statusSettings?.data);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const details = cached && cached.task.version === task.version && cached.statusSettingsVersion === settings?.version ? cached : null;

    async function prepare() {
        if (details || loading) {
            return;
        }
        setLoading(true);
        try {
            const fresh = await dispatch(loadTaskDetail({ id: task.id })).unwrap();
            if (fresh.task.version !== task.version) {
                onError({ id: task.id, status: 409, message: 'This task changed. Reload latest task before moving it.' });
                dispatch(loadWorkspace());
            }
        }
        catch (error) {
            onError({ ...error, id: task.id });
        }
        finally {
            setLoading(false);
        }
    }

    async function move(status) {
        if (!canMoveTask(details, status, administrator)) {
            return;
        }
        setSaving(true);
        try {
            await dispatch(moveTask({ id: task.id, status, details })).unwrap();
            dispatch(loadWorkspace());
        }
        catch (error) {
            onError({ ...error, id: task.id });
        }
        finally {
            setSaving(false);
        }
    }

    return (
        <select
            className="move-menu"
            aria-label={`Move ${task.code} to`}
            value=""
            disabled={saving}
            onFocus={prepare}
            onPointerDown={prepare}
            onChange={(event) => move(event.target.value)}
        >
            <option value="">{loading ? 'Loading permissions…' : saving ? 'Moving…' : 'Move to…'}</option>
            {allowedDisciplineStatuses(settings, task.discipline).filter((item) => canMoveTask(details, item.code, administrator)).map((item) => (
                <option key={item.code} value={item.code} disabled={!canMoveTask(details, item.code, administrator)}>
                    {item.name}
                </option>
            ))}
        </select>
    );
}
