# LLM-Based Orphan Reconciliation & Last.fm Data Mapping

## Current State

| Metric | Count |
|--------|-------|
| Orphan artists (no `jellyfin_id`) | 4,807 |
| ↳ Have `musicbrainz_id` | 3,593 |
| ↳ Exact name match with Jellyfin artist | 43 |
| ↳ Genuinely external (Last.fm-only) | 4,764 |
| Orphan children (albums under orphans) | 4,988 |
| Last.fm scrobbles | 77,083 |
| Playback history from Last.fm | 77,083 |
| Album-matches page | **Empty** (no data to show) |

**Why the page is empty:** The `generateMatches()` function looks for unmatched children (albums with no `jellyfin_id`) under artist parents, and tries to match them to Jellyfin albums _on the same artist_. But most orphan parents don't have a counterpart Jellyfin parent, so there are no candidates to match against.

## Proposed Approach: 3 Phases

### Phase 1: Fix the Low-Hanging Fruit (No LLM Needed)

Merge the 43 orphan artists that already have exact Jellyfin name matches. This was partially done by the new `deduplicateParentsByTitle()` but needs to run again after the recent cleanup.

Then, the 33 orphan children under those merged artists become visible to `generateMatches()`, populating the album-matches page.

> [!IMPORTANT]
> This should make the album-matches page actually show content.

---

### Phase 2: MusicBrainz ID-Based Artist Matching (No LLM)

3,593 orphan artists have a `musicbrainz_id`. Many Jellyfin artists also have `musicbrainz_id`. Match them by ID — this is deterministic and high-confidence.

For the remaining ~1,200 without MusicBrainz IDs, use the existing fuzzy title matching (Levenshtein/normalization) to find potential Jellyfin matches.

---

### Phase 3: LLM-Powered Matching (For Remaining Unmatched)

After Phases 1-2, the remaining unmapped items fall into two categories:

**A. Orphan artists with a close-but-not-exact Jellyfin match** (Unicode variants, "The" prefix, abbreviations, etc.):

- Use embedding similarity (`nomic-embed-text`) to find candidate matches
- Use the generation model (`llama3.2:3b`) to confirm/reject with reasoning
- Auto-merge high-confidence matches, queue medium-confidence for the album-matches UI

**B. Genuinely external artists** (in Last.fm but not Jellyfin):

- These are legitimate — the user listened to them outside their collection
- No action needed, but we could use LLM to enrich them:
  - Generate genre/mood tags from artist+album names
  - Link to MusicBrainz via fuzzy search
  - Group by genre for the "External Listening" view

### LLM Reconciliation Pipeline

```
1. Embed all parent titles (Jellyfin + orphan) with nomic-embed-text
2. For each orphan artist:
   a. Find top-3 nearest Jellyfin artists by embedding cosine similarity
   b. If best distance < 0.15 → auto-merge (very close match)
   c. If best distance 0.15-0.35 → send to LLM for confirmation:
      "Are these the same artist? A: 'Wu‐Tang Clan' B: 'Wu-Tang Clan'. YES/NO + confidence."
   d. If distance > 0.35 → mark as genuinely external, skip
3. For merged artists, run album-matcher pipeline (existing Tier 1-2) to match children
4. For remaining unmatched albums, use embedding similarity on album titles
```

### Infrastructure Required

All infrastructure already exists or is partially built:

| Component | Status |
|-----------|--------|
| Ollama settings UI | ✅ Done (this session) |
| `sqlite-vec` extension | ✅ Loaded on startup |
| `media_embeddings` vec0 table | ✅ Schema exists |
| `overview_embeddings` vec0 table | ✅ Schema exists |
| `/api/embeddings/generate` endpoint | ✅ Exists |
| `album-matcher.js` pipeline | ✅ Exists |
| Album-matches UI | ✅ Exists (just needs data) |

### New Components Needed

#### [NEW] `lib/server/llm-reconciler.js`

- `reconcileOrphanArtists()` — runs the full pipeline (embeds → candidates → LLM confirm → merge)
- `embedAllTitles()` — batch-embeds all parent titles via Ollama
- `llmConfirmMatch(titleA, titleB)` — asks LLM to confirm a match

#### [MODIFY] [album-matcher.js](file:///home/rappo/Documents/projects/mediajam/src/lib/server/album-matcher.js)

- Add embedding-based matching as Tier 0 (before track/title matching)
- Query `media_embeddings` for nearest neighbors instead of O(n²) Levenshtein

#### [MODIFY] [reconcile endpoint](file:///home/rappo/Documents/projects/mediajam/src/routes/api/sync/reconcile/+server.js)

- Add "Run LLM Reconciliation" option that triggers the full pipeline

#### [MODIFY] Settings UI

- Add "Reconcile with LLM" button in the LLM section
- Show progress/results

## Verification Plan

### Automated

- Run reconcile, verify orphan count drops
- Check album-matches page shows suggestions
- Verify playback_history still maps correctly

### Manual

- Test with known edge cases: "Wu‐Tang" → "Wu-Tang", "Guns N' Roses" → "Guns N' Roses"
- Verify genuinely external artists are NOT merged
- Check album-matches page at `/settings/album-matches`
