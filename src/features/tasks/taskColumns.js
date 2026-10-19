import { createAsyncThunk } from '@reduxjs/toolkit';
import { useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { request } from '../../app/api.js';
import { validCustomDefinitions } from './customFieldValues.js';

export const taskColumnLabels = { task: 'Task', discipline: 'Discipline', status: 'Status', priority: 'Priority',
    originalAssignee: 'Original assignee', assignedTo: 'Assigned To', qa: 'QA', dueDate: 'Due' };
export const requiredTaskColumns = ['task', 'discipline', 'status', 'priority', 'assignedTo', 'dueDate'];
export const defaultTaskColumns = {
    Development: Object.keys(taskColumnLabels),
    Drafting: Object.keys(taskColumnLabels).filter((field) => field !== 'qa'),
};
export const emptyTaskColumns = { data: null, readId: null, writeId: null, error: null, invalidated: false };
export const taskColumnKey = ({ projectId, discipline }) => `${projectId || 'default'}:${discipline}`;
const path = ({ projectId, discipline }) => `/task-columns/${projectId ? `projects/${encodeURIComponent(projectId)}/` : ''}${encodeURIComponent(discipline)}`;

export function columnError(columns, customFields = []) {
    const customIds = new Set(customFields.filter((field) => !field.isArchived).map((field) => `custom:${field.id.toLowerCase()}`));
    if (!Array.isArray(columns) || columns.length > 38 || columns.some((field) => !Object.hasOwn(taskColumnLabels, field) && !customIds.has(field)) || new Set(columns).size !== columns.length) {
        return 'Choose each available field at most once.';
    }
    if (requiredTaskColumns.some((field) => !columns.includes(field))) {
        return 'Task, Discipline, Status, Priority, Assigned To and Due must always be visible.';
    }
    return '';
}

export function columnLabels(customFields = []) {
    return { ...taskColumnLabels, ...Object.fromEntries(customFields.filter((field) => !field.isArchived).map((field) => [`custom:${field.id.toLowerCase()}`, field.name])) };
}

function readPage(page, scope) {
    const customFields = page?.customFields ?? [];
    if (!page || page.projectId !== (scope.projectId || null) || page.discipline !== scope.discipline ||
        !Number.isSafeInteger(page.version) || page.version < 0 || typeof page.usesDefault !== 'boolean' ||
        typeof page.canManage !== 'boolean' || !validCustomDefinitions(customFields) ||
        (!scope.projectId && customFields.length > 0) || columnError(page.columns, customFields)) {
        throw new Error('The server returned invalid task columns. Reload before continuing.');
    }
    return { ...page, customFields };
}

async function operation(scope, method, reset, { signal, rejectWithValue }) {
    try {
        if (!Object.hasOwn(defaultTaskColumns, scope.discipline) || (reset && !scope.projectId)) {
            throw new Error('Select a valid task column scope.');
        }
        if (method === 'PUT' && columnError(scope.columns, scope.customFields)) {
            throw new Error(columnError(scope.columns, scope.customFields));
        }
        const body = method === 'GET' ? undefined : { version: scope.version, ...(reset ? {} : { columns: scope.columns }) };
        return readPage(await request(path(scope) + (reset ? '/use-default' : ''), { method, body, signal }), scope);
    }
    catch (error) {
        return rejectWithValue({ message: error.message, status: error.status });
    }
}

export const loadTaskColumns = createAsyncThunk('taskColumns/load', (scope, api) => operation(scope, 'GET', false, api), {
    condition: (scope, { getState }) => {
        const resource = getState().workspace.taskColumns?.[taskColumnKey(scope)];
        return !resource?.readId && !resource?.writeId;
    },
});
export const saveTaskColumns = createAsyncThunk('taskColumns/save', (scope, api) => operation(scope, 'PUT', false, api));
export const useDefaultTaskColumns = createAsyncThunk('taskColumns/reset', (scope, api) => operation(scope, 'POST', true, api));

export function listTaskColumns(profiles, discipline) {
    if (discipline) {
        return profiles[discipline] || [];
    }
    return [...new Set([...(profiles.Development || []), ...(profiles.Drafting || [])])];
}

export function taskPersonName(task, people, field) {
    const id = task[field === 'originalAssignee' ? 'originalAssigneeId' : field === 'qa' ? 'reviewerId' : 'assigneeId'];
    const person = id && people.find((candidate) => candidate.id?.toLowerCase() === id.toLowerCase());
    const name = person && ([person.firstName, person.lastName].filter(Boolean).join(' ') || person.name);
    return name || ((field === 'assignedTo' || id && id === task.assigneeId) && task.assigneeName) ||
        (id ? 'Staff details unavailable' : 'Unassigned');
}

export function useTaskColumnProfiles(projectId = null) {
    const dispatch = useDispatch();
    const revision = useSelector((state) => state.workspace.taskColumnsRevision || 0);
    const epoch = useSelector((state) => state.workspace.taskColumnsEpoch || 0);
    const resources = useSelector((state) => state.workspace.taskColumns);
    useEffect(() => {
        const refresh = () => {
            for (const discipline of Object.keys(defaultTaskColumns)) {
                dispatch(loadTaskColumns({ projectId, discipline }));
            }
        };
        refresh();
        window.addEventListener('focus', refresh);
        const timer = window.setInterval(() => {
            if (document.visibilityState === 'visible') {
                refresh();
            }
        }, 60000);
        return () => {
            window.removeEventListener('focus', refresh);
            window.clearInterval(timer);
        };
    }, [dispatch, projectId, revision, epoch]);
    return Object.fromEntries(Object.keys(defaultTaskColumns).map((discipline) => {
        const resource = resources?.[taskColumnKey({ projectId, discipline })] || emptyTaskColumns;
        // A renamed/archived definition must not expose stale custom labels or values during refresh.
        return [discipline, resource.invalidated && resource.data?.customFields?.length ? { ...resource, data: null } : resource];
    }));
}

export function reconcileTaskColumns(state, bindingsChanged) {
    if (bindingsChanged) {
        state.taskColumns = {};
        state.customFields = {};
        state.taskColumnsEpoch = (state.taskColumnsEpoch || 0) + 1;
        return;
    }
    const visible = new Set(state.projects.map((project) => project.id));
    for (const key of Object.keys(state.taskColumns || {})) {
        const scope = key.split(':')[0];
        if (scope !== 'default' && !visible.has(scope)) {
            delete state.taskColumns[key];
        }
    }
    for (const projectId of Object.keys(state.customFields || {})) {
        if (!visible.has(projectId)) {
            delete state.customFields[projectId];
        }
    }
}

export function advanceTaskColumnRevision(state, version, layoutKey = null, definitionProjectId = null) {
    if (version <= (state.taskColumnsRevision || 0)) {
        return;
    }
    state.taskColumnsRevision = version;
    for (const [key, resource] of Object.entries(state.taskColumns || {})) {
        if (key !== layoutKey) {
            resource.invalidated = true;
            resource.readId = null;
        }
    }
    for (const [projectId, resource] of Object.entries(state.customFields || {})) {
        if (projectId !== definitionProjectId) {
            resource.invalidated = true;
            resource.readId = null;
        }
    }
}

export function addTaskColumnReducers(builder) {
    for (const thunk of [loadTaskColumns, saveTaskColumns, useDefaultTaskColumns]) {
        const writing = thunk !== loadTaskColumns;
        const requestKey = writing ? 'writeId' : 'readId';
        builder.addCase(thunk.pending, (state, action) => {
            state.taskColumns ||= {};
            const resource = state.taskColumns[taskColumnKey(action.meta.arg)] ||= { ...emptyTaskColumns };
            resource[requestKey] = action.meta.requestId;
            resource.error = null;
            if (writing) {
                resource.readId = null;
            }
        });
        builder.addCase(thunk.fulfilled, (state, action) => {
            const key = taskColumnKey(action.meta.arg);
            const resource = state.taskColumns?.[key];
            if (!resource || resource[requestKey] !== action.meta.requestId) {
                return;
            }
            resource[requestKey] = null;
            const version = action.payload.version;
            if (version < (state.taskColumnsRevision || 0)) {
                resource.invalidated = true;
                return;
            }
            advanceTaskColumnRevision(state, version, key);
            resource.data = action.payload;
            resource.invalidated = false;
            resource.error = null;
        });
        builder.addCase(thunk.rejected, (state, action) => {
            const resource = state.taskColumns?.[taskColumnKey(action.meta.arg)];
            if (!resource || resource[requestKey] !== action.meta.requestId) {
                return;
            }
            resource[requestKey] = null;
            resource.error = action.payload || { message: 'Could not load task columns.' };
            if ([401, 403, 404].includes(resource.error.status)) {
                resource.data = null;
                resource.readId = null;
                resource.writeId = null;
            }
        });
    }
}
