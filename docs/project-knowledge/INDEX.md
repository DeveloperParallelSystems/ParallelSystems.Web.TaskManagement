# Project knowledge index

Last verified: 2026-10-10
Evidence: `src/App.jsx`, `src/app/store.js`, `src/app/api.js`, `vite.config.js`, `tests/`

## System purpose

Task planning, assignment, review, and delivery for existing Parallel Systems accounts. Visual reference: `reference/parallel_systems_task_management_simplified.html`.

## Components and entry points

- `src/main.jsx`: Redux provider and React Router at `/task-management/`.
- `src/app/store.js`: in-memory authentication, task data, filters, request status, and stale-response guards. No account/task data is persisted in browser storage.
- `src/app/api.js`: credentialed requests exclusively to `/api/task-management`, no-store responses, request header, and 20-second timeout.
- `src/features/auth/LoginPage.jsx`: separate Task Management login using existing accounts.
- `src/features/tasks/TasksPage.jsx`: board, list, filters, and summary counts.
- `src/features/tasks/TaskDrawer.jsx`: create/edit, server-provided allowed transitions, concurrency error/reload, and activity history.
- `src/features/tasks/NotificationsPage.jsx`: persistent recipient inbox, unread count, mark read and open task. Workspace refreshes every 60 seconds while visible and on focus; no email or push delivery.
- `/tasks/{guid}`: shareable task route survives login and reload. The drawer waits for workspace lookups before opening; normal API permissions remain mandatory.
- Ownership suggestions follow participant changes unless an administrator explicitly selected a different owner. Approved tasks without a release owner remain with the reviewer, who may complete them directly.
- `src/features/tasks/OverviewPages.jsx`: dashboard and existing project summaries.
- `src/features/projects/ProjectDialog.jsx`: administrator project creation through Redux and `/api/task-management/projects`; refreshes project cards and task selections after saving.
- Projects and task selectors use the shared database project records. Administrators see all projects; ordinary users see projects associated with their visible tasks.

## Documentation map

- `README.md`: run/build instructions, permissions, deployment path, and current boundaries.
- Backend contract and database authority: `ParallelSystems.Server/docs/project-knowledge/TASK_MANAGEMENT.md` in the sibling server repository.

## Verification

Production build and Node tests; browser verification against the actual API and disposable SQL database (login, create, edit, reload persistence, list/search, project filters, dashboard, responsive layout). Live production deployment is not verified.
