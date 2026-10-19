import { createAsyncThunk } from '@reduxjs/toolkit';
import { request } from '../../app/api.js';
import { groups, statuses } from './workflow.js';

export const presentationColors = ['blue', 'amber', 'purple', 'green'];
const defaultIds = ['planning', 'working', 'review', 'delivery'];
export const defaultPresentationGroups = groups.map((group, index) => ({ ...group, id: defaultIds[index] }));
export const emptyPresentation = { data: null, status: 'idle', readId: null, writeId: null, error: null };
const unavailableGroups = [];

export function presentationError(columns, catalog = null) {
    const expectedStatuses = catalog ? catalog.map((item) => item.code) : statuses;
    if (!Array.isArray(columns) || columns.length < 1 || columns.length > 13) {
        return 'Use between 1 and 13 columns.';
    }
    const ids = new Set();
    const assigned = [];
    for (const column of columns) {
        if (!column || typeof column.id !== 'string' || !/^[a-z0-9-]{1,40}$/.test(column.id) || ids.has(column.id) ||
            typeof column.name !== 'string' || !column.name.trim() || column.name.length > 80 ||
            !presentationColors.includes(column.color) || !Array.isArray(column.statuses)) {
            return 'Each column needs a unique ID, a name up to 80 characters, a theme color, and a status list.';
        }
        ids.add(column.id);
        assigned.push(...column.statuses);
    }
    if (assigned.length !== expectedStatuses.length || new Set(assigned).size !== expectedStatuses.length ||
        assigned.some((status) => !expectedStatuses.includes(status))) {
        return catalog ? 'Include every catalog status exactly once.' : 'Include every existing status exactly once.';
    }
    return '';
}

export function selectPresentationGroups(state) {
    return state.workspace.workflowPresentation?.data?.groups || unavailableGroups;
}

export function movePresentationStatus(columns, status, targetId, catalog = null) {
    const expectedStatuses = catalog ? catalog.map((item) => item.code) : statuses;
    if (!expectedStatuses.includes(status) || !columns.some((column) => column.id === targetId)) {
        return columns;
    }
    return columns.map((column) => ({
        ...column,
        statuses: [...column.statuses.filter((item) => item !== status), ...(column.id === targetId ? [status] : [])],
    }));
}

export function reorderPresentation(items, index, offset) {
    const target = index + offset;
    if (target < 0 || target >= items.length) {
        return items;
    }
    const result = [...items];
    [result[index], result[target]] = [result[target], result[index]];
    return result;
}

export function readPresentationPage(page) {
    if (page?.catalog && (!Number.isSafeInteger(page.catalogVersion) || page.catalogVersion < 1 ||
        !Array.isArray(page.catalog) || !page.catalog.length ||
        page.catalog.some((item) => !item || typeof item.code !== 'string' || !item.code || typeof item.name !== 'string' || !item.name.trim()) ||
        new Set(page.catalog.map((item) => item.code)).size !== page.catalog.length)) {
        throw new Error('The server returned an invalid status catalog. Reload the board.');
    }
    const error = presentationError(page?.groups, page?.catalog);
    if (error || !Number.isSafeInteger(page.version) || page.version < 1 || typeof page.canManage !== 'boolean') {
        throw new Error('The server returned an invalid board presentation. Please reload or contact an administrator.');
    }
    return { ...page, supported: true };
}

export const loadPresentation = createAsyncThunk('presentation/load', async (_, { signal, rejectWithValue }) => {
    try {
        return readPresentationPage(await request('/board-presentation', { signal }));
    }
    catch (error) {
        if (error.status === 404) {
            try {
                return { ...readPresentationPage(await request('/workflow-presentation', { signal })), canManage: false, supported: false };
            }
            catch (fallback) {
                if (fallback.status !== 404) {
                    return rejectWithValue({ message: fallback.message, status: fallback.status });
                }
                return { version: 0, groups: defaultPresentationGroups, canManage: false, supported: false };
            }
        }
        return rejectWithValue({ message: error.message, status: error.status });
    }
}, {
    condition: (_, { getState }) => {
        const resource = getState().workspace.workflowPresentation;
        return !resource.readId && !resource.writeId;
    },
});

export const savePresentation = createAsyncThunk('presentation/save', async ({ version, catalogVersion, catalog = null, groups: columns }, { signal, rejectWithValue }) => {
    try {
        const error = presentationError(columns, catalog);
        if (error) {
            throw new Error(error);
        }
        return readPresentationPage(await request(catalogVersion ? '/board-presentation' : '/workflow-presentation', {
            method: 'PUT', body: { version, ...(catalogVersion ? { catalogVersion } : {}), groups: columns }, signal,
        }));
    }
    catch (error) {
        return rejectWithValue({ message: error.message, status: error.status });
    }
});

export function addPresentationReducers(builder) {
    for (const operation of [loadPresentation, savePresentation]) {
        const writing = operation === savePresentation;
        const key = writing ? 'writeId' : 'readId';
        builder.addCase(operation.pending, (state, action) => {
            const resource = state.workflowPresentation;
            resource[key] = action.meta.requestId;
            resource.error = null;
            resource.status = writing ? 'saving' : 'loading';
            if (writing) {
                resource.readId = null;
            }
        });
        builder.addCase(operation.fulfilled, (state, action) => {
            const resource = state.workflowPresentation;
            if (resource[key] !== action.meta.requestId) {
                return;
            }
            resource[key] = null;
            if (!resource.data || !action.payload.supported && action.payload.version === 0 ||
                action.payload.version > resource.data.version ||
                action.payload.version === resource.data.version &&
                (action.payload.catalogVersion || 0) >= (resource.data.catalogVersion || 0)) {
                resource.data = action.payload;
            }
            resource.status = 'ready';
            resource.error = null;
        });
        builder.addCase(operation.rejected, (state, action) => {
            const resource = state.workflowPresentation;
            if (resource[key] !== action.meta.requestId) {
                return;
            }
            resource[key] = null;
            resource.status = 'error';
            resource.error = action.payload || { message: 'Could not load board presentation.' };
            if ([401, 403].includes(action.payload?.status)) {
                resource.data = null;
                resource.readId = null;
                resource.writeId = null;
            }
        });
    }
}
