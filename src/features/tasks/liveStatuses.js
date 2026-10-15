import { createAsyncThunk } from '@reduxjs/toolkit';
import { statuses } from './workflow.js';
import { request } from '../../app/api.js';

export const emptyStatusSettings = { data: null, status: 'idle', error: null, readId: null, writeId: null };
const disciplines = ['Development', 'Drafting'];

export function allowedDisciplineStatuses(settings, discipline) {
    const codes = settings?.disciplines?.find((item) => item.discipline === discipline)?.statuses || [];
    const catalog = new Map(settings?.catalog?.map((item) => [item.code, item]) || []);
    return codes.map((code) => catalog.get(code)).filter(Boolean);
}

export function validateStatusSettings(settings, { uniqueNames = true } = {}) {
    if (!Array.isArray(settings?.catalog) || settings.catalog.length < 1 ||
        settings.catalog.some((item) => !item || typeof item.code !== 'string' || !item.code.trim() || item.code.length > 30 ||
            typeof item.name !== 'string' || !item.name.trim() || item.name.length > 80 || !statuses.includes(item.boardStatus)) ||
        new Set(settings.catalog.map((item) => item.code)).size !== settings.catalog.length ||
        settings.catalog.find((item) => item.code === 'To Do')?.name !== 'To Do') {
        return 'Use unique status codes and names, including To Do.';
    }
    if (uniqueNames && new Set(settings.catalog.map((item) => item.name.trim().toLowerCase())).size !== settings.catalog.length) {
        return 'Use unique status names, ignoring case and surrounding spaces.';
    }
    if (!Array.isArray(settings.disciplines) || settings.disciplines.length !== 2 ||
        disciplines.some((discipline) => !settings.disciplines.some((item) => item.discipline === discipline))) {
        return 'Configure both Development and Drafting.';
    }
    const catalog = new Set(settings.catalog.map((item) => item.code));
    for (const item of settings.disciplines) {
        if (!Array.isArray(item.statuses) || item.statuses[0] !== 'To Do' ||
            item.statuses.some((code) => !catalog.has(code)) || new Set(item.statuses).size !== item.statuses.length) {
            return 'To Do must be first in both disciplines, followed by unique catalog statuses.';
        }
    }
    return '';
}

function readSettings(settings) {
    if (!Number.isSafeInteger(settings?.version) || settings.version < 1 ||
        typeof settings.canManage !== 'boolean' || validateStatusSettings(settings, { uniqueNames: false })) {
        throw new Error('The server returned invalid status settings. Reload or contact an administrator.');
    }
    return settings;
}

export const loadStatusSettings = createAsyncThunk('statusSettings/load', async (_, { signal, rejectWithValue }) => {
    try {
        return readSettings(await request('/statuses', { signal }));
    }
    catch (error) {
        return rejectWithValue({ message: error.message, status: error.status });
    }
}, {
    condition: (_, { getState }) => !getState().workspace.statusSettings.readId &&
        !getState().workspace.statusSettings.writeId,
});

export const saveStatusSettings = createAsyncThunk('statusSettings/save', async (settings, { signal, rejectWithValue }) => {
    try {
        const error = validateStatusSettings(settings);
        if (error) {
            throw new Error(error);
        }
        return readSettings(await request('/statuses', { method: 'PUT', body: settings, signal }));
    }
    catch (error) {
        return rejectWithValue({ message: error.message, status: error.status });
    }
}, {
    condition: (_, { getState }) => Boolean(getState().workspace.statusSettings.data?.canManage &&
        !getState().workspace.statusSettings.writeId),
});

export function addStatusSettingsReducers(builder) {
    for (const operation of [loadStatusSettings, saveStatusSettings]) {
        const writing = operation === saveStatusSettings;
        const key = writing ? 'writeId' : 'readId';
        builder.addCase(operation.pending, (state, action) => {
            state.statusSettings[key] = action.meta.requestId;
            state.statusSettings.error = null;
            state.statusSettings.status = writing ? 'saving' : 'loading';
            if (writing) {
                state.statusSettings.readId = null;
            }
        });
        builder.addCase(operation.fulfilled, (state, action) => {
            if (state.statusSettings[key] !== action.meta.requestId) {
                return;
            }
            state.statusSettings[key] = null;
            if (!state.statusSettings.data || action.payload.version >= state.statusSettings.data.version) {
                state.statusSettings.data = action.payload;
            }
            state.statusSettings.status = 'ready';
        });
        builder.addCase(operation.rejected, (state, action) => {
            if (state.statusSettings[key] !== action.meta.requestId) {
                return;
            }
            state.statusSettings[key] = null;
            state.statusSettings.error = action.payload;
            state.statusSettings.status = 'error';
        });
    }
}
