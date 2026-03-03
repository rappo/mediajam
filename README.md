# 🎬 Mediajam

Beautiful analytics dashboard and **media telemetry hub** for your [Jellyfin](https://jellyfin.org/) media server. Track your TV shows, movies, and music collection with rich visualizations, real-time playback tracking, and historical imports from Trakt & Last.fm.

![SvelteKit](https://img.shields.io/badge/SvelteKit-FF3E00?style=flat&logo=svelte&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-003B57?style=flat&logo=sqlite&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-38B2AC?style=flat&logo=tailwind-css&logoColor=white)
![daisyUI](https://img.shields.io/badge/daisyUI-5A0EF8?style=flat&logo=daisyui&logoColor=white)

## Features

### Collection Dashboards
- 📺 **TV Shows** — Episode watch status, show completion rates, collection gaps, top shows by episode count
- 🎬 **Movies** — Watch status breakdown, movies by decade/year, most rewatched films, runtime stats
- 🎵 **Music** — Artist & album counts, play counts, collection completeness per artist
- 📦 **Collection Tracking** — See what % of each show/artist you have vs. what's available on Jellyfin

### Media Telemetry Hub (`feature/tracker-pivot`)
- ⏱ **Playback History Timeline** — Event-based tracking with timestamps, duration, and completion percentage
- 🔴 **Now Playing** — Real-time glassmorphic card powered by SSE, showing active playback sessions
- 🔗 **Trakt & Last.fm Integration** — Full OAuth flows for linking accounts and importing history
- 📊 **Three-Tiered Backfill Engine** — Import from cloud services (Trakt/Last.fm), Jellyfin Playback Reporting DB, or binary watched state
- 🌐 **Per-User Public API** — Unauthenticated endpoints for external widgets (`/api/users/:id/now-playing`, `/history`, `/stats`, `/favorites`)
- 🔄 **Webhook Ingestion** — Receives Jellyfin webhook events with 2-second debounce and smart scrobble thresholds
- 🎯 **Cross-Source Deduplication** — `external_event_id` ensures the same event is never imported twice

### General
- 🧙 **Onboarding Wizard** — Auto-discover your Jellyfin server, select libraries, configure API keys
- 🎨 **30+ Themes** — All daisyUI themes with live preview, persisted per user
- 🔄 **Real-time Sync** — SSE-powered progress with per-library tracking, pause/resume controls
- 📊 **Interactive Charts** — CanvasJS-powered bar charts, pie charts, and distribution graphs
- 🔍 **DataTable** — Sortable, searchable tables with "Show All" and "Hide Collected" filters

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | [SvelteKit](https://kit.svelte.dev/) with `@sveltejs/adapter-node` |
| Database | [SQLite](https://sqlite.org/) via `better-sqlite3` |
| Styling | [Tailwind CSS v4](https://tailwindcss.com/) + [daisyUI](https://daisyui.com/) |
| Charts | [CanvasJS](https://canvasjs.com/) |
| API | [Jellyfin API](https://api.jellyfin.org/), [Trakt API](https://trakt.docs.apiary.io/), [Last.fm API](https://www.last.fm/api/) |

## Quick Start

```bash
# Clone the repository
git clone http://192.168.1.50:3210/rappo/mediajam.git
cd mediajam

# Install dependencies
npm install

# Start development server
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) — the setup wizard will guide you through connecting to your Jellyfin server.

### Tracker Pivot Branch

The `feature/tracker-pivot` branch adds the media telemetry hub features (playback history, backfill engine, OAuth flows, per-user API, Now Playing):

```bash
# Switch to the tracker pivot branch
git checkout feature/tracker-pivot

# Install dependencies (if not already done)
npm install

# Start development server
npm run dev
```

After starting the server, `/` redirects to the new `/history` timeline view. To set up real-time tracking:

1. Install the [Jellyfin Webhook Plugin](https://github.com/jellyfin/jellyfin-plugin-webhook)
2. Configure it to send `PlaybackStart`, `PlaybackProgress`, and `PlaybackStop` events to `http://<mediajam-host>:5173/api/ingest`
3. Playback events will appear in the History timeline automatically

To import historical data from Trakt or Last.fm, configure API keys in Settings and use the backfill endpoints.

## Production Build

```bash
npm run build
node build/index.js
```

## Docker

```bash
# Build the image
docker build -t mediajam .

# Run with persistent data
docker run -d \
  -p 3000:3000 \
  -v mediajam_data:/app/data \
  --name mediajam \
  mediajam
```

### Docker Compose (with Jellyfin Playback Reporting)

```yaml
services:
  mediajam:
    build: .
    ports:
      - "3000:3000"
    volumes:
      - mediajam_data:/app/data
      # Mount Jellyfin's Playback Reporting DB (read-only)
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

## Project Structure

```
src/
├── lib/
│   ├── components/
│   │   ├── Chart.svelte           # CanvasJS chart wrapper
│   │   ├── DataTable.svelte       # Sortable/searchable table
│   │   ├── StatCard.svelte        # Glassmorphic stat card
│   │   ├── NowPlaying.svelte      # Live SSE now-playing card
│   │   ├── TimelineEntry.svelte   # Playback history entry
│   │   └── setup/                 # Onboarding wizard steps
│   └── server/
│       ├── db.js                  # SQLite schema & connection
│       ├── sync-engine.js         # Jellyfin collection sync
│       ├── ingest-engine.js       # Webhook ingestion & scrobble logic
│       └── backfill-engine.js     # Three-tiered history import
├── routes/
│   ├── +layout.svelte             # App shell with navbar
│   ├── history/                   # Playback history timeline (default)
│   ├── tv/                        # TV Shows dashboard
│   ├── movies/                    # Movies dashboard
│   ├── music/                     # Music dashboard
│   ├── settings/                  # Settings & re-sync
│   └── api/
│       ├── sync/                  # Collection sync + SSE
│       ├── ingest/                # Webhook ingestion + Now Playing SSE
│       ├── history/               # Paginated playback timeline
│       ├── backfill/history/      # Backfill trigger + progress SSE
│       ├── spokes/trakt/          # Trakt OAuth + scrobble
│       ├── spokes/lastfm/         # Last.fm auth + scrobble
│       ├── users/[userId]/        # Per-user public API
│       └── settings/              # Settings CRUD
└── app.css                        # Global styles & Tailwind config
```

## API Endpoints

### Public Per-User API (unauthenticated)

| Endpoint | Description |
|----------|-------------|
| `GET /api/users/:id/now-playing` | Active playback sessions |
| `GET /api/users/:id/history?page=1&type=show` | Paginated playback history |
| `GET /api/users/:id/stats` | Collection & playback statistics |
| `GET /api/users/:id/favorites?type=movie` | Most-played items |

### Internal API

| Endpoint | Description |
|----------|-------------|
| `POST /api/ingest` | Receive Jellyfin webhook events |
| `GET /api/ingest` | SSE stream for Now Playing updates |
| `GET /api/history` | Paginated playback timeline |
| `POST /api/backfill/history` | Trigger backfill tier (`trakt`, `lastfm`, `jellyfin`, `legacy`) |
| `GET /api/backfill/history` | SSE stream for backfill progress |
| `GET /api/spokes/trakt` | Trakt OAuth redirect |
| `GET /api/spokes/lastfm` | Last.fm auth redirect |

## Data Storage

SQLite database is stored at:

- **Development:** `./mediajam.sqlite`
- **Docker:** `/app/data/mediajam.sqlite` (mount a volume for persistence)

## License

MIT
