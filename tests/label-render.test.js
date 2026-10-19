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

test('label rendering escapes names, retains inactive labels and restricts assignment controls', async () => {
    const scratchRoot = resolve('.tmp');
    mkdirSync(scratchRoot, { recursive: true });
    const scratch = mkdtempSync(join(scratchRoot, 'label-render-'));
    try {
        const entryPath = join(scratch, 'entry.jsx');
        writeFileSync(entryPath, "export { default as TaskLabels } from '../../src/features/tasks/TaskLabels.jsx';\n" +
            "export { default as LabelBadges, labelStyle } from '../../src/features/tasks/LabelBadges.jsx';\n");
        const bundle = await build({ configFile: false, plugins: [react()], logLevel: 'silent',
            build: { ssr: entryPath, write: false } });
        const modulePath = join(scratch, 'labels.mjs');
        writeFileSync(modulePath, bundle.output.find((chunk) => chunk.isEntry).code);
        const { TaskLabels, LabelBadges, labelStyle } = await import(pathToFileURL(modulePath).href);
        const label = { id: 'label', name: '<script>alert(1)</script>', color: '#ffffff', active: false, version: 2 };
        const task = { id: 'task', labels: [label], version: 1 };
        function render(role, component, props, tasks = [task], definitions = [label]) {
            const state = { auth: { user: { role } }, workspace: { labels: definitions, tasks } };
            const store = { getState: () => state, subscribe: () => () => {}, dispatch: () => {} };
            return renderToStaticMarkup(React.createElement(Provider, { store }, React.createElement(component, props)));
        }
        const props = { task, onEditingChange: () => {}, onSaved: () => {}, onFailure: () => {} };
        const admin = render('Administrator', TaskLabels, props);
        assert.match(admin, /Save labels/);
        assert.match(admin, /type="checkbox" checked=""/);
        assert.match(admin, /&lt;script&gt;/);
        assert.doesNotMatch(admin, /<script>/);
        assert.match(admin, /\(inactive\)/);
        const integrated = render('Administrator', TaskLabels, { ...props, integrated: true });
        assert.doesNotMatch(integrated, /Save labels|Save labels separately/);
        assert.match(integrated, /Changes are included when you Save the task/);
        const missingDefinition = render('Administrator', TaskLabels, props, [task], []);
        assert.match(missingDefinition, /aria-label="Remove &lt;script&gt;alert\(1\)&lt;\/script&gt;"/);
        assert.match(missingDefinition, /type="checkbox" checked=""/);
        const newerTaskLabel = { ...label, name: 'Newest label name', version: 3 };
        const newerTask = { ...task, labels: [newerTaskLabel] };
        const newest = render('Administrator', TaskLabels, { ...props, task: newerTask }, [newerTask], [label]);
        assert.match(newest, /aria-label="Remove Newest label name"/);
        assert.doesNotMatch(newest, /&lt;script&gt;/);
        const unassignedTask = { ...task, labels: [] };
        const unassigned = render('Administrator', TaskLabels, { ...props, task: unassignedTask },
            [unassignedTask], [{ ...label, name: 'Drafting', active: true }]);
        assert.match(unassigned, /No labels assigned/);
        assert.match(unassigned, /Available labels/);
        assert.match(unassigned, /Drafting/);
        assert.doesNotMatch(unassigned, /checked=""/);
        const member = render('User', TaskLabels, props);
        assert.doesNotMatch(member, /Save labels|type="checkbox"/);
        assert.match(member, /&lt;script&gt;/);
        assert.equal(render('User', TaskLabels, props, []), '');
        assert.equal(labelStyle('#ffffff').color, '#000000');
        assert.equal(labelStyle('#000000').color, '#ffffff');
        assert.equal(labelStyle('url(evil)').backgroundColor, '#64748b');
        const updated = render('User', LabelBadges, { labels: [{ ...label, name: 'Old name', version: 1 }] });
        assert.doesNotMatch(updated, /Old name/);
    }
    finally {
        assert.ok(scratch.startsWith(scratchRoot + '\\') || scratch.startsWith(scratchRoot + '/'));
        rmSync(scratch, { recursive: true, force: true });
    }
});
