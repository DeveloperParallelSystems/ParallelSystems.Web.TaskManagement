import { disciplines, statuses } from './workflow.js';

export const quickViews = [
    ['', 'All visible work'],
    ['my-work', 'My work'],
    ['review', 'Needs my review'],
    ['releases', 'My releases'],
    ['created', 'Created by me'],
    ['overdue', 'Overdue'],
];
export const sortOptions = [['dueDate', 'Due date'], ['priority', 'Priority'], ['updatedAtUtc', 'Last updated'], ['title', 'Title']];
export const defaultTaskQuery = {
    search: '', discipline: '', status: '', projectId: '', mine: false,
    quickView: '', sort: 'updatedAtUtc', direction: 'desc', view: 'board',
};
const keys = {
    search: 'q', discipline: 'discipline', status: 'status', projectId: 'project',
    mine: 'mine', quickView: 'quick', sort: 'sort', direction: 'dir', view: 'view',
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
    if (!disciplines.includes(state.discipline)) {
        state.discipline = '';
    }
    if (!statuses.includes(state.status)) {
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
    if (!['board', 'list'].includes(state.view)) {
        state.view = defaultTaskQuery.view;
    }
    return state;
}

export function serializeTaskQuery(state, existing = '') {
    const params = new URLSearchParams(existing);
    for (const [name, key] of Object.entries(keys)) {
        params.delete(key);
        const value = state[name];
        if (value !== undefined && value !== defaultTaskQuery[name] && value !== '') {
            params.set(key, name === 'mine' ? (value ? '1' : '0') : value);
        }
    }
    return params.toString();
}
