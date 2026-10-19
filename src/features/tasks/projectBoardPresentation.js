import { createAsyncThunk } from '@reduxjs/toolkit';
import { useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { request } from '../../app/api.js';
import { emptyPresentation, presentationError, readPresentationPage } from './workflowPresentation.js';

const unavailableGroups = [];
const path = (projectId) => `/board-presentation/projects/${encodeURIComponent(projectId)}`;

function readProjectPage(page, projectId) {
    if (page?.projectId !== projectId || typeof page.usesDefault !== 'boolean'
        || !Number.isSafeInteger(page.projectVersion) || page.projectVersion < 0) {
        throw new Error('The server returned an invalid project layout. Reload before continuing.');
    }
    return readPresentationPage(page);
}

export const loadProjectPresentation = createAsyncThunk('projectPresentation/load', async (projectId, { signal, rejectWithValue }) => {
    try {
        return readProjectPage(await request(path(projectId), { signal }), projectId);
    }
    catch (error) {
        return rejectWithValue({ message: error.message, status: error.status });
    }
}, {
    condition: (projectId, { getState }) => {
        const resource = getState().workspace.projectPresentations?.[projectId];
        return !resource?.readId && !resource?.writeId;
    },
});

async function writeProject(input, useDefault, { signal, rejectWithValue }) {
    try {
        if (!useDefault) {
            const error = presentationError(input.groups, input.catalog);
            if (error) {
                throw new Error(error);
            }
        }
        const body = { version: input.version, projectVersion: input.projectVersion, catalogVersion: input.catalogVersion };
        if (!useDefault) {
            body.groups = input.groups;
        }
        return readProjectPage(await request(`${path(input.projectId)}${useDefault ? '/use-default' : ''}`, {
            method: useDefault ? 'POST' : 'PUT', body, signal,
        }), input.projectId);
    }
    catch (error) {
        return rejectWithValue({ message: error.message, status: error.status });
    }
}

export const saveProjectPresentation = createAsyncThunk('projectPresentation/save', (input, api) => writeProject(input, false, api));
export const useDefaultPresentation = createAsyncThunk('projectPresentation/reset', (input, api) => writeProject(input, true, api));

export function selectProjectPresentationGroups(state, projectId) {
    const data = state.workspace.projectPresentations?.[projectId]?.data;
    if (!data) {
        return unavailableGroups;
    }
    const shared = state.workspace.workflowPresentation?.data;
    if (data.usesDefault && shared && shared.version >= data.version && shared.catalogVersion >= data.catalogVersion) {
        return shared.groups;
    }
    return data.groups;
}

export function useProjectPresentation(projectId) {
    const dispatch = useDispatch();
    const shared = useSelector((state) => state.workspace.workflowPresentation?.data);
    useEffect(() => {
        if (!projectId || projectId === 'general') {
            return;
        }
        const refresh = () => dispatch(loadProjectPresentation(projectId));
        refresh();
        window.addEventListener('focus', refresh);
        const timer = window.setInterval(() => {
            if (document.visibilityState === 'visible') {
                refresh();
            }
        }, 30000);
        return () => {
            window.removeEventListener('focus', refresh);
            window.clearInterval(timer);
        };
    }, [dispatch, projectId, shared?.version, shared?.catalogVersion]);
}

export function addProjectPresentationReducers(builder) {
    for (const operation of [loadProjectPresentation, saveProjectPresentation, useDefaultPresentation]) {
        const writing = operation !== loadProjectPresentation;
        const key = writing ? 'writeId' : 'readId';
        const projectIdFor = (action) => writing ? action.meta.arg.projectId : action.meta.arg;
        builder.addCase(operation.pending, (state, action) => {
            const projectId = projectIdFor(action);
            state.projectPresentations ||= {};
            const resource = state.projectPresentations[projectId] ||= { ...emptyPresentation };
            resource[key] = action.meta.requestId;
            resource.error = null;
            resource.status = writing ? 'saving' : 'loading';
            if (writing) {
                resource.readId = null;
            }
        });
        builder.addCase(operation.fulfilled, (state, action) => {
            const resource = state.projectPresentations?.[projectIdFor(action)];
            if (!resource || resource[key] !== action.meta.requestId) {
                return;
            }
            resource[key] = null;
            const next = action.payload;
            const previous = resource.data;
            // A full workspace reset advances the catalog but restarts project revisions.
            if (!previous || next.catalogVersion > previous.catalogVersion
                || next.catalogVersion === previous.catalogVersion && (next.projectVersion > previous.projectVersion
                    || next.projectVersion === previous.projectVersion && next.version >= previous.version)) {
                resource.data = next;
            }
            resource.status = 'ready';
            resource.error = null;
        });
        builder.addCase(operation.rejected, (state, action) => {
            const resource = state.projectPresentations?.[projectIdFor(action)];
            if (!resource || resource[key] !== action.meta.requestId) {
                return;
            }
            resource[key] = null;
            resource.status = 'error';
            resource.error = action.payload || { message: 'Could not load the project layout.' };
            if ([401, 403, 404].includes(action.payload?.status)) {
                resource.data = null;
                resource.readId = null;
                resource.writeId = null;
            }
        });
    }
}
