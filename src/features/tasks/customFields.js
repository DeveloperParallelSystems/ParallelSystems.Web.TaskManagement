import { createAsyncThunk } from '@reduxjs/toolkit';
import { request } from '../../app/api.js';
import { advanceTaskColumnRevision, taskColumnLabels } from './taskColumns.js';
import { customFieldTypes, validCustomDefinitions } from './customFieldValues.js';

export const emptyCustomFields = { data: null, readId: null, writeId: null, error: null, invalidated: false };
const path = (projectId) => `/projects/${encodeURIComponent(projectId)}/custom-fields`;

export function fieldDefinitionError(input, fields = []) {
    const name = input.name?.trim() || '';
    if (!name || name.length > 80) {
        return 'Enter a field name with 1–80 characters.';
    }
    if (Object.values(taskColumnLabels).some((label) => label.toLowerCase() === name.toLowerCase())) {
        return 'Choose a name different from the built-in task fields.';
    }
    if (fields.some((field) => field.id !== input.id && field.name.trim().toLowerCase() === name.toLowerCase())) {
        return 'A field with this name already exists, including archived fields.';
    }
    if (!customFieldTypes.includes(input.type)) {
        return 'Choose a supported field type.';
    }
    const existing = fields.find((field) => field.id === input.id);
    if (existing && existing.type !== input.type) {
        return 'Field types cannot be changed after creation.';
    }
    if (!input.id && fields.length >= 30) {
        return 'This project already has 30 fields. Restore or rename an existing field.';
    }
    return '';
}

function readPage(page, projectId) {
    if (page?.projectId !== projectId || !Number.isSafeInteger(page.version) || page.version < 0 ||
        typeof page.canManage !== 'boolean' || !validCustomDefinitions(page.fields)) {
        throw new Error('The server returned invalid project fields. Reload before continuing.');
    }
    return page;
}

export const loadCustomFields = createAsyncThunk('customFields/load', async (projectId, { signal, rejectWithValue }) => {
    try {
        return readPage(await request(path(projectId), { signal }), projectId);
    }
    catch (error) {
        return rejectWithValue({ message: error.message, status: error.status });
    }
}, {
    condition: (projectId, { getState }) => {
        const resource = getState().workspace.customFields?.[projectId];
        return Boolean(projectId) && !resource?.readId && !resource?.writeId;
    },
});

export const saveCustomField = createAsyncThunk('customFields/save', async (input, { signal, getState, rejectWithValue }) => {
    try {
        const fields = getState().workspace.customFields?.[input.projectId]?.data?.fields || [];
        const error = fieldDefinitionError(input, fields);
        if (error) {
            throw new Error(error);
        }
        return readPage(await request(path(input.projectId) + (input.id ? `/${encodeURIComponent(input.id)}` : ''), {
            method: input.id ? 'PUT' : 'POST', signal, body: { version: input.version, name: input.name.trim(), type: input.type },
        }), input.projectId);
    }
    catch (error) {
        return rejectWithValue({ message: error.message, status: error.status });
    }
});

export const archiveCustomField = createAsyncThunk('customFields/archive', async (input, { signal, rejectWithValue }) => {
    try {
        return readPage(await request(`${path(input.projectId)}/${encodeURIComponent(input.fieldId)}/${input.restore ? 'restore' : 'archive'}`, {
            method: 'POST', signal, body: { version: input.version },
        }), input.projectId);
    }
    catch (error) {
        return rejectWithValue({ message: error.message, status: error.status });
    }
});

export function addCustomFieldReducers(builder) {
    for (const thunk of [loadCustomFields, saveCustomField, archiveCustomField]) {
        const writing = thunk !== loadCustomFields;
        const requestKey = writing ? 'writeId' : 'readId';
        const scope = (action) => writing ? action.meta.arg.projectId : action.meta.arg;
        builder.addCase(thunk.pending, (state, action) => {
            state.customFields ||= {};
            const resource = state.customFields[scope(action)] ||= { ...emptyCustomFields };
            resource[requestKey] = action.meta.requestId;
            resource.error = null;
            if (writing) {
                resource.readId = null;
            }
        });
        builder.addCase(thunk.fulfilled, (state, action) => {
            const projectId = scope(action);
            const resource = state.customFields?.[projectId];
            if (!resource || resource[requestKey] !== action.meta.requestId) {
                return;
            }
            resource[requestKey] = null;
            if (action.payload.version < (state.taskColumnsRevision || 0)) {
                resource.invalidated = true;
                return;
            }
            advanceTaskColumnRevision(state, action.payload.version, null, projectId);
            resource.data = action.payload;
            resource.error = null;
            resource.invalidated = false;
        });
        builder.addCase(thunk.rejected, (state, action) => {
            const resource = state.customFields?.[scope(action)];
            if (!resource || resource[requestKey] !== action.meta.requestId) {
                return;
            }
            resource[requestKey] = null;
            resource.error = action.payload || { message: 'Could not load project fields.' };
            if ([401, 403, 404].includes(resource.error.status)) {
                resource.data = null;
                resource.readId = null;
                resource.writeId = null;
            }
        });
    }
}
