import { createAsyncThunk } from '@reduxjs/toolkit';
import { request } from '../../app/api.js';

export const setTaskFollowing = createAsyncThunk('taskFollowing/set', async ({ taskId, isFollowed }, { rejectWithValue }) => {
    try {
        return await request(`/tasks/${taskId}/follow`, { method: isFollowed ? 'PUT' : 'DELETE' });
    }
    catch (error) {
        return rejectWithValue({ message: error.message, status: error.status });
    }
}, {
    condition: ({ taskId }, { getState }) => {
        const state = getState();
        return Boolean(state.auth.user && state.workspace.tasks.some((task) => task.id === taskId)
            && !state.workspace.taskFollowing?.[taskId]?.requestId);
    },
});

function invalidateReads(state, taskId) {
    state.requestId = null;
    state.status = state.hasLoaded ? 'ready' : 'idle';
    delete state.detailRequests[taskId];
}

export function reconcileFollowing(state) {
    for (const id of Object.keys(state.taskFollowing)) {
        if (!state.tasks.some((task) => task.id === id)) {
            delete state.taskFollowing[id];
        }
    }
    for (const task of state.tasks) {
        if (state.details[task.id]) {
            state.details[task.id].task.isFollowed = task.isFollowed;
        }
    }
}

export function addFollowingReducers(builder) {
    builder.addCase(setTaskFollowing.pending, (state, action) => {
        const id = action.meta.arg.taskId;
        state.taskFollowing[id] = { requestId: action.meta.requestId, error: null };
        invalidateReads(state, id);
    });
    builder.addCase(setTaskFollowing.fulfilled, (state, action) => {
        const id = action.meta.arg.taskId;
        if (state.taskFollowing[id]?.requestId !== action.meta.requestId) {
            return;
        }
        state.taskFollowing[id] = { requestId: null, error: null };
        const task = state.tasks.find((item) => item.id === id);
        if (task) {
            task.isFollowed = action.payload.isFollowed;
        }
        if (state.details[id]) {
            state.details[id].task.isFollowed = action.payload.isFollowed;
        }
        invalidateReads(state, id);
    });
    builder.addCase(setTaskFollowing.rejected, (state, action) => {
        const id = action.meta.arg.taskId;
        if (state.taskFollowing[id]?.requestId !== action.meta.requestId) {
            return;
        }
        state.taskFollowing[id] = { requestId: null, error: action.payload?.message || 'Could not update following. Try again.' };
        if ([403, 404].includes(action.payload?.status)) {
            state.tasks = state.tasks.filter((task) => task.id !== id);
            delete state.details[id];
            invalidateReads(state, id);
        }
    });
}
