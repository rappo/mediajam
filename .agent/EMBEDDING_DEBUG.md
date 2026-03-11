# Embedding Persistence Debug — Continuation Notes

## Status as of 2026-03-11 02:12

### What's Fixed ✅
- **Godzilla duplicate** — person_credits `DELETE` fix resolved infinite sync loop
- **Ghost music merge** — PATCH `/api/media/1466` merged ext id=48345 (correct MB + Lidarr + poster)
- **9 duplicate artists merged** — Bad Company, Boysetsfire, Conan, Earth, Rise Against, Russian Circles, Sleep, SRV, Warning
- **Ghost portrait** — PATCHed poster_url back to theaudiodb URL
- **COALESCE fix** — `poster_url = COALESCE(?, poster_url)` and `overview = COALESCE(?, overview)` in item-sync (1 location) and sync-engine (3 locations) prevents Jellyfin null overwriting external data
- **Content-hash re-embedding** — `embedding_hashes` table + SHA-256 comparison for stale detection
- **Number() cast** — vec0 requires strict int, `better-sqlite3` returns BigInt

### What's NOT Working ❌
**Embeddings don't persist despite no errors.**

#### Facts:
1. `sqliteVecLoaded: true` — the extension loads
2. vec0 tables exist (`CREATE VIRTUAL TABLE IF NOT EXISTS` succeeds)
3. `embed('test')` returns vectors (Ollama works)
4. `Number()` fix resolved the `"Only integers are allowed"` error
5. POST generation runs (620/2130 progress observed, **no error messages**)
6. GET stats returns `overviewEmbeddings: 0` after run completes
7. Server restart resets count to 0 (expected — vec0 recreated with `IF NOT EXISTS`)

#### Theories to investigate:
1. **INSERT OR REPLACE silently fails on vec0** — try plain `INSERT` instead
2. **Embedding dimension mismatch** — vec0 table is `FLOAT[768]`, check what `embed()` actually returns (could be 384 or 1024 depending on model)
3. **JSON format issue** — vec0 expects `[0.1, 0.2, ...]`, check if `JSON.stringify(embedding)` produces correct format
4. **Transaction/WAL issue** — vec0 might need explicit commits
5. **Shadow table corruption** — vec0 uses shadow tables that Prisma might interfere with

#### How to debug:
```bash
# 1. Deploy build 2026-03-11_02-12 (has diagnostic logging)
# 2. Run embedding generation from UI
# 3. Check SSE output for diagnostic event:
#    {"type":"diagnostic","phase":"overviews","succeeded":N,"failed":M,"lastError":"...","verifiedCount":N}
# This will tell us exactly how many succeed vs fail and what the COUNT shows

# 4. If succeeded > 0 but verifiedCount = 0, it's a vec0 persistence issue
# 5. If failed = 2130, read the first 5 error messages for the actual error
```

#### Quick test via API:
```bash
API="mj_P8svnG5GMIRmW4ebWsE12KH4xsn26RGNmtI3Y-3Eh-xHe9Vf5RBEfNst13IlrZMf"
# Start generation and capture first events + diagnostic
timeout 60 curl -s -X POST -H "Authorization: Bearer $API" \
  "http://192.168.1.50:7331/api/embeddings/generate" 2>&1 | grep -E 'warning|diagnostic'
```

### Fix Applied (2026-03-11 11:49)

**Root cause (most likely): `INSERT OR REPLACE` silently fails on vec0 virtual tables.**

vec0 is a virtual table implementation that doesn't properly support SQLite's conflict resolution. `INSERT OR REPLACE` triggers a DELETE (which may silently fail or no-op on the shadow tables) followed by an INSERT that never executes because the conflict resolution already consumed the statement.

**Changes made to `+server.js`:**
1. **DELETE + INSERT** instead of `INSERT OR REPLACE` for both `overview_embeddings` and `media_embeddings` vec0 tables
2. **Dimension validation** — upfront check that embedding model returns exactly 768 dimensions, returns 400 if mismatched
3. **First-insert read-back** — after the very first successful INSERT, immediately SELECTs back to confirm persistence. Sends a `diagnostic` SSE event with `phase: 'first-insert'` showing `changes`, `readBack` status, and `dim`
4. **Null-embed tracking** — warns if `embed()` returns null for the first item

**To test:** Deploy, trigger "Generate Embeddings", and watch for these SSE events:
- `diagnostic` with `phase: 'first-insert'` → confirms if INSERT actually persists
- `diagnostic` with `phase: 'overviews'` → shows `verifiedCount` (should match `succeeded`)
- Any `warning` events → shows specific error messages

### Files Changed
- `src/lib/server/db.js` — added `embedding_hashes` table
- `src/routes/api/embeddings/generate/+server.js` — content-hash detection, Number() cast, diagnostic logging
- `src/routes/api/sync/item/+server.js` — COALESCE poster_url/overview
- `src/lib/server/sync-engine.js` — COALESCE poster_url/overview (3 locations)
- `src/routes/api/backup/+server.js` — export embedding_hashes
- `src/routes/api/backup/import/+server.js` — import embedding_hashes
- `src/routes/api/media/[id]/+server.js` — PATCH endpoint (created in prior session)
