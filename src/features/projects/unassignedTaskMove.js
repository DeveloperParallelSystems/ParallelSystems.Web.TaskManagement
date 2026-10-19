import { projectClientIds, tasksForProjectClient } from './projectClients.js';

export function unassignedTaskMove(project, clients, tasks, clientId) {
    if (!project || !projectClientIds(project, clients).includes(clientId)) {
        throw new Error('Choose a linked client for this project.');
    }
    const unassigned = tasksForProjectClient(tasks, project, clients, null);
    if (!unassigned.length) {
        throw new Error('No unassigned tasks remain in this project.');
    }
    return { tasks: unassigned, changes: { clientId } };
}
