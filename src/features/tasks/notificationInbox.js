import { createAsyncThunk } from '@reduxjs/toolkit';
import { request } from '../../app/api.js';

export function notificationBadge(count) {
    return count > 99 ? '99+' : String(count);
}

export function notificationQuery(search) {
    const params = new URLSearchParams(search);
    const page = Number(params.get('page') || 1);
    return {
        filter: params.get('filter') === 'unread' ? 'unread' : 'all',
        page: Number.isInteger(page) && page > 0 && page <= 2147483647 ? page : 1,
    };
}

function pagePath({ filter, page }) {
    return `/notifications?filter=${filter}&page=${page}`;
}

export const loadNotificationInbox = createAsyncThunk('notificationInbox/load', async (query, { signal, rejectWithValue }) => {
    try {
        return await request(pagePath(query), { signal });
    }
    catch (error) {
        return rejectWithValue({ message: error.message, status: error.status });
    }
}, {
    condition: (_, { getState }) => Boolean(getState().auth.user && !getState().workspace.notificationInbox.mutationId),
});

export const readNotifications = createAsyncThunk('notificationInbox/read', async ({ id, ...query }, { signal, rejectWithValue }) => {
    try {
        await request(id ? `/notifications/${id}/read` : '/notifications/read-all', { method: 'POST', signal });
        return await request(pagePath(query), { signal });
    }
    catch (error) {
        return rejectWithValue({ message: error.message, status: error.status });
    }
}, {
    condition: (_, { getState }) => Boolean(getState().auth.user && !getState().workspace.notificationInbox.mutationId),
});

export const emptyNotificationInbox = {
    data: null, query: null, requestId: null, mutationId: null, error: null,
};

export function addNotificationInboxReducers(builder) {
    builder.addCase(loadNotificationInbox.pending, (state, action) => {
        state.notificationInbox.requestId = action.meta.requestId;
        state.notificationInbox.query = action.meta.arg;
        state.notificationInbox.error = null;
        state.notificationSummaryRequestId = action.meta.requestId;
    });
    builder.addCase(loadNotificationInbox.fulfilled, (state, action) => {
        if (state.notificationInbox.requestId !== action.meta.requestId) {
            return;
        }
        state.notificationInbox.requestId = null;
        state.notificationInbox.data = action.payload;
        if (state.notificationSummaryRequestId === action.meta.requestId) {
            state.notifications = action.payload;
        }
    });
    builder.addCase(loadNotificationInbox.rejected, (state, action) => {
        if (state.notificationInbox.requestId === action.meta.requestId) {
            state.notificationInbox.requestId = null;
            state.notificationInbox.error = action.payload?.message || 'Could not load notifications. Try again.';
            state.notificationInbox.data = null;
        }
    });
    builder.addCase(readNotifications.pending, (state, action) => {
        state.notificationInbox.mutationId = action.meta.requestId;
        state.notificationInbox.requestId = null;
        state.notificationInbox.error = null;
        state.notificationSummaryRequestId = action.meta.requestId;
    });
    builder.addCase(readNotifications.fulfilled, (state, action) => {
        if (state.notificationInbox.mutationId !== action.meta.requestId) {
            return;
        }
        state.notificationInbox.mutationId = null;
        state.notificationInbox.data = action.payload;
        state.notificationInbox.query = { filter: action.meta.arg.filter, page: action.payload.page };
        state.notifications = action.payload;
        state.notificationSummaryRequestId = null;
    });
    builder.addCase(readNotifications.rejected, (state, action) => {
        if (state.notificationInbox.mutationId === action.meta.requestId) {
            state.notificationInbox.mutationId = null;
            state.notificationInbox.error = action.payload?.message || 'Could not mark notifications as read. Try again.';
            state.notificationSummaryRequestId = null;
        }
    });
}
