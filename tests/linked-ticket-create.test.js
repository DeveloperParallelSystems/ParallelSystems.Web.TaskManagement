import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { linkedTaskPath, newChildTaskLocation, withoutParentSelection } from '../src/features/tasks/taskNavigation.js';

test('child creation inherits the project and encodes the parent selection', () => {
    assert.deepEqual(newChildTaskLocation({ id: 'parent', projectId: 'project' }, [{ id: 'project' }], '?following=1&view=list&parentTaskId=old'), {
        pathname: '/projects/project/tasks/new', search: '?following=1&view=list&parentTaskId=parent&client=unassigned',
    });
    assert.deepEqual(newChildTaskLocation({ id: 'parent', projectId: 'project' }, [{ id: 'project' }]), {
        pathname: '/projects/project/tasks/new', search: '?client=unassigned&parentTaskId=parent',
    });
    assert.deepEqual(newChildTaskLocation({ id: 'parent', projectId: null }), {
        pathname: '/projects/general/tasks/new', search: '?client=unassigned&parentTaskId=parent',
    });
});

test('historical task projects omitted from lookups retain ordinary task and child creation routes', () => {
    const task = { id: 'parent', projectId: 'historical-project' };
    const projects = [{ id: 'available-project' }];
    assert.equal(linkedTaskPath(task, projects), '/tasks/parent');
    assert.deepEqual(newChildTaskLocation(task, projects), {
        pathname: '/tasks/new', search: '?client=unassigned&parentTaskId=parent',
    });
    assert.equal(linkedTaskPath({ id: 'known', projectId: 'available-project' }, projects), '/projects/available-project/tasks/known');
    assert.equal(linkedTaskPath({ id: 'general', projectId: null }, projects), '/projects/general/tasks/general');
});

test('cancel, save and regular creation drop the parent query while preserving list filters', () => {
    assert.equal(withoutParentSelection('?parentTaskId=parent&view=list&search=design'), '?view=list&search=design');
    assert.equal(withoutParentSelection('?parentTaskId=parent'), '');
    assert.equal(withoutParentSelection('?view=board'), '?view=board');
});

test('new task form preserves optional and unavailable parents and sends the parent only on create', async () => {
    const scratchRoot = resolve('.tmp');
    mkdirSync(scratchRoot, { recursive: true });
    const scratch = mkdtempSync(join(scratchRoot, 'linked-ticket-create-'));
    const originalFetch = globalThis.fetch;
    try {
        const hooksPath = join(scratch, 'hooks.js');
        writeFileSync(hooksPath, `
let index = 0;
let input = {};
let search = '';
let isNew = true;
export function reset(values, query = '', creating = true) {
    index = 0;
    input = values;
    search = query;
    isNew = creating;
}
export function useState(initial) {
    const current = index++;
    let value = typeof initial === 'function' ? initial() : initial;
    if (current === 0) {
        value = { ...value, ...input };
    }
    else if (current === 1 && !isNew) {
        value = { task: input, canEditDetails: true, allowedStatuses: ['To Do'], activity: [] };
    }
    else if (current === 2) {
        value = false;
    }
    else if (current === 15) {
        value = true;
    }
    return [value, () => {}];
}
export function useEffect() {}
export function useRef() {
    return { current: null };
}
export function useDispatch() {
    return (action) => action(() => {}, () => ({}));
}
export function useSelector(select) {
    return select({ auth: { user: { role: 'Administrator' } }, workspace: {
        people: [], projects: [{ id: 'project', name: 'Project' }],
        tasks: [{ id: 'parent', code: 'TASK-1', title: 'Parent', projectId: 'project' },
            { id: 'outside', code: 'TASK-2', title: 'Other project', projectId: 'outside-project' }],
        statusSettings: { data: { catalog: [], disciplines: [] } },
        taskColumnsRevision: 1,
        taskColumns: {
            'project:Development': { data: { version: 1, columns: ['originalAssignee'] } },
            'default:Development': { data: { version: 1, columns: ['originalAssignee'] } },
        },
        customFields: { project: { data: { version: 1, projectId: 'project', canManage: true, fields: [] } } },
    } });
}
export function useBlocker() {
    return { state: 'unblocked' };
}
export function useLocation() {
    return { search };
}
export function useNavigate() {
    return () => {};
}
`);
        const entry = join(scratch, 'entry.jsx');
        writeFileSync(entry, "export { default as TaskPage } from '../../src/features/tasks/TaskPage.jsx';\nexport { reset } from './hooks.js';");
        const bundle = await build({ configFile: false, logLevel: 'silent', plugins: [{
            name: 'task-create-hooks', enforce: 'pre',
            transform(source, id) {
                if (!id.replaceAll('\\', '/').endsWith('/src/features/tasks/TaskPage.jsx')) {
                    return null;
                }
                return source.replace(/from '(react|react-redux|react-router-dom)'/g,
                    `from ${JSON.stringify(hooksPath.replaceAll('\\', '/'))}`);
            },
        }, react()], build: { ssr: entry, write: false } });
        const modulePath = join(scratch, 'create.mjs');
        writeFileSync(modulePath, bundle.output.find((chunk) => chunk.isEntry).code);
        const { TaskPage, reset } = await import(pathToFileURL(modulePath).href);
        function descendants(element) {
            if (Array.isArray(element)) {
                return element.flatMap(descendants);
            }
            if (!React.isValidElement(element)) {
                return [];
            }
            return [element, ...descendants(element.props.children)];
        }
        function form(query, creating = true, projectScope = 'project') {
            reset({ title: 'Child', discipline: 'Development', status: 'To Do', version: 1,
                originalAssigneeId: 'staff', ...(creating ? {} : { id: 'existing', parentTaskId: 'parent' }) }, query, creating);
            const tree = TaskPage({ id: creating ? 'new' : 'existing', projectScope,
                onEditingChange: () => {}, onClose: () => {}, onSaved: () => {} });
            return descendants(tree).find((element) => element.props.id === 'task-details-form');
        }
        const calls = [];
        globalThis.fetch = async (url, options) => {
            calls.push({ url, method: options.method, body: JSON.parse(options.body) });
            return new Response(JSON.stringify({ id: 'created' }), {
                headers: { 'Content-Type': 'application/json' },
            });
        };
        const childForm = form('?parentTaskId=parent');
        const childHtml = renderToStaticMarkup(childForm);
        assert.match(childHtml, /Parent ticket \(optional\)/);
        assert.match(childHtml, /<option value="parent" selected="">TASK-1/);
        assert.match(childHtml, /<optgroup label="This client and project">/);
        assert.match(childHtml, /<optgroup label="Other clients, projects and general tasks">/);
        await childForm.props.onSubmit({ preventDefault() {} });
        assert.equal(calls[0].url, '/api/task-management/tasks/live');
        assert.equal(calls[0].method, 'POST');
        assert.equal(calls[0].body.parentTaskId, 'parent');
        assert.equal(calls[0].body.projectId, 'project');
        const standalone = form('');
        await standalone.props.onSubmit({ preventDefault() {} });
        assert.equal(calls[1].body.parentTaskId, null);
        const unavailable = form('?parentTaskId=missing');
        assert.match(renderToStaticMarkup(unavailable), /<option value="missing" selected="">Selected parent unavailable/);
        await unavailable.props.onSubmit({ preventDefault() {} });
        assert.equal(calls[2].body.parentTaskId, 'missing', 'The server must validate a requested unavailable parent, never silently create standalone.');
        const existing = form('', false);
        assert.doesNotMatch(renderToStaticMarkup(existing), /Parent ticket \(optional\)/);
        await existing.props.onSubmit({ preventDefault() {} });
        assert.equal(calls[3].method, 'PUT');
        assert.equal(Object.hasOwn(calls[3].body, 'parentTaskId'), false);
        const historicalParent = form('?parentTaskId=outside', true, null);
        const historicalHtml = renderToStaticMarkup(historicalParent);
        assert.match(historicalHtml, /<span>Project<\/span><select form="task-details-form"><option value="" selected="">/);
        assert.match(historicalHtml, /<option value="outside" selected="">TASK-2/);
        await historicalParent.props.onSubmit({ preventDefault() {} });
        assert.equal(calls[4].body.parentTaskId, 'outside');
        assert.equal(calls[4].body.projectId, null);
    }
    finally {
        globalThis.fetch = originalFetch;
        assert.ok(scratch.startsWith(scratchRoot + '\\') || scratch.startsWith(scratchRoot + '/'));
        rmSync(scratch, { recursive: true, force: true });
    }
});
