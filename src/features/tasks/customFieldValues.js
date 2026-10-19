export const customFieldTypes = ['Text', 'Number', 'Date', 'Checkbox', 'Person'];
const guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validCustomDefinitions(fields) {
    return Array.isArray(fields) && fields.length <= 30 && new Set(fields.map((field) => field.id)).size === fields.length &&
        fields.every((field) => guid.test(field.id) && typeof field.name === 'string' && field.name.trim().length > 0 &&
            field.name.length <= 80 && customFieldTypes.includes(field.type) && typeof field.isArchived === 'boolean');
}

export function customValueError(field, value) {
    if (value === null || value === undefined || value === '') {
        return '';
    }
    if (typeof value !== 'string') {
        return 'Enter a text value.';
    }
    if (field.type === 'Text') {
        return value.length <= 2000 ? '' : 'Use at most 2000 characters.';
    }
    if (field.type === 'Number') {
        const match = value.match(/^[+-]?(\d+)(?:\.(\d+))?$/);
        return match && match[1].replace(/^0+/, '').length <= 20 && (match[2]?.length || 0) <= 8
            ? '' : 'Enter a decimal with at most 20 integer digits and 8 decimal places; exponent notation is not supported.';
    }
    if (field.type === 'Date') {
        const date = /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(`${value}T00:00:00Z`);
        return date && Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value && value.slice(0, 4) !== '0000'
            ? '' : 'Enter a valid date in YYYY-MM-DD format.';
    }
    if (field.type === 'Checkbox') {
        return ['true', 'false'].includes(value) ? '' : 'Choose Yes, No or Not set.';
    }
    if (field.type === 'Person') {
        return guid.test(value) ? '' : 'Select a staff member.';
    }
    return 'This field type is unavailable.';
}

export function customFieldDisplay(field, value, people = []) {
    if (value === null || value === undefined || value === '') {
        return '—';
    }
    if (field.type === 'Checkbox') {
        return value === 'true' ? 'Yes' : 'No';
    }
    if (field.type === 'Person') {
        const person = people.find((candidate) => candidate.id?.toLowerCase() === value.toLowerCase());
        return person ? [person.firstName, person.lastName].filter(Boolean).join(' ') || person.name || 'Staff details unavailable' : 'Staff details unavailable';
    }
    return value;
}

export function projectFieldDraft(drafts, projectId, task) {
    const loaded = task?.projectId === projectId ? Object.fromEntries((task.customFieldValues || []).map((item) => [item.fieldId, item.value ?? ''])) : {};
    return { ...loaded, ...drafts[projectId] };
}

export function customTaskPayload({ projectId, page, revision, values, canEdit, error = null, invalidated = false }) {
    if (!canEdit || !projectId || !Object.keys(values || {}).length) {
        return {};
    }
    if (!page || page.projectId !== projectId || error) {
        throw new Error('Load the project fields successfully before saving the task.');
    }
    if (invalidated || page.version !== revision) {
        throw new Error('Reload the project fields before saving. Their configuration has changed.');
    }
    const customFieldValues = Object.entries(values).map(([fieldId, editedValue]) => {
        const field = page.fields.find((candidate) => candidate.id === fieldId && !candidate.isArchived);
        if (!field) {
            throw new Error('An edited field is no longer available. Reload the project fields before saving.');
        }
        const value = editedValue ?? '';
        const error = customValueError(field, value);
        if (error) {
            throw new Error(`${field.name}: ${error}`);
        }
        return { fieldId, value: value === '' ? null : value };
    });
    return { customFieldVersion: page.version, customFieldValues };
}
