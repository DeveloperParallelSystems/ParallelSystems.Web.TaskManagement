import { createAsyncThunk } from '@reduxjs/toolkit';
import { request } from '../../app/api.js';

export const loadTaskAttachments = createAsyncThunk('attachments/load', async ({ taskId }, { signal, rejectWithValue }) => {
    try {
        return await request(`/tasks/${taskId}/attachments`, { signal });
    }
    catch (error) {
        return rejectWithValue({ message: error.message, status: error.status });
    }
}, {
    condition: (_, { getState }) => Boolean(getState().auth.user),
});

export const removeTaskAttachment = createAsyncThunk('attachments/remove', async ({ taskId, id, version }, { signal, rejectWithValue }) => {
    try {
        await request(`/tasks/${taskId}/attachments/${id}`, { method: 'DELETE', body: { version }, signal });
        return { id };
    }
    catch (error) {
        return rejectWithValue({ message: error.message, status: error.status });
    }
});

export function addAttachmentReducers(builder) {
    builder.addCase(loadTaskAttachments.pending, (state, action) => {
        const current = state.attachments[action.meta.arg.taskId] || { items: [], hasLoaded: false, mutations: {} };
        current.requestId = action.meta.requestId;
        current.status = 'loading';
        current.error = null;
        state.attachments[action.meta.arg.taskId] = current;
    });
    builder.addCase(loadTaskAttachments.fulfilled, (state, action) => {
        const current = state.attachments[action.meta.arg.taskId];
        if (current?.requestId !== action.meta.requestId) {
            return;
        }
        current.items = action.payload;
        current.hasLoaded = true;
        current.requestId = null;
        current.status = 'ready';
    });
    builder.addCase(loadTaskAttachments.rejected, (state, action) => {
        const current = state.attachments[action.meta.arg.taskId];
        if (current?.requestId !== action.meta.requestId) {
            return;
        }
        current.requestId = null;
        current.status = 'error';
        current.error = action.payload?.message || 'Could not load attachments.';
        if ([401, 403, 404].includes(action.payload?.status)) {
            current.items = [];
            current.hasLoaded = false;
        }
    });
    builder.addCase(removeTaskAttachment.pending, (state, action) => {
        const current = state.attachments[action.meta.arg.taskId];
        if (current) {
            current.mutations[action.meta.requestId] = true;
            current.requestId = null;
        }
    });
    builder.addCase(removeTaskAttachment.fulfilled, (state, action) => {
        const current = state.attachments[action.meta.arg.taskId];
        if (!current?.mutations[action.meta.requestId]) {
            return;
        }
        delete current.mutations[action.meta.requestId];
        current.requestId = null;
        current.items = current.items.filter((item) => item.id !== action.payload.id);
        current.status = 'ready';
    });
    builder.addCase(removeTaskAttachment.rejected, (state, action) => {
        const current = state.attachments[action.meta.arg.taskId];
        if (!current?.mutations[action.meta.requestId]) {
            return;
        }
        delete current.mutations[action.meta.requestId];
        if ([401, 404].includes(action.payload?.status)) {
            current.items = [];
            current.hasLoaded = false;
        }
    });
}
