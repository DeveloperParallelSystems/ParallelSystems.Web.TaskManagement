import { projectsForClient, taskClientId } from '../projects/projectClients.js';
import { deadlineKey, localDayKey } from './calendar.js';
import { taskKind } from './taskWorkflow.js';

export function dashboardTaskSummary(tasks, today = localDayKey()) {
    const summary = { total: tasks.length, overdue: 0, dueThisWeek: 0, withoutOwner: 0 };
    for (const task of tasks) {
        if (dashboardTaskOverdue(task, today)) {
            summary.overdue++;
        }
        if (dashboardDueMatches(task, 'week', today)) {
            summary.dueThisWeek++;
        }
        if (!task.assigneeId?.trim()) {
            summary.withoutOwner++;
        }
    }
    return summary;
}

export function dashboardTaskOverdue(task, today = localDayKey()) {
    const deadline = deadlineKey(task.dueDate);
    return Boolean(deadline && deadline < today && !['Completed', 'Cancelled'].includes(taskKind(task)));
}

export function dashboardDueMatches(task, due, today = localDayKey()) {
    if (due === 'overdue') {
        return dashboardTaskOverdue(task, today);
    }
    if (due === 'week') {
        const deadline = deadlineKey(task.dueDate);
        const start = new Date(`${today}T12:00:00`);
        start.setDate(start.getDate() - (start.getDay() + 6) % 7);
        const end = new Date(start);
        end.setDate(end.getDate() + 6);
        return Boolean(deadline && deadline >= localDayKey(start) && deadline <= localDayKey(end));
    }
    return true;
}

export function clientDashboardGroups({ tasks, projects, clients, due = 'all', today = localDayKey() }) {
    const groups = clients.map((client) => ({ id: client.id, name: client.name, tasks: [], totalAvailable: 0,
        projectCount: projectsForClient(projects, clients, client.id).length }));
    const byId = new Map(groups.map((group) => [group.id, group]));
    const unassigned = { id: 'unassigned', name: 'Unassigned', tasks: [], totalAvailable: 0,
        projectCount: projectsForClient(projects, clients, 'unassigned', tasks).length };
    const general = { id: 'general', name: 'General tasks', tasks: [], totalAvailable: 0, projectCount: 0 };
    for (const task of tasks) {
        let group = general;
        if (task.projectId) {
            group = byId.get(taskClientId(task, projects, clients)) || unassigned;
        }
        group.totalAvailable++;
        if (dashboardDueMatches(task, due, today)) {
            group.tasks.push(task);
        }
    }
    for (const group of [...groups, unassigned, general]) {
        group.tasks.sort((first, second) => Number(dashboardTaskOverdue(second, today)) - Number(dashboardTaskOverdue(first, today)) ||
            (deadlineKey(first.dueDate) || '9999-12-31').localeCompare(deadlineKey(second.dueDate) || '9999-12-31') ||
            (second.updatedAtUtc || '').localeCompare(first.updatedAtUtc || '') || first.id.localeCompare(second.id));
        group.summary = dashboardTaskSummary(group.tasks, today);
    }
    return { clients: groups, other: [unassigned, general].filter((group) => group.totalAvailable > 0) };
}

export function sortDashboardClients(groups, sort) {
    const metric = { week: 'dueThisWeek', withoutOwner: 'withoutOwner' }[sort] || 'overdue';
    const value = (group) => sort === 'projects' ? group.projectCount : group.summary[metric];
    return [...groups].sort((first, second) => {
        const name = first.name.localeCompare(second.name, undefined, { numeric: true, sensitivity: 'base' });
        if (sort === 'name') {
            return name || first.id.localeCompare(second.id);
        }
        const difference = value(second) - value(first);
        return difference || name || first.id.localeCompare(second.id);
    });
}
