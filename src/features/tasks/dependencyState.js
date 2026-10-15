import { createAsyncThunk } from '@reduxjs/toolkit';
import { request } from '../../app/api.js';

export function mergeDependencyVersion(current, change, expectedVersion) {
    if (!change || current.version !== expectedVersion) {
        return current;
    }
    return { ...current, version: change.version, updatedAtUtc: change.updatedAtUtc };
}

export const loadDependencies = createAsyncThunk('dependencies/load', async ({ taskId }, { signal, rejectWithValue }) => {
    try {
        return await request(`/tasks/${taskId}/dependencies`, { signal });
    }
    catch (error) {
        return rejectWithValue({ message: error.message, status: error.status });
    }
});

export const addDependency = createAsyncThunk('dependencies/add', async ({ taskId, blockedByTaskId, version }, { signal, rejectWithValue }) => {
    try {
        return await request(`/tasks/${taskId}/dependencies`, {
            method: 'POST', body: { blockedByTaskId, version }, signal,
        });
    }
    catch (error) {
        return rejectWithValue({ message: error.message, status: error.status });
    }
});

export const removeDependency = createAsyncThunk('dependencies/remove', async ({ taskId, blockedByTaskId, version }, { signal, rejectWithValue }) => {
    try {
        return await request(`/tasks/${taskId}/dependencies/${blockedByTaskId}`, {
            method: 'DELETE', body: { version }, signal,
        });
    }
    catch (error) {
        return rejectWithValue({ message: error.message, status: error.status });
    }
});

function entry() {
    return { blockedBy: [], blocks: [], version: 0, canManage: false, hasLoaded: false,
        stale: false, status: 'idle', requestId: null, mutations: {}, error: null };
}

function applyPage(state, taskId, page) {
    const current = state.dependencies[taskId];
    if (page.version >= current.version) {
        Object.assign(current, { blockedBy: page.blockedBy, blocks: page.blocks, version: page.version,
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
        state.dependencies = {};
    }
    const current = state.dependencies[taskId] || entry();
    current.requestId = null;
    current.status = 'error';
    current.error = failure || { message: 'Could not load dependencies.' };
    state.dependencies[taskId] = current;
}

export function addDependencyReducers(builder) {
    builder.addCase(loadDependencies.pending, (state, action) => {
        const current = state.dependencies[action.meta.arg.taskId] || entry();
        current.requestId = action.meta.requestId;
        current.status = 'loading';
        current.error = null;
        state.dependencies[action.meta.arg.taskId] = current;
    });
    builder.addCase(loadDependencies.fulfilled, (state, action) => {
        const current = state.dependencies[action.meta.arg.taskId];
        if (current?.requestId === action.meta.requestId && !Object.keys(current.mutations).length) {
            applyPage(state, action.meta.arg.taskId, action.payload);
        }
    });
    builder.addCase(loadDependencies.rejected, (state, action) => {
        const current = state.dependencies[action.meta.arg.taskId];
        if (current?.requestId === action.meta.requestId) {
            fail(state, action.meta.arg.taskId, action.payload);
        }
    });
    for (const operation of [addDependency, removeDependency]) {
        builder.addCase(operation.pending, (state, action) => {
            const current = state.dependencies[action.meta.arg.taskId];
            if (current) {
                current.mutations[action.meta.requestId] = true;
                current.requestId = null;
            }
        });
        builder.addCase(operation.rejected, (state, action) => {
            const current = state.dependencies[action.meta.arg.taskId];
            if (current?.mutations[action.meta.requestId]) {
                delete current.mutations[action.meta.requestId];
                fail(state, action.meta.arg.taskId, action.payload);
            }
        });
        builder.addCase(operation.fulfilled, (state, action) => {
            const taskId = action.meta.arg.taskId;
            const current = state.dependencies[taskId];
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
                const inverse = state.dependencies[change.id];
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

export function reconcileDependencies(state, previousTasks, bindingsChanged) {
    // A pending response can contain a neighbor not yet known to this cache.
    // Any observed loss of task access invalidates all dependency request identities.
    if (bindingsChanged || previousTasks.some((task) => !state.tasks.some((item) => item.id === task.id))) {
        state.dependencies = {};
        return;
    }
    for (const [taskId, current] of Object.entries(state.dependencies)) {
        const relatedIds = [taskId, ...current.blockedBy.map((task) => task.taskId), ...current.blocks.map((task) => task.taskId)];
        if (relatedIds.some((id) => state.tasks.find((task) => task.id === id)?.version !== previousTasks.find((task) => task.id === id)?.version)) {
            current.stale = true;
            current.requestId = null;
            if (current.status === 'loading') {
                current.status = 'ready';
            }
        }
    }
}
