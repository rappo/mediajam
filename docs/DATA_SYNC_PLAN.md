# Mediajam Data Sync & Cleanup Plan

> **Created:** 2026-03-12  
> **Status:** Reference document — revisit when implementing scheduler  
> **Scope:** All data syncs, merges, deduplication, cleanup, enrichments, and embeddings

---

## Table of Contents

1. [Complete Inventory](#1-complete-inventory)
2. [Dependency Chain](#2-dependency-chain)
3. [Conflicts & Overlap](#3-conflicts--overlap)
4. [Backup Assessment](#4-backup-assessment)
5. [Missing Steps & Gaps](#5-missing-steps--gaps)
6. [Proposed Scheduling Plan](#6-proposed-scheduling-plan)
7. [Recommendations](#7-recommendations)

---

## 1. Complete Inventory

### Data Ingestion (Primary Imports)

| # | Module | Operation | Source | Description |
|---|--------|-----------|--------|-------------|
| 1 | `sync-engine.js` | **Jellyfin Library Sync** | Jellyfin API | Imports all media_parents + media_children (movies, shows, episodes, artists, albums, tracks). Generates playback history from Jellyfin play data. Resolves TMDB/IMDb/TVDB conflicts on shared external IDs. |
| 2 | `auto-sync.js` | **Auto Sync Scheduler** | Internal | Runs `startSync()` every 6 hours via `setInterval`. |
| 3 | `backfill-engine.js` | **Trakt History Import** | Trakt API | Fetches watch history, stores raw in `trakt_history`, processes into `playback_history` with session consolidation (4hr window). |
| 4 | `backfill-engine.js` | **Last.fm Scrobble Import** | Last.fm API | Fetches scrobbles, stores raw in `lastfm_scrobbles`, processes into `playback_history` with 10min dedup. |
| 5 | `backfill-engine.js` | **Jellyfin PR Import** | Local SQLite | One-time bulk import of historical data from the Jellyfin Playback Reporting plugin. |
| 6 | `pr-poller.js` | **PR DB Poller** | Local SQLite | Polls PlaybackReporting.db every 5 minutes for new playback events. Tracks rowid cursor. |
| 7 | `arr-sync.js` | ***arr Sync** | Radarr/Sonarr/Lidarr | Matches *arr items to existing media_parents by external ID, creates "wanted" stubs for unmatched. Cleans stale stubs. |
| 8 | `ingest-engine.js` | **Webhook Ingest** | Jellyfin Webhooks | Handles PlaybackStart/Progress/Stop events, manages `active_sessions`, writes to `playback_history` on scrobble threshold. |
| 9 | `jellyfin-history-engine.js` | **Jellyfin Watch History** | Jellyfin API | Fetches all played movies/episodes/audio, creates `playback_history` entries. Cross-refs Trakt for better timestamps. |

### Data Enrichment

| # | Module | Operation | Source | Description |
|---|--------|-----------|--------|-------------|
| 10 | `people-sync-engine.js` | **People Sync** | Jellyfin API | Fetches cast/crew for all movies/shows, upserts `persons` + `person_credits`. |
| 11 | `people-sync-engine.js` | **People Enrich** | TMDB API | Fetches bio, birth/death dates, photo, birth_place for persons with TMDB IDs. Stamps `tmdb_enriched_at`. |
| 12 | `people-sync-engine.js` | **External IDs Backfill** | Jellyfin API | Backfills TMDB/IMDb IDs for persons that only have a jellyfin_id. |
| 13 | `musicbrainz-engine.js` | **MusicBrainz Enrich** | MusicBrainz API | Phase 1: band members. Phase 2: external IDs/links. Phase 3: cross-link by IMDb ID (person dedup). |
| 14 | `ratings-engine.js` | **Ratings Fetch** | OMDb/TMDB/Discogs/MB | Fetches ratings for all media_parents. Skips items with ratings < 6 months old unless forced. |
| 15 | `wikipedia-backfill.js` | **Wikipedia Backfill** | Wikipedia/Wikidata/MB | Fetches Wikipedia summaries + URLs for movies, shows, artists, and persons. |
| 16 | `arr-sync.js` | **TMDb Cast Enrichment** | TMDB API | After *arr sync, fetches cast/crew for items missing `person_credits`. |
| 17 | `lidarr-enrich.js` | **Lidarr Album Enrich** | Lidarr API | On-demand: fetches album metadata + tracks when a non-Jellyfin album page is loaded. |
| 18 | `album-matcher.js` | **Album Match & Enrich** | MusicBrainz/Cover Art | Match suggestions for unmatched albums, auto-merge, smart-merge compilations, MB metadata + cover art. |
| 19 | `image-cache.js` | **Image Cache** | Any URL | SHA-256 file cache with 6-month TTL and stale-while-revalidate. `warmCache()` pre-caches during syncs. |

### Deduplication & Reconciliation

| # | Module | Operation | Description |
|---|--------|-----------|-------------|
| 20 | `reconcile.js` | **Dedup Parents (ext ID)** | Merges media_parents sharing TMDB/IMDb/TVDB/MB IDs. Migrates children + history. |
| 21 | `reconcile.js` | **Dedup Parents (title)** | Merges same-title, same-type, same-year parents (prefers Jellyfin-sourced). |
| 22 | `reconcile.js` | **Dedup Children** | Merges duplicate episodes (same season + episode under same parent). |
| 23 | `reconcile.js` | **Dedup Playback History** | Removes duplicate plays (same user/media/source within 5-min window). |
| 24 | `reconcile.js` | **Orphan Artists→Albums** | Re-parents external media_children to correct album sibling. |
| 25 | `reconcile.js` | **Dedup External Albums** | Merges external albums with fuzzy-matching titles under the same artist. |
| 26 | `llm-reconciler.js` | **Full Reconciliation** | Orchestrator: snapshot → backup → clear → re-match all Last.fm/Trakt → reclassify → dedup → *arr sync → diff report. |

### AI Operations

| # | Module | Operation | Description |
|---|--------|-----------|-------------|
| 27 | `llm.js` | **Tag & Summarize** | Abstraction layer (Ollama/OpenAI/Gemini/Claude) for tags, summaries, embeddings. |

---

## 2. Dependency Chain

Operations must run in dependency order. Higher layers depend on lower layers.

```
Layer 0 — Primary Data
  └── ① Jellyfin Library Sync

Layer 1 — History Sources (all depend on Layer 0)
  ├── ⑨ Jellyfin Watch History (cross-refs Trakt for timestamps)
  ├── ⑤ Jellyfin PR Import (one-time bulk)
  ├── ⑥ PR Poller (always running, every 5 min)
  ├── ③ Trakt Import
  ├── ④ Last.fm Import
  └── ⑧ Webhook Ingest (always running, real-time)

Layer 2 — External Catalog (depends on Layer 0)
  └── ⑦ *arr Sync → ⑯ TMDb Cast Enrichment

Layer 3 — People & Credits (depends on Layer 0)
  ├── ⑩ People Sync → ⑫ External IDs → ⑪ TMDB Enrich
  └── ⑬ MusicBrainz Enrich (needs artists with MB IDs + collected albums)

Layer 4 — Metadata Enrichment (depends on Layers 0-3)
  ├── ⑭ Ratings Fetch (needs media_parents with external IDs)
  ├── ⑮ Wikipedia Backfill (needs tmdb_id or musicbrainz_id; person Wikipedia needs tmdb_person_id)
  ├── ⑰ Lidarr Album Enrich (on-demand, needs lidarr_id)
  └── ⑱ Album Matcher (needs Jellyfin albums + external albums from Last.fm/Trakt)

Layer 5 — Reconciliation (runs after any data change)
  ├── ⑳-㉕ Dedup Functions (lightweight, can run often)
  └── ㉖ Full Reconciliation (heavy, re-matches everything — on-demand only)

Layer 6 — AI (independent, on-demand)
  ├── ㉗ Tag & Summarize
  └── ⑲ Image Cache (runs inline during syncs)
```

### Key Dependency Rules

- **People Sync** requires Jellyfin Sync (`media_parents` with `jellyfin_id`)
- **People External IDs** requires People Sync (`persons` with `jellyfin_id`)
- **People Enrich (TMDB)** requires External IDs (`tmdb_person_id`)
- **MusicBrainz Enrich** requires Jellyfin Sync (artists with `musicbrainz_id` + `collected_children > 0`)
- ***arr Sync** requires Jellyfin Sync (matches to existing `media_parents`)
- ***arr Cast** runs automatically at end of each *arr service sync
- **Full Reconciliation** requires all raw data imported (`lastfm_scrobbles` + `trakt_history`)
- **Jellyfin Watch History** benefits from Trakt (for better timestamps)
- **Lidarr Album Enrich** requires *arr Sync (needs `lidarr_id`) — on-demand only

---

## 3. Conflicts & Overlap

### 3.1 Five Playback History Sources (Duplicate Risk)

Playback history is generated in 5 separate places, each using a different `external_event_id` format:

| Source | Module | Event ID Format |
|--------|--------|----------------|
| Jellyfin "isPlayed" flag | `sync-engine.js` | `jellyfin:{itemId}` |
| Jellyfin played items API | `jellyfin-history-engine.js` | `jellyfin:movie:{Id}` / `jellyfin:episode:{Id}` / `jellyfin:audio:{Id}` |
| Jellyfin PR plugin | `backfill-engine.js` / `pr-poller.js` | `jellyfin_pr:{rowid}` |
| Jellyfin webhooks | `ingest-engine.js` | `webhook:{sessionId}:{timestamp}` |
| Trakt / Last.fm | `backfill-engine.js` / `llm-reconciler.js` | `trakt:{traktId}` / `lastfm:{artist}:{track}:{ts}` |

Since formats don't collide, the same play event imported from different sources creates **duplicate rows**. The `deduplicatePlaybackHistory()` function addresses this but only runs during Full Reconciliation.

### 3.2 Overlapping Dedup Code

- `backfill-engine.js` has its own dedup functions — older versions of what's in `reconcile.js`
- `llm-reconciler.js` imports and uses the `reconcile.js` functions (newer, more comprehensive)
- Running both is safe but redundant

### 3.3 Person Dedup in Three Places

1. `people-sync-engine.js` Phase 2 — guards against UNIQUE clashes during external ID backfill
2. `musicbrainz-engine.js` Phase 3 — cross-links persons by IMDb ID, merges duplicates
3. `reconcile.js` — catches remaining duplicates via parent/title dedup (indirect)

### 3.4 *arr Sync Clears IDs Before Re-matching

`arr-sync.js` runs this at the start of every sync:
```sql
UPDATE media_parents SET radarr_id = NULL, arr_monitored = 0, ...
WHERE radarr_id IS NOT NULL AND collection_status != 'wanted'
```
If the *arr API is temporarily down, all *arr associations are lost until next successful sync.

---

## 4. Backup Assessment

| Operation | Has Backup? | Details |
|-----------|:-----------:|---------|
| Full Reconciliation | ✅ | Creates `_reconcile_backup` table. Restores on error. Drops on success. |
| Jellyfin Library Sync | ❌ | Upserts directly. No rollback. |
| People Sync | ❌ | INSERT OR IGNORE + UPDATE. No rollback. |
| MusicBrainz Enrich | ❌ | Phase 3 cross-link merge is destructive. |
| Ratings Fetch | ⚠️ | Overwrites ratings. `ratings_updated_at` preserved but old scores are lost. |
| *arr Sync | ❌ | Clears all *arr IDs then re-matches. Partial data on failure. |
| Wikipedia Backfill | ⚠️ | Stamps `wikipedia_fetched_at` even on failure (won't retry). Can reset column. |
| Dedup Functions | ❌ | DELETEs duplicate rows permanently. History migrated but source rows gone. |
| Album Matcher Merge | ❌ | Deletes unmatched albums after migrating plays. Irreversible. |

---

## 5. Missing Steps & Gaps

### Gap 1: No Cross-Source Playback Dedup by Default
Same play from Jellyfin + Trakt creates duplicate rows. `deduplicatePlaybackHistory()` exists but only during Full Reconciliation.

**Fix:** Run `deduplicatePlaybackHistory()` as a post-step after any history import.

### Gap 2: No Scheduled *arr Sync
*arr sync is manual-only or during Full Reconciliation. "Wanted" list goes stale.

**Fix:** Add *arr sync to nightly schedule.

### Gap 3: No Post-Sync Dedup
After Jellyfin sync, orphan external media_parents accumulate. Dedup only during Full Reconciliation.

**Fix:** Run `deduplicateParents()` + `deduplicateChildren()` after each Jellyfin sync.

### Gap 4: No Ratings Refresh Schedule
Ratings only fetched on demand. Go stale after 6 months.

**Fix:** Weekly/monthly refresh for stale items.

### Gap 5: Enrichment Not Chained
People Sync doesn't auto-trigger People Enrich or Wikipedia Backfill. New persons sit without TMDB bios or Wikipedia summaries.

**Fix:** Chain: People Sync → External IDs → TMDB Enrich → Wikipedia.

### Gap 6: No Image Pre-warming After Enrichment
`warmCache()` only used during Jellyfin/People/*arr sync. Wikipedia and TMDB enrichment add photo URLs that aren't pre-cached.

### Gap 7: No Pre-Sync Backup
Jellyfin Sync can overwrite IDs, clear mappings, re-generate history. No snapshot to recover from if Jellyfin's library is accidentally purged.

**Fix:** Simple `cp mediajam.sqlite mediajam.sqlite.bak` before nightly runs.

### Gap 8: Music Album Dedup After Scrobble Import
Last.fm import creates many external "ghost" albums. `mergeOrphanArtistsIntoAlbums()` and `deduplicateExternalAlbums()` exist but only run during Full Reconciliation.

**Fix:** Run after scrobble import.

---

## 6. Proposed Scheduling Plan

### Nightly (2:00 AM)

Run sequentially, each phase waits for the previous to complete:

```
Phase 1: Primary Data                          ~15 min
  ① Jellyfin Library Sync

Phase 2: History Import                         ~5-30 min
  ② Jellyfin Watch History Sync
  ③ Trakt History (incremental)
  ④ Last.fm Scrobbles (incremental)

Phase 3: External Catalogs                      ~2 min
  ⑤ *arr Sync (Radarr + Sonarr + Lidarr)

Phase 4: Quick Cleanup                          ~1 min
  ⑥ Dedup Parents (by external ID + title)
  ⑦ Dedup Children (episodes)
  ⑧ Dedup Playback History
  ⑨ Merge Orphan Artists → Albums
  ⑩ Dedup External Albums

Phase 5: Pre-cache                              ~5-10 min (async)
  ⑪ Image Cache Warm
```

### Weekly (Sunday 3:00 AM)

Run after the nightly phases complete:

```
Phase 6: People & Credits                       ~30-60 min
  ⑫ People Sync (from Jellyfin)
  ⑬ People External IDs Backfill
  ⑭ People Enrich (TMDB bios/photos)

Phase 7: Music Enrichment                       ~60-120 min
  ⑮ MusicBrainz Band Members
  ⑯ Album Matcher Auto-Merge (medium+ confidence)
  ⑰ Unmatched Album MB Enrichment (cover art)

Phase 8: Ratings                                ~30-60 min
  ⑱ Ratings Fetch (stale items only, >6 months)

Phase 9: Wikipedia                              ~60-120 min
  ⑲ Wikipedia Backfill (unfetched items only)
```

### Always Running

```
⑳ Webhook Ingest (real-time, event-driven)
㉑ PR Poller (every 5 minutes)
```

### On-Demand (User-triggered only)

```
Full Reconciliation (re-matches all history from scratch)
Lidarr Album Enrich (per-page load)
Tag & Summarize (LLM)
Smart Merge Compilations (track-level routing)
Factory Reset / Clear Cache
```

### What Changes vs. Today

| Today | Proposed |
|-------|----------|
| Jellyfin sync every 6h, nothing else scheduled | Nightly dependency-aware pipeline |
| Dedup only during Full Reconciliation | Lightweight dedup nightly after every sync |
| *arr sync manual only | *arr sync nightly |
| Ratings never auto-refreshed | Weekly stale-rating refresh |
| People/MB/Wikipedia manual only | Weekly enrichment pass |
| No pre-sync backup | DB snapshot before nightly run |
| PR Poller every 5 min ✅ | Keep as-is ✅ |
| Webhook Ingest real-time ✅ | Keep as-is ✅ |

---

## 7. Recommendations

1. **Run lightweight dedup after every Jellyfin sync** — `deduplicateParents()` + `deduplicateChildren()` + `deduplicatePlaybackHistory()` as a post-sync hook
2. **Add *arr sync to nightly** — keep wanted list fresh
3. **Chain enrichment operations** — People Sync → External IDs → TMDB Enrich → Wikipedia (automated pipeline)
4. **Add pre-sync DB snapshot** — even `cp mediajam.sqlite mediajam.sqlite.bak` before nightly runs
5. **Guard *arr sync against API failures** — don't clear existing *arr IDs if the API call fails; only clear on successful re-match
6. **Remove old dedup code from backfill-engine.js** — superseded by `reconcile.js` functions
7. **Add ratings to weekly schedule** — auto-refresh items with `ratings_updated_at` > 6 months
8. **Run `deduplicatePlaybackHistory()` after every history import** — not just during Full Reconciliation
