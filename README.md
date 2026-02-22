# 🎬 Mediajam

Beautiful analytics dashboard for your [Jellyfin](https://jellyfin.org/) media server. Track your TV shows, movies, and music collection with rich visualizations and detailed statistics.

![SvelteKit](https://img.shields.io/badge/SvelteKit-FF3E00?style=flat&logo=svelte&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-003B57?style=flat&logo=sqlite&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-38B2AC?style=flat&logo=tailwind-css&logoColor=white)
![daisyUI](https://img.shields.io/badge/daisyUI-5A0EF8?style=flat&logo=daisyui&logoColor=white)

## Features

- 🧙 **Onboarding Wizard** — Auto-discover your Jellyfin server, select libraries, configure API keys
- 📺 **TV Shows Dashboard** — Episode watch status, show completion rates, collection gaps, top shows by episode count
- 🎬 **Movies Dashboard** — Watch status breakdown, movies by decade/year, most rewatched films, runtime stats
- 🎵 **Music Dashboard** — Artist & album counts, play counts, collection completeness per artist
- 📦 **Collection Tracking** — See what % of each show/artist you have vs. what's available on Jellyfin
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
| API | [Jellyfin API](https://api.jellyfin.org/) |

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
│   ├── components/       # Reusable Svelte components
│   │   ├── Chart.svelte       # CanvasJS chart wrapper
│   │   ├── DataTable.svelte   # Sortable/searchable table
│   │   ├── StatCard.svelte    # Glassmorphic stat card
│   │   └── setup/             # Onboarding wizard steps
│   └── server/
│       ├── db.js              # SQLite schema & connection
│       └── sync-engine.js     # Jellyfin sync with SSE events
├── routes/
│   ├── +layout.svelte         # App shell with sidebar nav
│   ├── tv/                    # TV Shows dashboard
│   ├── movies/                # Movies dashboard
│   ├── music/                 # Music dashboard
│   ├── settings/              # Settings & re-sync
│   └── api/
│       ├── sync/              # Sync start/pause/resume + SSE stream
│       └── settings/          # Settings CRUD
└── app.css                    # Global styles & Tailwind config
```

## Data Storage

SQLite database is stored at:

- **Development:** `./mediajam.sqlite`
- **Docker:** `/app/data/mediajam.sqlite` (mount a volume for persistence)

## License

MIT
