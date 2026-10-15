import { createAsyncThunk } from '@reduxjs/toolkit';
import { request } from '../../app/api.js';

export const transitionTask = createAsyncThunk('taskTransition/save', async ({ id, transitionId, version, note }, { getState, rejectWithValue, signal, requestId }) => {
    const actor = getState().auth.user;
    try {
        const result = await request(`/tasks/${id}/transitions`, { method: 'POST', body: { transitionId, version, note }, signal });
        if (!actor?.userId || getState().auth.user !== actor) {
            return rejectWithValue({ message: 'Task access or session changed. Reload before continuing.', status: 409 });
        }
        // A poll can observe the committed handoff and remove the request first.
        // This acknowledgement contains no task data and still belongs to this session.
        if (result.accessLost === true && result.taskId === id) {
            return { taskId: id, accessLost: true };
        }
        if (getState().workspace.taskTransitions[id] !== requestId) {
            return rejectWithValue({ message: 'Task access or session changed. Reload before continuing.', status: 409 });
        }
        const summary = getState().workspace.tasks.find((task) => task.id === id)?.checklistSummary;
        if (summary && (!result.task.checklistSummary || summary.version > result.task.checklistSummary.version)) {
            return { ...result, task: { ...result.task, checklistSummary: summary } };
        }
        return result;
    }
    catch (error) {
        return rejectWithValue({ message: error.message, status: error.status });
    }
});

function removePrivateTask(state, id) {
    state.tasks = state.tasks.filter((task) => task.id !== id);
    for (const cache of ['details', 'detailRequests', 'discussions', 'attachments', 'checklists', 'labelMutations']) {
        if (state[cache]) {
            delete state[cache][id];
        }
    }
    state.dependencies = {};
    state.requestId = null;
    if (state.status === 'loading') {
        state.status = 'ready';
    }
}

export function addTaskTransitionReducers(builder) {
    builder.addCase(transitionTask.pending, (state, action) => {
        state.taskTransitions[action.meta.arg.id] = action.meta.requestId;
    });
    builder.addCase(transitionTask.fulfilled, (state, action) => {
        const id = action.meta.arg.id;
        if (action.payload.accessLost && !state.taskTransitions[id]) {
            removePrivateTask(state, id);
            return;
        }
        if (state.taskTransitions[id] !== action.meta.requestId) {
            return;
        }
        delete state.taskTransitions[id];
        if (action.payload.accessLost) {
            removePrivateTask(state, id);
            return;
        }
        const task = state.tasks.find((item) => item.id === id);
        if (!task || task.version > action.payload.task.version) {
            return;
        }
        const previousSummary = task.checklistSummary;
        Object.assign(task, action.payload.task);
        if (previousSummary && (!task.checklistSummary || previousSummary.version > task.checklistSummary.version)) {
            task.checklistSummary = previousSummary;
        }
        state.details[id] = { ...action.payload, task: { ...task } };
        delete state.detailRequests[id];
        state.requestId = null;
        if (state.status === 'loading') {
            state.status = 'ready';
        }
        if (state.dependencies[id]) {
            state.dependencies[id].stale = true;
        }
    });
    builder.addCase(transitionTask.rejected, (state, action) => {
        const id = action.meta.arg.id;
        if (state.taskTransitions[id] === action.meta.requestId) {
            delete state.taskTransitions[id];
            delete state.details[id];
            delete state.detailRequests[id];
            if (action.payload?.status === 404) {
                removePrivateTask(state, id);
            }
        }
    });
}
