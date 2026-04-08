# 🎬 Mediajam

Self-hosted media telemetry hub for [Jellyfin](https://jellyfin.org/). Track your TV shows, movies, and music with rich dashboards, real-time playback monitoring, and historical imports from Trakt & Last.fm.

![SvelteKit](https://img.shields.io/badge/SvelteKit-FF3E00?style=flat&logo=svelte&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-003B57?style=flat&logo=sqlite&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-38B2AC?style=flat&logo=tailwind-css&logoColor=white)
![daisyUI](https://img.shields.io/badge/daisyUI-5A0EF8?style=flat&logo=daisyui&logoColor=white)

## Features

### Playback Tracking
- ⏱ **History Timeline** — Full playback history with date grouping, text search, date range filtering, and a year scrub bar
- 🔴 **Now Playing** — Real-time glassmorphic card showing active sessions via SSE
- 🔗 **Trakt & Last.fm Integration** — OAuth flows for linking accounts and importing watch/listen history
- 📊 **Three-Tiered Backfill Engine** — Import from cloud services, Jellyfin Playback Reporting DB, or binary watched state
- 🔄 **Webhook Ingestion** — Receives Jellyfin webhook events with 2-second debounce and smart scrobble thresholds
- 🎯 **Cross-Source Deduplication** — `external_event_id` ensures events are never imported twice

### Collection Dashboards
- 📺 **TV Shows** — Episode watch status, show completion rates, poster carousels, collection gaps
- 🎬 **Movies** — Watch status breakdown, movies by decade/year, most rewatched films, poster carousels
- 🎵 **Music** — Artist & album counts, play counts, collection completeness, poster carousels
- 📦 **Collection Tracking** — See what % of each show/artist you have vs. what's available

### People & Credits
- 👤 **Person Database** — Cast & crew synced from Jellyfin with external IDs (TMDB, IMDb)
- 🎭 **Credit Browsing** — Browse by actor/director/writer, see filmography across your library
- 🔍 **Person Detail Pages** — Photo, biography, filmography with poster grids

### Smart Features
- 🧠 **LLM Reconciliation** — Ollama-powered matching for orphaned/external media (Last.fm artists, etc.)
- 💬 **Ask Mediajam** — Natural language chat with your library using Ollama, OpenAI, or Gemini (floating/dockable widget)
- 🏷 **Auto-Tagging** — LLM-generated genre, mood, and theme tags for your library
- 🎨 **MusicBrainz Enrichment** — Album art, release dates, band members, and metadata backfill
- 🔗 **TMDb Stub Enrichment** — Enrich media stubs without Jellyfin IDs via TMDb credits and metadata
- ⭐ **External Ratings** — TMDB, IMDb, and Rotten Tomatoes ratings integration
- 🔎 **Global Search** — Unified search across all media types with poster previews and semantic search

### *arr Integration (Radarr · Sonarr · Lidarr)
- 📡 **Network Discovery** — Auto-scan your network for *arr instances
- ✅ **Collection Status** — See monitored/downloaded status alongside watch history
- ➕ **Add to *arr** — Request missing media directly from Mediajam with customizable quality profiles, root folders, and monitor levels
- 🔍 **Interactive Search** — Search *arr indexers from within the app with sortable release tables, quality badges, and one-click downloads
- 📺 **Episode-Level Search** — Trigger Sonarr searches for individual episodes from the episode detail page

### Infrastructure
- 🧙 **Onboarding Wizard** — Auto-discover Jellyfin, select libraries, configure API keys
- 🎨 **30+ Themes** — All daisyUI themes with live preview
- 🔄 **Real-time Sync** — SSE-powered progress with per-library tracking, pause/resume
- 💾 **Backup & Restore** — Full JSON export/import, file-based backups with scheduling, boot backups with pruning
- 📊 **Activity Log** — Searchable history of all system events
- 🖼 **Image Caching** — Local proxy cache for Jellyfin images with stale-while-revalidate
- 🌐 **Per-User Public API** — Unauthenticated endpoints for external widgets
- ⏰ **Auto-Sync Scheduler** — Configurable automatic sync intervals
- 🔗 **Slug-Based Routing** — Clean, SEO-friendly URLs for all media, people, and episode pages
- 🔄 **Nightly Pipeline** — Automated enrichment pipeline with configurable phases and scheduling
- 📋 **Data Auditing** — Snapshot and compare library state over time
- 🔀 **Conflict Resolution** — Detect and resolve data conflicts from multiple sync sources
- 🤝 **Six Degrees** — Find shortest connection paths between people in your library

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | [SvelteKit](https://kit.svelte.dev/) v2 with Svelte 5 runes |
| Adapter | `@sveltejs/adapter-node` |
| Database | [SQLite](https://sqlite.org/) via `better-sqlite3` (WAL mode) |
| Styling | [Tailwind CSS v4](https://tailwindcss.com/) + [daisyUI v5](https://daisyui.com/) |
| Charts | [CanvasJS](https://canvasjs.com/) |
| APIs | Jellyfin SDK, Trakt OAuth, Last.fm, TMDB, MusicBrainz, Radarr/Sonarr/Lidarr |
| LLM | [Ollama](https://ollama.com/), OpenAI, or Gemini (optional, for reconciliation, tagging & chat) |
| Runtime | Node.js 20 |

## Quick Start

```bash
git clone http://192.168.1.50:3210/rappo/mediajam.git
cd mediajam
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) — the setup wizard will guide you through connecting to your Jellyfin server.

## Docker

```bash
docker build -t mediajam .

docker run -d \
  -p 3000:3000 \
  -v mediajam_data:/app/data \
  --name mediajam \
  mediajam
```

### Docker Compose

```yaml
services:
  mediajam:
    build: .
    ports:
      - "3000:3000"
    volumes:
      - mediajam_data:/app/data
      # Optional: mount Jellyfin's Playback Reporting DB (read-only)
      - /path/to/jellyfin/data/playback_reporting.db:/app/jellyfin/playback_reporting.db:ro
    environment:
      - ORIGIN=http://localhost:3000
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `HOST` | `0.0.0.0` | Bind address |
| `ORIGIN` | — | Public URL (required for CSRF in production) |
| `DATABASE_PATH` | `/app/data/mediajam.sqlite` | Database file path |

## Project Structure

```
src/
├── lib/
│   ├── components/
│   │   ├── Chart.svelte                # CanvasJS chart wrapper
│   │   ├── DataTable.svelte            # Sortable/searchable table
│   │   ├── StatCard.svelte             # Glassmorphic stat card
│   │   ├── NowPlaying.svelte           # Live now-playing card (SSE)
│   │   ├── NowPlayingBar.svelte        # Persistent bottom bar
│   │   ├── TimelineEntry.svelte        # Playback history entry
│   │   ├── YearScrubber.svelte         # History timeline year scrub bar
│   │   ├── CalendarStrip.svelte        # 3-week episode/album calendar
│   │   ├── SearchBar.svelte            # Global unified search
│   │   ├── PosterRow.svelte            # Horizontal poster carousel
│   │   ├── LogConsole.svelte           # SSE log output viewer
│   │   ├── SyncFooter.svelte           # Persistent sync status bar
│   │   ├── ChatWidget.svelte           # LLM-powered "Ask Mediajam" chat
│   │   ├── ReconciliationPanel.svelte  # LLM reconciliation UI
│   │   ├── ArrAddDialog.svelte         # Add-to-*arr dialog with profiles
│   │   ├── InteractiveSearchDialog.svelte  # *arr indexer search & download
│   │   ├── CollectionStatusBanner.svelte    # *arr collection status
│   │   ├── ConflictDialog.svelte       # Data conflict resolver
│   │   └── setup/                      # Onboarding wizard steps
│   └── server/
│       ├── db.js                       # SQLite schema & connection
│       ├── sync-engine.js              # Jellyfin collection sync
│       ├── ingest-engine.js            # Webhook ingestion & scrobble logic
│       ├── backfill-engine.js          # Three-tiered history import
│       ├── homepage-engine.js          # Smart dashboard recommendations
│       ├── nightly-pipeline.js         # Automated nightly enrichment
│       ├── reconcile.js                # Deduplication & merge engine
│       ├── slugify.js                  # URL slug generation
│       ├── people-sync-engine.js       # Cast & crew sync
│       ├── musicbrainz-engine.js       # MusicBrainz album enrichment
│       ├── musicbrainz-members.js      # Band member sync
│       ├── wikipedia-backfill.js       # Wikipedia summary enrichment
│       ├── ratings-engine.js           # External ratings (TMDB, IMDb, RT)
│       ├── arr-client.js               # *arr API client
│       ├── arr-sync.js                 # *arr sync engine
│       ├── llm-reconciler.js           # LLM reconciliation (multi-provider)
│       ├── album-matcher.js            # Album fuzzy matching pipeline
│       ├── image-cache.js              # Local image proxy cache
│       ├── section-cache.js            # Precomputed dashboard cache
│       ├── session.js                  # Session management
│       ├── logger.js                   # Structured logging
│       └── jellyfin.js                 # Jellyfin SDK wrapper
├── routes/
│   ├── history/                        # Playback history timeline
│   ├── tv/                             # TV Shows dashboard + detail
│   │   └── [slug]/episode/[epSlug]/    # Episode detail pages
│   ├── movies/                         # Movies dashboard + detail
│   ├── music/                          # Music dashboard + detail
│   │   └── [slug]/[albumSlug]/         # Album detail pages
│   ├── people/                         # Person directory + detail
│   ├── settings/                       # Settings & admin panel
│   ├── welcome/                        # Post-setup welcome page
│   └── api/
│       ├── sync/                       # Collection sync + SSE
│       ├── ingest/                     # Webhook ingestion + Now Playing SSE
│       ├── history/                    # Paginated playback timeline
│       ├── backfill/                   # Backfill triggers + progress
│       ├── spokes/trakt/               # Trakt OAuth + history sync
│       ├── spokes/lastfm/              # Last.fm auth + scrobble sync
│       ├── arr/                        # *arr integration endpoints
│       │   └── sonarr/episode-search/  # Episode-level Sonarr search
│       ├── llm/                        # Gemini & OpenAI OAuth
│       ├── ask/                        # Natural language queries
│       ├── pipeline/                   # Automated sync pipeline
│       ├── calendar/                   # Upcoming media calendar
│       ├── connections/                # Six Degrees of Separation
│       ├── conflicts/                  # Data conflict resolution
│       ├── audit/                      # Data auditing
│       ├── users/[userId]/             # Per-user public API
│       ├── backup/                     # Export & import
│       ├── backups/                    # File-based backup management
│       └── settings/                   # Settings CRUD
├── docs/
│   └── openapi.yaml                    # OpenAPI 3.0 spec (Swagger UI at /api/docs)
└── app.css                             # Global styles & Tailwind config
```

## API Endpoints

Full interactive API documentation is available at `/api/docs` (Swagger UI).

### Public Per-User API (unauthenticated)

| Endpoint | Description |
|----------|-------------|
| `GET /api/users/:id/now-playing` | Active playback sessions |
| `GET /api/users/:id/history?page=1&type=show` | Paginated playback history |
| `GET /api/users/:id/stats` | Collection & playback statistics |
| `GET /api/users/:id/favorites?type=movie` | Most-played items |

### Internal API (selected)

| Endpoint | Description |
|----------|-------------|
| `POST /api/ingest` | Receive Jellyfin webhook events |
| `GET /api/ingest` | SSE stream for Now Playing |
| `GET /api/history` | Paginated playback timeline |
| `POST /api/backfill/history` | Trigger backfill (`trakt`, `lastfm`, `jellyfin`, `legacy`) |
| `POST /api/sync` | Start/pause/resume/stop collection sync |
| `GET /api/sync` | SSE stream for sync progress |
| `POST /api/sync/item` | Sync single item (Jellyfin, TMDb, or MusicBrainz enrichment) |
| `POST /api/ask` | Natural language queries via LLM |
| `POST /api/arr/scan` | Scan network for *arr instances |
| `POST /api/arr/[service]/add` | Add item to *arr for monitoring |
| `POST /api/arr/sonarr/episode-search` | Trigger Sonarr episode-level search |
| `GET /api/arr/[service]/releases` | Search *arr indexers for releases |
| `POST /api/pipeline` | Run automated enrichment pipeline |
| `GET /api/calendar` | Upcoming movies/shows calendar |
| `GET /api/connections?from=&to=` | Six Degrees of Separation |
| `POST /api/backup` | Export full backup |
| `POST /api/backup/import` | Import backup |

## Data Storage

SQLite database location:

- **Development:** `./mediajam.sqlite`
- **Docker:** `/app/data/mediajam.sqlite` (mount a volume for persistence)

## License

MIT
