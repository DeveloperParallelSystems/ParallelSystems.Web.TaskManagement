# Task Management API extensions

Comments, mentions and file attachments were implemented in the frontend and sibling Server repository on 2026-10-13 with explicit approval. Other sections remain proposals. All paths below use `/api/task-management`, the dedicated cookie, no-store responses, and `X-Task-Management: 1` on mutations.

## Common contract

- Task access remains administrator or original assignee/current owner/reviewer/release owner. A mention, follower, dependency, attachment, or shared URL does not grant task access.
- Administrator-only task creation, detail/assignment edits, cancellation/reopening, project creation and configuration remain unchanged. Workflow changes continue to use server-provided `allowedStatuses`.
- Return 401 for invalid sessions, 404 for inaccessible resources, 403 for forbidden operations on accessible resources, 400 for invalid input, and 409 for a stale version. Errors use `{ "message": "..." }`.
- Use GUID task/staff/account IDs and numeric comment IDs, UTC timestamps, optimistic versions, and transactional audit records. Notification inserts share the successful comment transaction; task access is rechecked when notifications are read.
- Resource-specific versions allow comment/checklist edits without unnecessarily conflicting with unrelated task detail edits. None of these proposals change the current task PUT contract until the server and client are coordinated.

## Current payload gap: creator identity

Existing `WorkTaskRecord` responses omit `createdById`, although task creation is recorded by the server. Add `createdById: guid` to existing list/detail task records. This is an additive response field and needs no new endpoint. Return the stored creator, not an inferred assignee or first visible history actor. The frontend disables Created by me until this field is available. Database notes: expose the existing task creator reference; retain its FK and UTC creation time.

## 1. Threaded comments and mentions — implemented

- `GET /tasks/{id}/comments?after=0&limit=50` → `{ items, nextCursor: number|null, mentionablePeople }`. `after` is the last numeric comment ID; limit is 1–50; items are ordered by ID ascending, including deletion tombstones.
- `GET /tasks/{id}/comments/{commentId}` → a single comment, for conflict reload.
- `POST /tasks/{id}/comments` with `{ body, parentId: number|null, mentions: [{ staffId: guid, start: number, length: number }] }` → 201 comment and Location.
- `PUT /tasks/{id}/comments/{commentId}` with `{ body, parentId, mentions, version }` → updated comment; stale versions return 409. Parent cannot change.
- `DELETE /tasks/{id}/comments/{commentId}` with JSON `{ version }` → 204. Soft deletion empties the public body/mentions and preserves replies/history.
- Comment resource: `{ id, parentId, authorId, authorName, body, mentions: [{ staffId, name, email, start, length }], version, deleted, canEdit, canDelete, createdAtUtc, editedAtUtc }`. Author identity is the account; mention identity is staff. `mentionablePeople` provides the existing staff lookup fields, scoped to this task.
- Permissions: current task participants and administrators may comment; author or administrator may edit/delete only while retaining task access. Mention candidates must be Staff Information records linked to other active accounts with existing task access, including linked administrators. The signed-in account is excluded from candidates; self-mentions on create/edit return 400 with `You cannot mention yourself.` for all roles. Mentions never grant access. Newly added distinct recipients get one in-app notification; unchanged mention recipients on edit get none. Inbox permissions are rechecked on read.
- Bounds: plain text, nonblank body, 4,000 characters, at most 20 mention spans. Spans use UTF-16 offsets into exact `@Name` tokens, validated against current staff identity/access inside the transaction. Repeated mentions of one person may have separate spans. Replies target a top-level comment on the same task; retained deleted roots can continue receiving replies.
- DB: `024_work_task_comments.sql`, `025_work_task_comment_mentions.sql`, `026_work_task_comment_history.sql`, `v_WorkTaskMentionPeople`, `sp_WorkTaskCommentsGet/Save`. Task/author/parent/staff/recipient FKs, numeric identity, own version, snapshots, soft deletion and previous-version audit. Comment writes do not change task version/status or replace workflow/review notes. Comment/history/mention notification writes commit together.
- Evidence: sibling Server `Controllers/WorkTaskCommentsController.cs`, `Data/WorkTaskCommentRepository.cs`, `Tests/TaskManagementChecks/DiscussionChecks.cs`; frontend `TaskDiscussion.jsx`, `discussionState.js`, `commentMentions.js`, `tests/comments.test.js`. Discussion does not add email, rich text or comment-bound attachment endpoints.

## 2. File attachments — implemented; external links — proposed

- `GET /tasks/{id}/attachments` → plain array of `{ id, taskId, fileName, contentType, sizeBytes, sha256, uploadedById, uploadedByName, createdAtUtc, version, canDelete }`. Storage location/state are not exposed.
- `POST /tasks/{id}/attachments` multipart `file` + GUID `uploadId` → 201 metadata and Location. Reuse the upload ID on retry for the same file/task/uploader; completed retries are idempotent and failed attempts use new private keys.
- `GET /tasks/{id}/attachments/{attachmentId}/content` → authorized binary download.
- Proposed only: `POST /tasks/{id}/links` with `{ name, url, description }` → 201 link metadata. No external-link UI or endpoint exists.
- `DELETE /tasks/{id}/attachments/{attachmentId}` with `{ version }` → 204.
- Permissions: current task participants/administrators may add and download; uploader or administrator may remove only while retaining current task access. Attachment changes have independent versions and add task History without changing task version/workflow. Invalid input is 400, inaccessible resources 404, forbidden removal 403, conflicts 409, storage failures 503.
- Bounds/storage: non-empty PDF/PNG/JPEG and Word (`.doc`, `.docx`), Excel (`.xls`, `.xlsx`), PowerPoint (`.ppt`, `.pptx`) up to 10 MiB, 12 MiB multipart request cap, validated signatures/extensions/types and sanitized filenames. Modern Office packages additionally require matching content-type metadata and a main document part; legacy formats use the shared compound-file header. Validation is not antivirus scanning or full document decoding. Private Local storage in Development, private S3 otherwise; downloads pass through the API. Soft removal retains bytes/audit indefinitely; failed and abandoned upload attempts have durable background cleanup.
- DB/evidence: `027_work_task_attachments.sql`, `028_work_task_attachment_cleanup.sql`, `sp_WorkTaskAttachmentsGet/Save/Fail/Cleanup.sql`, sibling Server controller/repository/storage services and `AttachmentChecks.cs`; frontend `TaskAttachments.jsx`, `attachmentState.js`, `attachmentValidation.js`, `tests/attachments.test.js`. Real S3/IAM and production deployment remain unverified. For future links, validate HTTPS URLs without fetching arbitrary destinations and store URL/name separately.

## 3. Checklists and subtasks

- `GET /tasks/{id}/checklist` → `{ items: [{ id, title, assigneeId, completed, order, version }] }`.
- `POST /tasks/{id}/checklist` with `{ title, assigneeId, order }` → 201 item (administrator).
- `PUT /tasks/{id}/checklist/{itemId}` with `{ completed, version }` → item; administrator may also submit title/assignee/order.
- `DELETE /tasks/{id}/checklist/{itemId}` with `{ version }` → 204 (administrator).
- `POST /tasks/{id}/subtasks` with the existing task-create fields → 201 child task with `parentTaskId`. `GET /tasks/{id}/subtasks` → accessible child records.
- Permissions: participant can toggle an accessible checklist item; administrator manages structure and creates subtasks. Child task access uses its own participants, without exposing inaccessible children through parent counts/titles. Parent completion must not silently complete children; define any completion gate explicitly in the server workflow.
- DB: checklist table with task/assignee FKs, sort order and version; nullable parent-task FK for full subtasks, cycle prevention and indexed parent ID. Do not add checklist statuses to the existing workflow enum.

## 4. Watchers/followers

- `GET /tasks/{id}/followers` → `{ following: boolean, items: [{ userId, name }] }`.
- `PUT /tasks/{id}/followers/me` with `{ following: boolean }` → `{ following }`.
- `PUT /tasks/{id}/followers/{userId}` with `{ following }` → follower state (administrator only).
- Permissions: only people who already have task access may follow. Following never grants visibility. Ordinary participants may see current authorized followers; administrative changes may only add eligible users. Removed/deactivated participants stop receiving updates.
- DB: unique `(task_id, user_id)` follower rows and event subscriptions; notifications deduplicated with direct assignee/mention recipients. Cleanup or suppress invalid followers on reassignment.

## 5. Labels and configurable disciplines

- `GET /labels` → `{ items: [{ id, name, color, active, version }] }`.
- `POST /labels` with `{ name, color }` → 201 label; `PUT /labels/{id}` with `{ name, color, active, version }` → label (administrator).
- `PUT /tasks/{id}/labels` with `{ labelIds: [guid], version }` → updated task labels/version (administrator).
- `GET /disciplines` → `{ items: [{ id, name, active, version }] }`.
- `POST /disciplines` with `{ name }` → 201; `PUT /disciplines/{id}` with `{ name, active, version }` → discipline (administrator).
- Permissions: administrators configure and apply metadata; ordinary users may read metadata used by their accessible tasks. Deactivate used definitions instead of removing references.
- DB: label definitions + unique task-label join; discipline definitions with stable IDs. Migrate Development/Drafting without losing existing task values, change server enum validation deliberately, and expose compatible display names during migration. Phase 1 uses the existing shared frontend discipline constant.

## 6. Planning fields and Timesheet links

- Extend task list/detail with `{ startDate: "YYYY-MM-DD"|null, estimateMinutes: number|null }` and existing PUT input with those fields plus version.
- `GET /tasks/{id}/timesheet-links` → `{ items: [{ entryId, userId, date, durationMinutes }], totalMinutes }` for entries the caller may see.
- `POST /tasks/{id}/timesheet-links` with `{ entryId: guid }` → 201 association; `DELETE /tasks/{id}/timesheet-links/{entryId}` → 204.
- Permissions: only administrators edit start/estimate. Linking requires access to both task and existing Timesheet entry; ordinary users can link/unlink their own entries, administrators only entries they are independently authorized to manage. Task login does not imply Timesheet login or broader Timesheet data access.
- DB: date start column, nonnegative integer estimate with defined upper limit, task-entry association with uniqueness and FKs to confirmed Timesheet schema. Enforce valid date ordering and preserve existing time records. Resolve actual Timesheet entry identity/authorization in the server before exposing the integration.

## 7. Dependencies (blocked by)

- `GET /tasks/{id}/dependencies` → `{ blockedBy: [{ taskId, code, title, status }], blocks: [...] }`, returning only accessible linked tasks.
- `POST /tasks/{id}/dependencies` with `{ blockedByTaskId, version }` → updated dependencies/task version (administrator).
- `DELETE /tasks/{id}/dependencies/{blockingTaskId}` with `{ version }` → updated version (administrator).
- Permissions: task participants read accessible links; administrator manages edges with access to both tasks. Do not reveal inaccessible task identities through dependency lists. Reject self-links and cycles. Dependencies do not automatically change workflow status; any future gate must be reflected in server-provided allowed statuses.
- DB: directed edge table with unique pair/FKs and both-direction indexes; transactional cycle checks and audit. Define Completed/Cancelled dependency semantics before enabling workflow gates.

## 8. Email/digests and due reminders

- `GET /notification-preferences` → `{ emailEnabled, digestFrequency: "off"|"daily"|"weekly", timeZone, dueSoonDays, overdueEnabled, version }`.
- `PUT /notification-preferences` with the same fields/version → saved preferences for the caller.
- `GET /admin/notification-delivery` → delivery configuration/status (administrator, no secrets); `PUT /admin/notification-delivery` with validated sender/schedule/provider settings → configuration status (administrator).
- Reminder events reuse existing inbox records and may be delivered by email when the recipient opts in. Notification responses add `{ type, eventId }` so clients can distinguish assignment, review, mention, due-soon and overdue events.
- Permissions: own preferences only; server uses verified account email and current task access. No email is sent for historical notifications without an explicit delivery policy. Users can opt out, and administrator setup does not grant task visibility.
- DB: user preference/version rows, transactional event outbox, delivery attempts, retry/dead-letter status, deduplication `(recipient, task, reminder_type, local_date)` and digest grouping. Schedule in configured IANA time zones; suppress closed/cancelled work and inactive recipients. Provider configuration and secrets belong to server deployment settings.

## 9. Server pagination, search and sorting

- Proposed opt-in `GET /tasks?pageSize=50&cursor=&q=&discipline=&status=&projectId=&quickView=&sort=updatedAtUtc&direction=desc` → `{ items: [task], nextCursor, totalCount, summary: { total, inProgress, inReview, completed } }`.
- Proposed opt-in `GET /notifications?pageSize=50&cursor=&q=&read=all|unread&sort=createdAtUtc&direction=desc` → `{ items: [notification], nextCursor, unreadCount }`.
- Keep existing unpaged responses compatible until callers migrate; alternatively introduce a separately versioned contract. Do not silently replace the existing task array with an envelope.
- Permissions: apply actor visibility before search, counts, sort and pagination; quick views derive the actor from the cookie, not a submitted user ID. Creator view requires `createdById`. Searches include descriptions and authorized participant display names. Whitelist sort keys/directions; parameterize values.
- DB: stable cursor ordering with unique ID tie-breaker, indexes for assignee/reviewer/release owner/creator, dates and status. Consider full-text indexing only after measuring search volume. Define page-size cap, cursor validation and time-zone semantics for overdue. Dashboard aggregate counts must not depend on the current page.

## 10. Live updates

- `GET /events` → cookie-authenticated SSE (`text/event-stream`) with heartbeat and events `{ eventId, type: "task.changed"|"notification.changed"|"access.changed", taskId?: guid, version?: number }`. Alternatively a dedicated SignalR hub at `/events/hub`; choose one transport during backend implementation.
- Support reconnection via `Last-Event-ID` and a reset event if replay retention is exceeded. Events signal clients to refresh authorized data; they must not carry task descriptions/account data to unauthorized subscribers.
- Permissions: dedicated Task Management authentication only. Re-evaluate current membership for events and immediately signal removal without exposing inaccessible task content. End streams on session invalidation/deactivation; do not put access tokens in URL queries.
- DB: transactional event outbox or durable change log, bounded replay cursor retention and multi-instance fan-out. Publish after commit, including notification read changes. Define reverse-proxy buffering/timeouts and heartbeat limits. Keep focus/manual refresh and a polling fallback for disconnected clients until live delivery is verified.

## Adoption gates

The remaining proposals need coordinated server implementation, migration tests, authorization/visibility tests, a documented payload, and integration verification before UI development. The frontend calls only implemented task, notification, discussion and attachment contracts.
