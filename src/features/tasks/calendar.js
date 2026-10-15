import { isTaskClosed } from './taskWorkflow.js';

function utcDate(year, month, day) {
    const date = new Date(0);
    date.setUTCFullYear(year, month - 1, day);
    date.setUTCHours(0, 0, 0, 0);
    return date;
}

function dateKey(date) {
    const year = date.getUTCFullYear();
    if (year < 1 || year > 9999) {
        return '';
    }
    return `${String(year).padStart(4, '0')}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

export function localDayKey(date = new Date()) {
    return `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function validMonth(value) {
    return typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value) && value.slice(0, 4) !== '0000';
}

export function deadlineKey(value) {
    if (typeof value !== 'string') {
        return '';
    }
    const key = value.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) {
        return '';
    }
    const [year, month, day] = key.split('-').map(Number);
    return dateKey(utcDate(year, month, day)) === key ? key : '';
}

export function shiftMonth(month, offset) {
    if (!validMonth(month)) {
        return '';
    }
    const [year, number] = month.split('-').map(Number);
    const shifted = dateKey(utcDate(year, number + offset, 1));
    return shifted ? shifted.slice(0, 7) : month;
}

export function calendarDays(month) {
    if (!validMonth(month)) {
        return [];
    }
    const [year, number] = month.split('-').map(Number);
    const first = utcDate(year, number, 1);
    const offset = (first.getUTCDay() + 6) % 7;
    return Array.from({ length: 42 }, (_, index) => {
        const date = utcDate(year, number, index + 1 - offset);
        const key = dateKey(date);
        return { key, day: date.getUTCDate(), inMonth: key.startsWith(month) };
    });
}

export function calendarDateLabel(key, options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) {
    const [year, month, day] = key.split('-').map(Number);
    return utcDate(year, month, day).toLocaleDateString(undefined, { ...options, timeZone: 'UTC' });
}

export function planTasks(tasks, today) {
    const [year, month, day] = today.split('-').map(Number);
    const upcomingEnd = dateKey(utcDate(year, month, day + 30)) || '9999-12-31';
    const plan = { byDay: {}, overdue: [], today: [], upcoming: [], undated: [], upcomingEnd };
    const ordered = [...tasks].sort((left, right) => (deadlineKey(left.dueDate) || '9999-12-31')
        .localeCompare(deadlineKey(right.dueDate) || '9999-12-31'));
    for (const task of ordered) {
        const due = deadlineKey(task.dueDate);
        if (due) {
            (plan.byDay[due] ||= []).push(task);
        }
        if (isTaskClosed(task)) {
            continue;
        }
        if (!due) {
            plan.undated.push(task);
        }
        else if (due < today) {
            plan.overdue.push(task);
        }
        else if (due === today) {
            plan.today.push(task);
        }
        else if (due <= upcomingEnd) {
            plan.upcoming.push(task);
        }
    }
    return plan;
}

export function calendarFilterOptions(tasks, people, projects) {
    const staff = new Map(people.map((person) => [person.id, person]));
    const owners = new Map();
    const taskProjects = new Map(projects.map((project) => [project.id, project]));
    for (const task of tasks) {
        if (task.assigneeId && !owners.has(task.assigneeId)) {
            const person = staff.get(task.assigneeId);
            const fullName = [person?.firstName, person?.lastName].filter(Boolean).join(', ');
            const name = fullName || person?.name || task.assigneeName || 'Assigned staff';
            owners.set(task.assigneeId, {
                id: task.assigneeId,
                name: person?.email ? `${name} <${person.email}>` : name,
            });
        }
        if (task.projectId && !taskProjects.has(task.projectId)) {
            taskProjects.set(task.projectId, { id: task.projectId, name: task.projectName || 'Existing task project' });
        }
    }
    const byName = (left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id);
    return { owners: [...owners.values()].sort(byName), projects: [...taskProjects.values()].sort(byName) };
}
