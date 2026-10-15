import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSimpleStatusDefinition, simpleStatusError } from '../src/features/tasks/simpleStatusWorkflow.js';
import { workflowDefinitionErrors } from '../src/features/tasks/disciplineWorkflows.js';
import { taskKind, workflowBoards } from '../src/features/tasks/taskWorkflow.js';
import { defaultPresentationGroups } from '../src/features/tasks/workflowPresentation.js';

test('four Development statuses generate every permitted move, including reopening Completed', () => {
    const statuses = [
        { id: 'to-do', name: 'To Do' },
        { id: 'in-progress', name: 'In Progress' },
        { id: 'in-review', name: 'In Review' },
        { id: 'completed', name: 'Completed' },
    ];
    const definition = buildSimpleStatusDefinition('Development', statuses);
    assert.equal(definition.mode, 'Simple');
    assert.deepEqual(definition.stages.map((stage) => stage.name), statuses.map((status) => status.name));
    assert.deepEqual(definition.stages.map((stage) => stage.kind), ['Work', 'Work', 'Work', 'Completed']);
    assert.equal(definition.transitions.length, 12);
    assert.deepEqual(definition.transitions.filter((action) => action.fromStageId === 'completed').map((action) => action.toStageId),
        ['to-do', 'in-progress', 'in-review']);
    assert.ok(definition.transitions.filter((action) => action.fromStageId === 'completed')
        .every((action) => action.kind === 'Reopen' && action.actorRoles.includes('Original')));
    assert.deepEqual(workflowDefinitionErrors(definition, true), []);
    const workflow = { id: 'simple-version', discipline: 'Development', versionNumber: 2, definition };
    const boards = workflowBoards([{ id: 'task', status: 'in-review', workflow }], defaultPresentationGroups);
    assert.deepEqual(boards[0].groups.map((group) => group.name), defaultPresentationGroups.map((group) => group.name));
    assert.deepEqual(boards[0].groups.find((group) => group.id === 'legacy:review').tasks.map((task) => task.id), ['task']);
    assert.equal(taskKind({ status: 'in-review', workflow }), 'Work');
});

test('simple status checks reject duplicates, blank names and an oversized list', () => {
    assert.match(simpleStatusError([{ id: 'first', name: 'To Do' }, { id: 'second', name: 'to do' }]), /unique/i);
    assert.match(simpleStatusError([{ id: 'first', name: '' }, { id: 'second', name: 'Done' }]), /name/i);
    assert.match(simpleStatusError([{ id: 'first', name: 'Only one' }]), /2/);
    assert.match(simpleStatusError(Array.from({ length: 11 }, (_, index) => ({ id: `s-${index}`, name: `Status ${index}` }))), /10/);
});
