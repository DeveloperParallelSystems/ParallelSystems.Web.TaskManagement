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

export function filterTasks(tasks, filters, userId) {
    const query = filters.search.trim().toLowerCase();
    return tasks.filter((task) => {
        return (
            (!query ||
                `${task.code} ${task.title} ${task.projectName || 'General'}`
                    .toLowerCase()
                    .includes(query)) &&
            (!filters.status || task.status === filters.status) &&
            (!filters.discipline || task.discipline === filters.discipline) &&
            (!filters.projectId || task.projectId === filters.projectId) &&
            (!filters.mine || task.assigneeId === userId)
        );
    });
}

export function isOverdue(task, today = new Date()) {
    const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    return Boolean(
        task.dueDate && task.dueDate.slice(0, 10) < date && !['Completed', 'Cancelled'].includes(task.status),
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
