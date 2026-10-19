export function taskIdFromPath(pathname) {
    const match = pathname.match(/^(?:\/projects\/(?:general|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}))?\/tasks\/(new|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i);
    if (!match) {
        return null;
    }
    return match[1].toLowerCase();
}

export function projectScopeFromPath(pathname) {
    return pathname.match(/^\/projects\/([^/]+)\/tasks(?:\/|$)/i)?.[1].toLowerCase() || null;
}

export function taskPathAfterSave(task, projectId, projectScope) {
    const base = projectScope ? `/projects/${projectId || 'general'}/tasks` : '/tasks';
    return `${base}/${task.id}`;
}

function linkedTaskBase(task, projects) {
    if (!task.projectId) {
        return '/projects/general/tasks';
    }
    if (projects.some((project) => project.id === task.projectId)) {
        return `/projects/${task.projectId}/tasks`;
    }
    // Historical tasks may reference projects excluded from web project lookups.
    return '/tasks';
}

export function linkedTaskPath(task, projects = []) {
    return `${linkedTaskBase(task, projects)}/${task.id}`;
}

export function newChildTaskLocation(task, projects = []) {
    return {
        pathname: `${linkedTaskBase(task, projects)}/new`,
        search: `?${new URLSearchParams({ parentTaskId: task.id })}`,
    };
}

export function withoutParentSelection(search) {
    const parameters = new URLSearchParams(search);
    parameters.delete('parentTaskId');
    const remaining = parameters.toString();
    return remaining ? `?${remaining}` : '';
}

export function shouldBlockTaskNavigation({ dirty, saving }, currentLocation, nextLocation) {
    const changed = currentLocation.pathname !== nextLocation.pathname ||
        currentLocation.search !== nextLocation.search;
    return (dirty || saving) && changed;
}
