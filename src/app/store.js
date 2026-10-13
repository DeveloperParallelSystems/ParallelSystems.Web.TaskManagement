import { configureStore, createAsyncThunk, createSlice } from '@reduxjs/toolkit';
import { request, setSessionExpiredHandler } from './api.js';
import { canMoveTask, needsReviewNote, taskInput } from '../features/tasks/taskActions.js';
import { addDiscussionReducers } from '../features/tasks/discussionState.js';
import { addAttachmentReducers } from '../features/tasks/attachmentState.js';

export const loadTaskDetail = createAsyncThunk('workspace/detail', async ({ id }, { rejectWithValue, signal }) => {
    try {
        return await request(`/tasks/${id}`, { signal });
    }
    catch (error) {
        return rejectWithValue({ message: error.message, status: error.status });
    }
});

export const moveTask = createAsyncThunk('workspace/move', async ({ id, status, details }, { dispatch, getState, rejectWithValue }) => {
    try {
        const administrator = getState().auth.user?.role === 'Administrator';
        if (!canMoveTask(details, status, administrator) || needsReviewNote(status)) {
            return rejectWithValue({ message: 'Open task details to make this workflow change.' });
        }
        return await dispatch(saveTask({ id, values: taskInput(details.task, { status }) })).unwrap();
    }
    catch (error) {
        return rejectWithValue(error);
    }
});

export const bulkUpdateTasks = createAsyncThunk('workspace/bulk', async ({ tasks, changes }, { dispatch, getState }) => {
    const userId = getState().auth.user?.userId;
    const results = [];
    for (const target of tasks) {
        if (!userId || getState().auth.user?.userId !== userId || getState().auth.user?.role !== 'Administrator') {
            results.push({ id: target.id, code: target.code, success: false, message: 'Not attempted: administrator session is unavailable.' });
            continue;
        }
        try {
            const details = await dispatch(loadTaskDetail({ id: target.id })).unwrap();
            if (getState().auth.user?.userId !== userId || getState().auth.user?.role !== 'Administrator') {
                results.push({ id: target.id, code: target.code, success: false, message: 'Not attempted: administrator session changed.' });
                continue;
            }
            if (details.task.version !== target.version) {
                results.push({ id: target.id, code: target.code, success: false, status: 409, message: 'Someone else changed this task. Reload latest task before retrying.' });
                continue;
            }
            // Never overwrite other fields with a partial list record.
            await dispatch(saveTask({ id: target.id, values: taskInput(details.task, changes) })).unwrap();
            results.push({ id: target.id, code: target.code, success: true, message: 'Updated.' });
        }
        catch (error) {
            results.push({ id: target.id, code: target.code, success: false, status: error.status, message: error.message || 'Update failed.' });
        }
    }
    return results;
});

export const checkSession = createAsyncThunk('auth/check', async (_, { rejectWithValue, signal }) => {
    try {
        return await request('/auth/me', { signal, notifyExpired: false });
    }
    catch (error) {
        return rejectWithValue({ status: error.status, message: error.message });
    }
});

export const login = createAsyncThunk('auth/login', async (body, { rejectWithValue }) => {
    try {
        return await request('/auth/login', { method: 'POST', body, notifyExpired: false });
    }
    catch (error) {
        return rejectWithValue(error.message);
    }
});

export const logout = createAsyncThunk('auth/logout', async (_, { rejectWithValue }) => {
    try {
        await request('/auth/logout', { method: 'POST' });
    }
    catch (error) {
        if (error.status !== 401) {
            return rejectWithValue('Sign out failed. Please check your connection and try again.');
        }
    }
});

const authSlice = createSlice({
    name: 'auth',
    initialState: { user: null, status: 'checking', error: null, busy: false, checkRequestId: null },
    reducers: {
        clearLoginError(state) {
            state.error = null;
        },
        sessionExpired(state) {
            state.user = null;
            state.status = 'anonymous';
            state.checkRequestId = null;
            state.error = 'Your Task Management session expired. Please sign in again.';
        },
    },
    extraReducers(builder) {
        builder.addCase(checkSession.pending, (state, action) => {
            state.status = 'checking';
            state.error = null;
            state.checkRequestId = action.meta.requestId;
        });
        builder.addCase(checkSession.fulfilled, (state, action) => {
            if (state.checkRequestId !== action.meta.requestId) {
                return;
            }
            state.user = action.payload;
            state.status = 'authenticated';
        });
        builder.addCase(checkSession.rejected, (state, action) => {
            if (state.checkRequestId !== action.meta.requestId) {
                return;
            }
            state.status = action.payload?.status === 401 ? 'anonymous' : 'unavailable';
            state.error =
                action.payload?.status === 401
                    ? null
                    : action.payload?.message || 'Unable to connect to Task Management.';
        });
        builder.addCase(login.pending, (state) => {
            state.busy = true;
            state.error = null;
            state.checkRequestId = null;
        });
        builder.addCase(login.fulfilled, (state, action) => {
            state.user = action.payload;
            state.status = 'authenticated';
            state.busy = false;
        });
        builder.addCase(login.rejected, (state, action) => {
            state.error = action.payload || 'Unable to sign in.';
            state.busy = false;
        });
        builder.addCase(logout.pending, (state) => {
            state.busy = true;
            state.error = null;
        });
        builder.addCase(logout.fulfilled, (state) => {
            state.user = null;
            state.status = 'anonymous';
            state.busy = false;
            state.error = null;
            state.checkRequestId = null;
        });
        builder.addCase(logout.rejected, (state, action) => {
            state.busy = false;
            state.error = action.payload;
        });
    },
});

export const loadWorkspace = createAsyncThunk('workspace/load', async (_, { signal }) => {
    const [tasks, lookups, notifications] = await Promise.all([
        request('/tasks', { signal }),
        request('/lookups', { signal }),
        request('/notifications', { signal }),
    ]);
    return { tasks, ...lookups, notifications };
});

export const saveTask = createAsyncThunk('workspace/save', async ({ id, values }, { rejectWithValue }) => {
    try {
        return await request(id ? `/tasks/${id}` : '/tasks', {
            method: id ? 'PUT' : 'POST',
            body: values,
        });
    }
    catch (error) {
        return rejectWithValue({ message: error.message, status: error.status });
    }
});

export const createProject = createAsyncThunk('workspace/createProject', async (name, { rejectWithValue }) => {
    try {
        return await request('/projects', { method: 'POST', body: { name } });
    }
    catch (error) {
        return rejectWithValue(error.message);
    }
});

const emptyWorkspace = {
    tasks: [],
    people: [],
    projects: [],
    notifications: { items: [], unreadCount: 0 },
    status: 'idle',
    error: null,
    requestId: null,
    hasLoaded: false,
    details: {},
    discussions: {},
    attachments: {},
    detailRequests: {},
    bulkRequestId: null,
    bulkBusy: false,
    bulkResults: [],
};

const workspaceSlice = createSlice({
    name: 'workspace',
    initialState: emptyWorkspace,
    reducers: {
        invalidateTaskDetails(state) {
            state.details = {};
            state.detailRequests = {};
        },
        clearBulkResults(state) {
            state.bulkResults = [];
        },
    },
    extraReducers(builder) {
        builder.addCase(loadWorkspace.pending, (state, action) => {
            state.requestId = action.meta.requestId;
            state.status = 'loading';
            state.error = null;
        });
        builder.addCase(loadWorkspace.fulfilled, (state, action) => {
            if (state.requestId !== action.meta.requestId) {
                return;
            }
            const previousPeople = new Map(state.people.map((person) => [person.id, person]));
            const bindingsChanged = state.people.length !== action.payload.people.length || action.payload.people.some((person) => {
                const previous = previousPeople.get(person.id);
                return !previous || previous.userId !== person.userId || previous.accountIsActive !== person.accountIsActive;
            });
            Object.assign(state, action.payload);
            if (bindingsChanged) {
                state.details = {};
                state.detailRequests = {};
                state.discussions = {};
                state.attachments = {};
            }
            state.status = 'ready';
            state.hasLoaded = true;
            for (const id of Object.keys(state.discussions)) {
                if (!state.tasks.some((task) => task.id === id)) {
                    delete state.discussions[id];
                }
            }
            for (const id of Object.keys(state.attachments)) {
                if (!state.tasks.some((task) => task.id === id)) {
                    delete state.attachments[id];
                }
            }
            for (const [id, details] of Object.entries(state.details)) {
                const task = state.tasks.find((item) => item.id === id);
                if (!task || task.version !== details.task.version) {
                    delete state.details[id];
                }
            }
        });
        builder.addCase(loadWorkspace.rejected, (state, action) => {
            if (state.requestId !== action.meta.requestId) {
                return;
            }
            state.status = 'error';
            state.error = 'Could not refresh tasks. Check your connection and try again.';
        });
        builder.addCase(loadTaskDetail.pending, (state, action) => {
            state.detailRequests[action.meta.arg.id] = action.meta.requestId;
        });
        builder.addCase(loadTaskDetail.fulfilled, (state, action) => {
            const id = action.meta.arg.id;
            if (state.detailRequests[id] === action.meta.requestId) {
                state.details[id] = action.payload;
                delete state.detailRequests[id];
            }
        });
        builder.addCase(loadTaskDetail.rejected, (state, action) => {
            const id = action.meta.arg.id;
            if (state.detailRequests[id] === action.meta.requestId) {
                delete state.detailRequests[id];
                delete state.details[id];
            }
        });
        builder.addCase(saveTask.fulfilled, (state, action) => {
            delete state.details[action.meta.arg.id];
            delete state.detailRequests[action.meta.arg.id];
        });
        builder.addCase(bulkUpdateTasks.pending, (state, action) => {
            state.bulkRequestId = action.meta.requestId;
            state.bulkBusy = true;
            state.bulkResults = [];
        });
        builder.addCase(bulkUpdateTasks.fulfilled, (state, action) => {
            if (state.bulkRequestId === action.meta.requestId) {
                state.bulkResults = action.payload;
                state.bulkBusy = false;
                state.bulkRequestId = null;
            }
        });
        builder.addCase(bulkUpdateTasks.rejected, (state, action) => {
            if (state.bulkRequestId === action.meta.requestId) {
                state.bulkBusy = false;
                state.bulkRequestId = null;
            }
        });
        addDiscussionReducers(builder);
        addAttachmentReducers(builder);
        builder.addCase(logout.fulfilled, () => emptyWorkspace);
        builder.addCase(authSlice.actions.sessionExpired, () => emptyWorkspace);
        builder.addCase(login.fulfilled, () => emptyWorkspace);
    },
});

export const { invalidateTaskDetails, clearBulkResults } = workspaceSlice.actions;
export const { sessionExpired, clearLoginError } = authSlice.actions;
export const store = configureStore({
    reducer: { auth: authSlice.reducer, workspace: workspaceSlice.reducer },
    // Login thunk arguments contain credentials; do not send actions to browser devtools.
    devTools: false,
});
setSessionExpiredHandler(() => {
    store.dispatch(sessionExpired());
});
