export function projectClientIds(project, clients) {
    const assigned = Object.hasOwn(project || {}, 'clientIds')
        ? (project.clientIds || []) : [project?.clientId];
    const ids = new Set(assigned.filter(Boolean).map((id) => id.toLowerCase()));
    return clients.filter((client) => ids.has(client.id.toLowerCase())).map((client) => client.id);
}

export function projectsForClient(projects, clients, clientId, tasks = []) {
    return projects.filter((project) => {
        const ids = projectClientIds(project, clients);
        if (clientId === 'unassigned') {
            return ids.length === 0 || tasksForProjectClient(tasks, project, clients, null).length > 0;
        }
        return ids.some((id) => id.toLowerCase() === clientId?.toLowerCase());
    });
}

export function projectClientContext(project, clients, search) {
    const ids = projectClientIds(project, clients);
    const requested = new URLSearchParams(search).get('client')?.toLowerCase();
    if (requested === undefined || requested === 'unassigned') {
        return null;
    }
    return ids.find((id) => id.toLowerCase() === requested);
}

export function taskClientId(task, projects, clients) {
    const project = projects.find((item) => item.id === task.projectId);
    return projectClientIds(project, clients).find((id) => id.toLowerCase() === task.clientId?.toLowerCase()) || null;
}

export function tasksForProjectClient(tasks, project, clients, clientId) {
    return tasks.filter((task) => task.projectId === project.id &&
        taskClientId(task, [project], clients) === clientId);
}

export function clientScopeSearch(search, clientId) {
    const parameters = new URLSearchParams(search);
    parameters.set('client', clientId || 'unassigned');
    return `?${parameters}`;
}
