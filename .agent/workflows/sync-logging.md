---
description: All sync operations must have SSE streaming and console logging
---

# Sync Operations: Logging & SSE Requirements

Every sync operation (Jellyfin library sync, People sync, External IDs sync, Trakt sync, Last.fm sync, MusicBrainz sync, etc.) **MUST** follow this pattern:

## Required Infrastructure

1. **SSE (Server-Sent Events) streaming** — real-time progress updates sent to the frontend
2. **Console logging** — `console.log` / `console.error` with a `[sync-name]` prefix
3. **Broadcast function** — emit structured events (`progress`, `complete`, `error`, `paused`, `stopped`) to all connected SSE listeners
4. **Progress reporting** — percentage, items synced count, error count, log messages

## Required Event Types

- `snapshot` — initial state when client connects (running/paused, progress, logs)
- `progress` — ongoing progress with `{ progress, itemsSynced, errors, log, logType }`
- `complete` — sync finished with summary
- `error` — sync failed with error message
- `paused` / `resumed` / `stopped` — state changes

## Required UI Elements

- **Start button** (or trigger mechanism)
- **Progress bar** with percentage
- **Log console** showing timestamped messages (scrollable, max 150 entries)
- **Copy log** button
- **Pause/Resume/Stop** controls (for long-running syncs)
- Results shown in the sync log after completion

## Reference Implementation

See `src/lib/server/people-sync-engine.js` and `src/lib/server/sync-engine.js` for the canonical SSE-based sync pattern.

## Anti-patterns

- ❌ Simple POST endpoints that return JSON with no streaming
- ❌ Sync operations with no visible progress to the user
- ❌ Fire-and-forget operations with no log output
- ❌ Using `console.log` only without SSE broadcast to the frontend
