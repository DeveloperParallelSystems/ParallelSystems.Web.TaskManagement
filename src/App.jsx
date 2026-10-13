import { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { Bell, CheckSquare2, FolderOpen, FolderPlus, LayoutDashboard, LogOut, Plus, RefreshCw } from 'lucide-react';
import { checkSession, loadWorkspace, logout } from './app/store';
import LoginPage from './features/auth/LoginPage';
import TaskPage from './features/tasks/TaskPage';
import { taskIdFromPath } from './features/tasks/taskNavigation';
import ProjectDialog from './features/projects/ProjectDialog';
import NotificationsPage from './features/tasks/NotificationsPage';
import TasksPage from './features/tasks/TasksPage';
import { Dashboard, ProjectsPage } from './features/tasks/OverviewPages';
import { initials } from './features/tasks/workflow';

const pages = {
    '/tasks': {
        title: 'Task Management',
        description: 'Plan, assign, review, and deliver work across teams.',
    },
    '/dashboard': {
        title: 'Dashboard',
        description: 'A little clarity for the work ahead.',
    },
    '/projects': {
        title: 'Projects',
        description: 'Keep every project and its next steps in view.',
    },
    '/notifications': {
        title: 'Notifications',
        description: 'Assignments and review handoffs that need your attention.',
    },
};

export default function App() {
    const dispatch = useDispatch();
    const auth = useSelector((state) => state.auth);
    const workspace = useSelector((state) => state.workspace);
    const [taskEditing, setTaskEditing] = useState({ dirty: false, saving: false });
    const [creatingProject, setCreatingProject] = useState(false);
    const [toast, setToast] = useState('');
    const location = useLocation();
    const navigate = useNavigate();
    const selected = taskIdFromPath(location.pathname);
    const { title, description } = pages[location.pathname] || pages['/tasks'];
    let breadcrumbTitle = title;
    if (selected) {
        breadcrumbTitle = selected === 'new' ? 'New task' : 'Task details';
    }

    function setSelected(id, status = null) {
        if (id) {
            navigate(
                { pathname: `/tasks/${id}`, search: location.search },
                { state: { initialStatus: status } },
            );
        }
        else {
            navigate({ pathname: '/tasks', search: location.search });
        }
    }

    useEffect(() => {
        dispatch(checkSession());
    }, [dispatch]);

    useEffect(() => {
        setTaskEditing({ dirty: false, saving: false });
        setCreatingProject(false);
        if (auth.status !== 'authenticated') {
            return;
        }
        dispatch(loadWorkspace());
        const refresh = () => {
            dispatch(loadWorkspace());
        };
        window.addEventListener('focus', refresh);
        const timer = window.setInterval(() => {
            if (document.visibilityState === 'visible') {
                refresh();
            }
        }, 60000);
        return () => {
            window.removeEventListener('focus', refresh);
            window.clearInterval(timer);
        };
    }, [auth.status, auth.user?.userId, dispatch]);

    useEffect(() => {
        function createShortcut(event) {
            const editing = event.target.closest('input, textarea, select, [contenteditable="true"]');
            if (event.key.toLowerCase() === 'c' && !editing && !event.ctrlKey && !event.metaKey && !event.altKey &&
                auth.user?.role === 'Administrator' && workspace.status === 'ready' && !selected &&
                !document.querySelector('dialog[open]')) {
                event.preventDefault();
                navigate({ pathname: '/tasks/new', search: location.search });
            }
        }
        window.addEventListener('keydown', createShortcut);
        return () => {
            window.removeEventListener('keydown', createShortcut);
        };
    }, [auth.user?.role, workspace.status, selected, navigate, location.search]);

    useEffect(() => {
        const timer = setTimeout(() => setToast(''), 4500);
        return () => {
            clearTimeout(timer);
        };
    }, [toast]);

    if (auth.status === 'checking') {
        return <main className="loading-screen">Opening your workspace…</main>;
    }
    if (auth.status === 'unavailable') {
        return (
            <main className="loading-screen">
                <h1>Unable to connect</h1>
                <p>Task Management could not reach the server.</p>
                <button className="button primary" onClick={() => dispatch(checkSession())}>
                    Try again
                </button>
            </main>
        );
    }
    if (!auth.user) {
        return <LoginPage />;
    }

    return (
        <div className="app-shell">
            <aside className="sidebar">
                <div className="brand">
                    <img src={`${import.meta.env.BASE_URL}logo.png`} alt="" />
                    <div>
                        <strong>Parallel Systems</strong>
                        <small>Workspace</small>
                    </div>
                </div>
                <div className="sidebar-navigation">
                    <div className="nav-label">WORKSPACE</div>
                    <nav aria-label="Workspace">
                        <NavLink to="/dashboard">
                            <LayoutDashboard size={19} />
                            Dashboard
                        </NavLink>
                        <NavLink to="/tasks">
                            <CheckSquare2 size={19} />
                            Task Management
                        </NavLink>
                        <NavLink to="/projects">
                            <FolderOpen size={19} />
                            Projects
                        </NavLink>
                        <NavLink to="/notifications">
                            <Bell size={19} />
                            Notifications
                            {workspace.notifications.unreadCount > 0 && (
                                <span className="notification-count">{workspace.notifications.unreadCount}</span>
                            )}
                        </NavLink>
                    </nav>
                    <div className="sidebar-footer">
                        PARALLEL SYSTEMS<span>Task Management</span>
                    </div>
                </div>
            </aside>
            <div className="main">
                <header className="topbar">
                    <div className="breadcrumb">
                        Workspace <span>/</span>
                        <strong>{breadcrumbTitle}</strong>
                    </div>
                    <div className="account">
                        <span className="avatar">{initials(auth.user.name)}</span>
                        <div>
                            <strong>{auth.user.name}</strong>
                            <small>{auth.user.role}</small>
                        </div>
                        <button
                            className="icon-button"
                            aria-label="Sign out"
                            title="Sign out"
                            disabled={auth.busy || taskEditing.saving}
                            onClick={() => {
                                if (!taskEditing.dirty || window.confirm('Discard your unsaved changes and sign out?')) {
                                    dispatch(logout());
                                }
                            }}
                        >
                            <LogOut size={18} />
                        </button>
                    </div>
                </header>
                <main className="content">
                    {!selected && (
                        <div className="page-heading">
                            <div>
                                <span className="eyebrow">YOUR WORKSPACE</span>
                                <h1>{title}</h1>
                                <p>{description}</p>
                            </div>
                            <div className="page-actions">
                                {auth.user.role === 'Administrator' && title === 'Projects' && (
                                    <button
                                        className="button"
                                        disabled={!workspace.hasLoaded}
                                        onClick={() => setCreatingProject(true)}
                                    >
                                        <FolderPlus size={17} />
                                        New project
                                    </button>
                                )}
                                <button
                                    className="button"
                                    disabled={workspace.status === 'loading'}
                                    onClick={() => dispatch(loadWorkspace())}
                                >
                                    <RefreshCw size={15} />
                                    <span>Refresh</span>
                                </button>
                                {auth.user.role === 'Administrator' && (
                                    <button
                                        className="button primary"
                                        disabled={workspace.status !== 'ready'}
                                        onClick={() => setSelected('new')}
                                    >
                                        <Plus size={17} />
                                        New task
                                    </button>
                                )}
                            </div>
                        </div>
                    )}
                    {auth.error && (
                        <div className="error" role="alert">
                            {auth.error}
                        </div>
                    )}
                    {workspace.error && (
                        <div className="error" role="alert">
                            {workspace.error}
                            <button className="text-button" onClick={() => dispatch(loadWorkspace())}>
                                Retry
                            </button>
                        </div>
                    )}
                    {!workspace.hasLoaded ? (
                        <div className="empty">
                            {workspace.status === 'error'
                                ? 'Workspace unavailable. Use Retry to load your tasks.'
                                : 'Loading workspace…'}
                        </div>
                    ) : (
                        <Routes>
                            <Route path="/tasks" element={<TasksPage onOpen={setSelected} />} />
                            <Route path="/tasks/:taskId" element={selected ? (
                                <TaskPage
                                    key={selected}
                                    id={selected}
                                    initialStatus={location.state?.initialStatus || null}
                                    onClose={() => setSelected(null)}
                                    onEditingChange={setTaskEditing}
                                    onSaved={(message) => {
                                        setToast(message);
                                        dispatch(loadWorkspace());
                                    }}
                                />
                            ) : <Navigate to="/tasks" replace />} />
                            <Route path="/dashboard" element={<Dashboard onOpen={setSelected} />} />
                            <Route path="/projects" element={<ProjectsPage />} />
                            <Route path="/notifications" element={<NotificationsPage />} />
                            <Route path="*" element={<Navigate to="/tasks" replace />} />
                        </Routes>
                    )}
                    {workspace.status === 'loading' && (
                        <div className="refresh-status" role="status">
                            Refreshing workspace…
                        </div>
                    )}
                </main>
            </div>
            {toast && (
                <div className="toast" role="status">
                    ✓ {toast}
                </div>
            )}
            {creatingProject && (
                <ProjectDialog
                    onClose={() => setCreatingProject(false)}
                    onCreated={(project) => {
                        setCreatingProject(false);
                        setToast(`${project.name} created.`);
                        dispatch(loadWorkspace());
                    }}
                />
            )}
        </div>
    );
}
