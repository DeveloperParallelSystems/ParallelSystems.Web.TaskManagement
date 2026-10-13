import { suggestAssignee } from './workflow.js';

export function canMoveTask(details, status, administrator) {
    if (!details?.task || status === details.task.status || !details.allowedStatuses?.includes(status)) {
        return false;
    }
    if (!administrator && (status === 'Cancelled' || ['Completed', 'Cancelled'].includes(details.task.status))) {
        return false;
    }
    return true;
}

export function needsReviewNote(status) {
    return ['Approved', 'Failed Review'].includes(status);
}

export function taskInput(task, changes = {}) {
    const input = {
        title: task.title, description: task.description, discipline: task.discipline,
        projectId: task.projectId || null, priority: task.priority, dueDate: task.dueDate?.slice(0, 10) || null,
        status: task.status, originalAssigneeId: task.originalAssigneeId,
        assigneeId: task.assigneeId || null, reviewerId: task.reviewerId || null,
        releaseOwnerId: task.releaseOwnerId || null, version: task.version, note: '', ...changes,
    };
    if (input.status !== task.status) {
        input.assigneeId = suggestAssignee(input, input.status) || null;
    }
    return input;
}
