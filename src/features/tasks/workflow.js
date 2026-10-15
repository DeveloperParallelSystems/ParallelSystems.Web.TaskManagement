import { isTaskClosed, taskKind, taskStatusKey } from './taskWorkflow.js';
import { deadlineKey, localDayKey } from './calendar.js';

export const disciplines = ['Development', 'Drafting'];
export const reviewStatuses = ['Ready for Review', 'In Review', 'Ready for Re-Review'];

export const statuses = [
    'Backlog',
    'To Do',
    'In Progress',
    'Blocked',
    'Ready for Review',
    'In Review',
    'Failed Review',
    'Ready for Re-Review',
    'Approved',
    'Ready for Release',
    'Released',
    'Completed',
    'Cancelled',
];

export const groups = [
    { name: 'Planning', statuses: ['Backlog', 'To Do'], color: 'blue' },
    { name: 'Working', statuses: ['In Progress', 'Blocked', 'Failed Review'], color: 'amber' },
    { name: 'Review', statuses: ['Ready for Review', 'In Review', 'Ready for Re-Review'], color: 'purple' },
    {
        name: 'Delivery & closure',
        statuses: ['Approved', 'Ready for Release', 'Released', 'Completed', 'Cancelled'],
        color: 'green',
    },
];

export function suggestAssignee(values, status) {
    if (['Ready for Review', 'In Review', 'Ready for Re-Review'].includes(status)) {
        return values.reviewerId || '';
    }
    if (['Failed Review', 'In Progress', 'To Do'].includes(status)) {
        return values.originalAssigneeId || '';
    }
    if (status === 'Approved') {
        return values.releaseOwnerId || values.reviewerId || '';
    }
    if (['Ready for Release', 'Released'].includes(status)) {
        return values.releaseOwnerId || '';
    }
    if (['Completed', 'Cancelled'].includes(status)) {
        return '';
    }
    return values.assigneeId;
}

export function changeTaskField(current, name, value) {
    const updated = { ...current, [name]: value };
    const suggested = suggestAssignee(current, current.status);
    const affectsOwner =
        (name === 'reviewerId' &&
            ['Ready for Review', 'In Review', 'Ready for Re-Review', 'Approved'].includes(current.status)) ||
        (name === 'releaseOwnerId' &&
            ['Approved', 'Ready for Release', 'Released'].includes(current.status)) ||
        (name === 'originalAssigneeId' &&
            ['To Do', 'In Progress', 'Failed Review'].includes(current.status));
    if (name === 'status' || (affectsOwner && (!current.assigneeId || current.assigneeId === suggested))) {
        updated.assigneeId = suggestAssignee(updated, updated.status);
    }
    if (name === 'originalAssigneeId' && !current.assigneeId && !updated.assigneeId) {
        updated.assigneeId = value;
    }
    return updated;
}

export function statusTone(status) {
    if (['Failed Review', 'Blocked'].includes(status)) {
        return 'red';
    }
    if (['Completed', 'Approved', 'Released'].includes(status)) {
        return 'green';
    }
    if (status.includes('Review')) {
        return 'purple';
    }
    return status === 'Cancelled' ? 'gray' : 'blue';
}

export function filterTasks(tasks, filters, userId, people = [], today = new Date()) {
    const query = (filters.search || '').trim().toLowerCase();
    const weekStart = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (today.getDay() + 6) % 7);
    const weekEnd = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + 6);
    const firstDay = localDayKey(weekStart);
    const lastDay = localDayKey(weekEnd);
    const names = new Map(people.map((person) => [person.id, person.name]));
    const participantIds = new Set(people.filter((person) => userId && person.userId === userId).map((person) => person.id));
    if (userId && !people.some((person) => Object.hasOwn(person, 'userId'))) {
        participantIds.add(userId);
    }
    return tasks.filter((task) => {
        const searchable = [task.code, task.title, task.description, task.projectName || 'General',
            task.assigneeName || names.get(task.assigneeId), task.reviewerName || names.get(task.reviewerId),
            task.releaseOwnerName || names.get(task.releaseOwnerId)].filter(Boolean).join(' ').toLowerCase();
        const quickViewMatches = {
            'my-work': participantIds.has(task.assigneeId),
            'my-open': participantIds.has(task.assigneeId) && !isTaskClosed(task),
            'due-week': !isTaskClosed(task) && Boolean(deadlineKey(task.dueDate)) &&
                deadlineKey(task.dueDate) >= firstDay && deadlineKey(task.dueDate) <= lastDay,
            review: participantIds.has(task.reviewerId) && taskKind(task) === 'Review',
            releases: participantIds.has(task.releaseOwnerId),
            created: task.createdById === userId,
            overdue: isOverdue(task, today),
        };
        return (
            (!query || searchable.includes(query)) &&
            (!filters.status || taskStatusKey(task) === filters.status || task.status === filters.status ||
                (task.workflow && `${task.workflow.id}:${task.status}` === filters.status)) &&
            (!filters.discipline || task.discipline === filters.discipline) &&
            (!filters.projectId || task.projectId === filters.projectId) &&
            (!filters.assigneeId || (filters.assigneeId === 'unassigned' ? !task.assigneeId : task.assigneeId === filters.assigneeId)) &&
            (!(filters.labelIds?.length) || filters.labelIds.every((id) => task.labels?.some((label) => label.id === id))) &&
            (!filters.mine || participantIds.has(task.assigneeId)) &&
            (!filters.quickView || quickViewMatches[filters.quickView] === true)
        );
    });
}

export function staffOptionLabel(person) {
    const fullName = [person.firstName, person.lastName]
        .map((part) => (part || '').trim())
        .filter(Boolean)
        .join(', ');
    const name = fullName || person.name;
    const email = (person.email || '').trim();
    const label = email ? `${name} <${email}>` : name;
    if (!person.isActive) {
        return `${label} (legacy account — choose staff)`;
    }
    return label;
}

export function getProjectContributors(tasks, projectId) {
    const contributors = new Map();
    const roles = [
        ['originalAssigneeId', 'Original assignee', 'dev'],
        ['assigneeId', 'Current owner', 'owner'],
        ['reviewerId', 'Reviewer / QA', 'qa'],
        ['releaseOwnerId', 'Release owner', 'release'],
    ];

    for (const task of tasks) {
        if (task.projectId !== projectId) {
            continue;
        }
        for (const [field, description, tone] of roles) {
            const id = task[field];
            if (!id) {
                continue;
            }
            if (!contributors.has(id)) {
                contributors.set(id, { id, key: id, tone, roles: [], fallbackName: null });
            }
            const contributor = contributors.get(id);
            if (!contributor.roles.includes(description)) {
                contributor.roles.push(description);
            }
            if (id === task.assigneeId && task.assigneeName) {
                contributor.fallbackName = task.assigneeName;
            }
        }
    }

    return [...contributors.values()].map(({ roles: assignedRoles, ...contributor }) => ({
        ...contributor,
        description: assignedRoles.join(' · '),
    }));
}

export function sortTasks(tasks, sort = 'updatedAtUtc', direction = 'desc') {
    const priorities = { Low: 1, Medium: 2, High: 3, Urgent: 4 };
    const sign = direction === 'asc' ? 1 : -1;
    return [...tasks].sort((left, right) => {
        let first = left[sort];
        let second = right[sort];
        if (sort === 'priority') {
            first = priorities[left.priority];
            second = priorities[right.priority];
        }
        // Missing values stay last in either direction; ties have a stable identity order.
        if (first == null || first === '') {
            return second == null || second === '' ? left.id.localeCompare(right.id) : 1;
        }
        if (second == null || second === '') {
            return -1;
        }
        let comparison;
        if (sort === 'title') {
            comparison = String(first).localeCompare(String(second), undefined, { sensitivity: 'base', numeric: true });
        }
        else if (sort === 'priority') {
            comparison = first - second;
        }
        else {
            comparison = new Date(first).getTime() - new Date(second).getTime();
        }
        return (comparison || 0) * sign || left.id.localeCompare(right.id);
    });
}

export function isOverdue(task, today = new Date()) {
    const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    return Boolean(
        task.dueDate && task.dueDate.slice(0, 10) < date && !isTaskClosed(task),
    );
}

export function dateLabel(value) {
    if (!value) {
        return 'No due date';
    }
    return new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
    });
}

export function initials(name) {
    return (name || '?')
        .split(/\s+/)
        .map((part) => part[0])
        .slice(0, 2)
        .join('')
        .toUpperCase();
}
