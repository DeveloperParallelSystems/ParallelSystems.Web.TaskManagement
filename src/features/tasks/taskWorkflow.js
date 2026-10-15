export function taskStage(task) {
    return task.workflow?.definition.stages.find((stage) => stage.id === task.status) || null;
}

export function taskStatusName(task) {
    return task.statusName || taskStage(task)?.name || task.status;
}

export function taskKind(task) {
    if (task.workflow && (!task.liveStatusMode || taskStage(task))) {
        return taskStage(task)?.kind || 'Unknown';
    }
    if (['Completed', 'Cancelled'].includes(task.status)) {
        return task.status;
    }
    if (['Ready for Review', 'In Review', 'Ready for Re-Review'].includes(task.status)) {
        return 'Review';
    }
    if (['Approved', 'Ready for Release', 'Released'].includes(task.status)) {
        return 'Release';
    }
    return ['Backlog', 'To Do'].includes(task.status) ? 'Planning' : 'Work';
}

export function isTaskClosed(task) {
    return ['Completed', 'Cancelled'].includes(taskKind(task));
}

export function taskStatusTone(task) {
    const stage = taskStage(task);
    if (stage) {
        return stage.color;
    }
    if (['Failed Review', 'Blocked'].includes(task.status)) {
        return 'red';
    }
    if (['Completed', 'Approved', 'Released'].includes(task.status)) {
        return 'green';
    }
    if (task.status.includes('Review')) {
        return 'purple';
    }
    return task.status === 'Cancelled' ? 'gray' : 'blue';
}

export function taskStatusKey(task) {
    return task.statusName ? `status:${task.status}` : task.workflow && !task.liveStatusMode ? `${task.workflow.id}:${task.status}` : task.status;
}

export function taskStatusOptions(tasks, settings, discipline = '') {
    if (settings) {
        const codes = new Set(settings.disciplines.filter((item) => !discipline || item.discipline === discipline).flatMap((item) => item.statuses));
        return settings.catalog.filter((item) => codes.has(item.code)).map((item) => ({ value: `status:${item.code}`, label: item.name }));
    }
    const options = new Map();
    for (const task of tasks) {
        if (task.workflow) {
            const workflow = task.workflow;
            for (const stage of workflow.definition.stages) {
                const value = `${workflow.id}:${stage.id}`;
                options.set(value, { value, label: `${workflow.discipline} · ${workflow.definition.name} v${workflow.versionNumber} · ${stage.name}` });
            }
        }
    }
    return [...options.values()];
}

export function workflowBoards(tasks, presentationGroups, { availableTasks = tasks, workflows = [], discipline = '', statusSettings = null } = {}) {
    if (!presentationGroups.length) {
        return [];
    }
    const matchesDiscipline = (task) => !discipline || (task.discipline || task.workflow?.discipline) === discipline;
    const available = availableTasks.filter(matchesDiscipline);
    const visible = tasks.filter(matchesDiscipline);
    const definitions = new Map();
    for (const workflow of [...workflows, ...available.map((task) => task.workflow)]) {
        if (workflow && (!discipline || workflow.discipline === discipline) && !definitions.has(workflow.id)) {
            definitions.set(workflow.id, workflow);
        }
    }
    const groups = presentationGroups.map((column) => ({
        ...column,
        id: `legacy:${column.id}`,
        targets: column.statuses.map((status) => ({ workflowId: null, status })),
        tasks: [],
    }));
    const nameKey = (name) => name.trim().toLowerCase().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ');
    const columnsByStatus = new Map();
    const columnsByName = new Map();
    for (const group of groups) {
        columnsByName.set(nameKey(group.name), group);
        for (const status of group.statuses) {
            columnsByStatus.set(nameKey(status), group);
        }
    }
    const kindStatuses = {
        Planning: 'To Do',
        Work: 'In Progress',
        Review: 'In Review',
        Release: 'Ready for Release',
        Completed: 'Completed',
        Cancelled: 'Cancelled',
    };
    function columnForStage(stage) {
        // Stage metadata chooses a saved column; it must never create another column.
        return columnsByStatus.get(nameKey(stage.name)) ||
            columnsByStatus.get(nameKey(stage.id)) ||
            columnsByName.get(nameKey(stage.name)) ||
            columnsByStatus.get(nameKey(kindStatuses[stage.kind] || ''));
    }
    for (const workflow of definitions.values()) {
        for (const stage of workflow.definition.stages) {
            const group = columnForStage(stage);
            if (group) {
                group.targets.push({ workflowId: workflow.id, status: stage.id });
            }
        }
    }
    const directStatuses = new Set(groups.flatMap((group) => group.statuses));
    if (statusSettings) {
        for (const group of groups) {
            group.statusTargets = statusSettings.disciplines.flatMap((item) => item.statuses.filter((code) =>
                statusSettings.catalog.some((status) => status.code === code && group.statuses.includes(directStatuses.has(code) ? code : status.boardStatus)))
                .map((status) => ({ discipline: item.discipline, status })));
        }
    }
    for (const task of visible) {
        const workflowId = task.workflow?.id || null;
        const mappedStatus = directStatuses.has(task.status) ? task.status :
            statusSettings?.catalog.find((item) => item.code === task.status)?.boardStatus || task.statusBoardStatus;
        const group = mappedStatus ? groups.find((column) => column.statuses.includes(mappedStatus)) :
            groups.find((column) => column.targets.some((target) => target.workflowId === workflowId && target.status === task.status));
        if (group) {
            group.tasks.push(task);
        }
    }
    return [{ id: 'shared', name: 'Task board', groups }];
}

export function boardMoveStatuses(group, task) {
    if (!task) {
        return [];
    }
    if (group.statusTargets) {
        return group.statusTargets.filter((target) => target.discipline === task.discipline).map((target) => target.status);
    }
    return group.targets.filter((target) => target.workflowId === (task.workflow?.id || null))
        .map((target) => target.status);
}

export function ownerForStage(task, stageId) {
    const stage = task.workflow?.definition.stages.find((item) => item.id === stageId);
    const fields = { Original: 'originalAssigneeId', Owner: 'assigneeId', Reviewer: 'reviewerId', Release: 'releaseOwnerId' };
    return stage && fields[stage.ownerRole] ? task[fields[stage.ownerRole]] || null : null;
}

export function changeWorkflowField(task, name, value) {
    const changed = { ...task, [name]: value };
    const stage = taskStage(changed);
    if (stage && stage.ownerRole !== 'Owner') {
        changed.assigneeId = ownerForStage(changed, changed.status) || '';
    }
    return changed;
}

export function initializeTaskWorkflow(task, workflow) {
    const selected = { ...task, workflow, workflowVersionId: workflow?.id || null,
        status: workflow?.definition.startStageId || 'Backlog' };
    if (workflow) {
        selected.assigneeId = ownerForStage(selected, selected.status) || '';
    }
    return selected;
}
