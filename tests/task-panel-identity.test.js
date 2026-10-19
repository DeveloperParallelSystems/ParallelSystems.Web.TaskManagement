import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { statuses } from '../src/features/tasks/workflow.js';
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

test('loaded task panels have distinct stable identities across task refreshes', async () => {
    const scratchRoot = resolve('.tmp');
    mkdirSync(scratchRoot, { recursive: true });
    const scratch = mkdtempSync(join(scratchRoot, 'task-panel-identity-'));
    try {
        // Supply loaded page hook state without a browser, effects, or API requests.
        // Child components stay unevaluated: this checks the real parent's React tree.
        const hooksPath = join(scratch, 'hooks.js');
        writeFileSync(hooksPath, `
let index = 0;
let task;
let lost = false;
let changes = [];
let detailOptions = {};
export function updates() {
    return changes;
}
export function reset(next, accessLost = false, options = {}) {
    index = 0;
    task = next;
    lost = accessLost;
    changes = [];
    detailOptions = options;
}
export function useState(initial) {
    const current = index++;
    let value = initial;
    if (current === 0) {
        value = task;
    }
    else if (current === 1) {
        value = { task, allowedStatuses: ['To Do'], canEditDetails: true, activity: [], ...detailOptions };
    }
    else if (current === 2) {
        value = false;
    }
    if (current === 17) {
        value = lost;
    }
    return [value, (next) => changes.push([current, next])];
}
export function useEffect() {}
export function useRef() {
    return { current: null };
}
export function useDispatch() {
    return () => {};
}
export function useSelector(select) {
    return select({ auth: { user: { role: 'Administrator' } }, workspace: { people: [], projects: [],
        statusSettings: { data: { catalog: [{code:'To Do',name:'To Do',boardStatus:'To Do'}], disciplines: [{discipline:'Development',statuses:['To Do']}] } } } });
}
export function useBlocker() {
    return { state: 'unblocked' };
}
export function useLocation() {
    return { search: '' };
}
export function useNavigate() {
    return () => {};
}
`);
        const entryPath = join(scratch, 'entry.jsx');
        writeFileSync(entryPath, "export { default as TaskPage } from '../../src/features/tasks/TaskPage.jsx';\n" +
            "export { default as TaskStageOverview } from '../../src/features/tasks/TaskStageOverview.jsx';\n" +
            "export { reset, updates } from './hooks.js';\n");
        const bundle = await build({ configFile: false, logLevel: 'silent', plugins: [{
            name: 'loaded-task-page-hooks',
            enforce: 'pre',
            transform(source, id) {
                if (!id.replaceAll('\\', '/').endsWith('/src/features/tasks/TaskPage.jsx')) {
                    return null;
                }
                return source.replace(/from '(react|react-redux|react-router-dom)'/g,
                    `from ${JSON.stringify(hooksPath.replaceAll('\\', '/'))}`);
            },
        }, react()], build: { ssr: entryPath, write: false } });
        const modulePath = join(scratch, 'panels.mjs');
        writeFileSync(modulePath, bundle.output.find((chunk) => chunk.isEntry).code);
        const { TaskPage, TaskStageOverview, reset, updates } = await import(pathToFileURL(modulePath).href);
        function descendants(element) {
            if (Array.isArray(element)) {
                return element.flatMap(descendants);
            }
            if (!React.isValidElement(element)) {
                return [];
            }
            return [element, ...descendants(element.props.children)];
        }
        function panels(id, version) {
            reset({ id, version, title: 'Test task', status: 'To Do', labels: [], history: [] });
            const tree = TaskPage({ id, onEditingChange: () => {}, onClose: () => {}, onSaved: () => {} });
            const details = tree.props.children.find((child) => child?.props?.id === 'task-details-panel');
            return descendants(details).filter((child) => typeof child.type === 'function' &&
                child.key !== null && (child.props.taskId || child.props.task));
        }
        const initial = panels('task-one', 1);
        assert.equal(initial.length, 3, 'Labels, checklist and linked tickets must remain mounted with stable keys.');
        assert.equal(new Set(initial.map((panel) => panel.key)).size, initial.length,
            'Sibling panels must not share a React key: duplicate keys can leave orphaned panels after updates.');
        assert.deepEqual(panels('task-one', 2).map((panel) => panel.key), initial.map((panel) => panel.key));
        const next = panels('task-two', 1);
        assert.equal(new Set(next.map((panel) => panel.key)).size, next.length);
        assert.ok(next.every((panel) => !initial.some((previous) => previous.key === panel.key)),
            'Changing task must reset each panel independently.');
        const task = { id: 'existing', title: 'Task', discipline: 'Development', status: 'To Do' };
        reset(task);
        const simpleTree = TaskPage({ id: task.id, onEditingChange: () => {}, onClose: () => {}, onSaved: () => {} });
        const controls = descendants(simpleTree);
        const control = controls.find((child) => child.type === 'select' && child.props['aria-label'] === 'Status');
        assert.ok(control, 'Status must be part of the unified task form.');
        assert.equal(control.props.value, task.status);
        assert.equal(control.props.form, 'task-details-form');
        assert.equal(controls.filter((child) => child.type === 'button' && child.props.type === 'submit').length, 1);
        assert.equal(controls.some((child) => child.type === 'span' && ['Activity note', 'Status note (optional)'].includes(child.props.children)), false);
        assert.ok(!descendants(simpleTree).some((child) => child?.props?.details && child?.props?.onReload), 'Historical workflow actions must not be exposed.');
        const legacyOverview = renderToStaticMarkup(React.createElement(TaskStageOverview, { task: { status: 'Failed Review' } }));
        assert.equal((legacyOverview.match(/<li/g) || []).length, statuses.length);
        assert.equal((legacyOverview.match(/aria-current="step"/g) || []).length, 1);
        assert.doesNotMatch(legacyOverview, /<button|completed|✓/);
        const loopedWorkflow = { status: 'work', workflow: { definition: { stages: [
            { id: 'review', name: '<Review>' },
            { id: 'work', name: 'Revise work' },
            { id: 'done', name: 'Delivered' },
        ], transitions: [
            { fromStageId: 'review', toStageId: 'work' },
            { fromStageId: 'work', toStageId: 'review' },
        ] } } };
        const configuredOverview = renderToStaticMarkup(React.createElement(TaskStageOverview, { task: loopedWorkflow }));
        assert.equal((configuredOverview.match(/<li/g) || []).length, 3);
        assert.match(configuredOverview, /&lt;Review&gt;/);
        assert.match(configuredOverview, /aria-current="step"[^]*?Revise work/);
        assert.equal((configuredOverview.match(/aria-current="step"/g) || []).length, 1);
        assert.doesNotMatch(configuredOverview, /<button|completed|✓/,
            'Stage order must never imply completion or permit transitions.');
    }
    finally {
        assert.ok(scratch.startsWith(scratchRoot + '\\') || scratch.startsWith(scratchRoot + '/'));
        rmSync(scratch, { recursive: true, force: true });
    }
});
