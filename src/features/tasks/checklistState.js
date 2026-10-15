import { createAsyncThunk } from '@reduxjs/toolkit';
import { request } from '../../app/api.js';

export const loadTaskChecklist = createAsyncThunk('checklist/load', async ({ taskId }, { signal, rejectWithValue }) => {
    try {
        return await request(`/tasks/${taskId}/checklist`, { signal });
    }
    catch (error) {
        return rejectWithValue({ message: error.message, status: error.status });
    }
}, {
    condition: (_, { getState }) => Boolean(getState().auth.user),
});

export const saveChecklistItem = createAsyncThunk('checklist/save', async ({ taskId, id, values }, { signal, rejectWithValue }) => {
    try {
        return await request(`/tasks/${taskId}/checklist${id ? `/${id}` : ''}`, {
            method: id ? 'PUT' : 'POST', body: values, signal,
        });
    }
    catch (error) {
        return rejectWithValue({ message: error.message, status: error.status });
    }
});

export const reorderChecklist = createAsyncThunk('checklist/reorder', async ({ taskId, itemIds, collectionVersion }, { signal, rejectWithValue }) => {
    try {
        return await request(`/tasks/${taskId}/checklist/order`, {
            method: 'PUT', body: { itemIds, collectionVersion }, signal,
        });
    }
    catch (error) {
        return rejectWithValue({ message: error.message, status: error.status });
    }
});

export const deleteChecklistItem = createAsyncThunk('checklist/delete', async ({ taskId, id, version }, { signal, rejectWithValue }) => {
    try {
        await request(`/tasks/${taskId}/checklist/${id}`, { method: 'DELETE', body: { version }, signal });
        return { id };
    }
    catch (error) {
        return rejectWithValue({ message: error.message, status: error.status });
    }
});

function entry() {
    return { items: [], version: -1, hasLoaded: false, stale: false, status: 'idle',
        canManage: false, canComplete: false, requestId: null, mutations: {}, error: null };
}

function updateSummary(state, taskId, summary) {
    const task = state.tasks.find((item) => item.id === taskId);
    if (task && (!task.checklistSummary || summary.version >= task.checklistSummary.version)) {
        task.checklistSummary = summary;
    }
    const cachedTask = state.details[taskId]?.task;
    if (cachedTask && (!cachedTask.checklistSummary || summary.version >= cachedTask.checklistSummary.version)) {
        cachedTask.checklistSummary = summary;
    }
}

function applyPage(state, taskId, page) {
    const current = state.checklists[taskId];
    if (page.version >= current.version) {
        Object.assign(current, page, { hasLoaded: true, stale: false });
        updateSummary(state, taskId, page.summary);
    }
    const observedVersion = state.tasks.find((task) => task.id === taskId)?.checklistSummary?.version;
    current.stale = observedVersion > current.version;
    current.requestId = null;
    current.status = 'ready';
    current.error = null;
}

function fail(current, failure) {
    if ([401, 403, 404].includes(failure?.status)) {
        Object.assign(current, entry());
    }
    current.status = 'error';
    current.error = failure || { message: 'Could not load checklist.' };
    current.requestId = null;
}

export function addChecklistReducers(builder) {
    builder.addCase(loadTaskChecklist.pending, (state, action) => {
        const current = state.checklists[action.meta.arg.taskId] || entry();
        current.requestId = action.meta.requestId;
        current.status = 'loading';
        current.error = null;
        state.checklists[action.meta.arg.taskId] = current;
    });
    builder.addCase(loadTaskChecklist.fulfilled, (state, action) => {
        const current = state.checklists[action.meta.arg.taskId];
        if (current?.requestId !== action.meta.requestId || Object.keys(current.mutations).length) {
            return;
        }
        applyPage(state, action.meta.arg.taskId, action.payload);
    });
    builder.addCase(loadTaskChecklist.rejected, (state, action) => {
        const current = state.checklists[action.meta.arg.taskId];
        if (current?.requestId === action.meta.requestId) {
            fail(current, action.payload);
        }
    });
    for (const thunk of [saveChecklistItem, reorderChecklist, deleteChecklistItem]) {
        builder.addCase(thunk.pending, (state, action) => {
            const current = state.checklists[action.meta.arg.taskId];
            if (current) {
                current.mutations[action.meta.requestId] = true;
                current.requestId = null;
            }
        });
        builder.addCase(thunk.rejected, (state, action) => {
            const current = state.checklists[action.meta.arg.taskId];
            if (current?.mutations[action.meta.requestId]) {
                delete current.mutations[action.meta.requestId];
                fail(current, action.payload);
            }
        });
        builder.addCase(thunk.fulfilled, (state, action) => {
            const current = state.checklists[action.meta.arg.taskId];
            if (!current?.mutations[action.meta.requestId]) {
                return;
            }
            delete current.mutations[action.meta.requestId];
            current.requestId = null;
            if (thunk === deleteChecklistItem) {
                current.items = current.items.filter((item) => item.id !== action.payload.id);
                current.stale = true;
            }
            else {
                applyPage(state, action.meta.arg.taskId, action.payload);
            }
        });
    }
}

export function reconcileChecklists(state, previousTasks, bindingsChanged) {
    if (bindingsChanged) {
        state.checklists = {};
        return;
    }
    for (const task of state.tasks) {
        const previous = previousTasks.find((item) => item.id === task.id)?.checklistSummary;
        if (previous && (!task.checklistSummary || previous.version > task.checklistSummary.version)) {
            task.checklistSummary = previous;
        }
        const cached = state.checklists[task.id];
        if (cached && task.checklistSummary?.version > cached.version) {
            cached.stale = true;
        }
    }
    for (const id of Object.keys(state.checklists)) {
        if (!state.tasks.some((task) => task.id === id)) {
            delete state.checklists[id];
        }
    }
}
