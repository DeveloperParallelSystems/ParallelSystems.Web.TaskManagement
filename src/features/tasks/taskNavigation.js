import { clientScopeSearch, taskClientId } from '../projects/projectClients.js';

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

export function taskScopeLocation(task, projects = [], clients = [], search = '') {
    return {
        pathname: linkedTaskPath(task, projects),
        search: withoutParentSelection(clientScopeSearch(search, taskClientId(task, projects, clients))),
    };
}

export function newChildTaskLocation(task, projects = [], search = '', clients = []) {
    const parameters = new URLSearchParams(clientScopeSearch(search, taskClientId(task, projects, clients)));
    parameters.set('parentTaskId', task.id);
    return {
        pathname: `${linkedTaskBase(task, projects)}/new`,
        search: `?${parameters}`,
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
