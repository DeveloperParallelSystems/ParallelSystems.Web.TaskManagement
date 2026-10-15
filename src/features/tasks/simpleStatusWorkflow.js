export const simpleStatusLimit = 10;

const slug = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const statusColors = ['blue', 'amber', 'purple', 'gray', 'red'];

export function simpleStatusError(statuses) {
    if (!Array.isArray(statuses) || statuses.length < 2 || statuses.length > simpleStatusLimit) {
        return `Configure 2 to ${simpleStatusLimit} statuses.`;
    }
    const ids = new Set();
    const names = new Set();
    for (const status of statuses) {
        if (!status || typeof status.id !== 'string' || status.id.length > 30 || !slug.test(status.id) || ids.has(status.id)) {
            return 'Status IDs must be unique lowercase slugs up to 30 characters.';
        }
        if (typeof status.name !== 'string' || !status.name.trim() || status.name.trim().length > 80) {
            return 'Each status needs a name of 1 to 80 characters.';
        }
        const name = status.name.trim().toUpperCase();
        if (names.has(name)) {
            return 'Status names must be unique.';
        }
        ids.add(status.id);
        names.add(name);
    }
    return null;
}

export function buildSimpleStatusDefinition(discipline, statuses) {
    const stages = statuses.map((status, index) => ({
        id: status.id,
        name: status.name.trim(),
        kind: index === statuses.length - 1 ? 'Completed' : 'Work',
        color: index === statuses.length - 1 ? 'green' : statusColors[index % statusColors.length],
        ownerRole: index === statuses.length - 1 ? 'None' : 'Original',
    }));
    const transitions = stages.flatMap((source, sourceIndex) => stages.flatMap((target, targetIndex) => {
        if (sourceIndex === targetIndex) {
            return [];
        }
        return [{
            id: `move-${sourceIndex + 1}-${targetIndex + 1}`,
            name: `Move to ${target.name}`,
            fromStageId: source.id,
            toStageId: target.id,
            kind: sourceIndex === stages.length - 1 ? 'Reopen' : targetIndex === stages.length - 1 ? 'Complete' : 'Progress',
            actorRoles: ['Original', 'Owner'],
            requireNote: false,
        }];
    }));
    return {
        mode: 'Simple',
        name: `${discipline} statuses`,
        startStageId: stages[0]?.id || '',
        stages,
        transitions,
    };
}

export function simpleDefinitionErrors(definition, publishing) {
    const stages = definition.stages || [];
    const actions = definition.transitions || [];
    const errors = [];
    if (stages.length > simpleStatusLimit) {
        errors.push(`Simple workflows support up to ${simpleStatusLimit} statuses.`);
    }
    if (!publishing) {
        return errors;
    }
    const statusError = simpleStatusError(stages);
    if (statusError) {
        errors.push(statusError);
        return errors;
    }
    if (definition.startStageId !== stages[0]?.id) {
        errors.push('The first status must be the starting status.');
    }
    for (const [index, stage] of stages.entries()) {
        const final = index === stages.length - 1;
        if (stage?.kind !== (final ? 'Completed' : 'Work') || stage?.ownerRole !== (final ? 'None' : 'Original')) {
            errors.push('Simple statuses must keep the original assignee until the final status.');
            break;
        }
    }
    if (actions.length !== stages.length * (stages.length - 1)) {
        errors.push('Every status must be reachable from every other status.');
    }
    for (const [sourceIndex, source] of stages.entries()) {
        for (const [targetIndex, target] of stages.entries()) {
            if (sourceIndex === targetIndex) {
                continue;
            }
            const matches = actions.filter((action) => action?.fromStageId === source.id && action.toStageId === target.id);
            const expected = sourceIndex === stages.length - 1 ? 'Reopen' : targetIndex === stages.length - 1 ? 'Complete' : 'Progress';
            if (matches.length !== 1 || matches[0].kind !== expected || matches[0].requireNote ||
                !Array.isArray(matches[0].actorRoles) || matches[0].actorRoles.length !== 2 ||
                !matches[0].actorRoles.includes('Original') || !matches[0].actorRoles.includes('Owner')) {
                errors.push('Every status move must use the standard participant permissions.');
                return errors;
            }
        }
    }
    return errors;
}
