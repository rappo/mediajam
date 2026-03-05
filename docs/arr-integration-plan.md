# *arr Integration Plan (Radarr · Sonarr · Lidarr)

## Overview

Integrate Radarr (movies), Sonarr (TV shows), and Lidarr (music) with Mediajam. This enables users to:

- See download/collection status alongside watch history
- Request missing media from within Mediajam
- Track upcoming releases
- Manage quality profiles and monitoring

---

## 1. API Research Summary

### Authentication & Connection

All *arr apps use the same auth pattern:

- **API Key** passed as `X-Api-Key` header (or `?apikey=` query param)
- Base URL pattern: `http://host:port/api/v3/` (Radarr/Sonarr) or `/api/v1/` (Lidarr)
- All expose Swagger/OpenAPI docs at `{base}/swagger`
- All use JSON request/response bodies

### Libraries

No compelling npm libraries exist. The ecosystem is fragmented:

- `tsarr` — type-safe SDK but immature
- `@arr-ts-2/radarr` — auto-generated from OpenAPI, 2 years old
- `radson` — covers Sonarr+Radarr, 6 months old
- `sonarr-api` — 9 years old

**Recommendation:** Use direct `fetch()` calls with a thin shared wrapper. The APIs are simple REST — no auth flows, no WebSockets, no pagination complexity. A lightweight `lib/server/arr-client.js` is cleaner than adding dependencies.

---

## 2. External ID Mapping

This is the critical piece — how do we match *arr media to Mediajam's existing data?

### ID Fields Comparison

| ID Type | Mediajam `media_parents` | Radarr | Sonarr | Lidarr | Jellyfin |
|---------|-------------------------|--------|--------|--------|----------|
| TMDb ID | `tmdb_id` ✅ | `tmdbId` ✅ (primary) | `tmdbId` ✅ | — | `ProviderIds.Tmdb` |
| IMDb ID | `imdb_id` ✅ | `imdbId` ✅ | `imdbId` ✅ | — | `ProviderIds.Imdb` |
| TVDB ID | `tvdb_id` ✅ | — | `tvdbId` ✅ (primary) | — | `ProviderIds.Tvdb` |
| MusicBrainz | `musicbrainz_id` ✅ | — | — | `foreignArtistId` ✅ (primary) | `ProviderIds.MusicBrainzArtist` |
| *arr internal ID | — ❌ | `id` | `id` | `id` | — |

### Matching Strategy

| Media Type | Primary Match | Fallback |
|-----------|--------------|----------|
| Movies | `tmdb_id` → Radarr `tmdbId` | `imdb_id` → Radarr `imdbId` |
| TV Shows | `tvdb_id` → Sonarr `tvdbId` | `imdb_id` → Sonarr `imdbId` |
| Music | `musicbrainz_id` → Lidarr `foreignArtistId` | Title match (normalized) |

> [!IMPORTANT]
> All three primary IDs already exist in `media_parents`. No schema changes needed for basic matching.

### New IDs We Can Pull In

From *arr we can backfill IDs that Jellyfin may not provide:

| Source | New IDs Available | Value |
|--------|------------------|-------|
| Radarr | `tmdbId`, `imdbId`, `certification`, `youTubeTrailerId`, `collection.tmdbId` | Fill missing TMDB/IMDB, get trailer links, movie collection grouping |
| Sonarr | `tvdbId`, `imdbId`, `tvMazeId`, `tvRageId` | Fill missing TVDB, add TV Maze/Rage IDs |
| Lidarr | `foreignArtistId` (MBID), `foreignAlbumId` (MBID), `tadbId`, `discogsId` | Fill missing MBIDs, add Discogs/TADB links |

### Schema Additions

```sql
-- New columns on media_parents for *arr tracking
ALTER TABLE media_parents ADD COLUMN radarr_id INTEGER;
ALTER TABLE media_parents ADD COLUMN sonarr_id INTEGER;
ALTER TABLE media_parents ADD COLUMN lidarr_id INTEGER;
ALTER TABLE media_parents ADD COLUMN arr_monitored INTEGER DEFAULT 0;
ALTER TABLE media_parents ADD COLUMN arr_has_file INTEGER;        -- does *arr have a downloaded file?
ALTER TABLE media_parents ADD COLUMN arr_quality_profile TEXT;

-- New columns for richer metadata from *arr
ALTER TABLE media_parents ADD COLUMN certification TEXT;           -- PG-13, R, TV-MA, etc.
ALTER TABLE media_parents ADD COLUMN trailer_url TEXT;
ALTER TABLE media_parents ADD COLUMN tvmaze_id TEXT;
ALTER TABLE media_parents ADD COLUMN discogs_id TEXT;
```

---

## 3. *arr Concepts & How They Map

### Key Concepts

| *arr Concept | Meaning | Mediajam Equivalent |
|-------------|---------|-------------------|
| **Library / Root Folder** | Base directory for media files | `library_id` |
| **Quality Profile** | Preferred download quality (e.g., 1080p Bluray, FLAC) | New: `arr_quality_profile` |
| **Metadata Profile** (Lidarr) | Which album types to track (LP, EP, Single, Live) | Could filter `media_children` |
| **Monitored** | Actively searching for downloads | New: `arr_monitored` |
| **Has File** | Download complete, file exists | `is_collected = 1` maps to this |
| **Missing** | Monitored but no file yet | `is_collected = 0` + `arr_monitored = 1` |
| **Wanted / Cutoff Unmet** | Has file but below quality target | New status we could track |
| **Search** | Trigger indexer search for a specific item | Action button in Mediajam UI |
| **Add** | Add to *arr's database (doesn't download yet) | Action: "Track in Radarr/Sonarr/Lidarr" |
| **Collection** (Radarr) | Movie belongs to a franchise (e.g., MCU) | Could map to Mediajam collections |

### Adding Media to *arr

To request a download from Mediajam:

**Radarr** — `POST /api/v3/movie`:

```json
{
  "tmdbId": 550,
  "qualityProfileId": 1,
  "rootFolderPath": "/movies",
  "monitored": true,
  "addOptions": {
    "searchForMovie": true,          // immediately search indexers
    "monitor": "movieOnly"           // vs "movieAndCollection", "none"
  }
}
```

**Sonarr** — `POST /api/v3/series`:

```json
{
  "tvdbId": 81189,
  "qualityProfileId": 1,
  "rootFolderPath": "/tv",
  "monitored": true,
  "addOptions": {
    "monitor": "all",               // "all", "future", "missing", "existing", "none"
    "searchForMissingEpisodes": true,
    "searchForCutoffUnmetEpisodes": false
  }
}
```

**Lidarr** — `POST /api/v1/artist`:

```json
{
  "foreignArtistId": "0febdcf7-4e1f-4661-9493-b40427de2c13",
  "qualityProfileId": 1,
  "metadataProfileId": 1,
  "rootFolderPath": "/music",
  "monitored": true,
  "addOptions": {
    "monitor": "all",               // "all", "future", "missing", "existing", "none"
    "searchForMissingAlbums": true
  }
}
```

### Other Useful Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/v3/movie` (Radarr) | List all movies in Radarr |
| `GET /api/v3/series` (Sonarr) | List all series in Sonarr |
| `GET /api/v1/artist` (Lidarr) | List all artists in Lidarr |
| `GET /api/v3/qualityprofile` | List available quality profiles |
| `GET /api/v3/rootfolder` | List configured root folders |
| `GET /api/v3/calendar` | Upcoming releases (great for dashboard) |
| `GET /api/v3/queue` | Currently downloading items |
| `GET /api/v3/wanted/missing` | Monitored items without files |
| `POST /api/v3/command` | Trigger actions (search, rename, refresh) |
| `GET /api/v3/movie/{id}` | Single item detail + file info |

---

## 4. Integration Architecture

### Discovery & Configuration

Similar to the Ollama scan feature, add *arr instance discovery:

```
Settings > System > Media Management
  ┌─ Radarr ─────────────────────────────
  │ URL: http://localhost:7878   [Scan] [Test]
  │ API Key: ●●●●●●●●●●●●●●●●
  │ Status: ✅ Connected (2,480 movies)
  │ Quality Profile: [HD-1080p ▾]
  │ Root Folder: [/movies ▾]
  ├─ Sonarr ─────────────────────────────
  │ URL: http://localhost:8989   [Scan] [Test]
  │ API Key: ●●●●●●●●●●●●●●●●
  │ Status: ✅ Connected (156 series)
  │ Quality Profile: [HD-1080p ▾]
  │ Root Folder: [/tv ▾]
  ├─ Lidarr ─────────────────────────────
  │ URL: http://localhost:8686   [Scan] [Test]
  │ API Key: ●●●●●●●●●●●●●●●●
  │ Status: ✅ Connected (348 artists)
  │ Quality Profile: [FLAC ▾]
  │ Root Folder: [/music ▾]
  └──────────────────────────────────────
```

### Data Flow

```
          ┌────────────┐     sync IDs      ┌──────────┐
          │  Jellyfin   │ ──────────────▶  │ Mediajam │
          │ (collected) │                   │   DB     │
          └────────────┘                   └──┬───────┘
                                              │ match on
                                              │ tmdb/tvdb/mbid
          ┌────────────┐     sync status   ┌──▼───────┐
          │  Radarr    │ ◀────────────────▶│ arr-sync │
          │  Sonarr    │     add/search    │  engine  │
          │  Lidarr    │ ◀────────────────▶│          │
          └────────────┘                   └──────────┘
```

**Sync direction:**

1. **Read from *arr → Mediajam:** Import monitored/download status, quality info, upcoming releases
2. **Write Mediajam → *arr:** Add missing media, trigger searches, update monitoring

### Sync Engine Integration

The *arr sync runs after the Jellyfin sync to enrich existing entries:

```javascript
// Pseudocode for arr-sync
async function syncArr(arrType, config) {
  const items = await fetch(`${config.url}/api/${config.apiVersion}/${config.endpoint}`, {
    headers: { 'X-Api-Key': config.apiKey }
  }).then(r => r.json());

  for (const item of items) {
    // Match to existing media_parent by external ID
    const match = db.prepare(
      `SELECT id FROM media_parents WHERE ${config.idColumn} = ?`
    ).get(item[config.idField]);

    if (match) {
      // Update arr tracking fields
      db.prepare(`
        UPDATE media_parents SET
          ${arrType}_id = ?, arr_monitored = ?, arr_has_file = ?,
          arr_quality_profile = ?
        WHERE id = ?
      `).run(item.id, item.monitored ? 1 : 0, item.hasFile ? 1 : 0,
             config.qualityProfileName, match.id);
    }
  }
}
```

---

## 5. UI Integration Points

### Media Detail Page

On existing movie/show/artist pages, show *arr status:

```
┌─ The Dark Knight (2008) ───────────────────────────┐
│ ★ 9.2 │ PG-13 │ 152 min │ Action, Crime, Drama    │
│                                                      │
│ Radarr: ✅ Monitored │ 📁 1080p Bluray │ 42.3 GB    │
│         [🔍 Search] [❌ Unmonitor] [⬆️ Upgrade]     │
│                                                      │
│ Not in Radarr? [➕ Add to Radarr]                    │
└──────────────────────────────────────────────────────┘
```

### Dashboard Widget — Upcoming Releases

Pull from `GET /calendar`:

```
┌─ Upcoming ────────────────────────────┐
│ 📺 Tomorrow: The Last of Us S2E03    │
│ 🎬 Mar 14: Dune: Part Three          │
│ 🎵 Mar 21: New Radiohead Album       │
└───────────────────────────────────────┘
```

### "Add to Collection" Flow

When viewing external/unmatched media:

```
Wu-Tang Clan (external, not in Jellyfin)
  → [Add to Lidarr] → picks quality/root → Lidarr monitors & downloads
  → Jellyfin scans → next sync links everything together
```

### Wanted/Missing Page

New page showing monitored items without files:

```
/library/wanted
  📺 Breaking Bad S5E16 — Monitored in Sonarr (HD-1080p)
  🎬 Oppenheimer — Searching... (indexer queue)
  🎵 Radiohead - Kid A — Missing (FLAC)
```

---

## 6. Proposed Changes

### New Files

| File | Purpose |
|------|---------|
| `lib/server/arr-client.js` | Thin fetch wrapper for all *arr APIs (shared auth, error handling, URL building) |
| `lib/server/arr-sync.js` | Sync engine that reads *arr state into Mediajam DB |
| `routes/api/arr/[service]/+server.js` | API endpoints for connecting, testing, and proxying *arr requests |
| `routes/api/arr/[service]/add/+server.js` | Add media to *arr from Mediajam |
| `routes/api/arr/calendar/+server.js` | Aggregated calendar from all *arr services |

### Modified Files

| File | Changes |
|------|---------|
| `routes/settings/system/+page.svelte` | Add *arr configuration section (URL, API key, profiles, root folders) |
| `routes/api/settings/+server.js` | Persist *arr settings (URL, API key per service) |
| `lib/server/db.js` | Add `radarr_id`, `sonarr_id`, `lidarr_id`, `arr_monitored`, `arr_has_file`, etc. columns |
| `lib/server/sync-engine.js` | Call arr-sync after Jellyfin sync |

### Settings Schema Additions

```sql
ALTER TABLE app_settings ADD COLUMN radarr_url TEXT;
ALTER TABLE app_settings ADD COLUMN radarr_api_key TEXT;
ALTER TABLE app_settings ADD COLUMN radarr_quality_profile_id INTEGER;
ALTER TABLE app_settings ADD COLUMN radarr_root_folder TEXT;

ALTER TABLE app_settings ADD COLUMN sonarr_url TEXT;
ALTER TABLE app_settings ADD COLUMN sonarr_api_key TEXT;
ALTER TABLE app_settings ADD COLUMN sonarr_quality_profile_id INTEGER;
ALTER TABLE app_settings ADD COLUMN sonarr_root_folder TEXT;

ALTER TABLE app_settings ADD COLUMN lidarr_url TEXT;
ALTER TABLE app_settings ADD COLUMN lidarr_api_key TEXT;
ALTER TABLE app_settings ADD COLUMN lidarr_quality_profile_id INTEGER;
ALTER TABLE app_settings ADD COLUMN lidarr_metadata_profile_id INTEGER;
ALTER TABLE app_settings ADD COLUMN lidarr_root_folder TEXT;
```

---

## 7. Implementation Phases

### Phase 1: Connection & Read-Only Sync

- Add *arr settings UI (URL, API key, test connection)
- Build `arr-client.js` with shared fetch wrapper
- Scan/discover *arr instances on local network (like Ollama scan)
- Sync *arr → Mediajam: import monitored/download status for matched items
- Show *arr status on media detail pages

### Phase 2: Actions & Write Operations

- "Add to Radarr/Sonarr/Lidarr" button on media pages
- Quality profile and root folder selection
- Trigger search from Mediajam
- Monitor/unmonitor toggle

### Phase 3: Dashboard & Calendar

- Upcoming releases widget from `/calendar`
- Download queue status from `/queue`
- Wanted/missing page
- Notification when downloads complete

### Phase 4: Deep Integration

- Backfill missing IDs from *arr into Mediajam
- Two-way monitored status sync
- Collection/franchise grouping from Radarr collections
- Activity feed integration (recently grabbed, imported, etc.)

---

## 8. Verification Plan

### Automated

- Test `arr-client.js` against mock *arr API responses
- Verify ID matching logic with known tmdb/tvdb/mbid values
- Test add-to-arr flow end-to-end with a test *arr instance

### Manual

- Configure Radarr/Sonarr/Lidarr in Settings
- Verify status badges appear on media pages
- Add a movie/show/artist from Mediajam and confirm it appears in *arr
- Check calendar widget shows upcoming releases
