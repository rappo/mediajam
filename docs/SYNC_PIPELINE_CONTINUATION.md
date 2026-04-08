# Sync Pipeline — Continuation Guide

> **Branch:** `feat/sync-pipeline`  
> **Status:** Core modules written, not yet wired in  
> **Last rebased on:** `main` @ `e95332c`

## What's Already Done

### On `main` (committed & pushed)

| File | What |
|------|------|
| `src/lib/server/backup-engine.js` | Shared lock: `acquireLock()` / `releaseLock()` / `lockHolder()` / `BACKUP_DIR` export |
| `src/lib/server/data-audit.js` | Snapshot/compare/list/delete across 12 tables |
| `src/lib/server/nightly-pipeline.js` | 11-phase pipeline engine with scheduling, SSE events, per-phase toggles |
| `src/lib/server/db.js` | `backup_include_images` column |
| `src/routes/settings/+layout.svelte` | Sidebar restructured (Account/Credentials/Data/Debug), always-expand |

### On `feat/sync-pipeline` (stashed, needs rebase)

| File | What |
|------|------|
| `src/lib/server/db.js` | 5 pipeline columns: `pipeline_enabled`, `nightly_pipeline_time`, `weekly_pipeline_day`, `weekly_pipeline_time`, `pipeline_phase_flags` |

## What's Left To Do

### 1. Rebase the branch
```bash
git checkout feat/sync-pipeline
git stash pop          # restore stashed work
git rebase main        # pick up main's changes
```

### 2. Audit API Routes
Create these files:

**`src/routes/api/audit/+server.js`**
- `GET` → call `listSnapshots()`, return JSON
- `POST` → read `{label}` from body, call `takeSnapshot(label)`, return result

**`src/routes/api/audit/compare/+server.js`**
- `POST` → read `{before, after}` from body, call `compareSnapshots(before, after)`, return diffs

**`src/routes/api/audit/[filename]/+server.js`**
- `DELETE` → call `deleteSnapshot(params.filename)`, return result

All functions are already exported from `data-audit.js`.

### 3. Audit UI Page
Create `src/routes/settings/audit/+page.svelte`:
- "Take Snapshot" button with text input for label
- Table listing snapshots: label, timestamp, row counts summary, size, **delete** button
- Compare picker: two dropdowns to select before/after, "Compare" button
- Diff results: per-table card showing added/deleted/modified counts, expandable sample rows

### 4. Post-Sync Dedup Hook
In `src/lib/server/sync-engine.js`, at the end of `startSync()` (after sync completes successfully), add:
```js
import { deduplicateParents, deduplicateParentsByTitle, deduplicateChildren, deduplicatePlaybackHistory } from '$lib/server/reconcile.js';

// ... at end of startSync():
deduplicateParents();
deduplicateParentsByTitle();
deduplicateChildren();
deduplicatePlaybackHistory();
```

### 5. *arr Sync Safeguard
In `src/lib/server/arr-sync.js`, change the `syncArrService()` function:
- **Remove** the `UPDATE media_parents SET radarr_id = NULL ...` at the start
- **Add** a pending-flag approach:
  1. At start: `UPDATE media_parents SET arr_sync_pending = 1 WHERE {service}_id IS NOT NULL`
  2. On successful match: clear pending flag
  3. At end: items still pending = no longer in *arr → clear their IDs
  4. On API error: don't touch existing IDs (skip the entire clear step)
- Requires new column: `arr_sync_pending INTEGER DEFAULT 0` on `media_parents`

### 6. Refactor `auto-sync.js`
Import and start the pipeline scheduler alongside existing auto-sync:
```js
import { startPipelineScheduler } from '$lib/server/nightly-pipeline.js';
```
Call `startPipelineScheduler()` in `startAutoSyncScheduler()`. The existing per-user 6h incremental sync stays as-is.

### 7. Wire Pipeline Scheduler into Server Boot
In `src/hooks.server.js`, import and call `startPipelineScheduler()` alongside `startBackupScheduler()`.

### 8. Add Audit to Sidebar
In `src/routes/settings/+layout.svelte`, add to the Data subsections:
```js
{ href: "/settings/audit", label: "Audit" },
```

### 9. Update API Docs
Add backup + audit endpoints to `docs/external-api.md`.

### 10. Pipeline Settings UI (optional, can be deferred)
A settings card on the Data Sync tab or a dedicated Pipeline tab to configure:
- Pipeline enabled/disabled toggle
- Nightly time, weekly day+time
- Per-phase toggles

## Key Module Reference

| Module | Key exports |
|--------|------------|
| `nightly-pipeline.js` | `runPipeline(mode, opts)`, `getPipelineSettings()`, `updatePipelineSettings()`, `startPipelineScheduler()`, `restartPipelineScheduler()`, `stopPipelineScheduler()`, `addPipelineListener()`, `isPipelineRunning()`, `PHASES` |
| `data-audit.js` | `takeSnapshot(label)`, `compareSnapshots(before, after)`, `listSnapshots()`, `deleteSnapshot(filename)` |
| `backup-engine.js` | `acquireLock(label)`, `releaseLock(label)`, `lockHolder()`, `BACKUP_DIR` |
| `reconcile.js` | `deduplicateParents()`, `deduplicateParentsByTitle()`, `deduplicateChildren()`, `deduplicatePlaybackHistory()`, `mergeOrphanArtistsIntoAlbums()`, `deduplicateExternalAlbums()` |
