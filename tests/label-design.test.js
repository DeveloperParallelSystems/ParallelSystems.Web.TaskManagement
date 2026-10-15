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

test('label controls filter definitions, preserve selected inactive choices, and preview unsaved colors', async () => {
    const scratchRoot = resolve('.tmp');
    mkdirSync(scratchRoot, { recursive: true });
    const scratch = mkdtempSync(join(scratchRoot, 'label-design-'));
    try {
        const entry = join(scratch, 'entry.jsx');
        writeFileSync(entry, "export * from '../../src/features/tasks/LabelsPage.jsx';\n" +
            "export * from '../../src/features/tasks/TaskLabels.jsx';\n");
        const bundle = await build({ configFile: false, plugins: [react()], logLevel: 'silent',
            build: { ssr: entry, write: false } });
        const modulePath = join(scratch, 'labels.mjs');
        writeFileSync(modulePath, bundle.output.find((chunk) => chunk.isEntry).code);
        const controls = await import(pathToFileURL(modulePath).href);
        const labels = [
            { id: 'dev', name: 'Development', active: true, color: '#294A69', version: 2 },
            { id: 'legacy', name: 'Legacy development', active: false, color: '#8A9A86', version: 1 },
            { id: 'draft', name: 'Drafting', active: true, color: '#7A5A9A', version: 1 },
        ];
        const state = { workspace: { labels } };
        const store = { getState: () => state, subscribe: () => () => {}, dispatch: () => {} };
        function render(component, props) {
            assert.equal(typeof component, 'function', 'Label design controls are implemented');
            return renderToStaticMarkup(React.createElement(Provider, { store }, React.createElement(component, props)));
        }

        const table = render(controls.LabelDefinitionTable, { labels, query: '  DEVELOPMENT ', status: 'inactive', onEdit: () => {} });
        assert.match(table, /Legacy development/);
        assert.doesNotMatch(table, />Development<|Drafting/);
        assert.match(table, /Edit label Legacy development/);
        const noResults = render(controls.LabelDefinitionTable, { labels, query: 'missing', status: 'all', onEdit: () => {} });
        assert.match(noResults, /No labels match/);

        const choices = render(controls.LabelPickerChoices, {
            options: labels.slice(0, 2), selected: ['legacy'], query: 'LEGACY', onToggle: () => {},
        });
        assert.match(choices, /Legacy development/);
        assert.match(choices, /checked=""/);
        assert.match(choices, /\(inactive\)/);
        assert.doesNotMatch(choices, />Development</);
        const limit = render(controls.LabelPickerChoices, {
            options: labels, selected: ['legacy', ...Array.from({ length: 19 }, (_, index) => `other-${index}`)],
            query: '', onToggle: () => {},
        });
        assert.match(limit, /type="checkbox" disabled=""/);
        assert.match(limit, /type="checkbox" checked=""/);

        const preview = render(controls.LabelEditorPreview, { label: { ...labels[0], name: 'Unsaved name', color: '#FFFFFF' } });
        assert.match(preview, /Unsaved name/);
        assert.match(preview, /background-color:#FFFFFF;color:#000000/);
        assert.doesNotMatch(preview, />Development</);
        assert.equal(controls.isValidLabelColor('#aBc123'), true);
        for (const invalid of ['#abc', '#1234567', 'red', 'url(evil)', '']) {
            assert.equal(controls.isValidLabelColor(invalid), false);
        }
    }
    finally {
        assert.ok(scratch.startsWith(scratchRoot + '\\') || scratch.startsWith(scratchRoot + '/'));
        rmSync(scratch, { recursive: true, force: true });
    }
});
