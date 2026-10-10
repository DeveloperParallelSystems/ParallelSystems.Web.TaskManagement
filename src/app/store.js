import { configureStore, createAsyncThunk, createSlice } from '@reduxjs/toolkit';
import { request, setSessionExpiredHandler } from './api.js';

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
    filters: { search: '', discipline: '', status: '', projectId: '', mine: false },
    view: 'board',
};

const workspaceSlice = createSlice({
    name: 'workspace',
    initialState: emptyWorkspace,
    reducers: {
        setFilters(state, action) {
            state.filters = { ...state.filters, ...action.payload };
        },
        clearFilters(state) {
            state.filters = { ...emptyWorkspace.filters };
        },
        setView(state, action) {
            state.view = action.payload;
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
            Object.assign(state, action.payload);
            state.status = 'ready';
            state.hasLoaded = true;
        });
        builder.addCase(loadWorkspace.rejected, (state, action) => {
            if (state.requestId !== action.meta.requestId) {
                return;
            }
            state.status = 'error';
            state.error = 'Could not refresh tasks. Check your connection and try again.';
        });
        builder.addCase(logout.fulfilled, () => emptyWorkspace);
        builder.addCase(authSlice.actions.sessionExpired, () => emptyWorkspace);
        builder.addCase(login.fulfilled, () => emptyWorkspace);
    },
});

export const { setFilters, clearFilters, setView } = workspaceSlice.actions;
export const { sessionExpired } = authSlice.actions;
export const store = configureStore({
    reducer: { auth: authSlice.reducer, workspace: workspaceSlice.reducer },
    // Login thunk arguments contain credentials; do not send actions to browser devtools.
    devTools: false,
});
setSessionExpiredHandler(() => {
    store.dispatch(sessionExpired());
});
