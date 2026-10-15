import { createAsyncThunk } from '@reduxjs/toolkit';
import { request } from '../../app/api.js';
import { disciplines } from './workflow.js';
import { simpleDefinitionErrors } from './simpleStatusWorkflow.js';

export const workflowStageKinds = ['Planning', 'Work', 'Review', 'Release', 'Completed', 'Cancelled'];
export const workflowStageColors = ['blue', 'amber', 'purple', 'green', 'red', 'gray'];
export const workflowOwnerRoles = ['Original', 'Owner', 'Reviewer', 'Release', 'None'];
export const workflowActorRoles = ['Original', 'Owner', 'Reviewer', 'Release', 'Administrator'];
export const workflowActionKinds = ['Progress', 'Approve', 'FailReview', 'Release', 'Complete', 'Cancel', 'Reopen'];
export const emptyDisciplineWorkflows = { data: null, status: 'idle', error: null, readId: null, writeId: null };
const slug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function receiveWorkflowSnapshot(current, latest) {
    return current || structuredClone(latest || null);
}

export function savedWorkflowSnapshot(current, draft) {
    if (!draft || typeof draft.id !== 'string' || draft.discipline !== current.discipline ||
        !Number.isSafeInteger(draft.version) || draft.version < 1 || workflowDefinitionErrors(draft.definition).length) {
        throw new Error('The server returned an invalid saved draft. Reload the latest workflow.');
    }
    return { ...current, draft: structuredClone(draft) };
}

export function workflowDraftIsStale(local, remote) {
    return Boolean((local || remote) && (!local || !remote || local.id !== remote.id || local.version !== remote.version));
}

export function renameWorkflowStage(definition, previousId, nextId) {
    return {
        ...definition,
        startStageId: definition.startStageId === previousId ? nextId : definition.startStageId,
        stages: definition.stages.map((stage) => stage.id === previousId ? { ...stage, id: nextId } : stage),
        transitions: definition.transitions.map((action) => ({
            ...action,
            fromStageId: action.fromStageId === previousId ? nextId : action.fromStageId,
            toStageId: action.toStageId === previousId ? nextId : action.toStageId,
        })),
    };
}

export function removeWorkflowStage(definition, stageId) {
    return {
        ...definition,
        startStageId: definition.startStageId === stageId ? '' : definition.startStageId,
        stages: definition.stages.filter((stage) => stage.id !== stageId),
        transitions: definition.transitions.filter((action) => action.fromStageId !== stageId && action.toStageId !== stageId),
    };
}

function reachableStages(startIds, edges) {
    const reached = new Set(startIds);
    const pending = [...startIds];
    while (pending.length) {
        const current = pending.pop();
        for (const next of edges.get(current) || []) {
            if (!reached.has(next)) {
                reached.add(next);
                pending.push(next);
            }
        }
    }
    return reached;
}

export function workflowDefinitionErrors(definition, publishing = false) {
    const errors = [];
    if (!definition || typeof definition !== 'object') {
        return ['A workflow definition is required.'];
    }
    if (definition.mode && !['Advanced', 'Simple'].includes(definition.mode)) {
        errors.push('Choose a supported workflow mode.');
    }
    if (typeof definition.name !== 'string' || definition.name.length > 80 || publishing && !definition.name.trim()) {
        errors.push('Enter a workflow name up to 80 characters.');
    }
    if (!Array.isArray(definition.stages) || definition.stages.length > 30 ||
        !Array.isArray(definition.transitions) || definition.transitions.length > 100) {
        return [...errors, 'Use at most 30 stages and 100 actions.'];
    }
    const stages = definition.stages;
    const actions = definition.transitions;
    const stageIds = new Set();
    const actionIds = new Set();
    for (const [items, ids, label] of [[stages, stageIds, 'Stage'], [actions, actionIds, 'Action']]) {
        for (const item of items) {
            if (!item || typeof item.id !== 'string' || !slug.test(item.id) || item.id.length > 30 || ids.has(item.id)) {
                errors.push(`${label} IDs must be unique lowercase slugs up to 30 characters.`);
            }
            ids.add(item?.id);
            if (!item || typeof item.name !== 'string' || item.name.length > 80 || publishing && !item.name.trim()) {
                errors.push(`${label} names must be ${publishing ? 'nonempty and ' : ''}up to 80 characters.`);
            }
        }
    }
    for (const stage of stages) {
        if (!stage || !workflowStageKinds.includes(stage.kind) || !workflowStageColors.includes(stage.color) ||
            !workflowOwnerRoles.includes(stage.ownerRole)) {
            errors.push('Each stage needs a supported kind, theme color and owner role.');
            continue;
        }
        if (publishing && ['Completed', 'Cancelled'].includes(stage.kind) && stage.ownerRole !== 'None') {
            errors.push(`${stage.name}: terminal stages must use owner None.`);
        }
        if (publishing && stage.kind === 'Review' && stage.ownerRole !== 'Reviewer') {
            errors.push(`${stage.name}: review stages must use owner Reviewer.`);
        }
        if (publishing && stage.kind === 'Release' && stage.ownerRole !== 'Release') {
            errors.push(`${stage.name}: release stages must use owner Release.`);
        }
    }
    for (const action of actions) {
        if (!action || !workflowActionKinds.includes(action.kind) || typeof action.requireNote !== 'boolean' ||
            !Array.isArray(action.actorRoles) || action.actorRoles.some((role) => !workflowActorRoles.includes(role)) ||
            new Set(action.actorRoles).size !== action.actorRoles.length ||
            typeof action.fromStageId !== 'string' || typeof action.toStageId !== 'string') {
            errors.push('Each action needs a supported kind, participant roles, stage IDs and note setting.');
            continue;
        }
        if (!publishing) {
            continue;
        }
        if (!stageIds.has(action.fromStageId) || !stageIds.has(action.toStageId)) {
            errors.push(`${action.name}: choose existing source and destination stages.`);
        }
        if (!action.actorRoles.length) {
            errors.push(`${action.name}: choose at least one participant role.`);
        }
        let permitted = workflowActorRoles;
        if (['Approve', 'FailReview'].includes(action.kind)) {
            permitted = ['Reviewer', 'Administrator'];
        }
        else if (action.kind === 'Release') {
            permitted = ['Release', 'Administrator'];
        }
        else if (['Cancel', 'Reopen'].includes(action.kind)) {
            permitted = action.kind === 'Reopen' && definition.mode === 'Simple'
                ? ['Original', 'Owner'] : ['Administrator'];
        }
        if (action.actorRoles.some((role) => !permitted.includes(role))) {
            errors.push(`${action.name}: ${action.kind} actions may use only ${permitted.join(' or ')}.`);
        }
        if (action.kind === 'FailReview' && !action.requireNote) {
            errors.push(`${action.name}: failed review requires a note.`);
        }
        const source = stages.find((stage) => stage?.id === action.fromStageId);
        const target = stages.find((stage) => stage?.id === action.toStageId);
        if (['Approve', 'FailReview'].includes(action.kind) && source?.kind !== 'Review') {
            errors.push(`${action.name}: review actions must start from a Review stage.`);
        }
        if (action.kind === 'Cancel' && target?.kind !== 'Cancelled') {
            errors.push(`${action.name}: Cancel actions must target a Cancelled stage.`);
        }
        if (action.kind === 'Complete' && target?.kind !== 'Completed') {
            errors.push(`${action.name}: Complete actions must target a Completed stage.`);
        }
        if (['Completed', 'Cancelled'].includes(source?.kind) && action.kind !== 'Reopen') {
            errors.push(`${action.name}: terminal stages may only have Reopen actions.`);
        }
        if (action.kind === 'Reopen' && (!['Completed', 'Cancelled'].includes(source?.kind) ||
            ['Completed', 'Cancelled'].includes(target?.kind))) {
            errors.push(`${action.name}: Reopen actions must go from a terminal to a nonterminal stage.`);
        }
        if (action.kind === 'Reopen' && target?.ownerRole === 'Owner') {
            errors.push(`${action.name}: Reopen cannot target owner role Owner because terminal stages clear the current owner. Choose Original, Reviewer, Release or None.`);
        }
        else if (source?.ownerRole === 'None' && target?.ownerRole === 'Owner') {
            errors.push(`${action.name}: a stage with owner role None cannot hand off to Owner because it clears the current owner. Choose Original, Reviewer, Release or None for the destination.`);
        }
        if (source?.kind === 'Review' && target?.kind !== 'Review' && !['Approve', 'FailReview', 'Cancel'].includes(action.kind)) {
            errors.push(`${action.name}: Review exits must use Approve, FailReview or Cancel.`);
        }
        if (source?.kind === 'Review' && action.actorRoles.some((role) => !['Reviewer', 'Administrator'].includes(role))) {
            errors.push(`${action.name}: Review actions may use only Reviewer or Administrator.`);
        }
        if (source?.kind === 'Release' && action.actorRoles.some((role) => !['Release', 'Administrator'].includes(role))) {
            errors.push(`${action.name}: Release exits may use only Release or Administrator.`);
        }
        if (target?.kind === 'Completed' && !['Complete', 'Approve'].includes(action.kind)) {
            errors.push(`${action.name}: actions entering Completed must use Complete or Approve.`);
        }
        if (target?.kind === 'Cancelled' && action.kind !== 'Cancel') {
            errors.push(`${action.name}: actions entering Cancelled must use Cancel.`);
        }
    }
    if (typeof definition.startStageId !== 'string' || definition.startStageId.length > 30) {
        errors.push('Choose a valid start stage ID.');
    }
    if (definition.mode === 'Simple') {
        return [...new Set([...errors, ...simpleDefinitionErrors(definition, publishing)])];
    }
    if (!publishing) {
        return [...new Set(errors)];
    }
    if (stages.length < 2 || actions.length < 1) {
        errors.push('Publishing requires at least 2 stages and 1 action.');
    }
    const start = stages.find((stage) => stage?.id === definition.startStageId);
    if (!start || ['Completed', 'Cancelled'].includes(start.kind)) {
        errors.push('Choose one nonterminal start stage.');
    }
    const completeIds = stages.filter((stage) => stage?.kind === 'Completed').map((stage) => stage.id);
    if (!completeIds.length) {
        errors.push('Add at least one Completed stage.');
    }
    const forward = new Map();
    const backward = new Map();
    for (const action of actions.filter(Boolean)) {
        forward.set(action.fromStageId, [...(forward.get(action.fromStageId) || []), action.toStageId]);
        backward.set(action.toStageId, [...(backward.get(action.toStageId) || []), action.fromStageId]);
    }
    const reached = reachableStages([definition.startStageId], forward);
    const canComplete = reachableStages(completeIds, backward);
    for (const stage of stages.filter(Boolean)) {
        if (!reached.has(stage.id)) {
            errors.push(`${stage.name || stage.id}: unreachable from the start stage.`);
        }
        if (!['Completed', 'Cancelled'].includes(stage.kind) && !canComplete.has(stage.id)) {
            errors.push(`${stage.name || stage.id}: needs a path to a Completed stage.`);
        }
        if (stage.kind === 'Review') {
            const outgoing = actions.filter((action) => action?.fromStageId === stage.id);
            if (!outgoing.some((action) => action.kind === 'Approve') || !outgoing.some((action) => action.kind === 'FailReview')) {
                errors.push(`${stage.name}: review stages need both Approve and FailReview actions.`);
            }
        }
    }
    return [...new Set(errors)];
}

function readPage(page) {
    if (!page || typeof page.canManage !== 'boolean' || !Array.isArray(page.items) || page.items.length !== disciplines.length ||
        new Set(page.items.map((item) => item?.discipline)).size !== disciplines.length) {
        throw new Error('The server returned invalid discipline workflows. Reload or contact an administrator.');
    }
    for (const item of page.items) {
        if (!disciplines.includes(item?.discipline)) {
            throw new Error('The server returned an unsupported discipline.');
        }
        for (const [record, published] of [[item.active, true], [item.draft, false]]) {
            if (record && (typeof record.id !== 'string' || record.discipline !== item.discipline ||
                !Number.isSafeInteger(published ? record.versionNumber : record.version) ||
                (published ? record.versionNumber : record.version) < 1 ||
                workflowDefinitionErrors(record.definition, published).length)) {
                throw new Error('The server returned an invalid workflow definition. Reload or contact an administrator.');
            }
        }
    }
    return { ...page, supported: true };
}

function errorPayload(error) {
    return { message: error.message || 'Could not update discipline workflows.', status: error.status };
}

export const loadDisciplineWorkflows = createAsyncThunk('disciplineWorkflows/load', async (_, { signal, rejectWithValue, getState, requestId }) => {
    try {
        const page = readPage(await request('/discipline-workflows', { signal }));
        if (getState().workspace.disciplineWorkflows.readId !== requestId) {
            throw new Error('This workflow read has been superseded.');
        }
        return page;
    }
    catch (error) {
        if (error.status === 404 && getState().workspace.disciplineWorkflows.readId === requestId) {
            return { supported: false, canManage: false,
                items: disciplines.map((discipline) => ({ discipline, active: null, draft: null })) };
        }
        return rejectWithValue(errorPayload(error));
    }
}, {
    condition: (_, { getState }) => {
        const resource = getState().workspace.disciplineWorkflows;
        return !resource.readId && !resource.writeId;
    },
});

function mutation(name, endpoint, body, method = 'POST', validationOnly = false) {
    return createAsyncThunk(`disciplineWorkflows/${name}`, async (input, { signal, rejectWithValue, getState, requestId }) => {
        function ensureCurrent() {
            if (getState().workspace.disciplineWorkflows.writeId !== requestId) {
                throw new Error('This workflow request belongs to an expired session.');
            }
        }
        try {
            const result = await request(endpoint(input), { method, body: body(input), signal });
            ensureCurrent();
            if (validationOnly) {
                if (!Array.isArray(result?.errors) || result.errors.some((error) => typeof error !== 'string')) {
                    throw new Error('The server returned an invalid validation result.');
                }
                return result;
            }
            const page = readPage(await request('/discipline-workflows', { signal }));
            ensureCurrent();
            return { page, result };
        }
        catch (error) {
            return rejectWithValue(errorPayload(error));
        }
    }, {
        condition: (_, { getState }) => {
            const resource = getState().workspace.disciplineWorkflows;
            return Boolean(resource.data?.canManage && !resource.writeId);
        },
    });
}

export const createDisciplineWorkflowDraft = mutation('createDraft',
    ({ discipline }) => `/discipline-workflows/${encodeURIComponent(discipline)}/drafts`, () => ({}));
export const saveDisciplineWorkflowDraft = mutation('saveDraft', ({ id }) => `/workflow-drafts/${encodeURIComponent(id)}`,
    ({ version, definition }) => {
        const errors = workflowDefinitionErrors(definition);
        if (errors.length) {
            throw new Error(errors.join(' '));
        }
        return { version, definition };
    }, 'PUT');
export const validateDisciplineWorkflowDraft = mutation('validateDraft',
    ({ id }) => `/workflow-drafts/${encodeURIComponent(id)}/validate`, ({ version }) => ({ version }), 'POST', true);
export const publishDisciplineWorkflowDraft = mutation('publishDraft',
    ({ id }) => `/workflow-drafts/${encodeURIComponent(id)}/publish`, ({ version }) => ({ version }));
export const disableDisciplineWorkflow = mutation('disable',
    ({ discipline }) => `/discipline-workflows/${encodeURIComponent(discipline)}/activation`,
    ({ expectedActiveVersionId }) => ({ workflowVersionId: null, expectedActiveVersionId }), 'PUT');

export function addDisciplineWorkflowReducers(builder) {
    const operations = [loadDisciplineWorkflows, createDisciplineWorkflowDraft, saveDisciplineWorkflowDraft,
        validateDisciplineWorkflowDraft, publishDisciplineWorkflowDraft, disableDisciplineWorkflow];
    for (const operation of operations) {
        const writing = operation !== loadDisciplineWorkflows;
        const validationOnly = operation === validateDisciplineWorkflowDraft;
        const key = writing ? 'writeId' : 'readId';
        builder.addCase(operation.pending, (state, action) => {
            const resource = state.disciplineWorkflows;
            resource[key] = action.meta.requestId;
            resource.status = writing ? 'saving' : 'loading';
            resource.error = null;
            if (writing) {
                resource.readId = null;
            }
        });
        builder.addCase(operation.fulfilled, (state, action) => {
            const resource = state.disciplineWorkflows;
            if (resource[key] !== action.meta.requestId) {
                return;
            }
            resource[key] = null;
            resource.status = 'ready';
            resource.error = null;
            if (!validationOnly) {
                resource.data = writing ? action.payload.page : action.payload;
            }
        });
        builder.addCase(operation.rejected, (state, action) => {
            const resource = state.disciplineWorkflows;
            if (resource[key] !== action.meta.requestId) {
                return;
            }
            resource[key] = null;
            resource.status = 'error';
            resource.error = action.payload || { message: 'Could not load discipline workflows. Try again.' };
            if ([401, 403].includes(action.payload?.status)) {
                resource.data = null;
                resource.readId = null;
                resource.writeId = null;
            }
        });
    }
}
