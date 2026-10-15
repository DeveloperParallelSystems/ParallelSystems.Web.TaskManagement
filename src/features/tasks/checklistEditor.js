export function blankChecklistEditor() {
    return { id: null, title: '', originalTitle: '', version: 0 };
}

export function finishChecklistReload(current, started) {
    // Discard only the draft that was present when the user requested reload.
    // A slower response must not erase text entered while the read was pending.
    if (current !== started) {
        return current;
    }
    return blankChecklistEditor();
}
