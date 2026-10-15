import { useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Link, NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { Bell, CalendarDays, CheckSquare2, Columns3, FolderOpen, FolderPlus, GitBranch, LayoutDashboard, LogOut, Menu, Plus, RefreshCw, Search, Tags, X } from 'lucide-react';
import { checkSession, loadWorkspace, logout } from './app/store';
import LoginPage from './features/auth/LoginPage';
import TaskPage from './features/tasks/TaskPage';
import { taskIdFromPath } from './features/tasks/taskNavigation';
import ProjectDialog from './features/projects/ProjectDialog';
import NotificationsPage from './features/tasks/NotificationsPage';
import TasksPage from './features/tasks/TasksPage';
import LabelsPage from './features/tasks/LabelsPage';
import WorkflowPresentationPage from './features/tasks/WorkflowPresentationPage';
import { loadPresentation } from './features/tasks/workflowPresentation';
import StatusSettingsPage from './features/tasks/StatusSettingsPage';
import StatusCatalogPage from './features/tasks/StatusCatalogPage';
import { loadStatusSettings } from './features/tasks/liveStatuses';
import { Dashboard, ProjectsPage } from './features/tasks/OverviewPages';
import { initials } from './features/tasks/workflow';
import { defaultTaskQuery, serializeTaskQuery } from './features/tasks/taskQuery';

const pages = {
    '/status-catalog': {
        title: 'Status catalog',
        description: 'Manage shared status names.',
    },
    '/discipline-statuses': {
        title: 'Discipline statuses',
        description: 'Choose the available statuses for Development and Drafting.',
    },
    '/board-presentation': {
        title: 'Board presentation',
        description: 'Arrange columns while preserving the shared task workflow.',
    },
    '/labels': {
        title: 'Labels',
        description: 'Organize tasks with shared label names and colors.',
    },
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
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
    const [workspaceSearch, setWorkspaceSearch] = useState('');
    const workspaceSearchRef = useRef(null);
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
        dispatch(loadPresentation());
        dispatch(loadStatusSettings());
        const refresh = () => {
            dispatch(loadWorkspace());
            dispatch(loadPresentation());
            dispatch(loadStatusSettings());
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

    useEffect(() => {
        setMobileMenuOpen(false);
    }, [location.pathname, location.search]);

    useEffect(() => {
        function focusWorkspaceSearch(event) {
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k' &&
                !document.querySelector('dialog[open]') && auth.user) {
                event.preventDefault();
                workspaceSearchRef.current?.focus();
            }
        }
        window.addEventListener('keydown', focusWorkspaceSearch);
        return () => window.removeEventListener('keydown', focusWorkspaceSearch);
    }, [auth.user]);

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

    const calendarActive = location.pathname === '/tasks' && new URLSearchParams(location.search).get('view') === 'calendar';

    return (
        <div className="app-shell">
            <aside className="sidebar">
                <div className="brand">
                    <img src={`${import.meta.env.BASE_URL}logo.png`} alt="" />
                    <div>
                        <strong>Parallel Systems</strong>
                        <small>Workspace</small>
                    </div>
                    <button type="button" className="icon-button mobile-menu-toggle" aria-label={mobileMenuOpen ? 'Close navigation' : 'Open navigation'}
                        aria-expanded={mobileMenuOpen} aria-controls="workspace-navigation" onClick={() => setMobileMenuOpen((open) => !open)}>
                        {mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
                    </button>
                </div>
                <div id="workspace-navigation" className={`sidebar-navigation${mobileMenuOpen ? ' is-open' : ''}`}>
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
                    {auth.user.role === 'Administrator' && <>
                        <div className="nav-label nav-section-label">ADMINISTRATION</div>
                        <nav aria-label="Administration">
                            <NavLink to="/labels"><Tags size={18} />Labels</NavLink>
                            <NavLink to="/board-presentation"><Columns3 size={18} />Board presentation</NavLink>
                            <NavLink to="/status-catalog"><Tags size={18} />Status catalog</NavLink>
                            <NavLink to="/discipline-statuses"><GitBranch size={18} />Discipline statuses</NavLink>
                        </nav>
                    </>}
                </div>
                <div className="sidebar-profile">
                    <span className="avatar">{initials(auth.user.name)}</span>
                    <div><strong>{auth.user.name}</strong><small>{auth.user.role}</small></div>
                </div>
            </aside>
            <div className="main">
                <header className="topbar">
                    <div className="breadcrumb">
                        Workspace <span>/</span>
                        <strong>{breadcrumbTitle}</strong>
                    </div>
                    <form className="workspace-search" role="search" aria-label="Workspace task search" onSubmit={(event) => {
                        event.preventDefault();
                        navigate({ pathname: '/tasks', search: serializeTaskQuery({ ...defaultTaskQuery, search: workspaceSearch.trim() }) });
                    }}>
                        <Search size={16} aria-hidden="true" />
                        <input ref={workspaceSearchRef} type="search" aria-label="Search workspace tasks" placeholder="Search tasks, projects or people"
                            value={workspaceSearch} onChange={(event) => setWorkspaceSearch(event.target.value)} />
                        <button type="submit" aria-label="Find tasks" title="Find tasks"><kbd>↵</kbd></button>
                    </form>
                    <div className="account">
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
                    {workspace.workflowPresentation.error && location.pathname !== '/board-presentation' && (
                        <div className="error" role="alert">
                            Could not refresh board presentation. Showing the last loaded layout when available.
                            <button type="button" className="text-button" onClick={() => dispatch(loadPresentation())}>Retry layout</button>
                        </div>
                    )}
                    {workspace.statusSettings?.error && !['/discipline-statuses', '/status-catalog'].includes(location.pathname) && <div className="error" role="alert">
                        Could not refresh discipline statuses. Reload them before changing task status.
                        <button type="button" className="text-button" onClick={() => dispatch(loadStatusSettings())}>Retry statuses</button>
                    </div>}
                    {!selected && !['/labels', '/board-presentation', '/discipline-statuses', '/status-catalog'].includes(location.pathname) && (
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
                                    onClick={() => {
                                        dispatch(loadWorkspace());
                                        dispatch(loadPresentation());
                                        dispatch(loadStatusSettings());
                                    }}
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
                            <Route path="/discipline-workflows" element={<Navigate to="/discipline-statuses" replace />} />
                            <Route path="/status-catalog" element={auth.user.role === 'Administrator'
                                ? <StatusCatalogPage onEditingChange={setTaskEditing} /> : <Navigate to="/tasks" replace />} />
                            <Route path="/discipline-statuses" element={auth.user.role === 'Administrator'
                                ? <StatusSettingsPage onEditingChange={setTaskEditing} /> : <Navigate to="/tasks" replace />} />
                            <Route path="/board-presentation" element={auth.user.role === 'Administrator'
                                ? <WorkflowPresentationPage onEditingChange={setTaskEditing} /> : <Navigate to="/tasks" replace />} />
                            <Route path="/labels" element={auth.user.role === 'Administrator'
                                ? <LabelsPage onEditingChange={setTaskEditing} /> : <Navigate to="/tasks" replace />} />
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
            <nav className="mobile-bottom-nav" aria-label="Mobile workspace">
                <Link to="/tasks" aria-current={location.pathname.startsWith('/tasks') && !calendarActive ? 'page' : undefined}
                    className={location.pathname.startsWith('/tasks') && !calendarActive ? 'active' : ''}><CheckSquare2 size={20} /><span>Tasks</span></Link>
                <Link to="/tasks?view=calendar" aria-current={calendarActive ? 'page' : undefined}
                    className={calendarActive ? 'active' : ''}><CalendarDays size={20} /><span>Calendar</span></Link>
                <NavLink to="/projects"><FolderOpen size={20} /><span>Projects</span></NavLink>
                <NavLink to="/notifications"><Bell size={20} /><span>Notifications{workspace.notifications.unreadCount > 0 ? ` (${workspace.notifications.unreadCount})` : ''}</span></NavLink>
            </nav>
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
