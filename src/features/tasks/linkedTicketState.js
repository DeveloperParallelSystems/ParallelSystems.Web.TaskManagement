import { createAsyncThunk } from '@reduxjs/toolkit';
import { request } from '../../app/api.js';

export function mergeLinkedTicketVersion(current, change, expectedVersion) {
    if (!change || current.version !== expectedVersion) {
        return current;
    }
    return { ...current, version: change.version, updatedAtUtc: change.updatedAtUtc };
}

export const loadLinkedTickets = createAsyncThunk('linkedTickets/load', async ({ taskId }, { signal, rejectWithValue }) => {
    try {
        return await request(`/tasks/${taskId}/links`, { signal });
    }
    catch (error) {
        return rejectWithValue({ message: error.message, status: error.status });
    }
});

export const addLinkedTicket = createAsyncThunk('linkedTickets/add', async ({ taskId, childTaskId, parentTaskId, version, childVersion }, { signal, rejectWithValue }) => {
    try {
        return await request(`/tasks/${taskId}/links`, {
            method: 'POST', body: { childTaskId, parentTaskId, version, childVersion }, signal,
        });
    }
    catch (error) {
        return rejectWithValue({ message: error.message, status: error.status });
    }
});

export const removeLinkedTicket = createAsyncThunk('linkedTickets/remove', async ({ taskId, childTaskId, parentTaskId, version, childVersion }, { signal, rejectWithValue }) => {
    try {
        return await request(`/tasks/${taskId}/links`, {
            method: 'DELETE', body: { childTaskId, parentTaskId, version, childVersion }, signal,
        });
    }
    catch (error) {
        return rejectWithValue({ message: error.message, status: error.status });
    }
});

function entry() {
    return { parents: [], children: [], version: 0, canManage: false, hasLoaded: false,
        stale: false, status: 'idle', requestId: null, mutations: {}, error: null };
}

function applyPage(state, taskId, page) {
    const current = state.linkedTickets[taskId];
    if (page.version >= current.version) {
        Object.assign(current, { parents: page.parents, children: page.children, version: page.version,
            canManage: page.canManage, hasLoaded: true });
    }
    current.stale = state.tasks.find((task) => task.id === taskId)?.version > current.version;
    current.requestId = null;
    current.status = 'ready';
    current.error = null;
}

function fail(state, taskId, failure) {
    if ([401, 403, 404].includes(failure?.status)) {
        // Other pages and in-flight reads may include the same denied neighbor.
        state.linkedTickets = {};
    }
    const current = state.linkedTickets[taskId] || entry();
    current.requestId = null;
    current.status = 'error';
    current.error = failure || { message: 'Could not load linked tickets.' };
    state.linkedTickets[taskId] = current;
}

export function addLinkedTicketReducers(builder) {
    builder.addCase(loadLinkedTickets.pending, (state, action) => {
        const current = state.linkedTickets[action.meta.arg.taskId] || entry();
        current.requestId = action.meta.requestId;
        current.status = 'loading';
        current.error = null;
        state.linkedTickets[action.meta.arg.taskId] = current;
    });
    builder.addCase(loadLinkedTickets.fulfilled, (state, action) => {
        const current = state.linkedTickets[action.meta.arg.taskId];
        if (current?.requestId === action.meta.requestId && !Object.keys(current.mutations).length) {
            applyPage(state, action.meta.arg.taskId, action.payload);
        }
    });
    builder.addCase(loadLinkedTickets.rejected, (state, action) => {
        const current = state.linkedTickets[action.meta.arg.taskId];
        if (current?.requestId === action.meta.requestId) {
            fail(state, action.meta.arg.taskId, action.payload);
        }
    });
    for (const operation of [addLinkedTicket, removeLinkedTicket]) {
        builder.addCase(operation.pending, (state, action) => {
            const current = state.linkedTickets[action.meta.arg.taskId];
            if (current) {
                current.mutations[action.meta.requestId] = true;
                current.requestId = null;
            }
        });
        builder.addCase(operation.rejected, (state, action) => {
            const current = state.linkedTickets[action.meta.arg.taskId];
            if (current?.mutations[action.meta.requestId]) {
                delete current.mutations[action.meta.requestId];
                fail(state, action.meta.arg.taskId, action.payload);
            }
        });
        builder.addCase(operation.fulfilled, (state, action) => {
            const taskId = action.meta.arg.taskId;
            const current = state.linkedTickets[taskId];
            if (!current?.mutations[action.meta.requestId]) {
                return;
            }
            delete current.mutations[action.meta.requestId];
            state.requestId = null;
            state.status = 'ready';
            for (const change of action.payload.changedTasks) {
                const task = state.tasks.find((item) => item.id === change.id);
                if (task && task.version <= change.version) {
                    Object.assign(task, change);
                }
                delete state.details[change.id];
                delete state.detailRequests[change.id];
                const inverse = state.linkedTickets[change.id];
                if (inverse && change.id !== taskId) {
                    inverse.stale = true;
                    inverse.requestId = null;
                    if (inverse.status === 'loading') {
                        inverse.status = 'ready';
                    }
                }
            }
            applyPage(state, taskId, action.payload);
        });
    }
}

export function reconcileLinkedTickets(state, previousTasks, bindingsChanged) {
    // A pending response can contain a neighbor not yet known to this cache.
    // Any observed loss of task access invalidates all linked-ticket request identities.
    if (bindingsChanged || previousTasks.some((task) => !state.tasks.some((item) => item.id === task.id))) {
        state.linkedTickets = {};
        return;
    }
    for (const [taskId, current] of Object.entries(state.linkedTickets)) {
        const relatedIds = [taskId, ...current.parents.map((task) => task.taskId), ...current.children.map((task) => task.taskId)];
        if (relatedIds.some((id) => state.tasks.find((task) => task.id === id)?.version !== previousTasks.find((task) => task.id === id)?.version)) {
            current.stale = true;
            current.requestId = null;
            if (current.status === 'loading') {
                current.status = 'ready';
            }
        }
    }
}
