import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogDeleteReason, removeCatalogStatus, saveCatalogName } from '../src/features/tasks/statusCatalog.js';
import { validateStatusSettings } from '../src/features/tasks/liveStatuses.js';

const settings = {
    version: 5, canManage: true,
    catalog: [{ code: 'To Do', name: 'To Do', boardStatus: 'To Do' },
        { code: 'qa', name: 'QA', boardStatus: 'In Review' },
        { code: 'design-check', name: 'Unused', boardStatus: 'In Progress' }],
    disciplines: [{ discipline: 'Development', statuses: ['To Do', 'qa'] },
        { discipline: 'Drafting', statuses: ['To Do'] }],
};

test('catalog add and rename preserve stable codes, mappings, discipline membership and revision', () => {
    const before = structuredClone(settings);
    const added = saveCatalogName(settings, { name: '  Design check  ' });
    assert.deepEqual(added.catalog[3], { code: 'design-check-2', name: 'Design check', boardStatus: 'In Progress', isCustom: true });
    const renamed = saveCatalogName(added, { code: 'qa', name: '  Design QA  ' });
    assert.deepEqual(renamed.catalog[1], { code: 'qa', name: 'Design QA', boardStatus: 'In Review' });
    assert.deepEqual(renamed.disciplines, before.disciplines);
    assert.equal(renamed.version, 5);
    assert.deepEqual(settings, before);
    assert.throws(() => saveCatalogName(settings, { name: ' qa ' }), /unique/i);
    assert.throws(() => saveCatalogName(settings, { code: 'qa', name: 'Unused' }), /unique/i);
    assert.throws(() => saveCatalogName(settings, { name: ' ' }), /name/i);
    assert.throws(() => saveCatalogName(settings, { name: 'x'.repeat(81) }), /80/);
    assert.throws(() => saveCatalogName(settings, { code: 'To Do', name: 'Start' }), /default/i);
});

test('status settings reject duplicate display names regardless of code, case or surrounding spaces', () => {
    const duplicate = structuredClone(settings);
    duplicate.catalog.push({ code: 'other-qa', name: '  qa  ', boardStatus: 'In Review' });
    assert.match(validateStatusSettings(duplicate), /unique.*name/i);
    assert.throws(() => saveCatalogName({ ...settings, catalog: [
        ...settings.catalog, { code: 'other', name: ' Existing name ', boardStatus: 'In Progress' },
    ] }, { name: 'existing name' }), /unique/i);
});

test('catalog deletion rejects required, assigned and task-used statuses while allowing unused definitions', () => {
    assert.match(catalogDeleteReason(settings, [], 'To Do'), /default/i);
    assert.match(catalogDeleteReason(settings, [], 'qa'), /discipline/i);
    assert.match(catalogDeleteReason(settings, [{ status: 'design-check', discipline: 'Drafting' }], 'design-check'), /tasks/i);
    assert.throws(() => removeCatalogStatus(settings, [{ status: 'design-check' }], 'design-check'), /tasks/i);
    assert.throws(() => removeCatalogStatus(settings, [], 'qa'), /discipline/i);
    const removed = removeCatalogStatus(settings, [], 'design-check');
    assert.deepEqual(removed.catalog.map(item => item.code), ['To Do', 'qa']);
    assert.deepEqual(removed.disciplines, settings.disciplines);
    assert.equal(settings.catalog.length, 3);
});
