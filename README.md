# Parallel Systems Task Management

React (JavaScript), Redux Toolkit, and Vite frontend for the Task Management module in `ParallelSystems.Server`. The supplied HTML in `reference/` is the design reference. Application data is stored in SQL Server through the API.

## Run locally

Requires Node.js 22.12 or newer, .NET 8, and the existing server's configured SQL Server connection.

Start the updated API from the `ParallelSystems.Server` directory:

```powershell
dotnet run --project ParallelSystems.Api.csproj --launch-profile http
```

The server's normal database initializer installs the new `021_work_tasks.sql`, `022_work_task_activity.sql`, `023_work_task_notifications.sql`, and `sp_WorkTasks*.sql` / `sp_WorkTaskNotifications*.sql` scripts on startup. Use an appropriate development database when developing.

In this frontend directory:

```powershell
npm ci
npm run dev
```

Open `http://127.0.0.1:5174/task-management/`. Vite forwards only `/api/task-management` to `http://localhost:5185`. Set `PARALLEL_SYSTEMS_API_PROXY` before starting Vite if the API uses another address. Port 5174 is strict so another app does not silently receive the wrong port.

Sign in with an existing active Parallel Systems account. Task Management has its own login session; Timesheet/Receipts cookies cannot sign you into this app. No new application users or sample tasks are seeded by this frontend.

## First version

- Dashboard, grouped task board, list view, search, discipline/status/project filters, and Assigned to me.
- Task creation and editing, real users/projects, dates and priorities, review/re-review, optional release, and activity notes/history.
- Administrators create tasks, edit details and assignments, cancel/reopen tasks, and see all tasks.
- Ordinary users see only tasks where they are the original assignee, current owner, reviewer, or release owner. They can add notes and perform their assigned workflow steps. Reviewer actions require the designated reviewer; release/closure actions require the release owner. When release is skipped, the reviewer retains ownership after approval and may complete the task. Administrators can perform those actions too.
- Task details have shareable `/task-management/tasks/{guid}` URLs and a Copy task link button. Links still require Task Management login and task access. Configure the hosting fallback for these nested routes.
- Notifications provides a persistent inbox for new assignments and review handoffs. Opening a notification marks it read and opens its task. Self-actions do not notify the actor. Existing tasks are not backfilled. Notifications are in-app only, without email, push, or scheduled overdue reminders.
- Projects shows shared database projects and their visible task counts. Administrators can select **New project**, enter a name, and create a project that becomes available in task selectors. Existing name validation and duplicate rules apply. Other project/user administration remains in the existing system. A task may use General (no project).
- Saving an outdated version returns a conflict and offers Reload latest task. History is recorded by the API, with each save committed atomically.

## Checks

```powershell
npm test
npm run build
```

SQL and HTTP integration checks are in `ParallelSystems.Server/Tests/TaskManagementChecks`. They use a disposable local SQL Server database and cover authentication isolation, permissions, workflow, concurrency, and rollback. See that folder's README for commands.

## Hosting

Build with `npm run build` and serve `dist/` at `/task-management/`. Configure the web server to return `/task-management/index.html` for frontend routes such as `/task-management/tasks`. Proxy `/api/task-management/` to the updated API without rewriting its path. Use HTTPS in production. The API's existing forwarded-header configuration must trust the reverse proxy so secure cookies are issued on HTTPS requests.

The cookie `ParallelSystems.TaskManagement` uses the dedicated `TaskManagement` authentication scheme and is scoped to `/api/task-management`. Login, session check, and logout are under `/api/task-management/auth`. The cookie is HttpOnly and SameSite=Strict; each mutation sends `X-Task-Management: 1`. The app's session lasts 8 hours, or 24 hours with Remember Me, with sliding renewal. Existing shared authentication remains separate.

## Current boundaries

Filtering and dashboard counts use the full list of tasks visible to the signed-in account. Server pagination and live multi-user push updates are not implemented; refresh happens every 60 seconds while visible, on window focus, after saves, and with Refresh. The inbox shows up to 100 notifications, unread first, with a full unread count. Task cancellation preserves history; there is no hard-delete endpoint. Referenced users/projects are protected by foreign keys; deactivate accounts rather than deleting task participants. Production deployment has not been performed.

See [project knowledge](docs/project-knowledge/INDEX.md) for source evidence and maintenance notes.
