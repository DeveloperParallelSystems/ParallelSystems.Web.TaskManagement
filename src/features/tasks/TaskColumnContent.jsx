import { dateLabel, isOverdue } from './workflow';
import { taskStatusName, taskStatusTone } from './taskWorkflow';
import { taskPersonName } from './taskColumns';
import LabelBadges from './LabelBadges';
import { customFieldDisplay } from './customFieldValues';

export default function TaskColumnContent({ field, task, people = [], onOpen, card = false, customFields = [] }) {
    if (field.startsWith('custom:')) {
        const definition = customFields.find((candidate) => !candidate.isArchived && `custom:${candidate.id.toLowerCase()}` === field);
        if (!definition) {
            return '—';
        }
        const value = task.customFieldValues?.find((item) => item.fieldId.toLowerCase() === definition.id.toLowerCase())?.value;
        return customFieldDisplay(definition, value, people);
    }
    if (field === 'task') {
        if (card) {
            return <><span className="task-code">{task.code}</span><h3>{task.title}</h3>
                <div className="project-name">{task.projectName || 'General'}</div></>;
        }
        return <><button className="table-task" onClick={() => onOpen(task.id)}>
            <small>{task.code}</small><strong>{task.title}</strong><span>{task.projectName || 'General'}</span>
        </button><LabelBadges labels={task.labels} /></>;
    }
    if (field === 'status') {
        return <span className={`badge ${taskStatusTone(task)}`}>{taskStatusName(task)}</span>;
    }
    if (field === 'dueDate') {
        return <span className={isOverdue(task) ? 'due overdue' : 'due'}>{dateLabel(task.dueDate)}</span>;
    }
    if (['originalAssignee', 'assignedTo', 'qa'].includes(field)) {
        return taskPersonName(task, people, field);
    }
    return task[field] || '—';
}
