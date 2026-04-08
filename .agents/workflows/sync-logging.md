---
description: All sync operations must have SSE streaming and console logging
---

# Sync Logging Rule

Every sync operation (Jellyfin sync, People sync, MusicBrainz enrichment, External IDs backfill, Trakt/Last.fm sync, backfill engine, *arr sync) **MUST** implement:

## MANDATORY: Use LogConsole Component

**ALL log/streaming output in the UI MUST use `<LogConsole>` from `$lib/components/LogConsole.svelte`.**
Never create custom inline log divs with manual styling. The LogConsole component provides:

- Auto-scroll with follow toggle
- Error-only filter
- Copy all button
- Loading indicator
- Consistent styling

```svelte
<LogConsole logs={myLogs} running={isRunning} title="My Sync Log" height="h-48" />
```

Logs must be `{ time: string, message: string, type: 'info'|'success'|'error'|'warning' }[]`.

## Required for ALL Syncs

1. **SSE streaming** — Real-time progress via `EventSource` for the settings UI
2. **Console logging** — `console.log` with timestamped emoji prefixes (e.g. `[5:37:09 PM] 🔗 Backfilling external IDs...`)
3. **File logging** — Use `logError`/`logInfo`/`logWarn` from `$lib/server/logger.js` for all errors, warnings, and key events

## Error Logging Requirements

- **Every `catch` block** must call `logError()` with category, message, and context metadata
- **Every failed HTTP response** (non-2xx) must call `logError()` with status code
- **Every timeout** must call `logWarn()` with the operation that timed out
- Include identifiers in error logs (person name, jellyfin_id, media title, etc.)

## SSE Connection Rules

- All `EventSource` instances must be closed when the component unmounts (use `$effect` cleanup `return`)
- Server-side SSE streams must clean up listeners and intervals in `cancel()`
- Never open duplicate SSE connections to the same endpoint from different components
- Use the closure pattern for cleanup:

  ```js
  let cleanupFn = null;
  const stream = new ReadableStream({
      start(controller) {
          const removeListener = addListener(send);
          const keepAlive = setInterval(...);
          cleanupFn = () => { removeListener(); clearInterval(keepAlive); };
      },
      cancel() { if (cleanupFn) cleanupFn(); }
  });
  ```

## Logger Usage

```js
import { logError, logInfo, logWarn } from '$lib/server/logger.js';

// In catch blocks:
logError('sync', `Failed to sync item '${item.name}'`, { error: err?.message, id: item.id });

// For key events:
logInfo('people-sync', `External IDs backfill started for ${count} persons`);

// For warnings:
logWarn('backfill', `Timeout fetching data for ${item.name}`, { timeout: 30000 });
```
