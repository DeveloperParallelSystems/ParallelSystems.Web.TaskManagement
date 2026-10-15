import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { calendarDateLabel, calendarDays, deadlineKey, localDayKey, planTasks, shiftMonth, validMonth } from './calendar';
import { isTaskClosed, taskStatusName, taskStatusTone } from './taskWorkflow';
import LabelBadges from './LabelBadges';
import { ChecklistProgress } from './TaskChecklist';

export function useLocalToday() {
    const [today, setToday] = useState(() => localDayKey());
    useEffect(() => {
        const refresh = () => setToday(localDayKey());
        const timer = window.setInterval(refresh, 60000);
        window.addEventListener('focus', refresh);
        document.addEventListener('visibilitychange', refresh);
        refresh();
        return () => {
            window.clearInterval(timer);
            window.removeEventListener('focus', refresh);
            document.removeEventListener('visibilitychange', refresh);
        };
    }, []);
    return today;
}

function DeadlineTask({ task, today, people, onOpen, showDate = false }) {
    const due = deadlineKey(task.dueDate);
    const closed = isTaskClosed(task);
    const overdue = due && due < today && !closed;
    const owner = task.assigneeName || people.find((person) => person.id === task.assigneeId)?.name ||
        (task.assigneeId ? 'Assigned staff' : 'Unassigned');
    return <button type="button" className={`calendar-task${overdue ? ' is-overdue' : ''}${closed ? ' is-closed' : ''}`}
        aria-label={`Open ${task.code}: ${task.title}, ${taskStatusName(task)}${due ? `, due ${calendarDateLabel(due)}` : ', no deadline'}, Project: ${task.projectName || 'General'}, Current owner: ${owner}`}
        onClick={() => onOpen(task.id)}>
        <small>{task.code}</small>
        <strong>{task.title}</strong>
        <span className="calendar-task-project">{task.projectName || 'General'}</span>
        <span className="calendar-task-owner">Current owner: {owner}</span>
        <span className={`badge ${taskStatusTone(task)}`}>{taskStatusName(task)}</span>
        {showDate && <span className={overdue ? 'overdue' : 'muted'}>
            {due ? <time dateTime={due}>{calendarDateLabel(due, { year: 'numeric', month: 'short', day: 'numeric' })}</time> : 'No deadline'}
        </span>}
        {overdue && <span className="overdue">Overdue</span>}
        <ChecklistProgress summary={task.checklistSummary} compact />
        <LabelBadges labels={task.labels} />
    </button>;
}

export default function TaskCalendar({ tasks, people, month: selectedMonth, today, onMonthChange, onOpen }) {
    const month = validMonth(selectedMonth) ? selectedMonth : today.slice(0, 7);
    const days = calendarDays(month);
    const plan = planTasks(tasks, today);
    const monthCount = days.filter((day) => day.inMonth).reduce((count, day) => count + (plan.byDay[day.key]?.length || 0), 0);
    const sections = [
        { id: 'overdue', title: 'Overdue', tasks: plan.overdue, empty: 'No overdue work matches these filters.' },
        { id: 'today', title: 'Due today', tasks: plan.today, empty: 'No work is due today with these filters.' },
        { id: 'upcoming', title: 'Next 30 days', tasks: plan.upcoming, empty: 'No upcoming work matches these filters.' },
        { id: 'undated', title: 'No deadline', tasks: plan.undated, empty: 'All matching open tasks have a deadline.' },
    ];
    return <div className="calendar-planning">
        <section className="panel calendar-panel" aria-labelledby="calendar-heading">
            <div className="calendar-toolbar">
                <div>
                    <h2 id="calendar-heading" aria-live="polite">{calendarDateLabel(`${month}-01`, { month: 'long', year: 'numeric' })}</h2>
                    <p className="muted">{monthCount} {monthCount === 1 ? 'deadline' : 'deadlines'} this month · matching tasks, including closed work</p>
                </div>
                <div className="calendar-navigation">
                    <button type="button" className="icon-button" aria-label="Previous month" disabled={shiftMonth(month, -1) === month}
                        onClick={() => onMonthChange(shiftMonth(month, -1))}><ChevronLeft size={18} /></button>
                    <label className="field"><span>Calendar month</span>
                        <input type="month" min="0001-01" max="9999-12" value={month} onChange={(event) => {
                            if (validMonth(event.target.value)) {
                                onMonthChange(event.target.value);
                            }
                        }} />
                    </label>
                    <button type="button" className="icon-button" aria-label="Next month" disabled={shiftMonth(month, 1) === month}
                        onClick={() => onMonthChange(shiftMonth(month, 1))}><ChevronRight size={18} /></button>
                    <button type="button" className="button" onClick={() => onMonthChange(today.slice(0, 7))}>Today</button>
                </div>
            </div>
            <p className="hint">Deadlines use calendar dates. Open a task to review or edit it using your existing permissions.</p>
            {!monthCount && <p role="status">No matching deadlines in this month. Browse another month or check the planning lists below.</p>}
            <div className="calendar-weekdays" aria-hidden="true">
                {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => <span key={day}>{day}</span>)}
            </div>
            <div className="calendar-grid">
                {days.map((day, index) => {
                    if (!day.key) {
                        return <div className="calendar-day is-empty" key={`padding-${index}`} aria-hidden="true" />;
                    }
                    const items = plan.byDay[day.key] || [];
                    return <section key={day.key}
                        className={`calendar-day${day.inMonth ? '' : ' outside-month'}${items.length ? '' : ' is-empty'}${day.key === today ? ' is-today' : ''}`}
                        aria-label={calendarDateLabel(day.key)}>
                        <h3>
                            <time dateTime={day.key} aria-current={day.key === today ? 'date' : undefined}>
                                <span className="calendar-day-number" aria-hidden="true">{day.day}</span>
                                <span className="calendar-day-label">{calendarDateLabel(day.key, { weekday: 'short', month: 'short', day: 'numeric' })}</span>
                            </time>
                            {day.key === today && <span className="calendar-today-label">Today</span>}
                        </h3>
                        <ul>
                            {items.map((task) => <li key={task.id}>
                                <DeadlineTask task={task} today={today} people={people} onOpen={onOpen} />
                            </li>)}
                        </ul>
                    </section>;
                })}
            </div>
        </section>
        <section className="planning-panel" aria-labelledby="planning-heading">
            <h2 id="planning-heading">Plan upcoming work</h2>
            <p className="hint">Open work only, ordered by deadline. These lists use the same filters and are relative to today ({calendarDateLabel(today, { month: 'short', day: 'numeric', year: 'numeric' })}),
                independent of the calendar month. Next 30 days runs from tomorrow through {calendarDateLabel(plan.upcomingEnd, { month: 'short', day: 'numeric', year: 'numeric' })}.</p>
            <div className="planning-sections">
                {sections.map((section) => <section className="panel planning-section" key={section.id} aria-labelledby={`planning-${section.id}`}>
                    <h3 id={`planning-${section.id}`}>{section.title} <span className="muted">({section.tasks.length})</span></h3>
                    {section.tasks.length ? <ul>
                        {section.tasks.map((task) => <li key={task.id}>
                            <DeadlineTask task={task} today={today} people={people} onOpen={onOpen} showDate />
                        </li>)}
                    </ul> : <p className="muted">{section.empty}</p>}
                </section>)}
            </div>
        </section>
    </div>;
}
