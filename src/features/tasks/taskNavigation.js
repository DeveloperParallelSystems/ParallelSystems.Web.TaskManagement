export function taskIdFromPath(pathname) {
    const match = pathname.match(/^\/tasks\/(new|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i);
    if (!match) {
        return null;
    }
    return match[1].toLowerCase();
}

export function shouldBlockTaskNavigation({ dirty, saving }, currentLocation, nextLocation) {
    const changed = currentLocation.pathname !== nextLocation.pathname ||
        currentLocation.search !== nextLocation.search;
    return (dirty || saving) && changed;
}
