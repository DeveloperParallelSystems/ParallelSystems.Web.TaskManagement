import { useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { request } from '../../app/api';
import { loadWorkspace } from '../../app/store';

export default function NotificationsPage() {
    const { items, unreadCount } = useSelector((state) => state.workspace.notifications);
    const dispatch = useDispatch();
    const navigate = useNavigate();
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(null);

    async function open(notification) {
        setError('');
        setBusy(notification.id);
        try {
            if (!notification.readAtUtc) {
                await request(`/notifications/${notification.id}/read`, { method: 'POST' });
                dispatch(loadWorkspace());
            }
            navigate(`/tasks/${notification.taskId}`);
        }
        catch (failure) {
            setError(failure.message);
        }
        finally {
            setBusy(null);
        }
    }

    return (
        <section className="panel notification-panel" aria-label="Task notifications">
            <div className="panel-heading">
                <h2>Your inbox</h2>
                <span className="muted">{unreadCount} unread</span>
            </div>
            {error && <div className="error" role="alert">{error}</div>}
            {!items.length && (
                <div className="empty">
                    <h2>You’re all caught up</h2>
                    <p>New assignments and review handoffs will appear here.</p>
                </div>
            )}
            {items.map((notification) => (
                <button
                    key={notification.id}
                    className={`notification-item ${notification.readAtUtc ? '' : 'unread'}`}
                    disabled={busy !== null}
                    onClick={() => open(notification)}
                >
                    <span className="eyebrow">
                        {notification.code} · {notification.readAtUtc ? 'Read' : 'Unread'}
                    </span>
                    <strong>{notification.title}</strong>
                    <span>{notification.message}</span>
                    <time>{new Date(notification.createdAtUtc).toLocaleString()}</time>
                </button>
            ))}
            {items.length === 100 && <p className="muted">Showing the latest 100, with unread notifications first.</p>}
        </section>
    );
}
