# Stats & Data Visualization Design

Ideas for a dedicated stats/data page in Mediajam.

---

## 1. Library Composition — Sankey / Alluvial Diagram

A multi-column flow diagram showing how the library breaks down hierarchically.

### Column Flow

```
Total Library → Media Type → Collection Status → Source
```

| Column 1 | Column 2 | Column 3 | Column 4 |
|-----------|----------|----------|----------|
| Total Library (N items) | Movies | Owned (in Jellyfin) | Jellyfin |
| | TV Shows | Wanted (*arr queue) | Radarr |
| | Music (Artists) | Searching | Sonarr |
| | Music (Albums) | Not Tracked | Lidarr |

Each "flow" band is proportional to count, so you instantly see things like:
- "Most of my library is TV, and most of that is owned"
- "I have a lot of wanted movies but very few wanted albums"

### Possible Extensions
- Add a **quality** column: 4K / 1080p / 720p / SD
- Add a **watched** column: Watched / Partially Watched / Unwatched
- Add a **rating** column: Rated / Unrated, or buckets (★1-3, ★4-6, ★7-10)

### Implementation Notes
- Use [D3 Sankey](https://github.com/d3/d3-sankey) or a lighter alternative
- Data comes from existing DB queries — no new tables needed
- Could also be done as a stacked bar or treemap if Sankey feels too busy

---

## 2. Stats Dashboard Sections

### Overview Cards (top row)
| Stat | Example |
|------|---------|
| Total items | 4,832 |
| Movies / Shows / Artists / Albums | 2,193 / 847 / 1,264 / 528 |
| Total watch time | 2,517h |
| Items watched this month | 34 |
| Average rating | 7.2 ★ |
| Library growth rate | +12 items/week |

### Watching Habits
- **Watch heatmap** (GitHub-style contribution grid) — days of the year colored by how many things you watched
- **Time-of-day distribution** — bar chart showing when you typically watch (morning/afternoon/evening/night)
- **Day-of-week distribution** — which days you watch the most
- **Binge sessions** — longest consecutive watch streaks

### Genre Breakdown
- **Radar/spider chart** of top genres (Action, Drama, Comedy, etc.)
- Or a **bubble chart** where bubble size = count, color = media type
- Compare "what you own" vs "what you've actually watched" by genre

### Ratings Distribution
- **Histogram** of your ratings (1-10 scale)
- **Your rating vs external rating** scatter plot (your score on Y, TMDb/OMDb on X)
- **Most controversial** — biggest gap between your rating and public rating

### Timeline / Growth
- **Library growth over time** — line chart showing cumulative items added per month
- **Watched over time** — stacked area chart (movies vs TV vs music)
- **Discovery timeline** — when you added items vs when they were released (do you watch new stuff or classics?)

### People & Credits
- **Most-watched directors/actors** — top 10 bar chart
- **Actor collaboration network** — who appears together most often in your library
- **Credits per person** — how many of your items each person is in

### Music-Specific
- **Top artists by album count**
- **Listening time per genre**
- **Album completion rate** — how many tracks you've listened to per album

### Collection Health
- **Missing metadata** — items without posters, descriptions, or ratings
- **Duplicate detection** — potential duplicates in library
- **Stale items** — things added but never watched/played

---

## 3. Visual Style

- **Dark theme** consistent with the rest of Mediajam
- Charts should use the app's primary color (`oklch(var(--p))`) for accents
- Animated transitions when switching between time ranges or filters
- Responsive — Sankey should gracefully degrade to stacked bars on mobile
- Consider a **print/export** button for sharing stats as an image

---

## 4. Data Sources

All data already exists in the DB:
- `media` table → item counts, types, statuses
- `playback_history` → watch times, timestamps
- `ratings` → user + external ratings
- `credits` → people associations
- `collections` table → *arr status (wanted/searching/owned)

No new backend work needed beyond a `/api/pages/stats` endpoint that aggregates these queries.

---

## 5. Priority / Phasing

| Phase | What | Effort |
|-------|------|--------|
| **P1** | Overview stat cards + Sankey diagram | Medium |
| **P2** | Watch heatmap + ratings histogram | Low-Medium |
| **P3** | Genre radar + growth timeline | Medium |
| **P4** | People analytics + music stats | Medium-High |
| **P5** | Collection health dashboard | Low |
