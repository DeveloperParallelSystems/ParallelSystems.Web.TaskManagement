# Discipline statuses implementation plan

Approved scope: one live status list per Development/Drafting, shared administrator-managed catalog, common To Do default, free moves for administrators/original assignees/owners. No draft/publish/version interface. Historical task pins and history remain stored. Board presentation retains its saved four columns independently.

1. Add incremental catalog, discipline membership, settings revision and immutable audit migration. Seed common defaults and all in-use statuses without changing tasks. Preserve scoped reads, Staff Information bindings, concurrency and transactional activity/notifications. Guard in-use removal server-side.
2. Expose authenticated settings reads, administrator writes and versioned status changes. Keep historical API compatibility. Map catalog statuses through canonical board statuses so custom statuses cannot append columns.
3. Replace workflow administration with Discipline statuses. Reuse protected drafts/conflict reload. Add catalog names, board-column mapping, discipline assignment/order. Show configured and server-allowed choices; create in To Do and preserve owners.
4. Verify permissions, visibility, stale versions, removal, audit, replay and historical preservation in disposable SQL tests. Verify four-column mapping, live choices, session guards and renders in frontend tests/build. Update relevant API/knowledge docs.

Execution: existing dirty checkout continues earlier authorized UI work; baseline saved in ignored scratch. No commit/deployment/application database changes. User has approved implementation.

## Completion record

All four tasks complete. Discipline statuses verification (2026-10-15): all 130 frontend tests, production build, isolated API/test Release build and 797 disposable SQL/HTTP assertions passed. Coverage includes discipline membership, To Do defaults, existing-task choices, in-use removal, authorization, visibility, stale/concurrent writes, settings audit rollback, replay, historical pin/owner preservation, rejected historical transition bypass (HTTP and SQL), four saved columns and saved-filter compatibility. Independent final review identified and verified fixes for board grouping/completion coupling and historical transition writes. Browser checks at 1440px and 390px confirmed administration navigation, catalog addition/assignment/save, Drafting isolation, an existing Development task move, Review-column placement, four column names and no page overflow. Temporary frontend/API/database fixtures were stopped/removed. No application API restart, application database migration or deployment was performed. NuGet vulnerability-feed retrieval remains unavailable (NU1900); builds otherwise passed.

Compatibility note: historical catalog aliases can retain shared display names; codes stay distinct so existing task statuses are not rewritten. Existing compatibility endpoints remain internally, but live-mode task writes cannot use the historical pinned procedure.
