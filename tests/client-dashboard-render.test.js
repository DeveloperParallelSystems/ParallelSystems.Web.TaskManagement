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

test('client dashboard renders permission-scoped client cards without a project view or project breakdown', async () => {
    const root = resolve('.tmp');
    mkdirSync(root, { recursive: true });
    const scratch = mkdtempSync(join(root, 'client-dashboard-render-'));
    try {
        const bundle = await build({ configFile: false, logLevel: 'silent', plugins: [react()],
            build: { ssr: 'src/features/tasks/ClientDashboard.jsx', write: false } });
        const modulePath = join(scratch, 'dashboard.mjs');
        writeFileSync(modulePath, bundle.output.find((chunk) => chunk.isEntry).code);
        const { default: Dashboard } = await import(pathToFileURL(modulePath).href);
        const state = { workspace: {
            clients: [{ id: 'a', name: '<Acme>' }, { id: 'b', name: 'Beta' }, { id: 'zero', name: 'Zero' }],
            projects: [{ id: 'shared', name: 'Do not group by this project', clientIds: ['a', 'b'] }], people: [],
            tasks: [
                { id: 'a-open', projectId: 'shared', clientId: 'a', status: 'In Progress', dueDate: '2000-01-01', title: '<script>private title</script>' },
                { id: 'a-done', projectId: 'shared', clientId: 'a', status: 'Completed' },
                { id: 'b-review', projectId: 'shared', clientId: 'b', status: 'In Review' },
                { id: 'null-client', projectId: 'shared', clientId: null, status: 'To Do' },
                { id: 'general', projectId: null, status: 'To Do' },
            ],
        } };
        const store = { getState: () => state, subscribe: () => () => {}, dispatch() {} };
        const render = () => renderToStaticMarkup(React.createElement(Provider, { store },
            React.createElement(Dashboard, { onOpen() {} })));
        const html = render();
        assert.match(html, /&lt;Acme&gt; workload/);
        assert.match(html, /&lt;script&gt;private title&lt;\/script&gt;/);
        assert.doesNotMatch(html, /<script>|By project|View projects|Do not group by this project|Work at a glance/);
        assert.doesNotMatch(html, /client-dashboard-metrics|Selected client workload|client-workload-counts|In progress|In review|To do|Awaiting release|Other statuses/);
        assert.doesNotMatch(html, /completion|<progress/i);
        const summary = html.match(/<section class="client-dashboard-summary"[\s\S]*?<\/section>/)[0];
        assert.equal((summary.match(/<article /g) || []).length, 4);
        for (const [label, value] of [['Tasks', 3], ['Overdue', 1], ['Due this week', 0], ['Without owner', 3]]) {
            assert.match(summary, new RegExp(`aria-label="${label}"><span[^>]*>${label}</span><strong[^>]*>${value}</strong>`));
        }
        assert.match(summary, /across 3 clients|Needs attention|nothing coming up|needs assignment/);
        const acme = html.split('aria-label="&lt;Acme&gt; workload"')[1].split('</article>')[0];
        assert.match(acme, /<dt>Projects<\/dt><dd>1<\/dd>/);
        assert.match(acme, /<dt>Overdue tasks<\/dt><dd class="overdue">1<\/dd>/);
        assert.match(acme, /<dt>Due this week<\/dt><dd>0<\/dd>/);
        assert.match(acme, /<dt>Tasks without owner<\/dt><dd>2<\/dd>/);
        const empty = html.split('aria-label="Zero workload"')[1].split('</article>')[0];
        assert.equal((empty.match(/<dd>0<\/dd>/g) || []).length, 4);
        assert.match(html, /aria-label="Beta task metrics"/);
        assert.match(html, /aria-label="Unassigned task metrics"/);
        assert.match(html, /aria-label="General tasks task metrics"/);
        assert.match(html, /3 clients selected · 3 tasks/);
        state.workspace.clients = [{ id: 'b', name: 'Beta' }];
        state.workspace.tasks = state.workspace.tasks.filter((task) => task.id === 'b-review');
        const restricted = render();
        assert.doesNotMatch(restricted, /Acme|private title|Unassigned task metrics|General tasks task metrics/);
        assert.match(restricted, /1 client selected · 1 task/);
        assert.match(restricted, /across 1 client/);
        assert.match(restricted, />On track</);
    }
    finally {
        assert.ok(scratch.startsWith(root + '\\') || scratch.startsWith(root + '/'));
        rmSync(scratch, { recursive: true, force: true });
    }
});

test('client selection, due filters and paged client task opening preserve client scope', async () => {
    const root = resolve('.tmp');
    mkdirSync(root, { recursive: true });
    const scratch = mkdtempSync(join(root, 'client-dashboard-interactions-'));
    try {
        const hooks = join(scratch, 'hooks.js');
        writeFileSync(hooks, `
let state;
let slots = new Map();
let current;
let index;
export function reset(next) {
    state = next;
    slots = new Map();
}
export function start(name) {
    if (!slots.has(name)) {
        slots.set(name, []);
    }
    current = slots.get(name);
    index = 0;
}
export function useState(initial) {
    const values = current;
    const slot = index++;
    if (!(slot in values)) {
        values[slot] = typeof initial === 'function' ? initial() : initial;
    }
    return [values[slot], (next) => {
        values[slot] = typeof next === 'function' ? next(values[slot]) : next;
    }];
}
export function useSelector(select) {
    return select(state);
}
export function useId() {
    return 'client-card-details';
}
export function useLocalToday() {
    return '2026-10-26';
}
`);
        const entry = join(scratch, 'entry.jsx');
        writeFileSync(entry, "export { default as Dashboard } from '../../src/features/tasks/ClientDashboard.jsx';\n" +
            "export { default as Card } from '../../src/features/tasks/ClientWorkloadCard.jsx';\n" +
            "export { reset, start } from './hooks.js';\n");
        const bundle = await build({ configFile: false, logLevel: 'silent', plugins: [{
            name: 'client-dashboard-hooks', enforce: 'pre', transform(source, id) {
                if (['ClientDashboard.jsx', 'ClientWorkloadCard.jsx'].some((name) => id.replaceAll('\\', '/').endsWith(`/${name}`))) {
                    return source.replace(/from '(react|react-redux|\.\/TaskCalendar\.jsx)'/g,
                        `from ${JSON.stringify(hooks.replaceAll('\\', '/'))}`);
                }
            },
        }, react()], build: { ssr: entry, write: false } });
        const modulePath = join(scratch, 'interactive.mjs');
        writeFileSync(modulePath, bundle.output.find((chunk) => chunk.isEntry).code);
        const { Dashboard, Card, reset, start } = await import(pathToFileURL(modulePath).href);
        const tasks = Array.from({ length: 7 }, (_, index) => ({ id: `a-${index}`, code: `TASK-${index}`, title: `Client A task ${index}`,
            projectId: 'shared', clientId: 'a', status: 'In Progress', dueDate: '2026-10-25' }));
        tasks.push({ id: 'b', projectId: 'shared', clientId: 'b', title: 'Client B task', status: 'Completed', dueDate: '2026-11-06' });
        const state = { workspace: { tasks, people: [], clients: [{ id: 'a', name: 'Client A' }, { id: 'b', name: 'Client B' }],
            projects: [{ id: 'shared', clientIds: ['a', 'b'] }] } };
        reset(state);
        const opened = [];
        function descendants(node) {
            if (Array.isArray(node)) {
                return node.flatMap(descendants);
            }
            if (!React.isValidElement(node)) {
                return [];
            }
            return [node, ...descendants(node.props.children)];
        }
        function render() {
            start('dashboard');
            return descendants(Dashboard({ onOpen: (id) => opened.push(id) }));
        }
        const filters = () => render().find((node) => node.type?.name === 'ClientDashboardFilters').props;
        const cards = () => render().filter((node) => node.type?.name === 'ClientWorkloadCard');
        const summaryValues = () => render().filter((node) => node.props.className === 'client-summary-value')
            .map((node) => node.props.children);
        assert.equal(cards().length, 2);
        assert.deepEqual(summaryValues(), [8, 7, 0, 8]);
        filters().onSelect(['b']);
        assert.deepEqual(summaryValues(), [1, 0, 0, 1]);
        assert.deepEqual(cards().map((card) => card.props.group.id), ['b']);
        assert.equal(cards()[0].props.group.summary.withoutOwner, 1);
        assert.equal(cards()[0].props.group.projectCount, 1);
        state.workspace.tasks.find((task) => task.id === 'b').dueDate = '2026-10-27';
        filters().onDueChange('week');
        assert.deepEqual(summaryValues(), [1, 0, 1, 1]);
        filters().onDueChange('overdue');
        assert.equal(cards()[0].props.group.summary.total, 0);
        assert.deepEqual(summaryValues(), [0, 0, 0, 0]);
        filters().onSelect(null);
        assert.equal(cards().find((card) => card.props.group.id === 'a').props.group.summary.total, 7);
        filters().onSelect([]);
        assert.equal(cards().length, 0);
        assert.deepEqual(summaryValues(), [0, 0, 0, 0]);
        assert.ok(render().some((node) => node.props.children === 'No clients selected'));
        filters().onSelect(null);
        filters().onDueChange('all');
        const cardProps = cards().find((card) => card.props.group.id === 'a').props;
        function renderCard(props = cardProps) {
            start('card');
            return descendants(Card(props));
        }
        const toggle = () => renderCard().find((node) => node.props.className === 'button client-workload-toggle');
        toggle().props.onClick();
        let taskButtons = renderCard().filter((node) => node.props.className === 'client-workload-task');
        assert.equal(taskButtons.length, 5);
        taskButtons[0].props.onClick();
        assert.equal(opened[0], 'a-0');
        renderCard().find((node) => node.props['aria-label'] === 'Next Client A tasks').props.onClick();
        taskButtons = renderCard().filter((node) => node.props.className === 'client-workload-task');
        assert.equal(taskButtons.length, 2);
        assert.ok(taskButtons.every((button) => !descendants(button).some((node) => node.props.children === 'Client B task')));
        const reduced = { ...cardProps, group: { ...cardProps.group, tasks: cardProps.group.tasks.slice(0, 1) } };
        assert.equal(renderCard(reduced).filter((node) => node.props.className === 'client-workload-task').length, 1);
        toggle().props.onClick();
        assert.equal(renderCard().some((node) => node.props.className === 'client-workload-task'), false);
    }
    finally {
        assert.ok(scratch.startsWith(root + '\\') || scratch.startsWith(root + '/'));
        rmSync(scratch, { recursive: true, force: true });
    }
});
