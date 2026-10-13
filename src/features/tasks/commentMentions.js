export function mentionQuery(body, caret, mentions = []) {
    const before = body.slice(0, caret);
    const match = before.match(/(?:^|\s|\()@([^@\n]{0,100})$/);
    if (!match) {
        return null;
    }
    const start = before.lastIndexOf('@');
    if (mentions.some((mention) => mention.start === start)) {
        return null;
    }
    return { start, end: caret, query: match[1].trim() };
}

export function mentionCandidates(people, query, currentUserId) {
    const term = query.trim().toLowerCase();
    const accountId = currentUserId?.toLowerCase();
    return people.filter((person) => {
        if (accountId && person.userId?.toLowerCase() === accountId) {
            return false;
        }
        return `${person.name} ${person.firstName || ''} ${person.lastName || ''} ${person.email || ''}`
            .toLowerCase().includes(term);
    }).slice(0, 8);
}

export function adjustMentions(previous, next, mentions) {
    let start = 0;
    while (start < previous.length && start < next.length && previous[start] === next[start]) {
        start++;
    }
    let suffix = 0;
    while (suffix < previous.length - start && suffix < next.length - start &&
        previous[previous.length - suffix - 1] === next[next.length - suffix - 1]) {
        suffix++;
    }
    const end = previous.length - suffix;
    const shift = next.length - previous.length;
    const adjusted = [];
    for (const mention of mentions) {
        const text = mention.text || previous.slice(mention.start, mention.start + mention.length);
        let position = mention.start;
        if (mention.start >= end) {
            position += shift;
        }
        else if (mention.start + mention.length > start) {
            continue;
        }
        const following = next.slice(position + mention.length, position + mention.length + 2);
        if (next.slice(position, position + mention.length) === text && !/^[\p{L}\p{N}_]/u.test(following)) {
            adjusted.push({ ...mention, start: position, text });
        }
    }
    return adjusted;
}

export function insertMention(body, mentions, range, person) {
    const text = `@${person.name.trim()}`;
    const next = body.slice(0, range.start) + text + ' ' + body.slice(range.end);
    const adjusted = adjustMentions(body, next, mentions);
    adjusted.push({ staffId: person.id, start: range.start, length: text.length, text });
    adjusted.sort((left, right) => left.start - right.start);
    return { body: next, mentions: adjusted, caret: range.start + text.length + 1 };
}

export function commentInput(editor) {
    return {
        body: editor.body,
        parentId: editor.parentId || null,
        version: editor.version || 0,
        mentions: editor.mentions.map(({ staffId, start, length }) => ({ staffId, start, length })),
    };
}

export function commentParts(body, mentions) {
    const parts = [];
    let offset = 0;
    for (const mention of [...mentions].sort((left, right) => left.start - right.start)) {
        if (mention.start < offset || mention.length < 2 || mention.start + mention.length > body.length) {
            continue;
        }
        parts.push({ text: body.slice(offset, mention.start) });
        parts.push({ text: body.slice(mention.start, mention.start + mention.length), mention });
        offset = mention.start + mention.length;
    }
    parts.push({ text: body.slice(offset) });
    return parts;
}

export function mergeComments(current, incoming) {
    const merged = new Map(current.map((comment) => [comment.id, comment]));
    for (const comment of incoming) {
        const previous = merged.get(comment.id);
        if (!previous || comment.version >= previous.version) {
            merged.set(comment.id, comment);
        }
    }
    return [...merged.values()].sort((left, right) => left.id - right.id);
}

export function discussionThreads(comments) {
    const roots = comments.filter((comment) => !comment.parentId);
    const rootIds = new Set(roots.map((comment) => comment.id));
    const threads = roots.map((comment) => ({
        comment, replies: comments.filter((reply) => reply.parentId === comment.id),
    }));
    for (const comment of comments) {
        if (comment.parentId && !rootIds.has(comment.parentId)) {
            threads.push({ comment, replies: [] });
        }
    }
    return threads.sort((left, right) => left.comment.id - right.comment.id);
}
