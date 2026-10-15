import { disciplines, statuses } from './workflow.js';
import { validMonth } from './calendar.js';

export const quickViews = [
    ['', 'All visible work'],
    ['my-work', 'My work'],
    ['my-open', 'My open work'],
    ['due-week', 'Due this week'],
    ['review', 'Needs my review'],
    ['releases', 'My releases'],
    ['created', 'Created by me'],
    ['overdue', 'Overdue'],
];
export const sortOptions = [['dueDate', 'Due date'], ['priority', 'Priority'], ['updatedAtUtc', 'Last updated'], ['title', 'Title']];
export const defaultTaskQuery = {
    search: '', discipline: '', status: '', projectId: '', mine: false, labelIds: [],
    quickView: '', sort: 'updatedAtUtc', direction: 'desc', view: 'board', assigneeId: '', month: '',
};
const keys = {
    search: 'q', discipline: 'discipline', status: 'status', projectId: 'project',
    mine: 'mine', quickView: 'quick', sort: 'sort', direction: 'dir', view: 'view',
    assigneeId: 'assignee', month: 'month',
};

export function parseTaskQuery(query) {
    const params = new URLSearchParams(query);
    const state = { ...defaultTaskQuery };
    for (const [name, key] of Object.entries(keys)) {
        if (params.has(key)) {
            state[name] = params.get(key);
        }
    }
    state.mine = params.get('mine') === '1';
    state.assigneeId = state.assigneeId.toLowerCase();
    if (state.assigneeId !== 'unassigned' && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(state.assigneeId)) {
        state.assigneeId = '';
    }
    if (!validMonth(state.month)) {
        state.month = '';
    }
    state.labelIds = [...new Set((params.get('label') || '').toLowerCase().split(',')
        .filter((id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)))];
    if (!disciplines.includes(state.discipline)) {
        state.discipline = '';
    }
    if (!statuses.includes(state.status) && !/^status:[^\r\n]{1,30}$/.test(state.status) &&
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[a-z0-9-]{1,30}$/.test(state.status)) {
        state.status = '';
    }
    if (!quickViews.some(([value]) => value === state.quickView)) {
        state.quickView = '';
    }
    if (!sortOptions.some(([value]) => value === state.sort)) {
        state.sort = defaultTaskQuery.sort;
    }
    if (!['asc', 'desc'].includes(state.direction)) {
        state.direction = defaultTaskQuery.direction;
    }
    if (!['board', 'list', 'calendar'].includes(state.view)) {
        state.view = defaultTaskQuery.view;
    }
    return state;
}

export function serializeTaskQuery(state, existing = '') {
    const params = new URLSearchParams(existing);
    params.delete('label');
    if (state.labelIds?.length) {
        params.set('label', state.labelIds.join(','));
    }
    for (const [name, key] of Object.entries(keys)) {
        params.delete(key);
        const value = state[name];
        if (value !== undefined && value !== defaultTaskQuery[name] && value !== '') {
            params.set(key, name === 'mine' ? (value ? '1' : '0') : value);
        }
    }
    return params.toString();
}
