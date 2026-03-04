# Local LLM Integration — Brainstorm

Ideas for integrating a local LLM (via Ollama or similar) into Mediajam for smarter matching, search, recommendations, and automation.

---

## 1. Smarter Album & Track Matching (Embeddings)

**Problem:** The current matching pipeline uses Levenshtein distance and string normalization (`normalizeTitle()`). This works for exact titles and minor typos but fails on:

- **Remaster/deluxe variants:** "OK Computer" vs "OK Computer OKNOTOK 1997 2017"
- **Semantic equivalents:** "Greatest Hits" vs "Best Of", "Vol. 1" vs "Volume One"
- **Localization:** "Für Elise" vs "Fur Elise", "Nöel" vs "Noel"
- **Punctuation wars:** Last.fm stores "Guns N' Roses" (ASCII `'`), Jellyfin stores "Guns N' Roses" (smart quote `'`). We handle this now with `normalizeTitle()`, but an embedding model wouldn't care about these differences at all.
- **Subtitle variations:** "Abbey Road (Remastered)" vs "Abbey Road" vs "Abbey Road [Super Deluxe Edition]"
- **Missing articles:** "The Wall" vs "Wall"

**Solution:** Use a lightweight text embedding model to vectorize album/track titles, then compare via cosine similarity instead of edit distance.

### Implementation

```
Sync/Import → Embed title → Store vector in sqlite-vec → Match via nearest neighbor
```

**Model:** `nomic-embed-text` via Ollama (~270MB, runs on CPU).  
**Storage:** `sqlite-vec` extension (already in our stack for the vec0 virtual table).  
**Embedding dimension:** 768 (nomic-embed-text) — about 3KB per title.

```sql
-- Create vector table
CREATE VIRTUAL TABLE media_embeddings USING vec0(
    media_id INTEGER PRIMARY KEY,
    title_embedding FLOAT[768]
);

-- Find nearest matches for a given album
SELECT m.id, m.title, vec_distance_cosine(e.title_embedding, ?) as distance
FROM media_embeddings e
JOIN media_children m ON e.media_id = m.id
WHERE distance < 0.3
ORDER BY distance
LIMIT 5;
```

**Integration with existing pipeline:**

The current 3-tier matching pipeline is:

1. Track-based fuzzy matching
2. Exact normalized title match
3. Levenshtein fuzzy title match

Embeddings would slot in as a **Tier 0** or replace Tier 3:

- Embed all Jellyfin album titles on sync
- Embed all external (Last.fm) album titles on import
- In `generateMatches()`, query nearest neighbors from the vec0 table instead of looping through candidates with Levenshtein

**Benefits:**

- Would handle remaster/deluxe/localization variants automatically
- Much faster for large catalogs (vec0 uses efficient ANN search vs O(n²) Levenshtein)
- No manual rules for edge cases

**Potential issues:**

- Embedding generation adds latency to sync (mitigate by batching)
- Short titles like "1" or "II" may have poor embedding quality
- Need to handle embedding model not being available (fallback to current approach)

### Enhanced Track Matching

Beyond album titles, we could embed track names for the track-based matching tier. This would handle:

- "Don't Stop Me Now" vs "Dont Stop Me Now" vs "Don't Stop Me Now - Remastered 2011"
- "Bohemian Rhapsody" vs "Bohemian Rhapsody (Live at Wembley)"

Currently we use `fuzzyMatch()` with Levenshtein ≤2 or ≤15% of length. Embedding similarity would be more robust.

---

## 2. Semantic Search (Embeddings)

**Problem:** Current search uses SQL `LIKE '%query%'` which only finds literal substring matches. You can't search by concept, genre, mood, or theme.

**Solution:** Embed the `overview` text field for movies/shows, and artist bios, into vectors. At search time, embed the query and find nearest neighbors.

### What this enables

| Query | Current behavior | With embeddings |
|-------|-----------------|----------------|
| "space movies" | Finds nothing (no title contains "space movies") | Finds Interstellar, Gravity, The Martian, Ad Astra |
| "90s grunge" | Finds nothing | Finds Nirvana, Pearl Jam, Soundgarden, Alice in Chains |
| "funny shows" | Finds nothing | Finds The Office, Parks and Rec, Brooklyn Nine-Nine |
| "crime thriller" | Finds nothing | Finds Breaking Bad, Ozark, Fargo |
| "sad songs" | Finds nothing | Finds Radiohead, Elliott Smith, Bon Iver |

### Implementation

```sql
-- Embed overviews on sync
CREATE VIRTUAL TABLE overview_embeddings USING vec0(
    media_parent_id INTEGER PRIMARY KEY,
    overview_embedding FLOAT[768]
);

-- Search: embed the query, then find nearest overviews
SELECT mp.id, mp.title, mp.media_type,
       vec_distance_cosine(oe.overview_embedding, ?) as distance
FROM overview_embeddings oe
JOIN media_parents mp ON oe.media_parent_id = mp.id
WHERE distance < 0.5
ORDER BY distance
LIMIT 10;
```

**Hybrid approach:** Combine keyword search (existing LIKE) + semantic search (embeddings) and merge results. Show keyword matches first (exact relevance), then semantic matches (concept relevance) in a separate "Related" section.

### Cost analysis

- ~5,000 media items × 768 floats × 4 bytes = ~15MB of vector data
- Embedding generation: ~100ms per item on CPU → ~8 minutes for full catalog (one-time)
- Query time: <10ms for nearest neighbor search via vec0

---

## 3. Natural Language Queries (LLM Text-to-SQL)

**Problem:** Users can only browse via predefined pages and filters. Power queries require knowing the data model.

**Solution:** Let users ask questions in natural language. A local LLM converts the question to a SQL query against the Mediajam schema, executes it, and returns formatted results.

### Example queries

| Natural language | Generated SQL |
|-----------------|---------------|
| "What did I watch last Tuesday?" | `SELECT ... FROM playback_history WHERE date(timestamp) = '2026-02-25'` |
| "Which artist do I listen to most?" | `SELECT mp.title, COUNT(*) FROM playback_history ph JOIN ... GROUP BY ... ORDER BY COUNT(*) DESC LIMIT 1` |
| "Show me all unwatched movies from 2024" | `SELECT title FROM media_parents WHERE media_type='movie' AND release_year=2024 AND id NOT IN (SELECT ...)` |
| "How many hours of TV have I watched this month?" | `SELECT SUM(duration_consumed_seconds)/3600 FROM playback_history WHERE ...` |
| "What movies has Christopher Nolan directed?" | `SELECT mp.title FROM person_credits pc JOIN persons p ... WHERE p.name='Christopher Nolan' AND pc.role_type='director'` |

### Implementation

**Model:** `llama3.2:3b` or `phi-3-mini` via Ollama (both good at structured output from simple schemas).

```javascript
// Pseudocode
async function naturalLanguageQuery(question) {
    const schema = getRelevantSchemaSubset(); // Only tables relevant to the question
    const prompt = `Given this SQLite schema:
${schema}

Convert this question to a SQL query. Return ONLY the SQL, no explanation.
Question: ${question}`;

    const sql = await ollama.generate({ model: 'llama3.2:3b', prompt });
    
    // Safety: only allow SELECT queries, validate against schema
    if (!sql.trim().toUpperCase().startsWith('SELECT')) throw new Error('Only SELECT allowed');
    
    const results = db.prepare(sql).all();
    return { sql, results };
}
```

**UI:** Add a "Ask" button next to the search bar, or a `/ask` command in the search overlay. Show the generated SQL for transparency and debugging.

**Safety considerations:**

- Only allow SELECT queries (no mutations)
- Allowlist tables that can be queried
- Set a timeout on query execution
- Rate limit requests

---

## 4. Content Recommendations (LLM Reasoning)

**Problem:** No discovery mechanism beyond manual browsing. Users don't know what to watch/listen to from their library.

**Solution:** Feed watch history + ratings + library contents to a local LLM and get personalized recommendations.

### Approaches

**A. Simple pattern matching (no LLM needed):**

- "You watched 5 Christopher Nolan movies, here are the 2 you haven't seen"
- "You listened to Radiohead 47 times, similar artists in your library: Muse, Coldplay"
- This can be done with SQL queries and doesn't need an LLM

**B. LLM-powered discovery:**

```
Prompt: Based on my recent watches:
- Breaking Bad (5 seasons)
- Better Call Saul (6 seasons)  
- Ozark (4 seasons)

I have these unwatched shows in my library:
- The Wire
- Peaky Blinders
- Succession
- Stranger Things

Which should I watch next and why?
```

**C. Embedding-based similarity:**

- Embed all overviews
- Find the centroid of recently watched items' embeddings
- Recommend unwatched items closest to that centroid
- This is fast, doesn't need an LLM at runtime, just embeddings

### Implementation

A "Recommendations" widget on the dashboard or a dedicated `/discover` page.

The LLM approach is the most engaging (it can explain *why*) but the embedding centroid approach is more reliable and faster.

---

## 5. Auto-Tagging & Content Enrichment (LLM)

**Problem:** Content is only categorized by `media_type` (show/movie/artist). No genre tags, mood tags, or thematic grouping.

**Solution:** Use a local LLM to read overviews and generate structured tags.

### What this enables

- **Genre tags:** Action, Comedy, Thriller, Sci-Fi, Jazz, Rock, etc.
- **Mood tags:** Dark, Uplifting, Suspenseful, Chill, Energetic
- **Theme tags:** Family, Revenge, Coming-of-age, Space, Time travel
- **Era tags:** 80s, 90s, 2000s

### Implementation

```javascript
async function generateTags(title, overview, mediaType) {
    const prompt = `Categorize this ${mediaType}:
Title: ${title}
Overview: ${overview}

Return a JSON object with these arrays:
- genres: up to 3 genre tags
- moods: up to 2 mood/tone tags  
- themes: up to 3 theme tags

Only return the JSON, no explanation.`;

    const response = await ollama.generate({ model: 'llama3.2:3b', prompt, format: 'json' });
    return JSON.parse(response);
}
```

**Storage:** A new `media_tags` table with `media_parent_id`, `tag_type`, `tag_value`.

**Use cases:**

- Filter movies by mood: "Show me something dark and suspenseful"
- Group music by era on the artist page
- Auto-generated "Collections": "Your 80s Movies", "Chill Music", "Sci-Fi Marathon"

### Batch processing

Run tagging as a background job on first setup or on new imports. ~1-2 seconds per item with a 3B model on CPU, so a 5,000 item library takes ~2 hours. Can be parallelized.

---

## 6. Smart Deduplication (Embeddings + LLM)

**Problem:** After importing from multiple sources (Jellyfin, Last.fm, Trakt), we get duplicate entries that don't match on exact title. The current matching pipeline catches most, but complex cases slip through.

**Solution:** Use embeddings as a first pass to find candidates, then use an LLM to make the final judgment with context.

### Example

```
Candidate pair (found via embedding similarity):
  A: "The Dark Knight (2008)" [from Jellyfin, media_parent #1234]
  B: "Dark Knight" [from Trakt import, media_parent #5678]

LLM prompt: "Are these the same movie? A: 'The Dark Knight (2008)' B: 'Dark Knight'. 
Answer YES or NO with confidence (high/medium/low)."

LLM response: "YES, high confidence. Same movie, B just lacks the article and year."
```

For medium-confidence matches, show them in the album-matches UI for human review. For high-confidence, auto-merge.

---

## 7. Music Recognition Context (LLM)

**Problem:** ACRCloud/AcoustID returns a song match, but we need to map it to the right album in the library. A song can appear on multiple albums (studio album, greatest hits, live album, soundtrack).

**Solution:** When a song is identified, use an LLM to determine the most likely album based on context:

- What album does the user have in their library?
- What's the most common/canonical release?
- Was the user playing a specific album (sequential tracks)?

---

## Infrastructure — Ollama Integration

All of the above require an Ollama instance. Since Mediajam already supports a "spokes" architecture for connecting to external services, Ollama would be another spoke.

### Configuration

```
Settings > System > LLM Integration
  ☑ Enable local LLM features
  Ollama URL: http://localhost:11434
  Embedding model: nomic-embed-text
  Chat model: llama3.2:3b
  [Test Connection]
```

### Models needed

| Use case | Model | Size | Speed |
|----------|-------|------|-------|
| Embeddings (matching, search) | `nomic-embed-text` | 274MB | ~10ms/embed |
| Text generation (queries, tags, recs) | `llama3.2:3b` | 2.0GB | ~1-3s/response |
| Better generation (if GPU available) | `llama3.1:8b` | 4.7GB | ~0.5-2s/response |

### Graceful degradation

All LLM features should be optional. If Ollama isn't configured or a model isn't available, fall back to existing behavior:

- Matching → current Levenshtein pipeline
- Search → current LIKE queries
- Tags → not generated
- Recommendations → basic SQL "similar items" queries

---

## Priority Order

1. **Embedding-based album matching** — highest impact, solves the current pain point, infrastructure already exists (sqlite-vec)
2. **Semantic search** — natural extension of #1, same embedding model, same vec0 infrastructure
3. **Auto-tagging** — enables filtering/browsing by concept, runs as a batch job
4. **Natural language queries** — impressive but niche usage
5. **Recommendations** — nice-to-have, the embedding centroid approach is practical
6. **Smart deduplication** — edge case handler, only needed for complex merge scenarios
7. **Music recognition context** — very specific use case
