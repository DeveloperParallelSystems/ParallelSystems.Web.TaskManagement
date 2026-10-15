import { statuses } from './workflow.js';

const statusKey = (value) => value.trim().toLowerCase().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ');

export function taskDisciplineStatusOptions(task, configuration, allowedStatuses = []) {
    if (!task || !configuration) {
        return [];
    }
    const discipline = task.discipline || task.workflow?.discipline;
    const active = configuration.items.find((item) => item.discipline === discipline)?.active;
    const taskStages = task.workflow?.definition.stages || statuses.map((status) => ({ id: status, name: status }));
    const configured = active?.definition.stages || taskStages;
    const result = [];
    for (const stage of configured) {
        // Keep the task's persisted identifiers; active definitions do not migrate older tasks.
        const candidate = taskStages.find((item) => statusKey(item.id) === statusKey(stage.id)) ||
            taskStages.find((item) => statusKey(item.name) === statusKey(stage.name));
        if (candidate && allowedStatuses.includes(candidate.id) && !result.some((item) => item.status === candidate.id)) {
            result.push({ status: candidate.id, name: stage.name });
        }
    }
    return result;
}
