# Catalog board presentation

Approved request: Board presentation uses only shared catalog statuses directly in its columns. Remove Additional status groupings and provide one save. Preserve saved column count/order/colors, task data, permissions and concurrency.

1. Add an incremental catalog board state table holding the saved catalog-code layout. Preserve the original presentation tables and compatibility endpoint. New authenticated board-presentation GET resolves catalog additions/removals into existing saved columns; PUT atomically saves columns and catalog membership with expected board and catalog revisions and existing presentation audit.
2. Switch the frontend board resource/editor/preview to the catalog-aware endpoint and named catalog codes. Keep exactly the saved columns on task board/dashboard, with direct code placement and no extra section. Reuse dirty/navigation/conflict guards, handle changed catalog snapshots, and refresh presentation after catalog saves.
3. Add SQL/API coverage for permission, validation, catalog races, custom/empty columns, atomic audit rollback and replay without task/owner/history changes. Add frontend catalog-only rendering, mapping, revision/session tests; run frontend suite/build and isolated full SQL/API suite. Update relevant docs. No commit/deployment or application database edits.

Automated verification complete: 136 frontend tests, Vite production build, isolated Release build and 831 SQL/HTTP assertions passed. Coverage includes catalog additions/removals, direct placement, one editor/save, permissions, both revisions, rollback, replay and task-state preservation. No application database/API restart or deployment.
