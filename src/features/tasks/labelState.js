import { createAsyncThunk } from '@reduxjs/toolkit';
import { request } from '../../app/api.js';

export function labelOptions(labels, assigned = [], selected = []) {
    return labels.filter((label) => label.active || selected.includes(label.id) || assigned.some((item) => item.id === label.id));
}

export const saveLabel = createAsyncThunk('labels/save', async ({ id, values }, { signal, rejectWithValue }) => {
    try {
        return await request(id ? `/labels/${id}` : '/labels', {
            method: id ? 'PUT' : 'POST', body: values, signal,
        });
    }
    catch (error) {
        return rejectWithValue({ message: error.message, status: error.status });
    }
});

export const assignTaskLabels = createAsyncThunk('labels/assign', async ({ taskId, labelIds, version }, { signal, rejectWithValue }) => {
    try {
        return await request(`/tasks/${taskId}/labels`, {
            method: 'PUT', body: { labelIds, version }, signal,
        });
    }
    catch (error) {
        return rejectWithValue({ message: error.message, status: error.status });
    }
});

export function addLabelReducers(builder) {
    for (const operation of [saveLabel, assignTaskLabels]) {
        builder.addCase(operation.pending, (state, action) => {
            state.labelMutations[action.meta.requestId] = action.meta.arg;
        });
        builder.addCase(operation.rejected, (state, action) => {
            delete state.labelMutations[action.meta.requestId];
        });
        builder.addCase(operation.fulfilled, (state, action) => {
            if (!state.labelMutations[action.meta.requestId]) {
                return;
            }
            delete state.labelMutations[action.meta.requestId];
            // A poll started before this write can contain older associations or definitions.
            state.requestId = null;
            state.status = 'ready';
            if (operation === saveLabel) {
                const label = action.payload;
                const previous = state.labels.find((item) => item.id === label.id);
                if (!previous || previous.version <= label.version) {
                    state.labels = [...state.labels.filter((item) => item.id !== label.id), label];
                }
                for (const task of [...state.tasks, ...Object.values(state.details).map((details) => details.task)]) {
                    task.labels = (task.labels || []).map((item) => item.id === label.id && item.version <= label.version ? label : item);
                }
            }
            else {
                const id = action.meta.arg.taskId;
                const task = state.tasks.find((item) => item.id === id);
                if (task && task.version <= action.payload.version) {
                    Object.assign(task, action.payload);
                }
                delete state.details[id];
                delete state.detailRequests[id];
            }
        });
    }
}

export function reconcileLabelMutations(state, bindingsChanged) {
    for (const [requestId, arg] of Object.entries(state.labelMutations)) {
        if (bindingsChanged || (arg.taskId && !state.tasks.some((task) => task.id === arg.taskId))) {
            delete state.labelMutations[requestId];
        }
    }
}
