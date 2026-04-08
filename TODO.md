# Mediajam — Roadmap & Future Plans

Centralized list of planned features, improvements, and ideas for Mediajam.

---

## *arr Integration — Remaining Work

Phase 1 (connection, read-only sync, network discovery) and Phase 2 (add, search, monitor) are complete. Remaining:

### Phase 3: Dashboard & Calendar
- [ ] Upcoming releases widget from *arr `/calendar`
- [ ] Download queue status from *arr `/queue`
- [ ] Wanted/missing page
- [ ] Notification when downloads complete

### Phase 4: Deep Integration
- [ ] Backfill missing external IDs from *arr into Mediajam
- [ ] Two-way monitored status sync
- [ ] Collection/franchise grouping from Radarr collections
- [ ] Activity feed integration (recently grabbed, imported, etc.)

> See `docs/arr-integration-plan.md` for full API research and architecture details.

---

## External API

Make Mediajam a headless media control hub — external apps (voice assistants, CLI, Home Assistant, mobile apps) can query your library and control playback.

- [ ] API key generation & management (per-user, revocable)
- [ ] RESTful library query endpoints (`/api/tv`, `/api/movies`, `/api/music/artists`)
- [ ] Smart convenience endpoints (`/api/play/next/{showId}`, `/api/play/random`)
- [ ] OpenAPI/Swagger documentation
- [ ] Home Assistant custom component

> See `docs/external-api.md` for detailed endpoint specs and example flows.

---

## LLM Features

Ollama integration infrastructure is complete. Remaining features:

### Matching & Reconciliation
- [ ] Embedding-based album matching (Tier 0 in matching pipeline, using `sqlite-vec`)
- [ ] Embedding-based artist matching for orphans
- [x] LLM-powered tag generation (auto-tagging)
- [x] LLM orphan reconciliation pipeline

### Search & Discovery
- [ ] Semantic search via overview embeddings (search by concept/mood/genre)
- [ ] Natural language queries (text-to-SQL)
- [ ] Embedding-based content recommendations

> See `docs/llm-brainstorm.md` for full exploration of LLM use cases.
> See `docs/llm-reconciliation-plan.md` for the orphan reconciliation pipeline detail.

---

## General Improvements

- [ ] Mobile-responsive layout improvements
- [ ] Collection/franchise grouping UI
- [ ] Watch party / shared session features
