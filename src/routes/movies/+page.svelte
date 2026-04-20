<script>
    import { onMount } from 'svelte';
    import Chart from "$lib/components/Chart.svelte";
    import Skeleton from "$lib/components/Skeleton.svelte";
    import DeleteToast from "$lib/components/DeleteToast.svelte";
    import { imgUrl } from "$lib/utils.js";

    // Library data
    let loaded = $state(false);
    let loading = $state(true);
    let movies = $state(/** @type {any[]} */ ([]));
    let genres = $state(/** @type {string[]} */ ([]));
    let allPersons = $state(/** @type {any[]} */ ([]));
    let topRewatched = $state(/** @type {any[]} */ ([]));

    // Discovery sections
    let sectionsLoaded = $state(false);
    let sections = $state(/** @type {any} */ ({ hero: null, recommended: [], personRecs: [], recentlyWatched: [], unwatched: [] }));
    let picksSeed = $state(0);

    /** Fisher-Yates shuffle (returns new array) */
    function shuffle(/** @type {any[]} */ arr) {
        const a = [...arr];
        for (let i = a.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
    }

    // Person search
    let personSearch = $state('');
    let personDropdownOpen = $state(false);

    // Genre search
    let genreSearch = $state('');
    let genreDropdownOpen = $state(false);

    // Year filter
    let yearSearch = $state('');
    let yearDropdownOpen = $state(false);

    // View mode
    let viewMode = $state('poster'); // 'poster' | 'list'

    // Filters
    let searchQuery = $state('');
    /** @type {string[]} */
    let filterGenres = $state([]);
    let genreMode = $state('any'); // 'any' (OR) | 'all' (AND)
    /** @type {{id: number, name: string}[]} */
    let filterPersons = $state([]);
    let personMode = $state('all'); // 'any' (OR) | 'all' (AND)
    let filterUnwatched = $state(false);
    let filterRatingMin = $state(0);
    let filterRatingMax = $state(10);
    let downloadedOnly = $state(true);

    // Sort
    let sortBy = $state('title'); // 'title' | 'year' | 'rating'
    let sortDir = $state('asc'); // 'asc' | 'desc'

    // Chart toggle
    let chartMode = $state('zscore'); // 'decade' | 'year' | 'genre' | 'rating' | 'zscore' | 'percentile'
    let pctShowWatched = $state(true);
    let pctShowUnwatched = $state(true);

    // Pagination
    let page = $state(0);
    let pageSize = $state(50);
    const PAGE_SIZE_OPTIONS = [25, 50, 100, 200, 0]; // 0 = All

    onMount(async () => {
        try {
            // Load library data first (critical path)
            const libRes = await fetch('/api/pages/movies/library');
            const d = await libRes.json();
            movies = d.movies;
            genres = d.genres;
            allPersons = d.topPersons;
            topRewatched = d.topRewatched;

            // Read URL params into state
            const params = new URLSearchParams(window.location.search);
            if (params.get('q')) searchQuery = params.get('q') || '';
            if (params.get('genres')) {
                filterGenres = (params.get('genres') || '').split(',').filter(Boolean);
            }
            if (params.get('gmode')) genreMode = params.get('gmode') || 'any';
            if (params.get('persons')) {
                const pids = (params.get('persons') || '').split(',').filter(Boolean);
                filterPersons = pids.map(id => {
                    const match = allPersons.find(p => String(p.id) === id);
                    return { id: parseInt(id), name: match?.name || `Person ${id}` };
                });
            }
            if (params.get('pmode')) personMode = params.get('pmode') || 'all';
            if (params.get('year')) yearSearch = params.get('year') || '';
            if (params.has('unwatched')) filterUnwatched = params.get('unwatched') === '1';
            if (params.get('rmin')) filterRatingMin = parseFloat(params.get('rmin') || '0');
            if (params.get('rmax')) filterRatingMax = parseFloat(params.get('rmax') || '10');
            if (params.has('downloaded')) downloadedOnly = params.get('downloaded') !== '0';
            if (params.get('sort')) sortBy = params.get('sort') || 'title';
            if (params.get('dir')) sortDir = params.get('dir') || 'asc';
            if (params.get('view')) viewMode = params.get('view') || 'poster';
            if (params.get('page')) page = parseInt(params.get('page') || '0');
            if (params.get('per')) pageSize = parseInt(params.get('per') || '50');

            loaded = true;
            loading = false;

            // Load discovery sections lazily (non-critical, loads after render)
            fetch('/api/pages/movies').then(r => r.json()).then(secData => {
                sections = secData.sections;
                sectionsLoaded = true;
            }).catch(() => { sectionsLoaded = true; });
        } catch (e) {
            console.error('[movies] Failed to load:', e);
            loading = false;
        }
    });

    // Sync state → URL
    $effect(() => {
        if (!loaded) return;
        const p = new URLSearchParams();
        if (searchQuery) p.set('q', searchQuery);
        if (filterGenres.length) p.set('genres', filterGenres.join(','));
        if (filterGenres.length && genreMode !== 'any') p.set('gmode', genreMode);
        if (filterPersons.length) p.set('persons', filterPersons.map(x => x.id).join(','));
        if (filterPersons.length && personMode !== 'all') p.set('pmode', personMode);
        if (yearSearch) p.set('year', yearSearch);
        if (filterUnwatched) p.set('unwatched', '1');
        if (filterRatingMin > 0) p.set('rmin', String(filterRatingMin));
        if (filterRatingMax < 10) p.set('rmax', String(filterRatingMax));
        if (!downloadedOnly) p.set('downloaded', '0');
        if (sortBy !== 'title') p.set('sort', sortBy);
        if (sortDir !== 'asc') p.set('dir', sortDir);
        if (viewMode !== 'poster') p.set('view', viewMode);
        if (page > 0) p.set('page', String(page));
        if (pageSize !== 50) p.set('per', String(pageSize));
        const qs = p.toString();
        const url = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
        history.replaceState(null, '', url);
    });

    // Filtered movies
    let filtered = $derived.by(() => {
        let result = movies;
        if (downloadedOnly) {
            result = result.filter(m => m.collection_status !== 'wanted');
        }
        if (searchQuery) {
            const q = searchQuery.toLowerCase();
            result = result.filter(m => m.title.toLowerCase().includes(q));
        }
        if (filterGenres.length) {
            if (genreMode === 'any') {
                result = result.filter(m => filterGenres.some(g => m.genres.includes(g)));
            } else {
                result = result.filter(m => filterGenres.every(g => m.genres.includes(g)));
            }
        }
        if (yearSearch) {
            const yr = parseYearFilter(yearSearch);
            if (yr) {
                result = result.filter(m => m.release_year >= yr.min && m.release_year <= yr.max);
            }
        }
        if (filterPersons.length) {
            const pids = filterPersons.map(p => p.id);
            if (personMode === 'all') {
                result = result.filter(m => pids.every(pid => m.person_ids?.includes(pid)));
            } else {
                result = result.filter(m => pids.some(pid => m.person_ids?.includes(pid)));
            }
        }
        if (filterUnwatched) {
            result = result.filter(m => m.watch_status !== 'watched');
        }
        if (filterRatingMin > 0 || filterRatingMax < 10) {
            const rMin = filterRatingMin * 10;
            const rMax = filterRatingMax * 10;
            result = result.filter(m => {
                if (m.rating_value === null) return filterRatingMin === 0;
                return m.rating_value >= rMin && m.rating_value <= rMax;
            });
        }
        // Sort
        const dir = sortDir === 'asc' ? 1 : -1;
        result = [...result].sort((a, b) => {
            if (sortBy === 'title') return dir * (a.title || '').localeCompare(b.title || '');
            if (sortBy === 'year') return dir * ((a.release_year || 0) - (b.release_year || 0));
            if (sortBy === 'rating') return dir * ((a.rating_value ?? -1) - (b.rating_value ?? -1));
            if (sortBy === 'runtime') return dir * ((a.runtime_minutes || 0) - (b.runtime_minutes || 0));
            return 0;
        });
        return result;
    });

    let paged = $derived(pageSize === 0 ? filtered : filtered.slice(page * pageSize, (page + 1) * pageSize));
    let totalPages = $derived(pageSize === 0 ? 1 : Math.max(1, Math.ceil(filtered.length / pageSize)));

    // Stats
    let watchedCount = $derived(movies.filter(m => m.watch_status === 'watched').length);
    let unwatchedCount = $derived(movies.filter(m => m.watch_status === 'unwatched').length);
    let totalRuntime = $derived(movies.reduce((sum, m) => sum + (m.runtime_minutes || 0), 0));
    let watchedRuntime = $derived(movies.filter(m => m.watch_status === 'watched').reduce((sum, m) => sum + (m.runtime_minutes || 0), 0));
    let unwatchedRuntime = $derived(movies.filter(m => m.watch_status !== 'watched').reduce((sum, m) => sum + (m.runtime_minutes || 0), 0));
    let runtimeHours = $derived(Math.round(totalRuntime / 60));
    let watchPct = $derived(movies.length > 0 ? ((watchedCount / movies.length) * 100).toFixed(1) : '0');
    let avgRating = $derived.by(() => {
        const rated = movies.filter(m => m.rating_value != null);
        if (rated.length === 0) return '—';
        return (rated.reduce((s, m) => s + m.rating_value, 0) / rated.length).toFixed(1);
    });
    let genreCount = $derived(genres.length);
    let missingCount = $derived(movies.filter(m => m.watch_status === 'not_downloaded').length);

    // Genre breakdown chart (top 10 + Other)
    let genreChartData = $derived.by(() => {
        /** @type {Map<string, {watched: number, unwatched: number}>} */
        const map = new Map();
        for (const m of movies) {
            for (const g of (m.genres || [])) {
                const entry = map.get(g) || { watched: 0, unwatched: 0 };
                if (m.watch_status === 'watched') entry.watched++; else entry.unwatched++;
                map.set(g, entry);
            }
        }
        const sorted = [...map.entries()]
            .sort((a, b) => (b[1].watched + b[1].unwatched) - (a[1].watched + a[1].unwatched));
        const top = sorted.slice(0, 20);
        const rest = sorted.slice(20);
        const other = rest.reduce((acc, [, c]) => ({ watched: acc.watched + c.watched, unwatched: acc.unwatched + c.unwatched }), { watched: 0, unwatched: 0 });
        const result = top.map(([name, c]) => ({ name: name.charAt(0).toUpperCase() + name.slice(1), ...c }));
        if (other.watched + other.unwatched > 0) result.push({ name: 'Other', ...other });
        return result;
    });

    // Compute chart data from movies array
    let chartByDecade = $derived.by(() => {
        /** @type {Map<number, {watched: number, unwatched: number}>} */
        const map = new Map();
        for (const m of movies) {
            if (!m.release_year) continue;
            const decade = Math.floor(m.release_year / 10) * 10;
            const entry = map.get(decade) || { watched: 0, unwatched: 0 };
            if (m.watch_status === 'watched') entry.watched++; else entry.unwatched++;
            map.set(decade, entry);
        }
        return [...map.entries()].sort((a, b) => a[0] - b[0]).map(([decade, c]) => ({ decade, ...c }));
    });

    let chartByYear = $derived.by(() => {
        /** @type {Map<number, {watched: number, unwatched: number}>} */
        const map = new Map();
        for (const m of movies) {
            if (!m.release_year) continue;
            const entry = map.get(m.release_year) || { watched: 0, unwatched: 0 };
            if (m.watch_status === 'watched') entry.watched++; else entry.unwatched++;
            map.set(m.release_year, entry);
        }
        return [...map.entries()].sort((a, b) => a[0] - b[0]).map(([year, c]) => ({ year, ...c }));
    });
    // Picks derivation — depends on picksSeed to re-shuffle
    let picks = $derived.by(() => {
        void picksSeed; // reactive dependency
        const pool = [...sections.recommended, ...sections.personRecs.flatMap(s => s.items)];
        return shuffle(pool).slice(0, 12);
    });

    // "Because you like [Person]" section
    /** @type {number|null} */
    let selectedPersonId = $state(null);
    let personPickSearch = $state('');
    let personPickOpen = $state(false);
    let personPickSeed = $state(0);

    // Suggested persons: favorites first, then most-watched, then most-credited
    let suggestedPersons = $derived.by(() => {
        if (allPersons.length === 0) return [];
        const favs = allPersons.filter(p => p.is_favorite).sort((a, b) => b.movie_count - a.movie_count);
        const watched = allPersons.filter(p => !p.is_favorite && p.watched_count >= 2).sort((a, b) => b.watched_count - a.watched_count);
        return [...favs, ...watched.slice(0, 20)];
    });

    // Auto-select first person when data loads
    $effect(() => {
        if (suggestedPersons.length > 0 && selectedPersonId === null) {
            selectedPersonId = suggestedPersons[0].id;
        }
    });

    let selectedPersonName = $derived(allPersons.find(p => p.id === selectedPersonId)?.name || '');

    // Filtered person dropdown
    let personPickFiltered = $derived.by(() => {
        const q = personPickSearch.toLowerCase().trim();
        if (!q) return suggestedPersons.slice(0, 15);
        return allPersons.filter(p => p.name.toLowerCase().includes(q)).slice(0, 15);
    });

    // Unwatched movies by selected person — computed client-side from movies array
    let personPickMovies = $derived.by(() => {
        void personPickSeed;
        if (!selectedPersonId) return [];
        const unwatched = movies.filter(m =>
            m.watch_status !== 'watched' &&
            (m.person_ids || []).includes(selectedPersonId)
        );
        return shuffle(unwatched).slice(0, 12);
    });

    function cyclePersonPick() {
        // Pick a different random person from suggested
        const candidates = suggestedPersons.filter(p => p.id !== selectedPersonId);
        if (candidates.length > 0) {
            selectedPersonId = candidates[Math.floor(Math.random() * candidates.length)].id;
            personPickSeed++;
        }
    }

    // Rating chart data — individual scores 1-100, null for gaps
    let chartByRating = $derived.by(() => {
        /** @type {Map<number, {watched: number, unwatched: number}>} */
        const map = new Map();
        for (const m of movies) {
            const r = m.rating_value;
            if (r == null || r < 1) continue;
            const score = Math.min(100, Math.round(r));
            const entry = map.get(score) || { watched: 0, unwatched: 0 };
            if (m.watch_status === 'watched') entry.watched++; else entry.unwatched++;
            map.set(score, entry);
        }
        // Build full 1-100 range, null where no movies exist
        const result = [];
        for (let i = 1; i <= 100; i++) {
            const entry = map.get(i);
            if (entry && (entry.watched > 0 || entry.unwatched > 0)) {
                result.push({ rating: i, watched: entry.watched, unwatched: entry.unwatched });
            } else {
                result.push({ rating: i, watched: null, unwatched: null });
            }
        }
        return result;
    });

    // Z-Score chart data — bins ratings by σ, grouped into tiers
    let chartByZScore = $derived.by(() => {
        const rated = movies.filter(m => m.rating_value != null && m.rating_value >= 1);
        if (rated.length < 2) return [];
        const mean = rated.reduce((s, m) => s + m.rating_value, 0) / rated.length;
        const variance = rated.reduce((s, m) => s + Math.pow(m.rating_value - mean, 2), 0) / rated.length;
        const stdDev = Math.sqrt(variance);
        if (stdDev === 0) return [];

        /** @param {number} z */
        function tier(z) {
            if (z > 2.0) return 'S';
            if (z >= 1.0) return 'A';
            if (z >= -0.5) return 'B';
            if (z >= -1.5) return 'C';
            return 'F';
        }

        const tiers = /** @type {const} */ (['S', 'A', 'B', 'C', 'F']);
        /** @type {Map<number, Record<string, number>>} */
        const map = new Map();
        for (const m of rated) {
            const z = (m.rating_value - mean) / stdDev;
            const bin = Math.round(z * 2) / 2;
            const t = tier(bin);
            const w = m.watch_status === 'watched' ? 'w' : 'u';
            const entry = map.get(bin) || {};
            for (const k of tiers) { entry[k + 'w'] = entry[k + 'w'] || 0; entry[k + 'u'] = entry[k + 'u'] || 0; }
            entry[t + w]++;
            map.set(bin, entry);
        }
        // Build range, skipping empty bins and clamping to ±4σ
        const bins = [...map.keys()].sort((a, b) => a - b);
        if (bins.length === 0) return [];
        const result = [];
        const lo = Math.max(bins[0], -4);
        const hi = Math.min(bins[bins.length - 1], 4);
        for (let b = lo; b <= hi; b = Math.round((b + 0.5) * 10) / 10) {
            const entry = map.get(b);
            if (!entry) continue;
            result.push({
                z: b,
                sigma: b === 0 ? '0σ' : `${b > 0 ? '+' : ''}${b}σ`,
                label: '',
                ...entry,
            });
        }
        // Assign tier names to center bin of each tier group
        /** @type {Record<string, number[]>} */
        const tierIndices = { F: [], C: [], B: [], A: [], S: [] };
        const tierLabels = { F: 'Trash', C: 'Mediocre', B: 'Good', A: 'Great', S: 'Masterpiece' };
        for (let i = 0; i < result.length; i++) {
            tierIndices[tier(result[i].z)].push(i);
        }
        for (const [t, indices] of Object.entries(tierIndices)) {
            if (indices.length === 0) continue;
            const mid = indices[Math.floor(indices.length / 2)];
            result[mid].label = tierLabels[t];
        }
        return result;
    });

    // Percentile chart data — one bar per tier
    let chartByPercentile = $derived.by(() => {
        const rated = movies.filter(m => m.rating_value != null && m.rating_value >= 1);
        if (rated.length < 5) return { tiers: [], tierBoundaries: [] };
        // Sort ascending by rating
        const sorted = [...rated].sort((a, b) => a.rating_value - b.rating_value);
        const n = sorted.length;

        // Tier definitions by percentile
        const tierDefs = [
            { key: 'F', name: 'Trash', pctLo: 0, pctHi: 5, color: '#f87171' },
            { key: 'C', name: 'Mediocre', pctLo: 5, pctHi: 25, color: '#fb923c' },
            { key: 'B', name: 'Good', pctLo: 25, pctHi: 75, color: '#38bdf8' },
            { key: 'A', name: 'Great', pctLo: 75, pctHi: 95, color: '#36d399' },
            { key: 'S', name: 'Masterpiece', pctLo: 95, pctHi: 100, color: '#fbbf24' },
        ];

        // Count watched/unwatched per tier
        const tiers = tierDefs.map(td => {
            const idxLo = Math.floor(td.pctLo / 100 * n);
            const idxHi = td.pctHi === 100 ? n : Math.floor(td.pctHi / 100 * n);
            const slice = sorted.slice(idxLo, idxHi);
            const watched = slice.filter(m => m.watch_status === 'watched').length;
            const unwatched = slice.length - watched;
            const ratingLo = slice[0]?.rating_value || 0;
            const ratingHi = slice[slice.length - 1]?.rating_value || 0;
            return {
                ...td,
                label: `${td.name}\n(${ratingLo}–${ratingHi})`,
                watched,
                unwatched,
                total: slice.length,
                ratingLo,
                ratingHi,
            };
        });

        return { tiers, tierBoundaries: tiers };
    });

    let chartOptions = $derived.by(() => {
        if (chartMode === 'genre') {
            return {
                title: { text: "By Genre" },
                axisX: { labelFontSize: 10, labelAngle: -45 },
                axisY: { title: "Count", titleFontColor: "#a6adba" },
                toolTip: { shared: true },
                legend: { fontColor: "#a6adba", fontSize: 11 },
                data: [
                    { type: "stackedColumn", name: "Watched", color: "#36d399", showInLegend: true, dataPoints: genreChartData.map(d => ({ label: d.name, y: d.watched })) },
                    { type: "stackedColumn", name: "Unwatched", color: "#a1a1aa", showInLegend: true, dataPoints: genreChartData.map(d => ({ label: d.name, y: d.unwatched })) },
                ],
            };
        }
        if (chartMode === 'zscore') {
            const tc = { S: '#fbbf24', A: '#36d399', B: '#38bdf8', C: '#fb923c', F: '#f87171' };
            const tn = { S: 'Masterpiece', A: 'Great', B: 'Good', C: 'Mediocre', F: 'Trash' };
            // Semi-transparent versions for unwatched
            const tu = { S: 'rgba(251,191,36,0.35)', A: 'rgba(54,211,153,0.35)', B: 'rgba(56,189,248,0.35)', C: 'rgba(251,146,60,0.35)', F: 'rgba(248,113,113,0.35)' };
            const tierKeys = ['S', 'A', 'B', 'C', 'F'];
            // Snapshot for tooltip/click closures
            const zData = chartByZScore;
            // Series: watched then unwatched for each tier
            const series = [];
            for (const t of /** @type {const} */ (['S', 'A', 'B', 'C', 'F'])) {
                series.push({ type: 'stackedColumn', name: tn[t], color: tc[t], showInLegend: false, dataPoints: zData.map(d => ({ label: d.label, y: d[t + 'w'] || null })) });
            }
            for (const t of /** @type {const} */ (['S', 'A', 'B', 'C', 'F'])) {
                series.push({ type: 'stackedColumn', name: tn[t] + ' (unwatched)', color: tu[t], showInLegend: false, dataPoints: zData.map(d => ({ label: d.label, y: d[t + 'u'] || null })) });
            }
            return {
                title: { text: "Rating Tiers (Z-Score)" },
                subtitle: { text: "solid = watched, faded = unwatched" },
                axisX: { labelFontSize: 11 },
                axisY: { title: "Count", titleFontColor: "#a6adba" },
                toolTip: {
                    shared: true,
                    filter: (/** @type {any} */ item) => {
                        return item.raw > 0;
                    },
                    callbacks: {
                        title: (/** @type {any[]} */ items) => {
                            if (!items.length) return '';
                            const idx = items[0].dataIndex;
                            const d = zData[idx];
                            if (!d) return '';
                            // Find which tier this bin belongs to
                            const z = d.z;
                            let tierName = 'Trash';
                            if (z > 2.0) tierName = 'Masterpiece';
                            else if (z >= 1.0) tierName = 'Great';
                            else if (z >= -0.5) tierName = 'Good';
                            else if (z >= -1.5) tierName = 'Mediocre';
                            return `${d.sigma}  ·  ${tierName}`;
                        },
                        label: (/** @type {any} */ ctx) => {
                            if (!ctx.raw || ctx.raw <= 0) return null;
                            return `${ctx.dataset.label}: ${ctx.raw}`;
                        },
                    },
                },
                // Store z-score data for click handler
                _zData: zData,
                data: series,
            };
        }
        if (chartMode === 'percentile') {
            const pData = chartByPercentile;
            const tiers = pData.tiers || [];
            // Watched series (solid tier colors)
            const watchedDs = {
                type: 'stackedColumn', name: 'Watched', showInLegend: false,
                dataPoints: tiers.map(t => ({ label: t.name, y: t.watched || null, color: t.color })),
            };
            // Unwatched series (faded tier colors)
            /** @param {string} hex @param {number} a */
            const hexA = (hex, a) => {
                const h = hex.replace('#', '');
                return `rgba(${parseInt(h.substring(0,2),16)},${parseInt(h.substring(2,4),16)},${parseInt(h.substring(4,6),16)},${a})`;
            };
            const unwatchedDs = {
                type: 'stackedColumn', name: 'Unwatched', showInLegend: false,
                dataPoints: tiers.map(t => ({
                    label: t.name, y: t.unwatched || null,
                    color: hexA(t.color, 0.35),
                })),
            };
            return {
                title: { text: "Rating Tiers (Percentile)" },
                subtitle: { text: tiers.map(t => `${t.name}: ${t.ratingLo}\u2013${t.ratingHi}`).join('  \u00b7  ') },
                axisX: { labelFontSize: 11 },
                axisY: { title: "Count", titleFontColor: "#a6adba" },
                toolTip: {
                    shared: true,
                    filter: (/** @type {any} */ item) => item.raw > 0,
                    callbacks: {
                        title: (/** @type {any[]} */ items) => {
                            if (!items.length) return '';
                            const t = tiers[items[0].dataIndex];
                            return t ? `${t.name}  (${t.pctLo}th\u2013${t.pctHi}th percentile, ratings ${t.ratingLo}\u2013${t.ratingHi})` : '';
                        },
                        label: (/** @type {any} */ ctx) => {
                            if (!ctx.raw || ctx.raw <= 0) return null;
                            return `${ctx.dataset.label}: ${ctx.raw}`;
                        },
                    },
                },
                _pData: tiers,
                data: [
                    ...(pctShowWatched ? [watchedDs] : []),
                    ...(pctShowUnwatched ? [unwatchedDs] : []),
                ],
            };
        }
        if (chartMode === 'rating') {
            return {
                title: { text: "By Rating" },
                subtitle: { text: "Best available: IMDb → RT → Metacritic → TMDB" },
                axisX: { title: "Score (1–100)", titleFontColor: "#a6adba", labelFontSize: 10, minimum: 1, maximum: 100, interval: 10 },
                axisY: { title: "Count", titleFontColor: "#a6adba" },
                toolTip: { shared: true },
                legend: { fontColor: "#a6adba", fontSize: 11 },
                spanGaps: false,
                data: [
                    { type: "stackedArea", name: "Watched", color: "#36d399", showInLegend: true, markerSize: 0, lineThickness: 2, fillOpacity: 0.4, dataPoints: chartByRating.map(d => ({ x: d.rating, y: d.watched })) },
                    { type: "stackedArea", name: "Unwatched", color: "#a1a1aa", showInLegend: true, markerSize: 0, lineThickness: 2, fillOpacity: 0.4, dataPoints: chartByRating.map(d => ({ x: d.rating, y: d.unwatched })) },
                ],
            };
        }
        const isDecade = chartMode === 'decade';
        const source = isDecade ? chartByDecade : chartByYear;
        return {
            title: { text: isDecade ? "By Decade" : "By Year" },
            axisX: isDecade ? { labelFontSize: 11 } : { title: "Year", titleFontColor: "#a6adba", labelFontSize: 10, labelAngle: -45 },
            axisY: { title: "Count", titleFontColor: "#a6adba" },
            toolTip: { shared: true },
            legend: { fontColor: "#a6adba", fontSize: 11 },
            data: [
                { type: "stackedColumn", name: "Watched", color: "#36d399", showInLegend: true, dataPoints: source.map((/** @type {any} */ d) => ({ label: isDecade ? `${d.decade}s` : String(d.year), y: d.watched })) },
                { type: "stackedColumn", name: "Unwatched", color: "#a1a1aa", showInLegend: true, dataPoints: source.map((/** @type {any} */ d) => ({ label: isDecade ? `${d.decade}s` : String(d.year), y: d.unwatched })) },
            ],
        };
    });

    /** @param {string} ts */
    function timeAgo(ts) {
        if (!ts) return '';
        const d = new Date(ts);
        const diff = Math.floor((Date.now() - d.getTime()) / 86400000);
        if (diff === 0) return 'Today';
        if (diff === 1) return 'Yesterday';
        if (diff < 7) return `${diff}d ago`;
        if (diff < 30) return `${Math.floor(diff / 7)}w ago`;
        if (diff < 365) return `${Math.floor(diff / 30)}mo ago`;
        return `${Math.floor(diff / 365)}y ago`;
    }

    /** @param {number} mins */
    function fmtRuntime(mins) {
        if (!mins) return '—';
        const h = Math.floor(mins / 60);
        const m = Math.round(mins % 60);
        return h > 0 ? `${h}h ${m}m` : `${m}m`;
    }

    /** @param {string} status */
    function statusBadge(status) {
        const map = {
            watched: '<span class="badge badge-success badge-sm">Watched</span>',
            in_progress: '<span class="badge badge-warning badge-sm">In Progress</span>',
            unwatched: '<span class="badge badge-ghost badge-sm">Unwatched</span>',
            not_downloaded: '<span class="badge badge-error badge-sm">Missing</span>',
        };
        return map[status] || map.unwatched;
    }

    function resetFilters() {
        searchQuery = '';
        filterGenres = [];
        genreSearch = '';
        filterPersons = [];
        personSearch = '';
        yearSearch = '';
        filterUnwatched = false;
        filterRatingMin = 0;
        filterRatingMax = 10;
        page = 0;
    }

    /** Handle chart element click — update filters and scroll to All Movies */
    function onChartClick(/** @type {{label: string, x: any, datasetIndex: number, dataIndex: number}} */ detail) {
        // Reset filters first
        resetFilters();
        if (chartMode === 'zscore') {
            // Look up the z-score bin and convert to rating range
            const zData = chartOptions._zData;
            const d = zData?.[detail.dataIndex];
            if (d) {
                // Compute mean/stdDev from current movies to convert z back to rating
                const rated = movies.filter(m => m.rating_value != null && m.rating_value >= 1);
                if (rated.length >= 2) {
                    const mean = rated.reduce((s, m) => s + m.rating_value, 0) / rated.length;
                    const variance = rated.reduce((s, m) => s + Math.pow(m.rating_value - mean, 2), 0) / rated.length;
                    const stdDev = Math.sqrt(variance);
                    // z bin is ±0.25 wide (0.5 step, half step each side)
                    const lo = (d.z - 0.25) * stdDev + mean;
                    const hi = (d.z + 0.25) * stdDev + mean;
                    // Convert to 0-10 scale (ratings are stored as 1-100)
                    filterRatingMin = Math.max(0, Math.floor(lo / 10 * 2) / 2);
                    filterRatingMax = Math.min(10, Math.ceil(hi / 10 * 2) / 2);
                }
            }
        } else if (chartMode === 'percentile') {
            // Convert clicked tier to rating range filter
            const tiers = chartOptions._pData;
            const t = tiers?.[detail.dataIndex];
            if (t) {
                filterRatingMin = Math.max(0, Math.floor(t.ratingLo / 10));
                filterRatingMax = Math.min(10, Math.ceil(t.ratingHi / 10));
            }
        } else if (chartMode === 'rating') {
            // x is the numeric score (1-100), convert to 0-10 scale
            const score = Number(detail.x);
            filterRatingMin = Math.floor(score / 10);
            filterRatingMax = Math.ceil(score / 10);
        } else if (chartMode === 'genre') {
            const genre = detail.label;
            if (genre && genre !== 'Other') filterGenres = [genre];
        } else if (chartMode === 'year') {
            yearSearch = detail.label;
        } else if (chartMode === 'decade') {
            const label = detail.label; // e.g. "1980s"
            const decade = parseInt(label);
            if (!isNaN(decade)) yearSearch = `${decade}-${decade + 9}`;
        }
        page = 0;
        // Scroll to All Movies section
        setTimeout(() => {
            document.getElementById('all-movies-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 50);
    }

    let hasActiveFilters = $derived(
        searchQuery || filterGenres.length || filterPersons.length || yearSearch || filterUnwatched || filterRatingMin > 0 || filterRatingMax < 10
    );

    // Filtered persons for search dropdown (exclude already selected)
    let filteredPersons = $derived.by(() => {
        const selectedIds = new Set(filterPersons.map(p => p.id));
        const available = allPersons.filter(p => !selectedIds.has(p.id));
        if (!personSearch) return available.slice(0, 20);
        const q = personSearch.toLowerCase();
        return available.filter(p => p.name.toLowerCase().includes(q)).slice(0, 30);
    });

    function selectPerson(p) {
        if (!filterPersons.some(x => x.id === p.id)) {
            filterPersons = [...filterPersons, { id: p.id, name: p.name }];
        }
        personSearch = '';
        personDropdownOpen = false;
        page = 0;
    }

    /** @param {number} id */
    function removePerson(id) {
        filterPersons = filterPersons.filter(p => p.id !== id);
        page = 0;
    }

    // Filtered genres for search dropdown (exclude already selected)
    let filteredGenres = $derived.by(() => {
        const selected = new Set(filterGenres);
        const available = genres.filter(g => !selected.has(g.name));
        if (!genreSearch) return available.slice(0, 20);
        const q = genreSearch.toLowerCase();
        return available.filter(g => g.name.toLowerCase().includes(q)).slice(0, 30);
    });

    function selectGenre(g) {
        if (!filterGenres.includes(g.name)) {
            filterGenres = [...filterGenres, g.name];
        }
        genreSearch = '';
        genreDropdownOpen = false;
        page = 0;
    }

    /** @param {string} name */
    function removeGenre(name) {
        filterGenres = filterGenres.filter(g => g !== name);
        page = 0;
    }

    // Year filter helpers
    /** @param {string} input */
    function parseYearFilter(input) {
        const trimmed = input.trim();
        const rangeMatch = trimmed.match(/^(\d{4})\s*[-–]\s*(\d{4})$/);
        if (rangeMatch) return { min: parseInt(rangeMatch[1]), max: parseInt(rangeMatch[2]) };
        const singleMatch = trimmed.match(/^(\d{4})$/);
        if (singleMatch) { const y = parseInt(singleMatch[1]); return { min: y, max: y }; }
        return null;
    }

    let availableYears = $derived.by(() => {
        /** @type {Map<number, number>} */
        const map = new Map();
        for (const m of movies) {
            if (m.release_year) map.set(m.release_year, (map.get(m.release_year) || 0) + 1);
        }
        return [...map.entries()].sort((a, b) => b[0] - a[0]).map(([year, count]) => ({ year, count }));
    });

    let filteredYears = $derived.by(() => {
        if (!yearSearch) return availableYears.slice(0, 20);
        const q = yearSearch.trim();
        return availableYears.filter(y => String(y.year).includes(q)).slice(0, 20);
    });

    /** @param {{ year: number, count: number }} y */
    function selectYear(y) {
        yearSearch = String(y.year);
        yearDropdownOpen = false;
        page = 0;
    }

    function clearYear() {
        yearSearch = '';
        yearDropdownOpen = false;
        page = 0;
    }

    /** @param {MouseEvent} e */
    function handleClickOutside(e) {
        const target = /** @type {HTMLElement} */ (e.target);
        if (!target?.closest('.person-search-wrap')) personDropdownOpen = false;
        if (!target?.closest('.genre-search-wrap')) genreDropdownOpen = false;
        if (!target?.closest('.year-search-wrap')) yearDropdownOpen = false;
    }
</script>

<svelte:window onclick={handleClickOutside} />

<svelte:head>
    <title>Mediajam — Movies</title>
</svelte:head>

<div class="page-wrap max-w-6xl mx-auto">
    <!-- Header -->
    <div class="page-header">
        <div>
            <h1 class="page-title">Movies</h1>
            <p class="page-sub">
                {#if loaded}
                    {movies.length.toLocaleString()} films · {watchedCount.toLocaleString()} watched · {runtimeHours.toLocaleString()} hr total runtime
                {/if}
            </p>
        </div>
    </div>
    <DeleteToast />

    {#if loading}
        <div class="stats-strip animate-pulse" style="height: 60px;"></div>
        <Skeleton type="chart" />
    {:else if loaded}
        <!-- Compact Stats Strip -->
        <div class="stats-strip">
            <div class="stat-donut-wrap">
                <svg viewBox="0 0 36 36" class="stat-donut">
                    <circle cx="18" cy="18" r="14" fill="none" stroke="#3b3f47" stroke-width="5" />
                    <circle cx="18" cy="18" r="14" fill="none" stroke="#36d399" stroke-width="5"
                        stroke-dasharray="{(watchedCount / Math.max(movies.length, 1) * 87.96).toFixed(1)} 87.96"
                        stroke-linecap="round" transform="rotate(-90 18 18)" />
                </svg>
                <span class="stat-donut-pct">{watchPct}%</span>
            </div>
            <div class="stat-item">
                <span class="stat-value">{movies.length.toLocaleString()}</span>
                <span class="stat-label">Movies</span>
            </div>
            <span class="stat-divider"></span>
            <div class="stat-item">
                <span class="stat-value text-success">{watchedCount.toLocaleString()}</span>
                <span class="stat-label">Watched</span>
            </div>
            <span class="stat-divider"></span>
            <div class="stat-item">
                <span class="stat-value text-base-content/50">{unwatchedCount.toLocaleString()}</span>
                <span class="stat-label">Unwatched</span>
            </div>
            <span class="stat-divider"></span>
            <div class="stat-item">
                <span class="stat-value text-success">{Math.round(watchedRuntime / 60).toLocaleString()} hr</span>
                <span class="stat-label">Watched</span>
            </div>
            <span class="stat-divider"></span>
            <div class="stat-item">
                <span class="stat-value text-base-content/50">{Math.round(unwatchedRuntime / 60).toLocaleString()} hr</span>
                <span class="stat-label">Unwatched</span>
            </div>
            <span class="stat-divider"></span>
            <div class="stat-item">
                <span class="stat-value text-warning">{avgRating}</span>
                <span class="stat-label">Avg Rating</span>
            </div>
            <span class="stat-divider"></span>
            <div class="stat-item">
                <span class="stat-value">{genreCount}</span>
                <span class="stat-label">Genres</span>
            </div>
            {#if missingCount > 0}
                <span class="stat-divider"></span>
                <div class="stat-item">
                    <span class="stat-value text-error">{missingCount}</span>
                    <span class="stat-label">Missing</span>
                </div>
            {/if}
        </div>

        <!-- Chart -->
        <div class="relative">
            <div class="chart-toggle">
                <button class="btn btn-xs" class:btn-active={chartMode === 'decade'} onclick={() => chartMode = 'decade'}>Decade</button>
                <button class="btn btn-xs" class:btn-active={chartMode === 'year'} onclick={() => chartMode = 'year'}>Year</button>
                <button class="btn btn-xs" class:btn-active={chartMode === 'genre'} onclick={() => chartMode = 'genre'}>Genre</button>
                <button class="btn btn-xs" class:btn-active={chartMode === 'rating'} onclick={() => chartMode = 'rating'}>Rating</button>
                <button class="btn btn-xs" class:btn-active={chartMode === 'zscore'} onclick={() => chartMode = 'zscore'}>Z-Score</button>
                <button class="btn btn-xs" class:btn-active={chartMode === 'percentile'} onclick={() => chartMode = 'percentile'}>Percentile</button>
            </div>
            {#if chartMode === 'percentile'}
                <div class="chart-toggle-sub">
                    <button
                        class="btn btn-xs {pctShowWatched ? 'btn-success btn-outline' : 'btn-ghost opacity-40'}"
                        onclick={() => pctShowWatched = !pctShowWatched}
                    >{pctShowWatched ? '✔' : '✕'} Watched</button>
                    <button
                        class="btn btn-xs {pctShowUnwatched ? 'btn-warning btn-outline' : 'btn-ghost opacity-40'}"
                        onclick={() => pctShowUnwatched = !pctShowUnwatched}
                    >{pctShowUnwatched ? '✔' : '✕'} Unwatched</button>
                </div>
            {/if}
            <Chart options={chartOptions} height={240} onclick={onChartClick} />
        </div>

        <!-- Picks For You + Because You Like (side by side) -->
        <div class="dual-row">
            {#if sectionsLoaded && picks.length > 0}
                <section class="smart-section">
                    <div class="section-header">
                        <h2 class="section-title">🎯 Picks For You</h2>
                        <div class="flex items-center gap-2">
                            <span class="section-count">unwatched</span>
                            <button class="btn btn-ghost btn-xs btn-circle" onclick={() => picksSeed++} title="Shuffle picks">
                                <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><polyline points="23 20 23 14 17 14"/><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/></svg>
                            </button>
                        </div>
                    </div>
                    <div class="poster-scroll">
                        {#each picks as item}
                            <a href="/movies/{item.slug || item.id}" class="poster-card poster-card-sm" title={item.title}>
                                <span class="uwb">unwatched</span>
                                <div class="poster-img poster-placeholder">🎬</div>
                                {#if item.poster_url}
                                    <img src={imgUrl(item.poster_url)} alt={item.title} class="poster-img poster-img-abs" loading="lazy" onerror={(e) => { /** @type {HTMLImageElement} */ (e.currentTarget).style.display='none'; }} />
                                {/if}
                                <div class="poster-meta">
                                    <span class="poster-name">{item.title}</span>
                                    {#if item.reason}
                                        <span class="poster-reason">{item.reason}</span>
                                    {/if}
                                </div>
                            </a>
                        {/each}
                    </div>
                </section>
            {/if}
            {#if selectedPersonId && personPickMovies.length > 0}
                <section class="smart-section">
                    <div class="section-header">
                        <h2 class="section-title" style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                            <span>Because you like</span>
                            <div class="person-pick-dropdown" style="position:relative;display:inline-block;">
                                <button class="btn btn-xs btn-ghost gap-1" onclick={() => { personPickOpen = !personPickOpen; personPickSearch = ''; }} title="Change person">
                                    <span class="text-primary font-semibold">{selectedPersonName}</span>
                                    <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3 opacity-50" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clip-rule="evenodd"/></svg>
                                </button>
                                {#if personPickOpen}
                                    <div class="person-pick-menu">
                                        <input type="text" class="input input-xs input-bordered w-full mb-1" placeholder="Search people..." bind:value={personPickSearch} />
                                        <div class="person-pick-list">
                                            {#each personPickFiltered as p}
                                                <button
                                                    class="person-pick-item" class:active={p.id === selectedPersonId}
                                                    onclick={() => { selectedPersonId = p.id; personPickOpen = false; personPickSeed++; }}
                                                >
                                                    <span>{p.name}</span>
                                                    <span class="text-xs opacity-40">{p.movie_count} films{p.is_favorite ? ' ★' : ''}</span>
                                                </button>
                                            {/each}
                                        </div>
                                    </div>
                                {/if}
                            </div>
                        </h2>
                        <button class="btn btn-ghost btn-xs btn-circle" onclick={cyclePersonPick} title="Different person">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><polyline points="23 20 23 14 17 14"/><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/></svg>
                        </button>
                    </div>
                    <div class="poster-scroll">
                        {#each personPickMovies as item}
                            <a href="/movies/{item.slug || item.id}" class="poster-card poster-card-sm" title={item.title}>
                                <span class="uwb">unwatched</span>
                                <div class="poster-img poster-placeholder">🎬</div>
                                {#if item.poster_url}
                                    <img src={imgUrl(item.poster_url)} alt={item.title} class="poster-img poster-img-abs" loading="lazy" onerror={(e) => { /** @type {HTMLImageElement} */ (e.currentTarget).style.display='none'; }} />
                                {/if}
                                <div class="poster-meta">
                                    <span class="poster-name">{item.title}</span>
                                </div>
                            </a>
                        {/each}
                    </div>
                </section>
            {/if}
        </div>

        <!-- Watch Again + Recently Watched (side by side) -->
        <div class="dual-row">
            {#if topRewatched.length > 0}
                <section class="smart-section">
                    <div class="section-header">
                        <h2 class="section-title">🔁 Watch Again</h2>
                        <span class="section-count">{topRewatched.length} films</span>
                    </div>
                    <div class="poster-scroll">
                        {#each topRewatched as item}
                            <a href="/movies/{item.slug || item.id}" class="poster-card poster-card-sm" title="{item.title} ({item.play_count}x)">
                                <div class="poster-img poster-placeholder">🎬</div>
                                {#if item.poster_url}
                                    <img src={imgUrl(item.poster_url)} alt={item.title} class="poster-img poster-img-abs" loading="lazy" onerror={(e) => { /** @type {HTMLImageElement} */ (e.currentTarget).style.display='none'; }} />
                                {/if}
                                <span class="rewatch-badge">{item.play_count}×</span>
                                <div class="poster-meta">
                                    <span class="poster-name">{item.title}</span>
                                    <span class="poster-year">{item.play_count}× watched</span>
                                </div>
                            </a>
                        {/each}
                    </div>
                </section>
            {/if}
            {#if sectionsLoaded && sections.recentlyWatched.length > 0}
                <section class="smart-section">
                    <div class="section-header">
                        <h2 class="section-title">🕐 Recently Watched</h2>
                    </div>
                    <div class="poster-scroll">
                        {#each sections.recentlyWatched.slice(0, 20) as item}
                            <a href="/movies/{item.slug || item.id}" class="poster-card poster-card-sm" title={item.title}>
                                <div class="poster-img poster-placeholder">🎬</div>
                                {#if item.poster_url}
                                    <img src={imgUrl(item.poster_url)} alt={item.title} class="poster-img poster-img-abs" loading="lazy" onerror={(e) => { /** @type {HTMLImageElement} */ (e.currentTarget).style.display='none'; }} />
                                {/if}
                                <div class="poster-meta">
                                    <span class="poster-name">{item.title}</span>
                                </div>
                            </a>
                        {/each}
                    </div>
                </section>
            {/if}
        </div>

        <!-- All Movies Section -->
        <div class="space-y-3" id="all-movies-section">
            <div class="flex items-center justify-between">
                <h2 class="text-xl font-bold">All Movies</h2>
                <div class="flex items-center gap-2">
                    <div class="sort-controls">
                        <select class="select select-bordered select-xs bg-base-300/30" bind:value={sortBy} onchange={() => page = 0}>
                            <option value="title">Name</option>
                            <option value="year">Year</option>
                            <option value="rating">Rating</option>
                            <option value="runtime">Runtime</option>
                        </select>
                        <button class="btn btn-xs btn-ghost" onclick={() => { sortDir = sortDir === 'asc' ? 'desc' : 'asc'; page = 0; }} title="{sortDir === 'asc' ? 'Ascending' : 'Descending'}">
                            {sortDir === 'asc' ? '↑' : '↓'}
                        </button>
                    </div>
                    <div class="btn-group">
                        <button class="btn btn-xs" class:btn-active={viewMode === 'poster'} onclick={() => viewMode = 'poster'} title="Poster view">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
                        </button>
                        <button class="btn btn-xs" class:btn-active={viewMode === 'list'} onclick={() => viewMode = 'list'} title="List view">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
                        </button>
                    </div>
                </div>
            </div>

            <!-- Filters Bar -->
            <div class="filters-bar">
                <input
                    type="text"
                    placeholder="Search movies..."
                    class="input input-bordered input-sm flex-1 min-w-[160px] bg-base-300/30"
                    bind:value={searchQuery}
                    oninput={() => page = 0}
                />
                <div class="genre-search-wrap">
                    <input
                        type="text"
                        placeholder="Add genre..."
                        class="input input-bordered input-sm bg-base-300/30 w-[140px]"
                        bind:value={genreSearch}
                        onfocus={() => genreDropdownOpen = true}
                        oninput={() => genreDropdownOpen = true}
                    />
                    {#if genreDropdownOpen && filteredGenres.length > 0}
                        <div class="person-dropdown">
                            {#each filteredGenres as g}
                                <button class="person-option" onclick={() => selectGenre(g)}>
                                    <span>{g.name.charAt(0).toUpperCase() + g.name.slice(1)}</span>
                                    <span class="text-base-content/40">{g.count}</span>
                                </button>
                            {/each}
                        </div>
                    {/if}
                </div>
                <div class="person-search-wrap">
                    <input
                        type="text"
                        placeholder="Add person..."
                        class="input input-bordered input-sm bg-base-300/30 w-[140px]"
                        bind:value={personSearch}
                        onfocus={() => personDropdownOpen = true}
                        oninput={() => personDropdownOpen = true}
                    />
                    {#if personDropdownOpen && filteredPersons.length > 0}
                        <div class="person-dropdown">
                            {#each filteredPersons as p}
                                <button class="person-option" onclick={() => selectPerson(p)}>
                                    <span>{p.name}</span>
                                    <span class="text-base-content/40">{p.movie_count}</span>
                                </button>
                            {/each}
                        </div>
                    {/if}
                </div>
                <div class="year-search-wrap">
                    <input
                        type="text"
                        placeholder="Year or range..."
                        class="input input-bordered input-sm bg-base-300/30 w-[130px]"
                        bind:value={yearSearch}
                        onfocus={() => yearDropdownOpen = true}
                        oninput={() => { yearDropdownOpen = true; page = 0; }}
                    />
                    {#if yearSearch}
                        <button class="person-clear" onclick={clearYear}>✕</button>
                    {/if}
                    {#if yearDropdownOpen && filteredYears.length > 0 && !parseYearFilter(yearSearch)}
                        <div class="person-dropdown">
                            {#each filteredYears as y}
                                <button class="person-option" onclick={() => selectYear(y)}>
                                    <span>{y.year}</span>
                                    <span class="text-base-content/40">{y.count}</span>
                                </button>
                            {/each}
                        </div>
                    {/if}
                </div>
                <div class="rating-filter">
                    <span class="text-xs text-base-content/50">Rating</span>
                    <input type="number" min="0" max="10" step="0.5" class="rating-input" bind:value={filterRatingMin} oninput={() => { if (filterRatingMin > filterRatingMax) filterRatingMin = filterRatingMax; page = 0; }} />
                    <span class="text-xs text-base-content/40">–</span>
                    <input type="number" min="0" max="10" step="0.5" class="rating-input" bind:value={filterRatingMax} oninput={() => { if (filterRatingMax < filterRatingMin) filterRatingMax = filterRatingMin; page = 0; }} />
                </div>
                <label class="flex items-center gap-1.5 cursor-pointer">
                    <input type="checkbox" class="toggle toggle-xs toggle-success" bind:checked={filterUnwatched} onchange={() => page = 0} />
                    <span class="text-xs text-base-content/60">Unwatched</span>
                </label>
                <label class="flex items-center gap-1.5 cursor-pointer">
                    <input type="checkbox" class="toggle toggle-xs toggle-success" bind:checked={downloadedOnly} onchange={() => page = 0} />
                    <span class="text-xs text-base-content/60">Downloaded</span>
                </label>
                {#if hasActiveFilters}
                    <button class="btn btn-xs btn-ghost" onclick={resetFilters}>✕ Clear</button>
                {/if}
                <span class="text-xs text-base-content/50">{filtered.length} results</span>
                <!-- Active filter badges (inline) -->
                {#if filterGenres.length > 0}
                    <span class="stat-divider"></span>
                    <div class="badge-group">
                        <span class="badge-group-label">Genres:</span>
                        {#if filterGenres.length > 1}
                            <span class="mode-toggle">
                                <button class="mode-opt" class:active={genreMode === 'any'} onclick={() => genreMode = 'any'}>any</button>
                                <span class="mode-sep">|</span>
                                <button class="mode-opt" class:active={genreMode === 'all'} onclick={() => genreMode = 'all'}>all</button>
                            </span>
                        {/if}
                        {#each filterGenres as g}
                            <span class="filter-badge genre-badge">
                                {g.charAt(0).toUpperCase() + g.slice(1)}
                                <button class="badge-dismiss" onclick={() => removeGenre(g)}>×</button>
                            </span>
                        {/each}
                    </div>
                {/if}
                {#if filterPersons.length > 0}
                    <span class="stat-divider"></span>
                    <div class="badge-group">
                        <span class="badge-group-label">People:</span>
                        {#if filterPersons.length > 1}
                            <span class="mode-toggle">
                                <button class="mode-opt" class:active={personMode === 'any'} onclick={() => personMode = 'any'}>any</button>
                                <span class="mode-sep">|</span>
                                <button class="mode-opt" class:active={personMode === 'all'} onclick={() => personMode = 'all'}>all</button>
                            </span>
                        {/if}
                        {#each filterPersons as p}
                            <span class="filter-badge person-badge">
                                {p.name}
                                <button class="badge-dismiss" onclick={() => removePerson(p.id)}>×</button>
                            </span>
                        {/each}
                    </div>
                {/if}
            </div>

            <!-- POSTER VIEW -->
            {#if viewMode === 'poster'}
                <div class="poster-grid">
                    {#each paged as movie}
                        <a href="/movies/{movie.slug || movie.id}" class="poster-grid-card" title={movie.title}>
                            <div class="poster-grid-img-wrap">
                                <div class="poster-grid-placeholder">🎬</div>
                                {#if movie.poster_url}
                                    <img src={imgUrl(movie.poster_url)} alt={movie.title} class="poster-grid-img" loading="lazy" onerror={(e) => { /** @type {HTMLImageElement} */ (e.currentTarget).style.display='none'; }} />
                                {/if}
                                {#if movie.watch_status === 'watched'}
                                    <span class="status-dot watched" title="Watched">✓</span>
                                {:else if movie.watch_status === 'unwatched'}
                                    <span class="status-dot unwatched" title="Unwatched"></span>
                                {:else if movie.watch_status === 'not_downloaded'}
                                    <span class="status-dot missing" title="Not Downloaded">!</span>
                                {/if}
                                {#if movie.rating_display}
                                    <span class="rating-pill">★ {movie.rating_display}</span>
                                {/if}
                            </div>
                            <div class="poster-grid-meta">
                                <span class="poster-grid-title">{movie.title}</span>
                                <span class="poster-grid-year">{movie.release_year || ''}{movie.runtime_minutes ? ` · ${fmtRuntime(movie.runtime_minutes)}` : ''}</span>
                            </div>
                        </a>
                    {/each}
                </div>
            {:else}
                <!-- LIST VIEW -->
                <div class="overflow-x-auto rounded-xl border border-base-content/5">
                    <table class="table table-sm">
                        <thead>
                            <tr class="bg-base-300/30">
                                <th class="font-medium">Title</th>
                                <th class="text-center w-16">Year</th>
                                <th class="text-center w-20">Rating</th>
                                <th class="text-center w-24">Runtime</th>
                                <th class="text-center w-36">Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            {#each paged as movie}
                                <tr class="hover:bg-base-300/20 transition-colors">
                                    <td class="font-medium">
                                        <a href="/movies/{movie.slug || movie.id}" class="link link-hover link-primary">{movie.title}</a>
                                    </td>
                                    <td class="text-center">{movie.release_year || '—'}</td>
                                    <td class="text-center">
                                        {#if movie.rating_display}
                                            <span class="text-warning">★</span> {movie.rating_display}
                                        {:else}
                                            —
                                        {/if}
                                    </td>
                                    <td class="text-center">{fmtRuntime(movie.runtime_minutes)}</td>
                                    <td class="text-center">
                                        {@html statusBadge(movie.watch_status)}
                                        {#if movie.last_watched}
                                            <span class="text-xs text-base-content/40 ml-1">{timeAgo(movie.last_watched)}</span>
                                        {/if}
                                    </td>
                                </tr>
                            {/each}
                            {#if paged.length === 0}
                                <tr>
                                    <td colspan="5" class="text-center text-base-content/40 py-8">No results found</td>
                                </tr>
                            {/if}
                        </tbody>
                    </table>
                </div>
            {/if}

            <!-- Pagination -->
            <div class="pagination-bar">
                <div class="flex items-center gap-1">
                    <span class="text-xs text-base-content/50">Show</span>
                    <select class="select select-bordered select-xs bg-base-300/30" value={pageSize} onchange={(e) => { pageSize = parseInt(e.target.value); page = 0; }}>
                        {#each PAGE_SIZE_OPTIONS as size}
                            <option value={size}>{size === 0 ? 'All' : size}</option>
                        {/each}
                    </select>
                </div>
                {#if totalPages > 1}
                    <div class="flex items-center gap-2">
                        <button class="btn btn-xs btn-ghost" onclick={() => page = Math.max(0, page - 1)} disabled={page === 0}>←</button>
                        <span class="text-xs text-base-content/60">Page {page + 1} of {totalPages}</span>
                        <button class="btn btn-xs btn-ghost" onclick={() => page = Math.min(totalPages - 1, page + 1)} disabled={page >= totalPages - 1}>→</button>
                    </div>
                {/if}
            </div>
        </div>
    {/if}
</div>

<style>
    .page-wrap { display: flex; flex-direction: column; gap: 1.25rem; padding: 0 1.5rem; }
    .page-header { display: flex; align-items: flex-end; justify-content: space-between; }
    .page-title { font-size: 1.75rem; font-weight: 800; letter-spacing: -0.02em; }
    .page-sub { font-size: 0.8rem; color: oklch(var(--bc) / 0.45); margin-top: 2px; }

    /* Compact stats strip */
    .stats-strip {
        display: flex; align-items: center; gap: 1rem;
        padding: 0.6rem 1.25rem; border-radius: 1rem;
        background: oklch(var(--b3) / 0.3); border: 1px solid oklch(var(--bc) / 0.06);
    }
    .stat-donut-wrap {
        position: relative; width: 44px; height: 44px; flex-shrink: 0;
    }
    .stat-donut { width: 44px; height: 44px; }
    .stat-donut-pct {
        position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
        font-size: 0.55rem; font-weight: 700; color: oklch(var(--bc) / 0.7);
    }
    .stat-item { display: flex; flex-direction: column; align-items: center; min-width: 50px; }
    .stat-value { font-size: 1.1rem; font-weight: 800; line-height: 1.2; }
    .stat-label { font-size: 0.6rem; text-transform: uppercase; letter-spacing: 0.04em; color: oklch(var(--bc) / 0.4); font-weight: 600; }
    .stat-divider { width: 1px; height: 28px; background: oklch(var(--bc) / 0.1); flex-shrink: 0; }

    /* Chart toggle */
    .chart-toggle {
        position: absolute; top: 8px; right: 12px; z-index: 5;
        display: flex; gap: 2px;
    }
    .chart-toggle-sub {
        position: absolute; top: 34px; right: 12px; z-index: 5;
        display: flex; gap: 4px;
    }

    /* Sort controls */
    .sort-controls {
        display: flex; align-items: center; gap: 2px;
    }

    /* Filters */
    .filters-bar {
        display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem;
    }
    .rating-filter {
        display: flex; align-items: center; gap: 0.5rem;
    }

    /* Rating filter inputs */
    .rating-input {
        width: 3.2rem; padding: 0.15rem 0.3rem; font-size: 0.75rem;
        text-align: center; border-radius: 0.375rem;
        border: 1px solid oklch(var(--bc) / 0.15);
        background: oklch(var(--b2)); color: oklch(var(--bc));
        outline: none;
    }
    .rating-input:focus {
        border-color: oklch(var(--p));
    }

    /* Person / Genre / Year search */
    .person-search-wrap, .genre-search-wrap, .year-search-wrap {
        position: relative;
    }
    .person-clear {
        position: absolute; right: 6px; top: 50%; transform: translateY(-50%);
        font-size: 0.65rem; cursor: pointer; color: oklch(var(--bc) / 0.4);
        background: none; border: none; padding: 2px;
    }
    .person-clear:hover { color: oklch(var(--bc) / 0.8); }
    .person-dropdown {
        position: absolute; top: 100%; left: 0; right: 0; z-index: 50;
        max-height: 240px; overflow-y: auto;
        background-color: #1d232a; border: 1px solid rgba(255,255,255,0.1);
        border-radius: 0.5rem; margin-top: 2px;
        box-shadow: 0 8px 24px rgba(0,0,0,0.7);
    }
    .person-option {
        display: flex; justify-content: space-between; align-items: center;
        width: 100%; padding: 0.35rem 0.65rem; font-size: 0.78rem;
        background: none; border: none; cursor: pointer; color: inherit;
        text-align: left;
    }
    .person-option:hover {
        background: oklch(var(--p) / 0.12);
    }

    /* Smart section (rewatched) */
    .smart-section { display: flex; flex-direction: column; gap: 0.75rem; }
    .section-header { display: flex; align-items: baseline; gap: 10px; }
    .section-title { font-size: 1.1rem; font-weight: 700; }
    .section-count { font-size: 0.7rem; color: oklch(var(--bc) / 0.35); }

    /* Poster scroll row (rewatched) */
    .poster-scroll {
        display: flex; gap: 14px; overflow-x: auto;
        scrollbar-width: none; -ms-overflow-style: none; padding-bottom: 4px;
        mask-image: linear-gradient(to right, black calc(100% - 48px), transparent);
        -webkit-mask-image: linear-gradient(to right, black calc(100% - 48px), transparent);
    }
    .poster-scroll::-webkit-scrollbar { display: none; }

    .dual-row {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 1.5rem;
    }
    .dual-row > * {
        min-width: 0;
        overflow: hidden;
    }
    @media (max-width: 768px) {
        .dual-row { grid-template-columns: 1fr; }
    }
    .poster-card-sm { width: 80px; }

    /* Person pick dropdown */
    .person-pick-menu {
        position: absolute; top: 100%; left: 0; z-index: 50;
        background-color: #1d232a; border: 1px solid rgba(255,255,255,0.1);
        border-radius: 0.5rem; padding: 0.375rem; min-width: 220px; max-width: 280px;
        box-shadow: 0 8px 24px rgba(0,0,0,0.7);
    }
    .person-pick-list {
        max-height: 200px; overflow-y: auto; display: flex; flex-direction: column; gap: 1px;
    }
    .person-pick-item {
        display: flex; justify-content: space-between; align-items: center;
        padding: 0.25rem 0.5rem; border-radius: 0.25rem; cursor: pointer;
        background: transparent; border: none; color: inherit; font-size: 0.8rem;
        text-align: left; width: 100%; transition: background 0.1s;
    }
    .person-pick-item:hover { background: oklch(var(--bc) / 0.08); }
    .person-pick-item.active { background: oklch(var(--p) / 0.15); color: oklch(var(--p)); font-weight: 600; }

    .poster-card {
        flex-shrink: 0; width: 90px; text-decoration: none; color: inherit;
        transition: transform 0.2s ease, box-shadow 0.2s ease; position: relative;
    }
    .poster-card:hover { transform: translateY(-3px) scale(1.03); }
    .poster-img {
        width: 100%; aspect-ratio: 2/3; border-radius: 8px; object-fit: cover;
        box-shadow: 0 4px 14px oklch(0 0 0 / 0.35);
    }
    .poster-img-abs { position: absolute; inset: 0; z-index: 1; }
    .poster-placeholder {
        display: flex; align-items: center; justify-content: center;
        background: oklch(var(--b3)); font-size: 2rem;
    }
    .poster-meta { margin-top: 4px; display: flex; flex-direction: column; gap: 1px; }
    .poster-name {
        font-size: 0.6rem; font-weight: 600; overflow: hidden;
        text-overflow: ellipsis; white-space: nowrap; line-height: 1.2;
    }
    .poster-year { font-size: 0.5rem; color: oklch(var(--bc) / 0.4); }
    .rewatch-badge {
        position: absolute; top: 4px; right: 4px; z-index: 2;
        font-size: 0.5rem; font-weight: 700; padding: 1px 5px; border-radius: 4px;
        background: oklch(var(--p)); color: oklch(var(--pc));
        text-shadow: 0 1px 2px rgba(0,0,0,0.4); border: 1px solid rgba(0,0,0,0.15);
    }

    /* Poster grid (all movies) */
    .poster-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
        gap: 1.25rem 0.75rem;
    }
    .poster-grid-card {
        text-decoration: none; color: inherit;
        transition: transform 0.15s ease;
    }
    .poster-grid-card:hover { transform: translateY(-4px); }
    .poster-grid-img-wrap {
        position: relative; aspect-ratio: 2/3; border-radius: 10px; overflow: hidden;
        background: oklch(var(--b3));
        box-shadow: 0 4px 14px oklch(0 0 0 / 0.3);
    }
    .poster-grid-placeholder {
        position: absolute; inset: 0; display: flex; align-items: center;
        justify-content: center; font-size: 2rem;
    }
    .poster-grid-img {
        position: relative; z-index: 1; width: 100%; height: 100%; object-fit: cover;
    }
    .poster-grid-meta { margin-top: 6px; display: flex; flex-direction: column; gap: 1px; }
    .poster-grid-title {
        font-size: 0.72rem; font-weight: 600; overflow: hidden;
        text-overflow: ellipsis; white-space: nowrap; line-height: 1.3;
    }
    .poster-grid-year { font-size: 0.62rem; color: oklch(var(--bc) / 0.4); }

    /* Status dot on poster */
    .status-dot {
        position: absolute; top: 6px; left: 6px; z-index: 2;
        width: 18px; height: 18px; border-radius: 50%;
        font-size: 0.55rem; font-weight: 700; display: flex;
        align-items: center; justify-content: center;
        border: 1.5px solid rgba(0,0,0,0.2);
    }
    .status-dot.watched { background: #16a34a; color: #fff; }
    .status-dot.unwatched { background: #6b7280; }
    .status-dot.missing { background: #dc2626; color: #fff; }

    /* Rating pill on poster */
    .rating-pill {
        position: absolute; bottom: 6px; right: 6px; z-index: 2;
        font-size: 0.55rem; font-weight: 700; padding: 1px 5px; border-radius: 4px;
        background: oklch(0 0 0 / 0.7); color: #facc15;
        backdrop-filter: blur(4px);
    }

    /* btn-group for view toggle */
    .btn-group { display: flex; gap: 0; }
    .btn-group .btn { border-radius: 0; }
    .btn-group .btn:first-child { border-radius: 0.375rem 0 0 0.375rem; }
    .btn-group .btn:last-child { border-radius: 0 0.375rem 0.375rem 0; }

    /* Pagination bar */
    .pagination-bar {
        display: flex; justify-content: center; align-items: center; gap: 1rem;
    }

    /* Filter badge row */
    .filter-badges {
        display: flex; flex-wrap: wrap; gap: 0.75rem; align-items: center;
        padding: 0.35rem 0;
    }
    .badge-group {
        display: flex; flex-wrap: wrap; gap: 0.35rem; align-items: center;
    }
    .badge-group-label {
        font-size: 0.65rem; font-weight: 600; text-transform: uppercase;
        color: oklch(var(--bc) / 0.4); letter-spacing: 0.05em; margin-right: 2px;
    }
    .mode-toggle {
        display: inline-flex; align-items: center; gap: 1px;
        font-size: 0.65rem; font-weight: 600; text-transform: lowercase;
        margin-right: 2px;
    }
    .mode-opt {
        background: none; border: none; cursor: pointer;
        padding: 0 2px; font-size: 0.65rem; font-weight: 600;
        color: oklch(var(--bc) / 0.3);
        transition: color 0.15s ease;
    }
    .mode-opt.active {
        color: oklch(var(--p));
    }
    .mode-opt:hover:not(.active) {
        color: oklch(var(--bc) / 0.6);
    }
    .mode-sep {
        color: oklch(var(--bc) / 0.2);
        font-size: 0.6rem;
        user-select: none;
    }
    .filter-badge {
        display: inline-flex; align-items: center; gap: 4px;
        font-size: 0.7rem; font-weight: 500; padding: 2px 8px; border-radius: 999px;
        background: oklch(var(--bc) / 0.08); color: oklch(var(--bc) / 0.8);
        border: 1px solid oklch(var(--bc) / 0.1);
    }
    .genre-badge { background: oklch(var(--su) / 0.12); color: oklch(var(--su)); border-color: oklch(var(--su) / 0.2); }
    .person-badge { background: oklch(var(--in) / 0.12); color: oklch(var(--in)); border-color: oklch(var(--in) / 0.2); }
    .badge-dismiss {
        background: none; border: none; cursor: pointer; font-size: 0.6rem;
        color: inherit; opacity: 0.5; padding: 0; line-height: 1;
        transition: opacity 0.15s;
    }
    .badge-dismiss:hover { opacity: 1; }

    /* Discovery badges */
    .uwb {
        position: absolute; top: 6px; right: 6px; z-index: 2;
        font-size: 0.5rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;
        padding: 2px 7px; border-radius: 6px;
        background: #dc2626; color: #fff;
        text-shadow: 0 1px 2px rgba(0,0,0,0.4); border: 1px solid rgba(0,0,0,0.15);
    }
    .poster-reason {
        font-size: 0.58rem; color: oklch(var(--p) / 0.8); font-weight: 500;
    }
    .person-link {
        color: oklch(var(--p)); text-decoration: none; cursor: pointer;
        font-weight: 600; transition: color 0.15s;
    }
    .person-link:hover { text-decoration: underline; color: oklch(var(--s)); }
</style>
