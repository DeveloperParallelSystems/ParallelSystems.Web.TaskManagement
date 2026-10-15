export function catalogDeleteReason(settings, tasks, code) {
    if (code === 'To Do') {
        return 'Required default for both disciplines.';
    }
    if (tasks.some((task) => task.status === code)) {
        return 'In use by tasks. Move those tasks to another status first.';
    }
    if (settings.disciplines.some((item) => item.statuses.includes(code))) {
        return 'Assigned to a discipline. Remove the assignment under Discipline statuses first.';
    }
    return '';
}

export function saveCatalogName(settings, { code = null, name }) {
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 80) {
        throw new Error('Enter a status name up to 80 characters.');
    }
    if (code === 'To Do') {
        throw new Error('To Do is the required default and cannot be renamed.');
    }
    if (settings.catalog.some((item) => item.code !== code && item.name.trim().toLowerCase() === trimmed.toLowerCase())) {
        throw new Error('Enter a unique status name.');
    }
    if (code) {
        if (!settings.catalog.some((item) => item.code === code)) {
            throw new Error('This status is no longer available. Reload the catalog.');
        }
        return { ...settings, catalog: settings.catalog.map((item) => item.code === code ? { ...item, name: trimmed } : item) };
    }
    const base = trimmed.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 27);
    if (!base) {
        throw new Error('Use letters or numbers in the status name.');
    }
    let newCode = base;
    let suffix = 2;
    while (settings.catalog.some((item) => item.code === newCode)) {
        newCode = `${base}-${suffix}`;
        suffix++;
    }
    return { ...settings, catalog: [...settings.catalog, { code: newCode, name: trimmed, boardStatus: 'In Progress', isCustom: true }] };
}

export function removeCatalogStatus(settings, tasks, code) {
    const reason = catalogDeleteReason(settings, tasks, code);
    if (reason) {
        throw new Error(reason);
    }
    return { ...settings, catalog: settings.catalog.filter((item) => item.code !== code) };
}
