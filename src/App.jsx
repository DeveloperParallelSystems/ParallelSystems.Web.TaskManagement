import { notificationBadge } from './features/tasks/notificationInbox.js';
import { useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Link, NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { Bell, CalendarDays, CheckSquare2, GitBranch, Kanban, LayoutDashboard, LogOut, Menu, Plus, RefreshCw, Search, Table, Tags, X } from 'lucide-react';
import { checkSession, loadWorkspace, logout } from './app/store';
import LoginPage from './features/auth/LoginPage';
import TaskPage from './features/tasks/TaskPage';
import { taskIdFromPath, projectScopeFromPath, taskScopeLocation, withoutParentSelection } from './features/tasks/taskNavigation';
import ClientsPage from './features/projects/ClientsPage';
import { followingSearch } from './features/tasks/FollowingFilter';
import ClientProjectsPage from './features/projects/ClientProjectsPage';
import { clientScopeSearch, projectClientContext, taskClientId } from './features/projects/projectClients';
import NotificationsPage from './features/tasks/NotificationsPage';
import TasksPage from './features/tasks/TasksPage';
import LabelsPage from './features/tasks/LabelsPage';
import BoardPresentationAdministration from './features/tasks/BoardPresentationAdministration';
import TaskColumnsAdministration from './features/tasks/TaskColumnsAdministration';
import { loadTaskColumns } from './features/tasks/taskColumns';
import { loadPresentation } from './features/tasks/workflowPresentation';
import StatusSettingsPage from './features/tasks/StatusSettingsPage';
import StatusCatalogPage from './features/tasks/StatusCatalogPage';
import { loadStatusSettings } from './features/tasks/liveStatuses';
import { Dashboard } from './features/tasks/OverviewPages';
import { initials } from './features/tasks/workflow';
import { defaultTaskQuery, serializeTaskQuery } from './features/tasks/taskQuery';

const pages = {
    '/task-columns': { title: 'Task columns', description: 'Choose visible task information by discipline and project.' },
    '/clients': {
        title: 'Task Management',
        description: 'Browse clients and projects to manage their tasks.',
    },
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
        description: 'Track workload, progress and overdue tasks by client.',
    },
    '/projects': {
        title: 'Projects',
        description: 'Keep every project and its next steps in view.',
    },
    '/notifications': {
        title: 'Notifications',
        description: 'Task updates, mentions and changes to work you follow.',
    },
};

export default function App() {
    const dispatch = useDispatch();
    const auth = useSelector((state) => state.auth);
    const workspace = useSelector((state) => state.workspace);
    const [taskEditing, setTaskEditing] = useState({ dirty: false, saving: false });
    const [toast, setToast] = useState('');
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
    const [workspaceSearch, setWorkspaceSearch] = useState('');
    const [openedTask, setOpenedTask] = useState(null);
    const workspaceSearchRef = useRef(null);
    const location = useLocation();
    const navigate = useNavigate();
    const selected = taskIdFromPath(location.pathname);
    const routeProjectScope = projectScopeFromPath(location.pathname);
    const selectedTask = selected && selected !== 'new' ? (openedTask?.id === selected ? openedTask
        : workspace.tasks.find((task) => task.id === selected)) : null;
    const projectScope = selectedTask
        ? (workspace.projects.some((project) => project.id === selectedTask.projectId) ? selectedTask.projectId : (!selectedTask.projectId ? 'general' : null))
        : routeProjectScope;
    const taskManagementActive = /^\/(clients|projects|tasks)(\/|$)/i.test(location.pathname);
    const followSearch = projectScope ? followingSearch(location.search) : '';
    const scopedProject = workspace.projects.find((project) => project.id === projectScope);
    const clientScope = location.pathname.match(/^\/clients\/([^/]+)\/projects\/?$/)?.[1];
    const contextualClientId = selectedTask ? taskClientId(selectedTask, workspace.projects, workspace.clients || [])
        : projectClientContext(scopedProject, workspace.clients || [], location.search);
    const scopedClient = (workspace.clients || []).find((client) => client.id === (clientScope || contextualClientId));
    const clientSearch = projectScope ? `client=${encodeURIComponent(contextualClientId === undefined
        ? new URLSearchParams(location.search).get('client') : contextualClientId || 'unassigned')}` : '';
    const taskBase = projectScope ? `/projects/${projectScope}/tasks` : '/tasks';
    const clientUnavailable = Boolean(projectScope && contextualClientId === undefined);
    const canCreateTask = !clientUnavailable && (!projectScope || projectScope === 'general' || Boolean(scopedProject));
    const { title, description } = projectScope
        ? { title: scopedProject?.name || (projectScope === 'general' ? 'General tasks' : 'Project unavailable'), description: 'Task Management · Plan and manage work in this project.' }
        : clientScope ? { title: scopedClient?.name || (clientScope === 'unassigned' ? 'Unassigned projects' : 'Client unavailable'), description: 'Choose a project to open its task management workspace.' }
        : pages[location.pathname] || pages['/clients'];
    let breadcrumbTitle = title;
    if (selected) {
        breadcrumbTitle = selected === 'new' ? 'New task' : 'Task details';
    }

    function setSelected(id, status = null) {
        if (id) {
            const task = workspace.tasks.find((item) => item.id === id);
            const target = task ? taskScopeLocation(task, workspace.projects, workspace.clients || [], location.search)
                : { pathname: `${taskBase}/${id}`, search: withoutParentSelection(projectScope
                    ? clientScopeSearch(location.search, contextualClientId) : location.search) };
            navigate(
                target,
                { state: { initialStatus: status } },
            );
        }
        else {
            navigate({ pathname: taskBase, search: withoutParentSelection(projectScope
                ? clientScopeSearch(location.search, contextualClientId) : location.search) });
        }
    }

    useEffect(() => {
        dispatch(checkSession());
    }, [dispatch]);

    useEffect(() => {
        setTaskEditing({ dirty: false, saving: false });
        setOpenedTask(null);
        if (auth.status !== 'authenticated') {
            return;
        }
        dispatch(loadWorkspace());
        dispatch(loadPresentation());
        for (const discipline of ['Development', 'Drafting']) {
            dispatch(loadTaskColumns({ projectId: null, discipline }));
        }
        dispatch(loadStatusSettings());
        const refresh = () => {
            dispatch(loadWorkspace());
            dispatch(loadPresentation());
            for (const discipline of ['Development', 'Drafting']) {
                dispatch(loadTaskColumns({ projectId: null, discipline }));
            }
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
                auth.user && workspace.status === 'ready' && !selected && canCreateTask &&
                (projectScope || location.pathname === '/tasks' || location.pathname === '/dashboard') &&
                !document.querySelector('dialog[open]')) {
                event.preventDefault();
                navigate({ pathname: `${taskBase}/new`, search: withoutParentSelection(location.search) });
            }
        }
        window.addEventListener('keydown', createShortcut);
        return () => {
            window.removeEventListener('keydown', createShortcut);
        };
    }, [auth.user, workspace.status, selected, navigate, location.search, location.pathname, taskBase, projectScope, canCreateTask]);

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

    const calendarActive = location.pathname === taskBase && new URLSearchParams(location.search).get('view') === 'calendar';
    const taskDetails = selected ? (
        <TaskPage key={`${projectScope || ''}:${selected}`} id={selected} projectScope={projectScope}
            onTaskLoaded={setOpenedTask} onClose={() => setSelected(null)} onEditingChange={setTaskEditing} onSaved={(message) => {
                setToast(message);
                dispatch(loadWorkspace());
            }} />
    ) : <Navigate to={taskBase} replace />;
    const projectUnavailable = projectScope && projectScope !== 'general' && !scopedProject;

    return (
        <div className="app-shell">
            <aside className="sidebar">
                <div className="brand">
                    <img src={`${import.meta.env.BASE_URL}logo.png`} alt="Parallel Systems — Devised to deliver" />
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
                        <Link to="/clients" className={taskManagementActive ? 'active' : ''}
                            aria-current={taskManagementActive ? 'page' : undefined}>
                            <CheckSquare2 size={19} />
                            Task Management
                        </Link>
                        <NavLink to="/notifications">
                            <Bell size={19} />
                            Notifications
                            {workspace.notifications.unreadCount > 0 && (
                                <span className="notification-count">{notificationBadge(workspace.notifications.unreadCount)}</span>
                            )}
                        </NavLink>
                    </nav>
                    {auth.user.role === 'Administrator' && <>
                        <div className="nav-label nav-section-label">ADMINISTRATION</div>
                        <nav aria-label="Administration">
                            <NavLink to="/labels"><Tags size={18} />Labels</NavLink>
                            <NavLink to="/task-columns"><Table size={18} />Task columns</NavLink>
                            <NavLink to="/board-presentation"><Kanban size={18} />Board presentation</NavLink>
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
                        {clientScope || projectScope ? <>
                            <Link to="/clients">Task Management</Link><span>/</span>
                            {projectScope !== 'general' && <><Link to={`/clients/${scopedClient?.id || 'unassigned'}/projects`}>
                                {scopedClient?.name || (clientUnavailable ? 'Client unavailable' : 'Unassigned projects')}</Link>{projectScope && <span>/</span>}</>}
                            {projectScope && <>
                                {selected ? <>
                                    <Link to={{ pathname: taskBase, search: withoutParentSelection(clientScopeSearch(location.search, contextualClientId)) }}>{scopedProject?.name || (projectScope === 'general' ? 'General tasks' : 'Project unavailable')}</Link>
                                    <span>/</span><strong>{breadcrumbTitle}</strong>
                                </> : <strong>{scopedProject?.name || (projectScope === 'general' ? 'General tasks' : 'Project unavailable')}</strong>}
                            </>}
                        </> : <strong>{breadcrumbTitle}</strong>}
                    </div>
                    <form className="workspace-search" role="search" aria-label="Workspace task search" onSubmit={(event) => {
                        event.preventDefault();
                        navigate({ pathname: taskBase, search: serializeTaskQuery({ ...defaultTaskQuery, search: workspaceSearch.trim(), followingOnly: Boolean(followSearch) }, clientSearch) });
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
                    {!selected && !['/labels', '/task-columns', '/board-presentation', '/discipline-statuses', '/status-catalog'].includes(location.pathname) && (
                        <div className="page-heading">
                            <div>
                                <span className="eyebrow">YOUR WORKSPACE</span>
                                <h1>{title}</h1>
                                <p>{description}</p>
                            </div>
                            <div className="page-actions">
                                <button
                                    className="button"
                                    disabled={workspace.status === 'loading'}
                                    onClick={() => {
                                        dispatch(loadWorkspace());
                                        dispatch(loadPresentation());
                                        for (const discipline of ['Development', 'Drafting']) {
                                            dispatch(loadTaskColumns({ projectId: projectScope && projectScope !== 'general' ? projectScope : null, discipline }));
                                        }
                                        dispatch(loadStatusSettings());
                                    }}
                                >
                                    <RefreshCw size={15} />
                                    <span>Refresh</span>
                                </button>
                                {canCreateTask && (projectScope || location.pathname === '/tasks' || location.pathname === '/dashboard') && (
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
                            <Route path="/task-columns" element={auth.user.role === 'Administrator'
                                ? <TaskColumnsAdministration onEditingChange={setTaskEditing} /> : <Navigate to="/tasks" replace />} />
                            <Route path="/board-presentation" element={auth.user.role === 'Administrator'
                                ? <BoardPresentationAdministration onEditingChange={setTaskEditing} /> : <Navigate to="/tasks" replace />} />
                            <Route path="/labels" element={auth.user.role === 'Administrator'
                                ? <LabelsPage onEditingChange={setTaskEditing} /> : <Navigate to="/tasks" replace />} />
                            <Route path="/tasks" element={<TasksPage onOpen={setSelected} />} />
                            <Route path="/tasks/:taskId" element={taskDetails} />
                            <Route path="/clients" element={<ClientsPage />} />
                            <Route path="/following" element={<Navigate to="/clients" replace />} />
                            <Route path="/clients/:clientId/projects" element={<ClientProjectsPage key={clientScope} />} />
                            <Route path="/projects/:projectId/tasks" element={projectUnavailable || clientUnavailable
                                ? <div className="empty panel">{projectUnavailable ? 'Project unavailable.' : 'Client unavailable for this project.'} <Link to="/clients">Back to clients</Link></div>
                                : <TasksPage key={projectScope} projectScope={projectScope} onOpen={setSelected} />} />
                            <Route path="/projects/:projectId/tasks/:taskId" element={selected === 'new' && (projectUnavailable || clientUnavailable)
                                ? <div className="empty panel">Project unavailable. <Link to="/clients">Back to clients</Link></div> : taskDetails} />
                            <Route path="/dashboard" element={<Dashboard onOpen={setSelected} />} />
                            <Route path="/projects" element={<Navigate to="/clients" replace />} />
                            <Route path="/notifications" element={<NotificationsPage />} />
                            <Route path="*" element={<Navigate to="/clients" replace />} />
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
                <Link to="/clients" className={taskManagementActive && !calendarActive ? 'active' : ''}
                    aria-current={taskManagementActive && !calendarActive ? 'page' : undefined}>
                    <CheckSquare2 size={20} /><span>Task Management</span>
                </Link>
                <Link to={`${taskBase}?view=calendar${clientSearch ? `&${clientSearch}` : ''}${followSearch ? '&following=1' : ''}`} aria-current={calendarActive ? 'page' : undefined}
                    className={calendarActive ? 'active' : ''}><CalendarDays size={20} /><span>Calendar</span></Link>
                <NavLink to="/notifications"><Bell size={20} /><span>Notifications{workspace.notifications.unreadCount > 0 ? ` (${notificationBadge(workspace.notifications.unreadCount)})` : ''}</span></NavLink>
            </nav>
            {toast && (
                <div className="toast" role="status">
                    ✓ {toast}
                </div>
            )}
        </div>
    );
}
