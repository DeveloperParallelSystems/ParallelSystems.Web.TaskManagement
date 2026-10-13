import { createAsyncThunk } from '@reduxjs/toolkit';
import { request } from '../../app/api.js';
import { mergeComments } from './commentMentions.js';

export const loadTaskComments = createAsyncThunk('discussion/load', async ({ taskId, after = 0 }, { signal, rejectWithValue }) => {
    try {
        return await request(`/tasks/${taskId}/comments?after=${after}&limit=50`, { signal });
    }
    catch (error) {
        return rejectWithValue({ message: error.message, status: error.status });
    }
});

export const loadTaskComment = createAsyncThunk('discussion/comment', async ({ taskId, id }, { signal, rejectWithValue }) => {
    try {
        return await request(`/tasks/${taskId}/comments/${id}`, { signal });
    }
    catch (error) {
        return rejectWithValue({ message: error.message, status: error.status });
    }
});

export const saveTaskComment = createAsyncThunk('discussion/save', async ({ taskId, id, values }, { rejectWithValue }) => {
    try {
        return await request(id ? `/tasks/${taskId}/comments/${id}` : `/tasks/${taskId}/comments`, {
            method: id ? 'PUT' : 'POST', body: values,
        });
    }
    catch (error) {
        return rejectWithValue({ message: error.message, status: error.status });
    }
});

export const deleteTaskComment = createAsyncThunk('discussion/delete', async ({ taskId, id, version }, { rejectWithValue }) => {
    try {
        await request(`/tasks/${taskId}/comments/${id}`, { method: 'DELETE', body: { version } });
        return { id, version };
    }
    catch (error) {
        return rejectWithValue({ message: error.message, status: error.status });
    }
});

function entry() {
    return { items: [], mentionablePeople: [], nextCursor: null, hasLoaded: false,
        status: 'idle', error: null, requestId: null, mutations: {} };
}

function mutationPending(state, action) {
    const discussion = state.discussions[action.meta.arg.taskId];
    if (discussion) {
        discussion.mutations[action.meta.requestId] = true;
    }
}

function mutationFinished(state, action) {
    const discussion = state.discussions[action.meta.arg.taskId];
    if (!discussion?.mutations[action.meta.requestId]) {
        return null;
    }
    delete discussion.mutations[action.meta.requestId];
    if ([401, 404].includes(action.payload?.status)) {
        discussion.items = [];
        discussion.mentionablePeople = [];
        discussion.hasLoaded = false;
        discussion.status = 'error';
        discussion.error = action.payload.message;
    }
    return discussion;
}

export function addDiscussionReducers(builder) {
    builder.addCase(loadTaskComments.pending, (state, action) => {
        const taskId = action.meta.arg.taskId;
        const discussion = state.discussions[taskId] || (state.discussions[taskId] = entry());
        discussion.requestId = action.meta.requestId;
        discussion.status = 'loading';
        discussion.error = null;
    });
    builder.addCase(loadTaskComments.fulfilled, (state, action) => {
        const discussion = state.discussions[action.meta.arg.taskId];
        if (discussion?.requestId !== action.meta.requestId) {
            return;
        }
        // Keep locally observed newer versions when an older read completes after a write.
        const current = action.meta.arg.after ? discussion.items : discussion.items.filter((comment) =>
            action.payload.items.some((incoming) => incoming.id === comment.id),
        );
        discussion.items = mergeComments(current, action.payload.items);
        discussion.nextCursor = action.payload.nextCursor;
        discussion.mentionablePeople = action.payload.mentionablePeople;
        discussion.hasLoaded = true;
        discussion.status = 'ready';
        discussion.requestId = null;
    });
    builder.addCase(loadTaskComments.rejected, (state, action) => {
        const discussion = state.discussions[action.meta.arg.taskId];
        if (discussion?.requestId !== action.meta.requestId) {
            return;
        }
        discussion.requestId = null;
        discussion.status = 'error';
        discussion.error = action.payload?.message || 'Could not load discussion.';
        if ([401, 403, 404].includes(action.payload?.status)) {
            discussion.items = [];
            discussion.mentionablePeople = [];
            discussion.hasLoaded = false;
        }
    });
    for (const thunk of [saveTaskComment, loadTaskComment, deleteTaskComment]) {
        builder.addCase(thunk.pending, mutationPending);
        builder.addCase(thunk.rejected, (state, action) => {
            mutationFinished(state, action);
        });
    }
    for (const thunk of [saveTaskComment, loadTaskComment]) {
        builder.addCase(thunk.fulfilled, (state, action) => {
            const discussion = mutationFinished(state, action);
            if (discussion) {
                discussion.items = mergeComments(discussion.items, [action.payload]);
                discussion.requestId = null;
                discussion.status = 'ready';
            }
        });
    }
    builder.addCase(deleteTaskComment.fulfilled, (state, action) => {
        const discussion = mutationFinished(state, action);
        const comment = discussion?.items.find((item) => item.id === action.payload.id);
        if (comment && comment.version <= action.payload.version) {
            Object.assign(comment, { deleted: true, body: '', mentions: [], canEdit: false,
                canDelete: false, version: action.payload.version + 1 });
        }
        if (discussion) {
            discussion.requestId = null;
            discussion.status = 'ready';
        }
    });
}
