# MediaJam External API — Future Phase

> **Status:** Planned, not yet implemented. Core remote playback controls are being built first on the `remote-playback` branch. This API layer builds on top of those.

## Vision

Make MediaJam a **headless media control hub** — any external app (voice assistant, CLI, mobile app, Home Assistant, Shortcuts, etc.) can query your library, check watch status, and control Jellyfin players.

## Authentication

Current app uses cookie sessions (SvelteKit). External callers need a different auth path:

- **API Key** — Generated per-user in Settings. Sent as `Authorization: Bearer <key>` or `X-API-Key: <key>`.
- Store in `api_keys` table: `id, user_id, key_hash, label, created_at, last_used_at, revoked_at`
- Settings UI: generate, label ("Home Assistant"), revoke keys
- Rate limiting optional (trust model — self-hosted)

## Endpoints

### Remote Control (already being built)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/jellyfin/sessions` | List active controllable players |
| `POST` | `/api/jellyfin/remote` | Send play/pause/stop/queue commands |

### Library Queries

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/tv` | List all TV shows |
| `GET` | `/api/tv/{id}` | Show detail with seasons |
| `GET` | `/api/tv/{id}/episodes` | All episodes, filterable: `?status=unwatched&season=3` |
| `GET` | `/api/tv/{id}/next-unwatched` | Returns the next episode to watch |
| `GET` | `/api/movies` | List all movies, filterable: `?status=unwatched&genre=comedy` |
| `GET` | `/api/movies/{id}` | Movie detail with watch history |
| `GET` | `/api/music/artists` | List artists |
| `GET` | `/api/music/albums` | List albums |
| `GET` | `/api/people/{id}` | Person detail with credits |
| `GET` | `/api/history` | Recent watch history across all media types |

### Smart / Convenience

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/play/next/{showId}` | Auto-find next unwatched episode + send to default player |
| `POST` | `/api/play/random` | Play random item, filterable: `?genre=comedy&type=movie` |
| `GET` | `/api/stats` | Global stats (total plays, most watched, etc.) |

## Example Flows

### "Which Futurama episodes haven't I watched?"
```
GET /api/tv/42/episodes?status=unwatched
Authorization: Bearer mj_abc123

→ { episodes: [
    { season: 3, episode: 7, title: "The Day the Earth Stood Stupid", jellyfin_id: "..." },
    { season: 3, episode: 8, title: "That's Lobstertainment!", jellyfin_id: "..." },
    ...
  ]}
```

### "Play the next episode on my TV"
```
POST /api/play/next/42
Authorization: Bearer mj_abc123
Content-Type: application/json
{ "player": "default" }

→ { success: true, playing: { season: 3, episode: 7, title: "The Day the Earth Stood Stupid" }, device: "Living Room TV" }
```

### "What players are available?"
```
GET /api/jellyfin/sessions
Authorization: Bearer mj_abc123

→ { sessions: [
    { id: "abc", deviceName: "Living Room TV", client: "Jellyfin Android TV", supportsMediaControl: true },
    { id: "def", deviceName: "Desktop Chrome", client: "Jellyfin Web", supportsMediaControl: true }
  ]}
```

## Implementation Notes

- Most query endpoints already have the DB queries written for the UI page servers — they just need to be exposed as JSON API routes
- The remote control routes are being built now and already serve both the UI and external callers
- Consider OpenAPI/Swagger doc generation for discoverability
- WebSocket option for real-time now-playing updates (already have SSE via `/api/ingest`)

## Integration Ideas

- **Home Assistant** — Custom component using the API
- **Apple Shortcuts / Android Tasker** — HTTP actions
- **CLI tool** — `mediajam play next futurama --player tv`
- **Discord/Slack bot** — "What's playing?" / "Queue movie for tonight"
