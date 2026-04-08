# Mediajam API Reference

> **Base URL**: `http://<host>:7331` (default port)
>
> **Authentication**: Most endpoints require a session cookie obtained via `POST /api/auth/login`. Some public endpoints (under `/api/users/`) are unauthenticated for external widget consumption. API keys (`mj_...`) can also be used via `Authorization: Bearer mj_...` header.

---

## Table of Contents

- [Authentication](#authentication)
- [Search](#search)
- [Media Management](#media-management)
- [Favorites & Watchlist](#favorites--watchlist)
- [Playback History](#playback-history)
- [Activity Feed](#activity-feed)
- [Ratings](#ratings)
- [Stats](#stats)
- [User Endpoints (Public)](#user-endpoints-public)
- [Natural Language Queries](#natural-language-queries)
- [Settings](#settings)
- [Image Proxy](#image-proxy)
- [Sync & Backfill](#sync--backfill)
- [Enrichment](#enrichment)
- [AI / Ollama](#ai--ollama)
- [*arr Integration](#arr-integration)
- [Spokes (Trakt & Last.fm)](#spokes-trakt--lastfm)
- [Discovery](#discovery)
- [Ingest (Webhooks)](#ingest-webhooks)
- [API Keys](#api-keys)
- [Backup & Restore](#backup--restore)
- [Tracks](#tracks)
- [Debug](#debug)
- [LLM Integration Guide](#llm-integration-guide)

---

## Authentication

### `POST /api/auth/login`

Authenticate and receive a session cookie. Supports both local password and Jellyfin-delegated auth.

**Request:**
```json
{
  "username": "admin",
  "password": "yourpassword"
}
```

**Response (200):**
```json
{
  "success": true,
  "user": {
    "id": 1,
    "username": "admin",
    "isAdmin": true
  }
}
```

**Response (401):**
```json
{ "success": false, "error": "Invalid username or password." }
```

**Notes:**
- Sets an `mjsession` cookie used for subsequent authenticated requests.
- For Jellyfin-linked accounts (no local password), authenticates against the Jellyfin server.

**curl example:**
```bash
curl -c cookies.txt -X POST http://localhost:7331/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"mypassword"}'
```

---

### `POST /api/auth/logout`

Clear the session cookie.

**Request:** No body needed.

**Response (200):**
```json
{ "success": true }
```

**curl example:**
```bash
curl -b cookies.txt -X POST http://localhost:7331/api/auth/logout
```

---

### `POST /api/auth/reset-password`

Reset a user's password (admin only).

**Request:**
```json
{
  "userId": 2,
  "newPassword": "newpass123"
}
```

**Response (200):**
```json
{ "success": true }
```

---

## Search

### `GET /api/search?q=<query>`

Global search across all media types, people, episodes, albums, and playback history. Includes semantic search when embeddings are available.

**Query params:**
| Param | Required | Description |
|-------|----------|-------------|
| `q` | Yes | Search query (min 2 chars) |

**Response (200):**
```json
{
  "query": "ghost",
  "results": {
    "shows": [
      { "id": 123, "title": "Ghost in the Shell", "poster_url": "...", "release_year": 1995, "episode_count": 26, "type": "show" }
    ],
    "movies": [
      { "id": 456, "title": "Ghostbusters", "poster_url": "...", "release_year": 1984, "type": "movie" }
    ],
    "music": [
      { "id": 1466, "title": "Ghost", "poster_url": "...", "album_count": 10, "type": "artist" }
    ],
    "albums": [
      { "id": 789, "item_title": "Meliora", "parent_title": "Ghost", "poster_url": "...", "parent_id": 1466, "type": "album" }
    ],
    "people": [
      { "id": 100, "title": "Patrick Swayze", "poster_url": "...", "credit_count": 5, "type": "person" }
    ],
    "children": [],
    "history": [],
    "semantic": []
  },
  "totalCount": 8
}
```

**curl example:**
```bash
curl -b cookies.txt "http://localhost:7331/api/search?q=ghost"
```

---

## Media Management

### `PATCH /api/media/:id`

Correct an external ID or image URL on a media item. Handles automatic duplicate merging when the corrected ID already exists on another record.

**Request:**
```json
{
  "field": "musicbrainz_id",
  "value": "2bcf2e02-5bc3-4c76-bf76-41126cb11444"
}
```

**Allowed fields:**

| Field | Description | Merge logic |
|-------|-------------|-------------|
| `musicbrainz_id` | MusicBrainz artist/release group ID | Yes — merges duplicate if exists |
| `tmdb_id` | TMDB movie/show ID | Yes — merges duplicate if exists |
| `imdb_id` | IMDb ID (e.g. `tt1234567`) | Yes — merges duplicate if exists |
| `backdrop_url` | Backdrop image URL | Simple set (pass `null` to clear) |
| `poster_url` | Poster image URL | Simple set (pass `null` to clear) |

**Response (200):**
```json
{ "success": true, "merged": true, "mergedId": 45765 }
```

**What "merge" does:** When you correct an ID and another record already has that ID:
1. Useful metadata (poster, overview, *arr IDs) is transferred from the duplicate
2. All children (episodes/albums) are moved to the target
3. Person credits are moved
4. The duplicate record is deleted

**curl example — correct a MusicBrainz ID:**
```bash
curl -b cookies.txt -X PATCH http://localhost:7331/api/media/1466 \
  -H "Content-Type: application/json" \
  -d '{"field":"musicbrainz_id","value":"2bcf2e02-5bc3-4c76-bf76-41126cb11444"}'
```

**curl example — clear a stale backdrop:**
```bash
curl -b cookies.txt -X PATCH http://localhost:7331/api/media/1466 \
  -H "Content-Type: application/json" \
  -d '{"field":"backdrop_url","value":null}'
```

---

### `DELETE /api/media/:id`

Remove a media item and all related data (children, credits, ratings, playback history, tags). Returns an undo token valid for 30 seconds.

**Response (200):**
```json
{
  "success": true,
  "title": "Ghost",
  "undoToken": "abc123...",
  "route": "music"
}
```

---

### `POST /api/media/:id` (Undo Delete)

Restore a previously deleted media item using the undo token.

**Request:**
```json
{ "undoToken": "abc123..." }
```

**Response (200):**
```json
{ "success": true, "id": 1466, "title": "Ghost", "route": "music" }
```

---

### `PATCH /api/media/child/:id`

Update a child item (episode/album). Supports marking watch status, toggling collection, and correcting IDs.

**Request:**
```json
{
  "field": "watch_status",
  "value": "watched"
}
```

**Allowed fields:** `watch_status`, `is_collected`, `musicbrainz_id`

---

### `DELETE /api/media/child/:id`

Remove a specific child item (episode/album/track).

**Query params:**
| Param | Description |
|-------|-------------|
| `undo` | Set to `true` to restore (with `undoToken` in body) |

---

## Favorites & Watchlist

### `POST /api/favorite`

Toggle favorite status on a media item or person. Bidirectional — also syncs to Jellyfin.

**Request:**
```json
{
  "type": "media",
  "id": 1466,
  "isFavorite": true
}
```

| Field | Type | Values |
|-------|------|--------|
| `type` | string | `"media"` or `"person"` |
| `id` | number | media_parents.id or persons.id |
| `isFavorite` | boolean | `true` to favorite, `false` to unfavorite |

**Response (200):**
```json
{ "success": true, "type": "media", "id": 1466, "isFavorite": true }
```

**curl example:**
```bash
curl -b cookies.txt -X POST http://localhost:7331/api/favorite \
  -H "Content-Type: application/json" \
  -d '{"type":"media","id":1466,"isFavorite":true}'
```

---

### `POST /api/watchlist`

Toggle a media item on/off the user's watchlist.

**Request:**
```json
{ "mediaParentId": 456 }
```

**Response (200):**
```json
{ "inWatchlist": true }
```

Call again with the same ID to remove from watchlist.

---

## Playback History

### `GET /api/history`

Paginated playback history timeline for the authenticated user.

**Query params:**
| Param | Default | Description |
|-------|---------|-------------|
| `page` | `1` | Page number |
| `limit` | `50` | Items per page (max 200) |
| `type` | — | Filter: `show`, `movie`, or `artist` |

**Response (200):**
```json
{
  "entries": [
    {
      "id": 101,
      "timestamp": "2026-03-10T15:30:00Z",
      "duration_consumed_seconds": 3600,
      "completion_pct": 100,
      "source": "jellyfin",
      "item_title": "Episode 1",
      "season_number": 1,
      "item_number": 1,
      "parent_title": "Breaking Bad",
      "media_type": "show",
      "poster_url": "https://image.tmdb.org/...",
      "username": "admin"
    }
  ],
  "page": 1,
  "limit": 50,
  "total": 1234,
  "totalPages": 25
}
```

**curl example:**
```bash
curl -b cookies.txt "http://localhost:7331/api/history?type=movie&limit=10"
```

---

### `DELETE /api/playback-history/:id`

Delete a specific playback history entry.

**Response (200):**
```json
{ "success": true }
```

---

## Activity Feed

### `GET /api/activity`

Get recent activity log entries (sync events, errors, etc.).

**Query params:**
| Param | Default | Description |
|-------|---------|-------------|
| `limit` | `50` | Max entries to return |
| `unreadOnly` | `false` | Only return unread items |

**Response (200):**
```json
{
  "activities": [
    {
      "id": 1,
      "type": "sync_complete",
      "message": "Movies sync complete — 1300 items",
      "timestamp": "2026-03-10T15:00:00Z",
      "read": false
    }
  ],
  "unreadCount": 3
}
```

---

### `PUT /api/activity`

Mark activity entries as read.

**Request:**
```json
{ "id": 1 }
```
Or mark all read:
```json
{ "id": "all" }
```

---

### `DELETE /api/activity`

Clear all read entries from the activity log.

**Response (200):**
```json
{
  "success": true,
  "deleted": 5,
  "activities": [ /* remaining entries */ ],
  "unreadCount": 0
}
```

---

## Ratings

### `GET /api/ratings`

Get cached external ratings for a media item or album.

**Query params (one required):**
| Param | Description |
|-------|-------------|
| `mediaParentId` | Get ratings for a movie/show/artist |
| `mediaChildId` | Get ratings for a specific album |

**Response (200):**
```json
{
  "ratings": [
    {
      "source": "imdb",
      "rating_type": "audience",
      "value": 8.5,
      "vote_count": 250000,
      "raw_value": "8.5/10"
    },
    {
      "source": "rottentomatoes",
      "rating_type": "critic",
      "value": 93,
      "vote_count": null,
      "raw_value": "93%"
    }
  ]
}
```

**curl example:**
```bash
curl -b cookies.txt "http://localhost:7331/api/ratings?mediaParentId=42"
```

---

### `POST /api/ratings`

Fetch fresh external ratings from OMDb/Discogs/MusicBrainz.

**Request:**
```json
{
  "mediaParentId": 42,
  "refresh": true
}
```

Or for an album:
```json
{
  "mediaChildId": 789,
  "refresh": true
}
```

---

## Stats

### `GET /api/stats`

Get playback stats for a specific item.

**Query params:**
| Param | Values | Description |
|-------|--------|-------------|
| `type` | `track`, `album`, `artist`, `movie`, `show` | Item type |
| `id` | number | Item ID (media_children.id for track/album, media_parents.id for others) |

**Response (200):**
```json
{
  "type": "artist",
  "id": 1466,
  "play_count": 936,
  "last_played": "2026-03-10T14:22:00Z",
  "first_played": "2025-06-15T20:00:00Z"
}
```

**curl example:**
```bash
curl -b cookies.txt "http://localhost:7331/api/stats?type=artist&id=1466"
```

---

## User Endpoints (Public)

These endpoints are **unauthenticated** — designed for external widgets, home automation, and dashboards.

### `GET /api/users/:userId/stats`

Collection and playback statistics for a user.

**Response (200):**
```json
{
  "userId": 1,
  "collection": {
    "shows": 45,
    "movies": 1300,
    "artists": 250,
    "collectedItems": 15000,
    "totalRuntimeHours": 8500
  },
  "playback": {
    "totalPlays": 12500,
    "uniqueItemsPlayed": 3200,
    "totalPlayedHours": 4100,
    "firstPlay": "2024-01-15T12:00:00Z",
    "lastPlay": "2026-03-10T15:30:00Z"
  },
  "topItems": [
    {
      "parent_title": "Radiohead",
      "item_title": "OK Computer",
      "media_type": "artist",
      "play_count": 85
    }
  ]
}
```

**curl example:**
```bash
curl http://localhost:7331/api/users/1/stats
```

---

### `GET /api/users/:userId/history`

Paginated playback history for a user (same params as `/api/history`).

**Query params:** `page`, `limit`, `type`

---

### `GET /api/users/:userId/favorites`

Most-watched/played items, ranked by play count.

**Query params:**
| Param | Default | Description |
|-------|---------|-------------|
| `type` | — | Filter: `show`, `movie`, `artist` |
| `limit` | `20` | Max results (max 100) |

**Response (200):**
```json
{
  "userId": 1,
  "favorites": [
    {
      "parent_id": 1466,
      "parent_title": "Ghost",
      "media_type": "artist",
      "poster_url": "...",
      "play_count": 936,
      "total_seconds": 180000,
      "last_played": "2026-03-10T14:22:00Z"
    }
  ]
}
```

---

### `GET /api/users/:userId/now-playing`

Get active playback sessions for a user. Perfect for home automation dashboards.

**Response (200):**
```json
{
  "userId": 1,
  "playing": true,
  "sessions": [
    {
      "session_id": 1,
      "title": "OK Computer",
      "media_type": "artist",
      "progress_ticks": 50000000,
      "runtime_ticks": 100000000,
      "started_at": "2026-03-10T15:30:00Z",
      "is_paused": false,
      "progress_pct": 50.0
    }
  ]
}
```

**curl example:**
```bash
curl http://localhost:7331/api/users/1/now-playing
```

---

## Natural Language Queries

### `POST /api/ask`

Chat with your media library using natural language. Uses Ollama LLM for text-to-SQL conversion and conversational responses.

**Requires:** Ollama configured in settings.

**Request:**
```json
{ "question": "What movies did I watch this week?" }
```

**Response — data query (200):**
```json
{
  "question": "What movies did I watch this week?",
  "type": "data",
  "sql": "SELECT DISTINCT mp.title, mp.release_year, ph.timestamp FROM playback_history ph JOIN media_children mc ON ph.media_id = mc.id JOIN media_parents mp ON mc.parent_id = mp.id WHERE mp.media_type = 'movie' AND ph.timestamp > datetime('now', '-7 days') AND ph.user_id = 1 ORDER BY ph.timestamp DESC",
  "results": [
    { "title": "The Matrix", "release_year": 1999, "timestamp": "2026-03-08T20:00:00Z" }
  ],
  "count": 3,
  "summary": "You watched 3 movies this week: The Matrix, Blade Runner 2049, and Dune."
}
```

**Response — chat (200):**
```json
{
  "question": "recommend a good sci-fi movie",
  "type": "chat",
  "summary": "Based on your collection, you might enjoy..."
}
```

**curl example:**
```bash
curl -b cookies.txt -X POST http://localhost:7331/api/ask \
  -H "Content-Type: application/json" \
  -d '{"question":"How many albums do I have?"}'
```

---

## Settings

### `GET /api/settings`

Get current app settings. API keys are masked as `••••••••`.

**Response (200):**
```json
{
  "jellyfinUrl": "http://192.168.1.50:8096",
  "theme": "dark",
  "includeSpecials": false,
  "tvdbApiKey": "••••••••",
  "tmdbApiKey": "••••••••",
  "setupComplete": true,
  "heartBorderMovies": true,
  "radarrUrl": "http://192.168.1.50:7878",
  "radarrApiKey": "••••••••",
  "sonarrUrl": "",
  "lidarrUrl": "http://192.168.1.50:8686",
  "lidarrApiKey": "••••••••",
  "omdbApiKey": "••••••••",
  "discogsToken": "••••••••",
  "fanartApiKey": "••••••••"
}
```

---

### `PUT /api/settings`

Update app settings. Only provided fields are updated.

**Request:**
```json
{
  "jellyfin_url": "http://192.168.1.50:8096",
  "tmdb_api_key": "your_key_here",
  "ollama_url": "http://192.168.1.100:11434",
  "ollama_chat_model": "llama3.2:latest"
}
```

**Allowed fields:** `jellyfin_url`, `theme`, `tvdb_api_key`, `tmdb_api_key`, `musicbrainz_api_key`, `include_specials`, `trakt_client_id`, `trakt_client_secret`, `lastfm_api_key`, `lastfm_shared_secret`, `jellyfin_pr_db_path`, `jellyfin_sync_check`, `ollama_url`, `ollama_embed_model`, `ollama_chat_model`, `radarr_url`, `radarr_api_key`, `radarr_external_url`, `sonarr_url`, `sonarr_api_key`, `sonarr_external_url`, `lidarr_url`, `lidarr_api_key`, `lidarr_external_url`, `omdb_api_key`, `discogs_token`, `fanart_api_key`, `heart_border_movies`, `heart_border_shows`, `heart_border_music`, `heart_border_people`

**Response (200):**
```json
{ "success": true }
```

---

### `POST /api/settings/validate`

Test connectivity to a Jellyfin server.

**Request:**
```json
{ "url": "http://192.168.1.50:8096" }
```

---

### `POST /api/settings/validate-pr-db`

Validate that a playback reporting database path exists and is readable.

**Request:**
```json
{ "path": "/app/jellyfin/playback_reporting.db" }
```

---

## Image Proxy

### `GET /api/image?url=<encoded_url>`

Proxy and cache external images. Avoids CORS/ORB issues and provides local caching with 24h `Cache-Control`.

**Query params:**
| Param | Description |
|-------|-------------|
| `url` | URL-encoded image URL to proxy |

**Allowed sources:** `image.tmdb.org`, `artworks.thetvdb.com`, `coverartarchive.org`, `img.discogs.com`, `assets.fanart.tv`, Jellyfin (private IPs, `/Items/` paths), `localhost`

**Response:** Raw image bytes with appropriate `Content-Type`.

**curl example:**
```bash
curl "http://localhost:7331/api/image?url=https%3A%2F%2Fimage.tmdb.org%2Ft%2Fp%2Fw500%2Fabc.jpg" -o poster.jpg
```

---

### `GET /api/icons/:service`

Get a service icon (e.g., `tmdb`, `tvdb`, `musicbrainz`, `discogs`, `fanart`).

**Response:** SVG image with 30-day cache.

---

## Sync & Backfill

### `POST /api/sync`

Start a Jellyfin library sync. Returns an SSE stream of progress events.

**Request:**
```json
{
  "libraryId": "abc123",
  "libraryName": "Movies"
}
```

**SSE Response stream:**
```
data: {"type":"progress","library":"Movies","synced":50,"total":1300,"title":"The Matrix"}
data: {"type":"complete","library":"Movies","synced":1300,"errors":0,"duration":"1m 30s"}
```

---

### `GET /api/sync`

SSE stream for monitoring all active sync operations.

---

### `GET /api/sync/status`

Get current sync status for all libraries.

**Response (200):**
```json
{
  "syncing": true,
  "libraries": [
    { "id": "abc", "name": "Movies", "status": "syncing", "progress": 50 }
  ]
}
```

---

### `POST /api/sync/item`

Sync a single item from Jellyfin by Jellyfin ID.

**Request:**
```json
{ "jellyfinId": "abc123def456" }
```

---

### `POST /api/backfill`

Run TMDB enrichment for all media parents (overview, poster, release year).

---

### `POST /api/backfill/backdrops`

Enrich backdrops from Fanart.tv and TMDB. SSE stream response.

**SSE events:**
```
data: {"type":"progress","done":10,"total":100,"enriched":8,"title":"Ghost"}
data: {"type":"complete","enriched":95,"total":100}
```

---

### `POST /api/backfill/history`

Import playback history from Jellyfin's Playback Reporting plugin database.

**Request:**
```json
{ "daysBack": 365 }
```

---

### `POST /api/backfill/jellyfin`

Backfill Jellyfin metadata (runtime, community rating) for items missing data.

---

### `POST /api/backfill/rebuild`

Full library rebuild — re-syncs all items from Jellyfin.

---

### `POST /api/backfill/wikipedia`

Enrich items with Wikipedia summaries. SSE stream response.

---

### `POST /api/sync/people-ids`

Sync TMDB person IDs for all credited people.

---

### `POST /api/sync/reconcile`

Run reconciliation to match local items with external services.

---

## Enrichment

### `POST /api/people/sync`

Sync people data (bios, photos) from TMDB. SSE stream with progress.

**Request:**
```json
{ "batchSize": 50 }
```

---

### `POST /api/people/:id/sync`

Sync a single person's data from TMDB.

---

### `GET /api/people/:id/bio`

Get a person's biography and metadata.

---

### `POST /api/musicbrainz/enrich`

Enrich music data from MusicBrainz (album counts, release dates). SSE stream.

---

### `POST /api/reconcile/enrich`

Enrich existing media records with data from external APIs. SSE stream.

---

### `POST /api/reconcile/run`

Run the reconciliation engine to match unmatched items.

**Request:**
```json
{ "mediaType": "movie", "dryRun": false }
```

---

### `GET /api/reconcile/run/report`

Get the latest reconciliation report.

---

### `GET /api/reconcile/unmatched`

List unmatched media items.

**Query params:** `type` (movie|show|artist), `page`, `limit`

---

### `GET /api/reconcile/unmatched/children`

List unmatched child items (episodes, albums).

---

## AI / Ollama

### `GET /api/ollama/health`

Check Ollama connectivity and list available models.

**Query params:**
| Param | Description |
|-------|-------------|
| `url` | Ollama server URL to test |

**Response (200):**
```json
{
  "ok": true,
  "models": ["llama3.2:latest", "nomic-embed-text:latest"],
  "modelCount": 2
}
```

---

### `GET /api/ollama/scan`

Scan the local network for Ollama instances.

---

### `POST /api/embeddings/generate`

Generate embeddings for media overviews and titles. SSE stream.

---

### `GET /api/embeddings/generate`

Get current embedding statistics.

**Response (200):**
```json
{
  "totalParentsWithOverview": 2129,
  "overviewEmbeddings": 1500,
  "totalChildren": 41402,
  "titleEmbeddings": 30000
}
```

---

### `POST /api/tags/generate`

Generate AI tags for media items using Ollama. SSE stream.

---

### `GET /api/tags/generate`

Get current tagging statistics.

---

## *arr Integration

### `POST /api/arr/test`

Test connection to a *arr service.

**Request:**
```json
{
  "service": "radarr",
  "url": "http://192.168.1.50:7878",
  "apiKey": "your_api_key"
}
```

**Response (200):**
```json
{ "success": true, "name": "Radarr", "version": "5.0.0" }
```

---

### `GET /api/arr/scan`

Scan local network for *arr service instances.

---

### `GET /api/arr/profiles`

Get quality profiles from all configured *arr services.

---

### `POST /api/arr/sync`

Sync metadata from *arr services (monitored status, quality profiles, etc.).

**Query params:**
| Param | Description |
|-------|-------------|
| `service` | Optional: `radarr`, `sonarr`, or `lidarr` (syncs all if omitted) |

---

### `POST /api/arr/:service/search`

Search for items in a *arr service.

**Request:**
```json
{ "query": "The Matrix" }
```

---

### `POST /api/arr/:service/add`

Add an item to a *arr service for monitoring/download.

**Request:**
```json
{
  "mediaParentId": 42,
  "qualityProfileId": 1,
  "rootFolderPath": "/movies"
}
```

---

### `PUT /api/arr/:service/monitor`

Toggle monitoring status for an item in *arr.

**Request:**
```json
{
  "mediaParentId": 42,
  "monitored": true
}
```

---

### `GET /api/arr/:service/releases`

Get available releases/downloads for an item.

**Query params:** `mediaParentId`

---

### `POST /api/arr/:service/releases`

Trigger a manual download of a specific release.

---

### `GET /api/arr/:service/file-info`

Get file information (quality, size, path) for a *arr item.

**Query params:** `mediaParentId`

---

## Spokes (Trakt & Last.fm)

### `GET /api/spokes/trakt`

Initiate Trakt OAuth flow. Redirects to Trakt authorization page.

**Query params:**
| Param | Description |
|-------|-------------|
| `start` | Set to `1` to start OAuth |
| `disconnect` | Set to `1` to disconnect |

---

### `GET /api/spokes/trakt/callback`

OAuth callback handler for Trakt. Handles token exchange.

---

### `POST /api/spokes/trakt/scrobble`

Sync watch history to/from Trakt. SSE stream.

---

### `GET /api/spokes/lastfm`

Initiate Last.fm OAuth flow.

---

### `GET /api/spokes/lastfm/callback`

OAuth callback handler for Last.fm.

---

### `POST /api/spokes/lastfm/scrobble`

Sync scrobble history from Last.fm. SSE stream.

---

## Discovery

### `GET /api/discover/person/:id`

Discover a person by TMDB ID. Returns full biography, filmography, and images.

---

### `GET /api/discover/artist/:id`

Discover an artist by local ID. Returns full discography and Fanart.tv images.

---

### `POST /api/discover/add`

Add a discovered movie/show to the library from TMDB.

**Request:**
```json
{
  "tmdbId": 550,
  "mediaType": "movie"
}
```

---

### `POST /api/discover/add-album`

Add a discovered album to an artist's collection.

---

### `GET /api/discover/test-tmdb`

Test TMDB API key connectivity.

---

## Ingest (Webhooks)

### `POST /api/ingest`

Receive Jellyfin webhook payloads. Configure the Jellyfin Webhook Plugin to point to this URL.

**Request:** Jellyfin webhook JSON payload (automatically parsed).

**Response (200):**
```json
{ "success": true, "event": "PlaybackStart", "itemTitle": "OK Computer" }
```

---

### `GET /api/ingest`

SSE stream for real-time "Now Playing" updates from Jellyfin.

**SSE events:**
```
data: {"type":"connected","activeSessions":[...]}
data: {"type":"playback_start","title":"OK Computer","user":"admin"}
data: {"type":"playback_progress","progress_pct":45.2}
data: {"type":"playback_stop","title":"OK Computer"}
```

---

## API Keys

### `GET /api/api-keys`

List all API keys (admin sees all, users see their own).

**Response (200):**
```json
{
  "keys": [
    {
      "id": 1,
      "name": "Home Assistant Widget",
      "key_prefix": "mj_abc12345",
      "permissions": ["read:media"],
      "last_used_at": "2026-03-10T15:00:00Z",
      "created_at": "2026-03-01T12:00:00Z",
      "expires_at": null
    }
  ]
}
```

---

### `POST /api/api-keys`

Create a new API key (admin only).

**Request:**
```json
{
  "name": "Home Assistant Widget",
  "permissions": ["read:media"],
  "expiresAt": "2027-01-01T00:00:00Z"
}
```

**Valid permissions:** `read:media`, `write:media`, `read:sync`, `write:sync`, `admin`

**Response (201):**
```json
{
  "id": 1,
  "name": "Home Assistant Widget",
  "key": "mj_abc123def456...",
  "keyPrefix": "mj_abc12345",
  "permissions": ["read:media"],
  "expiresAt": "2027-01-01T00:00:00Z"
}
```

> ⚠️ The full `key` is **only returned once** at creation. Store it securely.

---

### `DELETE /api/api-keys/:id`

Revoke an API key.

---

## Backup & Restore

### `GET /api/backup`

Export full database backup as JSON.

**Query params:**
| Param | Default | Description |
|-------|---------|-------------|
| `includeImages` | `false` | Include cached images (base64) |

**Response:** JSON file download containing all media, history, settings, etc.

**curl example:**
```bash
curl -b cookies.txt "http://localhost:7331/api/backup" -o backup.json
```

---

### `POST /api/backup/import`

Import a backup JSON file.

**Request:** `multipart/form-data` with the backup JSON file.

**Query params:**
| Param | Default | Description |
|-------|---------|-------------|
| `includeImages` | `false` | Import cached images |

---

### `POST /api/factory-reset`

Reset the database to a fresh state. **Destructive — cannot be undone.**

**Request:**
```json
{ "confirm": "RESET" }
```

---

## Tracks

### `GET /api/tracks/:albumId`

Get tracks for a music album.

**Params:** `albumId` is the Jellyfin ID of the album.

**Response (200):**
```json
[
  {
    "Id": "jellyfin-id-123",
    "Name": "Square Hammer",
    "IndexNumber": 1,
    "ParentIndexNumber": 1,
    "RunTimeTicks": 2400000000,
    "musicbrainz_id": "abc-123"
  }
]
```

---

## Debug

### `GET /api/debug/movie/:id`

Get raw debug data for a movie (all DB fields, children, credits).

### `GET /api/debug/trakt-check/:tmdbId`

Check if a TMDB ID exists in Trakt history.

### `GET /api/debug/unmatched/:artistId`

Debug unmatched albums for a specific artist.

---

## User Preferences

### `GET /api/user/preferences`

Get the current user's preferences.

### `PUT /api/user/preferences`

Update user preferences.

---

## Auto Sync

### `POST /api/auto-sync`

Configure automatic sync scheduling.

**Request:**
```json
{
  "enabled": true,
  "intervalHours": 6
}
```

---

## Jellyfin

### `POST /api/jellyfin/remote`

Send a remote command to Jellyfin (play, pause, stop).

### `GET /api/jellyfin/sessions`

Get active Jellyfin sessions.

---

## Album Matching

### `GET /api/albums/match`

Search for album matches in external databases.

### `POST /api/albums/match`

Apply an album match.

### `GET /api/albums/match/artist-albums`

Get albums for an artist from external databases.

---

## Conflicts

### `GET /api/conflicts`

List data conflicts that need resolution.

### `POST /api/conflicts`

Resolve a conflict.

---

# LLM Integration Guide

This section explains how other LLMs and AI agents can effectively interact with the Mediajam API.

## Getting Started

### 1. Authenticate

All API calls (except `/api/users/*` public endpoints) require authentication. Start by logging in:

```bash
# Get a session cookie
curl -c cookies.txt -X POST http://mediajam:7331/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"password"}'

# Use cookie for subsequent requests
curl -b cookies.txt http://mediajam:7331/api/search?q=matrix
```

Or use an API key (created via `POST /api/api-keys`):
```bash
curl -H "Authorization: Bearer mj_your_api_key_here" \
  http://mediajam:7331/api/search?q=matrix
```

### 2. Understand the Data Model

```
┌─────────────────┐     ┌──────────────────┐     ┌───────────────┐
│  media_parents   │────▶│  media_children   │────▶│    tracks     │
│  (movies, shows, │     │  (episodes,       │     │  (audio only) │
│   artists)       │     │   albums, movie   │     └───────────────┘
│                  │     │   single-child)   │
│  Fields:         │     │                   │     ┌───────────────┐
│  - media_type    │     │  Fields:          │────▶│playback_history│
│  - title         │     │  - season_number  │     │  (per user)   │
│  - tmdb_id       │     │  - item_number    │     └───────────────┘
│  - imdb_id       │     │  - watch_status   │
│  - musicbrainz_id│     │  - play_count     │
│  - is_favorite   │     │  - runtime_ticks  │
└────────┬─────────┘     └──────────────────┘
         │
         ▼
┌─────────────────┐     ┌──────────────────┐
│ person_credits   │────▶│    persons        │
│                  │     │  - name           │
│  - role_type     │     │  - tmdb_person_id │
│  - character_name│     │  - photo_url      │
└─────────────────┘     └──────────────────┘
```

**Key relationships:**
- `media_parents` → `media_children`: One-to-many (show→episodes, artist→albums, movie→1 child)
- `media_children` → `playback_history`: One-to-many (each play is recorded)
- `media_parents` → `person_credits` → `persons`: Many-to-many via credits

### 3. Common Tasks

#### Browse the library
```bash
# Search for anything
curl "http://mediajam:7331/api/search?q=radiohead"

# Get user stats
curl "http://mediajam:7331/api/users/1/stats"

# Get playback history
curl "http://mediajam:7331/api/users/1/history?type=movie&limit=10"
```

#### Ask natural language questions
```bash
# If Ollama is configured, ask anything about the library
curl -X POST http://mediajam:7331/api/ask \
  -H "Content-Type: application/json" \
  -d '{"question":"What are my most watched TV shows?"}'
```

The `/api/ask` endpoint handles:
- **Data queries** → Generates SQL, executes against the DB, and returns results with a natural language summary
- **Chat** → Responds conversationally about media topics

#### Manage favorites
```bash
# Favorite a movie
curl -X POST http://mediajam:7331/api/favorite \
  -H "Content-Type: application/json" \
  -d '{"type":"media","id":42,"isFavorite":true}'

# Check now playing
curl "http://mediajam:7331/api/users/1/now-playing"
```

#### Fix metadata
```bash
# Correct a wrong MusicBrainz ID (auto-merges duplicates)
curl -X PATCH http://mediajam:7331/api/media/1466 \
  -H "Content-Type: application/json" \
  -d '{"field":"musicbrainz_id","value":"correct-mbid-here"}'

# Clear a stale image
curl -X PATCH http://mediajam:7331/api/media/1466 \
  -H "Content-Type: application/json" \
  -d '{"field":"backdrop_url","value":null}'
```

### 4. SSE Streams

Many sync/backfill endpoints return **Server-Sent Events** (SSE) streams. To consume them:

```bash
# Stream sync progress
curl -N -X POST http://mediajam:7331/api/sync \
  -H "Content-Type: application/json" \
  -d '{"libraryId":"abc","libraryName":"Movies"}'
```

SSE format:
```
data: {"type":"progress","done":50,"total":1300,"title":"The Matrix"}
data: {"type":"complete","synced":1300}
```

### 5. Error Handling

All errors follow this pattern:
```json
{ "error": "Description of what went wrong" }
```

Common HTTP status codes:
| Code | Meaning |
|------|---------|
| 200 | Success |
| 201 | Created (new resource) |
| 400 | Bad request (missing/invalid params) |
| 401 | Unauthorized (need login) |
| 403 | Forbidden (need admin) |
| 404 | Not found |
| 502 | Upstream service error (Jellyfin, TMDB, etc.) |
| 503 | Service unavailable (Ollama not configured) |

### 6. Tips for LLMs

1. **Start with `/api/users/:userId/stats`** to understand the library size and scope.
2. **Use `/api/search`** for finding specific media items by name.
3. **Use `/api/ask`** for complex queries — it translates natural language to SQL internally.
4. **The public `/api/users/*` endpoints don't need auth** — great for read-only integrations.
5. **Image URLs** from the API should be proxied through `/api/image?url=<encoded_url>` for reliable loading.
6. **All timestamps are ISO 8601** format.
7. **`media_type`** values are: `movie`, `show`, `artist` (on `media_parents`).
8. **`runtime_ticks`** are in 100-nanosecond intervals (Jellyfin format). Divide by 10,000,000 for seconds.
