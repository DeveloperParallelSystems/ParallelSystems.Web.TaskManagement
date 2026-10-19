import { useEffect, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useLocation, useNavigate } from 'react-router-dom';
import { loadNotificationInbox, notificationQuery, readNotifications } from './notificationInbox.js';

export default function NotificationsPage() {
    const { notificationInbox: inbox, notifications, notificationRefreshVersion } = useSelector((state) => state.workspace);
    const dispatch = useDispatch();
    const navigate = useNavigate();
    const location = useLocation();
    const { filter, page } = notificationQuery(location.search);
    const active = useRef(false);
    const mutation = useRef(null);
    const busy = Boolean(inbox.mutationId);
    const matches = inbox.query?.filter === filter && inbox.query?.page === page;
    const loading = Boolean(inbox.requestId) || !matches;
    const data = matches ? inbox.data : null;
    const pages = Math.max(1, Math.ceil((data?.totalCount || 0) / 25));

    function go(nextFilter, nextPage, replace = false) {
        navigate({ pathname: location.pathname, search: `?filter=${nextFilter}&page=${nextPage}` }, { replace });
    }

    useEffect(() => {
        active.current = true;
        return () => {
            active.current = false;
            mutation.current?.abort();
        };
    }, []);

    useEffect(() => {
        const pending = dispatch(loadNotificationInbox({ filter, page }));
        return () => pending.abort();
    }, [dispatch, filter, page, notificationRefreshVersion]);

    useEffect(() => {
        if (matches && data && !loading && !busy && data.page !== page) {
            go(filter, data.page, true);
        }
    }, [matches, data, loading, busy, filter, page]);

    async function markRead(id) {
        const pending = dispatch(readNotifications({ id, filter, page: id ? page : 1 }));
        mutation.current = pending;
        const result = await pending;
        return active.current && readNotifications.fulfilled.match(result);
    }

    async function open(notification) {
        if (notification.readAtUtc || await markRead(notification.id)) {
            navigate(`/tasks/${notification.taskId}`);
        }
    }

    async function markAll() {
        if (await markRead()) {
            go(filter, 1, true);
        }
    }

    return (
        <section className="panel notification-panel" aria-label="Task notifications" aria-busy={loading || busy}>
            <div className="panel-heading notification-heading">
                <div>
                    <h2>Your inbox</h2>
                    <span className="muted" role="status">{notifications.unreadCount} unread</span>
                </div>
                <div className="notification-actions">
                    <button className="button primary" disabled={loading || busy || !notifications.unreadCount} onClick={markAll}>
                        {busy ? 'Updating…' : 'Mark all as read'}
                    </button>
                </div>
            </div>
            <div className="notification-toolbar">
                <div className="notification-filters" role="group" aria-label="Filter notifications">
                    {['all', 'unread'].map((value) => (
                        <button key={value} className={`button ${filter === value ? 'primary' : 'secondary'}`} aria-pressed={filter === value}
                            disabled={busy} onClick={() => go(value, 1)}>{value === 'all' ? 'All' : 'Unread'}</button>
                    ))}
                </div>
                <span className="muted">Unread first · 25 per page</span>
            </div>
            {inbox.error && <div className="error" role="alert">{inbox.error} <button className="button secondary" disabled={busy} onClick={() => dispatch(loadNotificationInbox({ filter, page }))}>Retry</button></div>}
            {loading && <p className="empty" role="status">Loading notifications…</p>}
            {!loading && !inbox.error && data?.items.length === 0 && (
                <div className="empty">
                    <h2>{filter === 'unread' ? 'You’re all caught up' : 'No notifications yet'}</h2>
                    <p>{filter === 'unread' ? 'You have no unread notifications.' : 'Task updates and assignments will appear here.'}</p>
                </div>
            )}
            {!loading && data?.items.map((notification) => (
                <button key={notification.id} className={`notification-item ${notification.readAtUtc ? '' : 'unread'}`}
                    disabled={busy} onClick={() => open(notification)}>
                    <span className="eyebrow">{notification.code} · {notification.readAtUtc ? 'Read' : 'Unread'}</span>
                    <strong>{notification.title}</strong>
                    <span>{notification.message}</span>
                    <time dateTime={notification.createdAtUtc}>{new Date(notification.createdAtUtc).toLocaleString()}</time>
                </button>
            ))}
            {!loading && data && data.totalCount > 0 && (
                <nav className="notification-pagination" aria-label="Notification pages">
                    <span className="muted">{(data.page - 1) * 25 + 1}–{Math.min(data.page * 25, data.totalCount)} of {data.totalCount} notifications</span>
                    <div className="notification-actions">
                        <button className="button secondary" disabled={busy || data.page <= 1} onClick={() => go(filter, data.page - 1)}>Previous</button>
                        <span>Page {data.page} of {pages}</span>
                        <button className="button secondary" disabled={busy || data.page >= pages} onClick={() => go(filter, data.page + 1)}>Next</button>
                    </div>
                </nav>
            )}
        </section>
    );
}
