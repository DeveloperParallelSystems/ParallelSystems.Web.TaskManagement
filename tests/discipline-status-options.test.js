import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { taskDisciplineStatusOptions } from '../src/features/tasks/disciplineStatusOptions.js';

test('discipline status choices preserve stored IDs, ignore drafts and retain the unconfigured legacy fallback', () => {
    const task = { discipline: 'Drafting', workflow: { discipline: 'Drafting', definition: { stages: [
        { id: 'old-review', name: 'In Review' },
        { id: 'old-done', name: 'Completed' },
        { id: 'removed', name: 'Removed' },
    ] } } };
    const configuration = { items: [
        { discipline: 'Development', active: { definition: { stages: [{ id: 'code', name: 'Code' }] } } },
        { discipline: 'Drafting', active: { definition: { stages: [
            { id: 'review', name: 'In Review' }, { id: 'done', name: 'Completed' },
        ] } }, draft: { definition: { stages: [{ id: 'removed', name: 'Removed' }] } } },
    ] };
    assert.deepEqual(taskDisciplineStatusOptions(task, configuration, ['old-review', 'old-done', 'removed']), [
        { status: 'old-review', name: 'In Review' }, { status: 'old-done', name: 'Completed' },
    ]);
    assert.deepEqual(taskDisciplineStatusOptions(task, configuration, ['removed']), []);
    configuration.items[1].active = null;
    assert.deepEqual(taskDisciplineStatusOptions(task, configuration, ['removed']), [{ status: 'removed', name: 'Removed' }]);
    assert.deepEqual(taskDisciplineStatusOptions({ discipline: 'Drafting' }, configuration, ['To Do', 'Blocked']), [
        { status: 'To Do', name: 'To Do' }, { status: 'Blocked', name: 'Blocked' },
    ]);
});

test('status menus use only the task discipline configuration and server-permitted destinations', async () => {
    const scratchRoot = resolve('.tmp');
    mkdirSync(scratchRoot, { recursive: true });
    const scratch = mkdtempSync(join(scratchRoot, 'discipline-status-options-'));
    try {
        const entryPath = join(scratch, 'entry.jsx');
        writeFileSync(entryPath, "export { TaskMoveMenu } from '../../src/features/tasks/TaskMoves.jsx';\n" +
            "export { default as Actions } from '../../src/features/tasks/TaskWorkflowActions.jsx';\n");
        const bundle = await build({ configFile: false, logLevel: 'silent', plugins: [react()],
            build: { ssr: entryPath, write: false } });
        const modulePath = join(scratch, 'menus.mjs');
        writeFileSync(modulePath, bundle.output.find((chunk) => chunk.isEntry).code);
        const { TaskMoveMenu, Actions } = await import(pathToFileURL(modulePath).href);
        const stages = [
            { id: 'to-do', name: 'To Do' },
            { id: 'in-progress', name: 'In Progress' },
            { id: 'in-review', name: 'In Review' },
            { id: 'completed', name: 'Completed' },
        ];
        const configuration = { items: [
            { discipline: 'Development', active: { definition: { stages } },
                draft: { definition: { stages: [{ id: 'draft-only', name: 'Draft only' }] } } },
            { discipline: 'Drafting', active: { definition: { stages: [{ id: 'drawing', name: 'Drawing' }] } } },
        ] };
        const task = { id: 'legacy', code: 'TASK-1', discipline: 'Development', status: 'To Do', version: 1 };
        const details = { task, liveStatuses: true, allowedStatuses: ['To Do', 'In Review', 'Completed', 'Blocked', 'Ready for Release'] };
        const state = { auth: { user: { role: 'Administrator' } }, workspace: {
            tasks: [task], details: { [task.id]: details }, statusSettings: { data: {
                catalog: ['To Do', 'In Progress', 'In Review', 'Completed'].map((code) => ({ code, name: code, boardStatus: code })),
                disciplines: [{ discipline: 'Development', statuses: ['To Do', 'In Progress', 'In Review', 'Completed'] },
                    { discipline: 'Drafting', statuses: ['To Do'] }],
            } }, disciplineWorkflows: { data: configuration },
        } };
        const store = { getState: () => state, subscribe: () => () => {}, dispatch: () => {} };
        function render(Component, props) {
            return renderToStaticMarkup(React.createElement(Provider, { store }, React.createElement(Component, props)));
        }
        function optionValues(html) {
            return [...html.matchAll(/<option[^>]*value="([^"]*)"/g)].map((match) => match[1]);
        }
        const menu = render(TaskMoveMenu, { task, onOpen: () => {}, onError: () => {} });
        assert.deepEqual(optionValues(menu), ['', 'In Review', 'Completed']);
        assert.doesNotMatch(menu, /Blocked|Ready for Release|Drawing|Draft only|In Progress/);

        const pinned = { ...task, id: 'pinned', status: 'to-do', workflow: { id: 'old-version', versionNumber: 1,
            discipline: 'Development', definition: { mode: 'Simple', name: 'Development', stages: [
                ...stages, { id: 'removed', name: 'Removed status' },
            ] } } };
        const pinnedDetails = { task: pinned, allowedStatuses: ['to-do', 'in-review', 'completed', 'removed'],
            allowedTransitions: [
                { id: 'review-action', name: 'Move to In Review', toStageId: 'in-review' },
                { id: 'removed-action', name: 'Move to Removed status', toStageId: 'removed' },
                { id: 'forbidden-action', name: 'Move to In Progress', toStageId: 'in-progress' },
            ] };
        state.workspace.tasks = [pinned];
        state.workspace.details = { [pinned.id]: pinnedDetails };
        const actions = render(Actions, { details: pinnedDetails, onEditingChange: () => {}, onSaved: () => {}, onReload: () => {} });
        assert.deepEqual(optionValues(actions), ['', 'review-action']);
        assert.match(actions, />In Review<\/option>/);
        assert.doesNotMatch(actions, /Removed status|Move to In Progress/);
        state.workspace.disciplineWorkflows.data = null;
        state.workspace.statusSettings.data = null;
        assert.deepEqual(optionValues(render(TaskMoveMenu, { task: pinned })), ['']);
        assert.deepEqual(optionValues(render(Actions, { details: pinnedDetails, onEditingChange: () => {} })), []);
    }
    finally {
        assert.ok(scratch.startsWith(scratchRoot + '\\') || scratch.startsWith(scratchRoot + '/'));
        rmSync(scratch, { recursive: true, force: true });
    }
});
