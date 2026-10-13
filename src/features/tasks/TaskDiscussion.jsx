import { useEffect, useId, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { MessageSquare, Pencil, RefreshCw, Reply, Send, Trash2, X } from 'lucide-react';
import { loadWorkspace } from '../../app/store';
import { initials, staffOptionLabel } from './workflow';
import { adjustMentions, commentInput, commentParts, discussionThreads, insertMention,
    mentionCandidates, mentionQuery } from './commentMentions';
import { deleteTaskComment, loadTaskComment, loadTaskComments, saveTaskComment } from './discussionState';

function blankEditor(parentId = null) {
    return { id: null, parentId, body: '', mentions: [], version: 0, initialBody: '', initialMentions: '[]' };
}

function editComment(comment, people) {
    const mentions = comment.mentions.filter((mention) => people.some((person) => person.id === mention.staffId));
    return { ...comment, initialBody: comment.body, mentions, initialMentions: JSON.stringify(commentInput({ ...comment, mentions }).mentions) };
}

export default function TaskDiscussion({ taskId, onEditingChange }) {
    const dispatch = useDispatch();
    const discussion = useSelector((state) => state.workspace.discussions[taskId]);
    const user = useSelector((state) => state.auth.user);
    const [editor, setEditor] = useState(blankEditor);
    const [caret, setCaret] = useState(0);
    const [pickerDismissed, setPickerDismissed] = useState(false);
    const [activeOption, setActiveOption] = useState(0);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    const [message, setMessage] = useState('');
    const [deleting, setDeleting] = useState(null);
    const [confirmAction, setConfirmAction] = useState(null);
    const editorRef = useRef(null);
    const deleteRef = useRef(null);
    const draftConfirmRef = useRef(null);
    const pendingCaret = useRef(null);
    const pickerId = useId();
    const people = discussion?.mentionablePeople || [];
    const dirty = editor.body !== editor.initialBody || JSON.stringify(commentInput(editor).mentions) !== editor.initialMentions;
    const range = mentionQuery(editor.body, caret, editor.mentions);
    const candidates = range ? mentionCandidates(people, range.query, user?.userId) : [];
    const pickerOpen = Boolean(range && !pickerDismissed && candidates.length && editor.mentions.length < 20);
    const selectedOption = Math.min(activeOption, Math.max(0, candidates.length - 1));

    useEffect(() => {
        if (!discussion) {
            dispatch(loadTaskComments({ taskId }));
        }
    }, [discussion, dispatch, taskId]);

    useEffect(() => {
        function refresh() {
            if (!dirty && !busy) {
                dispatch(loadTaskComments({ taskId }));
            }
        }
        const timer = window.setInterval(() => {
            if (document.visibilityState === 'visible') {
                refresh();
            }
        }, 60000);
        window.addEventListener('focus', refresh);
        return () => {
            window.clearInterval(timer);
            window.removeEventListener('focus', refresh);
        };
    }, [dispatch, taskId, dirty, busy]);

    useEffect(() => {
        onEditingChange({ dirty, saving: busy });
    }, [dirty, busy, onEditingChange]);

    useEffect(() => {
        return () => {
            onEditingChange({ dirty: false, saving: false });
        };
    }, [onEditingChange]);

    useEffect(() => {
        if (pendingCaret.current !== null) {
            editorRef.current?.focus();
            editorRef.current?.setSelectionRange(pendingCaret.current, pendingCaret.current);
            pendingCaret.current = null;
        }
    }, [editor]);

    useEffect(() => {
        if (deleting) {
            deleteRef.current?.showModal();
        }
    }, [deleting]);

    useEffect(() => {
        if (confirmAction) {
            draftConfirmRef.current?.showModal();
        }
    }, [confirmAction]);

    function applyEditor(next) {
        setEditor(next);
        setCaret(next.body.length);
        setPickerDismissed(true);
        setError(null);
        setMessage('');
        pendingCaret.current = next.body.length;
        editorRef.current?.focus();
    }

    function replaceEditor(next) {
        if (dirty) {
            setConfirmAction({ kind: 'replace', next });
        }
        else {
            applyEditor(next);
        }
    }

    function requestReload() {
        if (dirty && editor.id === error.commentId) {
            setConfirmAction({ kind: 'reload' });
        }
        else {
            reloadComment();
        }
    }

    function keepDraft() {
        draftConfirmRef.current?.close();
        setConfirmAction(null);
    }

    function discardDraft() {
        const action = confirmAction;
        keepDraft();
        if (action.kind === 'reload') {
            reloadComment();
        }
        else {
            applyEditor(action.next);
        }
    }

    function changeBody(event) {
        const body = event.target.value;
        const position = event.target.selectionStart;
        setEditor((current) => ({ ...current, body, mentions: adjustMentions(current.body, body, current.mentions) }));
        setCaret(position);
        setPickerDismissed(false);
        setActiveOption(0);
        setMessage('');
    }

    function choose(person) {
        if (!range || editor.mentions.length >= 20) {
            return;
        }
        const inserted = insertMention(editor.body, editor.mentions, range, person);
        if (inserted.body.length > 4000) {
            setError({ message: 'This mention would exceed the 4,000-character limit.' });
            return;
        }
        setEditor((current) => ({ ...current, body: inserted.body, mentions: inserted.mentions }));
        pendingCaret.current = inserted.caret;
        setCaret(inserted.caret);
        setPickerDismissed(true);
    }

    function editorKey(event) {
        if (!pickerOpen) {
            return;
        }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            const step = event.key === 'ArrowDown' ? 1 : -1;
            setActiveOption((selectedOption + step + candidates.length) % candidates.length);
        }
        else if (event.key === 'Enter') {
            event.preventDefault();
            choose(candidates[selectedOption]);
        }
        else if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            setPickerDismissed(true);
        }
    }

    async function submit(event) {
        event.preventDefault();
        if (busy || !editor.body.trim()) {
            return;
        }
        setBusy(true);
        setError(null);
        try {
            await dispatch(saveTaskComment({ taskId, id: editor.id, values: commentInput(editor) })).unwrap();
            let savedMessage = 'Comment posted.';
            if (editor.id) {
                savedMessage = 'Comment updated.';
            }
            else if (editor.parentId) {
                savedMessage = 'Reply posted.';
            }
            setMessage(savedMessage);
            setEditor(blankEditor());
            setPickerDismissed(true);
            dispatch(loadWorkspace());
        }
        catch (failure) {
            setError({ ...failure, commentId: editor.id });
        }
        finally {
            setBusy(false);
        }
    }

    async function reloadComment() {
        setBusy(true);
        try {
            const latest = await dispatch(loadTaskComment({ taskId, id: error.commentId })).unwrap();
            if (editor.id === latest.id) {
                setEditor(latest.deleted ? blankEditor() : editComment(latest, people));
            }
            setError(null);
            setMessage('Latest comment loaded.');
        }
        catch (failure) {
            setError({ ...failure, commentId: error.commentId });
        }
        finally {
            setBusy(false);
        }
    }

    async function removeComment() {
        setBusy(true);
        setError(null);
        try {
            await dispatch(deleteTaskComment({ taskId, id: deleting.id, version: deleting.version })).unwrap();
            if (editor.id === deleting.id) {
                setEditor(blankEditor());
            }
            setMessage('Comment deleted. Replies are retained.');
            dispatch(loadWorkspace());
        }
        catch (failure) {
            setError({ ...failure, commentId: deleting.id });
        }
        finally {
            setDeleting(null);
            setBusy(false);
        }
    }

    function renderComment(comment, isReply = false) {
        return (
            <article key={comment.id} className={`discussion-comment ${isReply ? 'discussion-reply' : ''}`}>
                <span className="avatar comment-avatar" aria-hidden="true">{initials(comment.authorName)}</span>
                <div className="comment-content">
                    <div className="comment-heading">
                        <strong>{comment.authorName}</strong>
                        <time dateTime={comment.createdAtUtc}>{new Date(comment.createdAtUtc).toLocaleString()}</time>
                        {!comment.deleted && comment.editedAtUtc && <span className="muted" title={new Date(comment.editedAtUtc).toLocaleString()}>Edited</span>}
                    </div>
                    {comment.deleted ? <p className="muted">This comment was deleted.</p> : (
                        <p className="comment-body">
                            {commentParts(comment.body, comment.mentions).map((part, index) => part.mention ? (
                                <mark className="comment-mention" key={index} title={`${part.mention.name}${part.mention.email ? ` <${part.mention.email}>` : ''}`}>
                                    {part.text}
                                </mark>
                            ) : <span key={index}>{part.text}</span>)}
                        </p>
                    )}
                    {!comment.deleted && (
                        <div className="comment-actions">
                            <button type="button" className="text-button" disabled={busy} onClick={() => replaceEditor(blankEditor(comment.parentId || comment.id))}>
                                <Reply size={13} /> Reply
                            </button>
                            {comment.canEdit && (
                                <button type="button" className="text-button" disabled={busy} onClick={() => replaceEditor(editComment(comment, people))}>
                                    <Pencil size={13} /> Edit
                                </button>
                            )}
                            {comment.canDelete && (
                                <button type="button" className="text-button" disabled={busy} onClick={() => setDeleting(comment)}>
                                    <Trash2 size={13} /> Delete
                                </button>
                            )}
                        </div>
                    )}
                </div>
            </article>
        );
    }

    let composerTitle = 'Add a comment';
    if (editor.id) {
        composerTitle = 'Edit comment';
    }
    else if (editor.parentId) {
        const parent = discussion?.items.find((comment) => comment.id === editor.parentId);
        composerTitle = `Reply to ${parent?.authorName || 'comment'}`;
    }

    return (
        <section className="panel task-discussion" aria-labelledby="discussion-title">
            <div className="panel-heading">
                <h2 id="discussion-title"><MessageSquare size={17} /> Discussion</h2>
                <button type="button" className="text-button" disabled={busy || discussion?.status === 'loading'}
                    onClick={() => dispatch(loadTaskComments({ taskId }))}>
                    <RefreshCw size={14} /> Refresh discussion
                </button>
            </div>
            {discussion?.error && <div className="error" role="alert">{discussion.error}</div>}
            {error && (
                <div className="error" role="alert">
                    {error.message || 'Unable to save comment.'}
                    {error.status === 409 && (
                        <button type="button" className="text-button" disabled={busy} onClick={requestReload}>Reload latest comment</button>
                    )}
                </div>
            )}
            {message && <p className="muted" role="status">{message}</p>}
            {!discussion?.hasLoaded && discussion?.status !== 'error' && <p className="muted" role="status">Loading discussion…</p>}
            {discussion?.hasLoaded && (
                <>
                    <form className="comment-composer" onSubmit={submit} aria-busy={busy}>
                        <div className="comment-composer-heading">
                            <span className="avatar comment-avatar" aria-hidden="true">{initials(user?.name)}</span>
                            <strong>{composerTitle}</strong>
                            {(editor.id || editor.parentId) && (
                                <button type="button" className="text-button" disabled={busy} onClick={() => replaceEditor(blankEditor())}>
                                    <X size={14} /> Cancel
                                </button>
                            )}
                        </div>
                        <div className="mention-editor">
                            <label className="field">
                                <span>Comment</span>
                                <textarea
                                    ref={editorRef}
                                    rows={4}
                                    maxLength={4000}
                                    required
                                    disabled={busy}
                                    value={editor.body}
                                    aria-autocomplete="list"
                                    aria-haspopup="listbox"
                                    aria-expanded={pickerOpen}
                                    aria-controls={pickerOpen ? pickerId : undefined}
                                    aria-activedescendant={pickerOpen ? `${pickerId}-${selectedOption}` : undefined}
                                    aria-describedby={`${pickerId}-help`}
                                    onChange={changeBody}
                                    onKeyDown={editorKey}
                                    onSelect={(event) => setCaret(event.target.selectionStart)}
                                    onBlur={() => setPickerDismissed(true)}
                                    placeholder="Write a comment. Type @ to mention staff…"
                                />
                            </label>
                            {pickerOpen && (
                                <ul className="mention-picker" id={pickerId} role="listbox" aria-label="Mention staff">
                                    {candidates.map((person, index) => (
                                        <li key={person.id} id={`${pickerId}-${index}`} role="option" aria-selected={index === selectedOption}
                                            onPointerDown={(event) => event.preventDefault()} onClick={() => choose(person)}>
                                            <span className="avatar comment-avatar" aria-hidden="true">{initials(person.name)}</span>
                                            <span>{staffOptionLabel(person)}</span>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                        <div className="comment-composer-footer">
                            <span className="muted" id={`${pickerId}-help`}>
                                Type @ and select other staff to notify them. Only active linked accounts with task access appear.
                            </span>
                            <button className="button primary" disabled={busy || !editor.body.trim()}>
                                <Send size={14} /> {busy ? 'Saving…' : editor.id ? 'Save comment' : 'Post comment'}
                            </button>
                        </div>
                        {range && !pickerDismissed && !candidates.length && <p className="muted" role="status">No eligible staff match.</p>}
                        {editor.mentions.length >= 20 && <p className="muted">A comment can contain up to 20 selected mentions.</p>}
                        {dirty && <p className="muted comment-draft-status" role="status">Draft not saved</p>}
                    </form>
                    <div className="discussion-threads" aria-label="Task comments">
                        {!discussion.items.length && <p className="muted">No comments yet. Start the discussion.</p>}
                        {discussionThreads(discussion.items).map(({ comment, replies }) => (
                            <div className="discussion-thread" key={comment.id}>
                                {renderComment(comment)}
                                {replies.map((reply) => renderComment(reply, true))}
                            </div>
                        ))}
                    </div>
                    {discussion.nextCursor !== null && (
                        <button type="button" className="button" disabled={discussion.status === 'loading' || busy}
                            onClick={() => dispatch(loadTaskComments({ taskId, after: discussion.nextCursor }))}>
                            {discussion.status === 'loading' ? 'Loading…' : 'Load more comments'}
                        </button>
                    )}
                </>
            )}
            {deleting && (
                <dialog ref={deleteRef} className="project-dialog" aria-labelledby="delete-comment-title"
                    aria-describedby="delete-comment-description" onCancel={(event) => {
                        event.preventDefault();
                        if (!busy) {
                            setDeleting(null);
                        }
                    }}>
                    <div className="drawer-body">
                        <h2 id="delete-comment-title">Delete this comment?</h2>
                        <p id="delete-comment-description">Its text will be removed from the discussion. Replies will remain.</p>
                        {editor.id === deleting.id && dirty && <p>Unsaved edits to this comment will also be discarded.</p>}
                    </div>
                    <div className="drawer-footer">
                        <button type="button" className="button" autoFocus disabled={busy} onClick={() => setDeleting(null)}>Keep comment</button>
                        <button type="button" className="button primary" disabled={busy} onClick={removeComment}>Delete comment</button>
                    </div>
                </dialog>
            )}
            {confirmAction && (
                <dialog ref={draftConfirmRef} className="project-dialog" aria-labelledby="discard-comment-title"
                    aria-describedby="discard-comment-description" onCancel={(event) => {
                        event.preventDefault();
                        keepDraft();
                    }}>
                    <div className="drawer-body">
                        <h2 id="discard-comment-title">Discard your unsaved comment?</h2>
                        <p id="discard-comment-description">
                            {confirmAction.kind === 'reload' ? 'Load the latest saved comment and discard your edits.' :
                                'Your current comment draft will be lost.'}
                        </p>
                    </div>
                    <div className="drawer-footer">
                        <button type="button" className="button" autoFocus onClick={keepDraft}>Keep editing</button>
                        <button type="button" className="button primary" onClick={discardDraft}>
                            {confirmAction.kind === 'reload' ? 'Reload comment' : 'Discard draft'}
                        </button>
                    </div>
                </dialog>
            )}
        </section>
    );
}
