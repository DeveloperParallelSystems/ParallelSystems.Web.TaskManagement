import { useState } from 'react';
import { useSelector } from 'react-redux';
import { CalendarDays, CircleAlert, Clock3, Layers, UserRound } from 'lucide-react';
import { useLocalToday } from './TaskCalendar.jsx';
import { clientDashboardGroups, dashboardTaskOverdue, dashboardTaskSummary, sortDashboardClients } from './clientDashboard.js';
import ClientDashboardFilters from './ClientDashboardFilters.jsx';
import ClientWorkloadCard from './ClientWorkloadCard.jsx';
import { dateLabel } from './workflow.js';
import { taskPersonName } from './taskColumns.js';
import './client-dashboard.css';

export default function Dashboard({ onOpen }) {
    const { tasks = [], projects = [], clients = [], people = [] } = useSelector((state) => state.workspace);
    const [selection, setSelection] = useState(null);
    const [due, setDue] = useState('all');
    const [sort, setSort] = useState('overdue');
    const today = useLocalToday();
    const selected = clients.filter((client) => selection === null || selection.includes(client.id)).map((client) => client.id);
    const groups = clientDashboardGroups({ tasks, projects, clients, due, today });
    const visible = sortDashboardClients(groups.clients.filter((group) => selected.includes(group.id)), sort);
    const selectedTasks = visible.flatMap((group) => group.tasks);
    const summary = dashboardTaskSummary(selectedTasks, today);
    const noOverdueMessage = due === 'all' ? 'On track' : 'None in this view';
    const overdueTone = summary.overdue > 0 ? ' is-alert' : '';
    const summaryCards = [
        { label: 'Tasks', value: summary.total, icon: Layers,
            detail: `across ${selected.length} ${selected.length === 1 ? 'client' : 'clients'}` },
        { label: 'Overdue', value: summary.overdue, icon: Clock3,
            detail: summary.overdue ? 'Needs attention' : noOverdueMessage,
            badge: `client-summary-badge${overdueTone}` },
        { label: 'Due this week', value: summary.dueThisWeek, icon: CalendarDays,
            detail: summary.dueThisWeek ? 'upcoming deadlines' : 'nothing coming up' },
        { label: 'Without owner', value: summary.withoutOwner, icon: UserRound,
            detail: summary.withoutOwner ? 'needs assignment' : 'everything assigned' },
    ];
    const overdueTasks = visible.flatMap((group) => group.tasks.filter((task) => dashboardTaskOverdue(task, today))
        .map((task) => ({ task, clientName: group.name })))
        .sort((first, second) => first.task.dueDate.localeCompare(second.task.dueDate) || first.task.id.localeCompare(second.task.id));

    return <div className="client-dashboard">
        <section className="client-dashboard-summary" aria-label="Selected client task summary">
            {summaryCards.map((card) => {
                const Icon = card.icon;

                return <article key={card.label} aria-label={card.label}
                    className={card.label === 'Overdue' && summary.overdue > 0 ? 'is-alert' : undefined}>
                    <span className="client-summary-label">{card.label}<Icon size={16} aria-hidden="true" /></span>
                    <strong className="client-summary-value">{card.value}</strong>
                    <span className={card.badge && selected.length > 0 ? card.badge : 'client-summary-detail'}>
                        {selected.length ? card.detail : 'No clients selected'}
                    </span>
                </article>;
            })}
        </section>
        <div className="section-heading">
            <h2>Client overview</h2>
            <span className="muted" role="status">{selected.length} {selected.length === 1 ? 'client' : 'clients'} selected · {summary.total} {summary.total === 1 ? 'task' : 'tasks'}</span>
        </div>
        <ClientDashboardFilters clients={clients} selected={selected} onSelect={setSelection}
            due={due} onDueChange={setDue} sort={sort} onSortChange={setSort} />
        <div className="client-workload-grid">
            {visible.map((group) => <ClientWorkloadCard key={group.id} group={group} people={people} today={today} onOpen={onOpen} />)}
        </div>
        {!clients.length && <div className="empty panel"><h2>No clients available</h2>
            <p>Clients appear here when available to your account. Unassigned and General tasks appear under Other work.</p>
        </div>}
        {clients.length > 0 && !selected.length && <div className="empty panel"><h2>Select clients to compare</h2>
            <p>Choose one or more clients to see their workload.</p>
        </div>}
        {groups.other.length > 0 && <section className="client-dashboard-other" aria-label="Other work">
            <div className="section-heading"><h2>Other work</h2><span className="muted">Outside selected-client totals</span></div>
            <div className="client-workload-grid">
                {groups.other.map((group) => <ClientWorkloadCard key={group.id} group={group} people={people}
                    today={today} onOpen={onOpen} other />)}
            </div>
        </section>}
        <section className="panel client-dashboard-attention" aria-labelledby="client-attention-title">
            <div className="panel-heading"><h2 id="client-attention-title">
                <CircleAlert size={18} aria-hidden="true" />Needs attention
                <span className="client-attention-count">{overdueTasks.length}</span>
            </h2>
                {due !== 'overdue' && summary.overdue > 0 && <button type="button" className="text-button"
                    onClick={() => setDue('overdue')}>Show overdue only</button>}
            </div>
            {!overdueTasks.length && <p className="muted">No overdue tasks in your selected clients.</p>}
            <ul>
                {overdueTasks.slice(0, 6).map(({ task, clientName }) => <li key={task.id}>
                    <button type="button" className="client-attention-task" onClick={() => onOpen(task.id)}>
                        <span><strong>{task.title}</strong><small>{clientName} · {task.code} · {taskPersonName(task, people, 'assignedTo')}</small></span>
                        <span className="overdue">{dateLabel(task.dueDate)}</span>
                    </button>
                </li>)}
            </ul>
            {overdueTasks.length > 6 && <p className="muted">Showing 6 of {overdueTasks.length} overdue tasks. Open a client’s task list to see the rest.</p>}
        </section>
    </div>;
}
