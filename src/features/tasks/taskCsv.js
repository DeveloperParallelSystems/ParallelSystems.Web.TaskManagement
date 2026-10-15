import { taskStatusName } from './taskWorkflow.js';

function csvCell(value) {
    let text = String(value ?? '');
    // CSV is opened in spreadsheets: prevent user text from becoming a formula.
    if (/^[\s\uFEFF]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) {
        text = `'${text}`;
    }
    return `"${text.replaceAll('"', '""')}"`;
}

export function taskCsv(tasks, people = []) {
    const names = new Map(people.map((person) => [person.id, person.name]));
    const rows = [['Code', 'Title', 'Description', 'Project', 'Discipline', 'Status', 'Priority', 'Owner', 'Reviewer', 'Release owner', 'Due date', 'Last updated']];
    for (const task of tasks) {
        rows.push([
            task.code, task.title, task.description, task.projectName || 'General', task.discipline,
            taskStatusName(task), task.priority, task.assigneeName || names.get(task.assigneeId) || '',
            task.reviewerName || names.get(task.reviewerId) || '',
            task.releaseOwnerName || names.get(task.releaseOwnerId) || '',
            task.dueDate?.slice(0, 10) || '', task.updatedAtUtc,
        ]);
    }
    return '\uFEFF' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export function downloadTaskCsv(tasks, people) {
    const url = URL.createObjectURL(new Blob([taskCsv(tasks, people)], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'parallel-systems-tasks.csv';
    link.click();
    URL.revokeObjectURL(url);
}
