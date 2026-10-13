# Parallel Systems Task Management

React (JavaScript), Redux Toolkit, and Vite frontend for the Task Management module in `ParallelSystems.Server`. The supplied HTML in `reference/` is the design reference. Application data is stored in SQL Server through the API.

## Run locally

Requires Node.js 22.12 or newer, .NET 8, and the existing server's configured SQL Server connection.

Start the updated API from the `ParallelSystems.Server` directory:

```powershell
dotnet run --project ParallelSystems.Api.csproj --launch-profile http
```

The server's normal database initializer installs the task table scripts `021`–`026` and the `sp_WorkTasks*.sql`, `sp_WorkTaskNotifications*.sql`, and `sp_WorkTaskComments*.sql` procedures on startup. Use an appropriate development database when developing.

In this frontend directory:

```powershell
npm ci
npm run dev
```

Open `http://127.0.0.1:5174/task-management/`. Vite forwards only `/api/task-management` to `http://localhost:5185`. Set `PARALLEL_SYSTEMS_API_PROXY` before starting Vite if the API uses another address. Port 5174 is strict so another app does not silently receive the wrong port.

Enter your username or Staff Information email first. An existing account opens the password step. A unique staff email without an account opens Create account; choose a username and matching passwords (minimum eight characters). The server creates an active standard `User` account linked to that staff record, then the screen asks you to sign in. Task Management has its own login session; Timesheet/Receipts cookies cannot sign you into this app. No sample tasks/accounts are seeded in application databases.

## First version

- Username/email-first login and staff self-registration. Unknown or ambiguous emails cannot register; inactive accounts cannot be replaced or reactivated through registration. Role, staff identity and account name are determined by the server. Existing username/password login remains available through the password step.
- Dashboard, grouped task board, list view, search, discipline/status/project filters, and Assigned to me.
- Board/list sorting by due date, priority, last updated, or title in either direction. Missing dates stay last. Search also matches descriptions and owner/reviewer/release-owner names from existing lookups.
- Quick views: My work (current owner), Needs my review (reviewer in active review stages), My releases, and Overdue. Created by me is unavailable with the current API because task responses omit `createdById`; its filter is ready for that additive field, without inferring creators.
- Search, filters, quick view, sorting, and board/list mode live in URL query parameters. Reload and shared task links retain them. No task/account data is stored in browser storage.
- Board cards can be dragged to explicit status targets; permissions load lazily from task details and are cached in memory by version. Invalid/loading targets are disabled. A keyboard-accessible Move to… menu provides the same transitions. Approval/failure decisions open the task page and require a note; changes use existing versioned task PUT requests.
- Keyboard shortcuts: C opens the create-task page for administrators from workspace overview pages, / focuses task search, and Escape returns from a task page with unsaved-change protection. C and / are ignored while editing fields or while a dialog is open.
- Dashboard includes overdue counts by current owner and active waiting-on-review counts, using only the caller's visible tasks.
- Administrators can select filtered list rows and bulk reassign the current owner or set/clear due dates. Each task loads full details and saves separately with its selected version; results identify conflicts and other failures per task. There is no all-or-nothing batch endpoint.
- Export CSV downloads the currently filtered/sorted tasks, including descriptions and participant names, with quoted fields and spreadsheet formula protection.
- Task creation and editing, staff/projects, dates and priorities, review/re-review, optional release, and activity notes/history. Original assignee, current owner, reviewer and release owner come from Timesheet **Staff Information**, including staff without a web account. Web accounts are used for login and cannot be selected for new assignments.
- Administrators create tasks, edit details and assignments, cancel/reopen tasks, and see all tasks.
- Ordinary users see tasks assigned to the staff record linked to their web account as original assignee, current owner, reviewer or release owner. Staff without an account gain access once an active account is linked through User Management. They can add notes and perform their assigned workflow steps. Reviewer actions require the designated reviewer; release/closure actions require the release owner. When release is skipped, the reviewer retains ownership after approval and may complete the task. Administrators can perform those actions too. Existing unlinked account assignments retain access until replaced with staff.
- Tasks open on their own full-width page at `/task-management/tasks/{guid}`, with separate detail, workflow and activity sections and a Copy task link button. Back to tasks retains the list query state. Saves stay on the task page and reload its latest version; new tasks use `/task-management/tasks/new` and redirect to their saved task URL. Links still require Task Management login and task access. Configure the hosting fallback for these nested routes.
- Task pages have a text Details tab, a History icon tab for the existing task activity log, and a disabled Attachments icon with “Attachments — coming soon” on hover/focus. Details contains the task form, workflow and Discussion. Switching tabs preserves unsaved task/comment drafts. Arrow keys and Home/End navigate tabs; Escape dismisses an icon tooltip. New-task History explains that the task must first be saved. Attachments make no API calls.
- Unsaved task edits are protected when using Back to tasks, sidebar links, browser Back or Escape, with an accessible Keep editing / Discard changes dialog. Closing or reloading the tab uses the browser warning; sign-out asks before discarding edits and is disabled during a save.
- Notifications provides a persistent inbox for new assignments and review handoffs. Opening a notification marks it read and opens its task. Self-actions do not notify the actor. Existing tasks are not backfilled. Notifications are in-app only, without email, push, or scheduled overdue reminders.
- Projects and task selectors show shared database projects created from web (`created_from = 1`) and their visible task counts. Administrators see all web-created projects; ordinary users see only those associated with their visible tasks. Administrators can select **New project**, enter a name, and create a project that becomes available in task selectors. Existing name validation and duplicate rules apply. Other project/user administration remains in the existing system. A task may use General (no project).
- Saving an outdated version returns a conflict and offers Reload latest task. History is recorded by the API, with each save committed atomically.
- Task pages include Discussion: plain-text comments, one level of replies, author initials/timestamps, highlighted mentions, and author or administrator edit/delete controls. Type `@` to choose Staff Information records by name/email using the keyboard or pointer. Only other active linked accounts that already have task access appear; the signed-in account is excluded and self-mentions are rejected by the API on create/edit. Mentioning someone never grants access. New mention recipients receive an in-app notification.
- Comments have their own optimistic versions, independent of task details/workflow. Reload latest comment resolves conflicts with a draft-discard confirmation. Deleting a comment retains its replies and server audit. Unposted comment drafts share the task page's navigation/sign-out protection and stay in memory; saving task details preserves the draft.

## Checks

```powershell
npm test
npm run build
```

SQL and HTTP integration checks are in `ParallelSystems.Server/Tests/TaskManagementChecks`. They use a disposable local SQL Server database and cover authentication isolation, permissions, workflow, concurrency, and rollback. See that folder's README for commands.

## Hosting

Build with `npm run build` and serve `dist/` at `/task-management/`. Configure the web server to return `/task-management/index.html` for frontend routes such as `/task-management/tasks`. Proxy `/api/task-management/` to the updated API without rewriting its path. Use HTTPS in production. The API's existing forwarded-header configuration must trust the reverse proxy so secure cookies are issued on HTTPS requests.

The cookie `ParallelSystems.TaskManagement` uses the dedicated `TaskManagement` authentication scheme and is scoped to `/api/task-management`. Login, session check, and logout are under `/api/task-management/auth`. The cookie is HttpOnly and SameSite=Strict; each mutation sends `X-Task-Management: 1`. The app's session lasts 8 hours, or 24 hours with Remember Me, with sliding renewal. Existing shared authentication remains separate.

## EC2 deployment tools

Use `DeploymentTools/Deploy-ParallelSystems-TaskManagement.cmd` to deploy this frontend at `/task-management/` alongside Timesheet (`/`) and Receipts (`/receipts/`) on the existing EC2 site. The default URL is `http://3.24.250.195/task-management/`; HTTPS/domain overrides are supported. The launcher requires a clean committed repository, asks for `YES`, runs tests/build, uploads compiled files, and installs a separate release with Nginx backups and rollback. Deploy the updated shared Server separately first. See [deployment instructions](DeploymentTools/README.md) for prerequisites, checks and recovery. These tools have been verified locally; no EC2 deployment has been performed.

## Current boundaries

Email ownership verification and invitation links are deferred by user request. Registration currently checks only that an email uniquely matches an unlinked Staff Information record; it does not prove ownership of the mailbox. Accounts live in the existing shared account table and can be used with other applications' normal login flows. Only Task Management establishes a session here. No role selector or administrator self-registration is provided.

Filtering and dashboard counts use the full list of tasks visible to the signed-in account. Server pagination and live multi-user push updates are not implemented; refresh happens every 60 seconds while visible, on window focus, after saves, and with Refresh. The inbox shows up to 100 notifications, unread first, with a full unread count. Task cancellation preserves history; there is no hard-delete endpoint. Referenced staff/accounts/projects are protected by foreign keys. Staff account inactivity or tracker access does not prevent assignment, but an inactive account cannot log in and receives no new notifications. Production deployment has not been performed.

Deploy the updated Server and frontend together for staff assignments. Server startup migrates existing account assignments where a staff link exists, increments affected task versions once, and preserves history. Unmatched legacy accounts appear only as disabled existing selections; administrators can replace them with staff. The account link is checked on each API request, and personal filters/permission caches follow refreshed staff links. Invitations remain unimplemented. Linking an account does not backfill older notifications.

Phase 1 changes are frontend-only and add no dependencies or API endpoints. `Created by me` needs the existing task responses to expose `createdById`. Search query text is visible in shared URLs, so review it before sharing. CSV includes only the currently filtered tasks the API already returned to the caller. Bulk failures do not roll back successful rows; reload conflicts before selecting and retrying them. Permissions cached at a known version are still revalidated by the API on save.

Task pages (2026-10-12): 26 Node tests and the production build passed. Browser checks used synthetic data and mocked existing API responses in an isolated fixture, covering task opening, creation, repeated versioned saves, review-note handoffs, conflict reload/retry, ordinary-user controls, session expiry, navigation protection and layouts at 375px/1200px without horizontal overflow. The fixture uses a hash data router to preserve its test document during navigation; the application uses a browser data router with the existing base path. Real API integration, deployed deep-link reloads, and native tab-close/reload warnings were not reverified.

Earlier checks: twenty-three Node tests and the production build passed on 2026-10-12, including staff/account personal filters, staff option labels, permission-cache invalidation and deployment-launcher checks. The server passed 139 SQL/HTTP assertions in a disposable database, including staff migration, all four assignment fields, account linking/unlinking, workflows, notification scope and version conflicts. Thirty-one Python/Bash deployment checks previously passed with local fixtures and mocked system/network commands. Earlier browser checks used the API's disposable SQL fixture for URL reload, bulk dates/reassignment, the Move to… workflow, review-note handling, create shortcut, and layouts at 375px and 1200px. Pointer drag produced a drag-start event but no drop event through browser automation, so a complete pointer gesture remains unverified. The Escape test reached the existing unsaved-change confirmation; automated dismissal could not be verified. Staff-selector browser checks, production deployment, touch dragging, full keyboard-only navigation, and concurrent multi-user browser sessions were not verified.

Future backend features are proposals in [API needs](docs/api-needs.md), with methods, payloads, permissions and database notes. No UI calls these proposed endpoints.

Discussion (2026-10-13): 34 Node tests, the production build, an isolated API Release build, and 212 SQL/HTTP assertions passed. Browser checks against the disposable SQL-backed API exercised posting mentions, replies, edits, two-editor conflicts/reload, draft protection, direct task-route reload, ordinary-user controls and recipient inbox navigation. Layouts at 375px/1200px had no horizontal overflow. The test host and preview stopped, and this run's disposable databases were removed. The NuGet vulnerability feed was unavailable during the test build; its dependency audit was not verified. No new dependencies were added.

Discussion supports 4,000-character comments, at most 20 selected mention spans and bounded 50-record pages with Load more. Automatic discussion refresh pauses while a draft is dirty or a comment is saving. Rich text, attachments, email notifications and deeper reply nesting remain unimplemented. Rebuild/restart the updated API yourself to install the additive scripts, then refresh Task Management and sign in again if required. The application API was not started/restarted for this feature; the application database, production deployment and native tab-close warning were not tested.

See [project knowledge](docs/project-knowledge/INDEX.md) for source evidence and maintenance notes.

Task tabs (2026-10-13): all 37 Node tests and the production build passed. A frontend fixture using the real App/TaskPage and synthetic API responses verified Details/History separation, retained task/comment drafts, navigation confirmation from History, keyboard navigation, disabled attachment activation and tooltip dismissal, new-task History, and 375px/1200px layouts without overflow. No API process or database was started/changed for these checks. Real API integration, physical touch and complete screen-reader navigation were not reverified.

Login flow (2026-10-13): 37 Node tests, frontend production build, API Release build (zero warnings/errors) and 279 SQL/HTTP assertions passed. Browser checks used disposable SQL data and verified email/password login, wrong-password rejection, unknown-email rejection, staff account creation/password confirmation, subsequent sign-in, Change resetting credentials and 375px/1200px layouts without overflow. The browser fixture uses a separate test cookie; the temporary host/preview stopped and its database was removed. The test build's NuGet vulnerability feed remained unavailable. Rebuild/start the application API yourself to install `sp_TaskManagementAccountLookup/Register`, then refresh the frontend. Real application database startup and production deployment remain unverified.
