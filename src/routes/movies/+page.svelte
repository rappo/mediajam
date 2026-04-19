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
    let filterStatus = $state('all'); // all | watched | unwatched | not_downloaded
    let filterRatingMin = $state(0);
    let filterRatingMax = $state(10);
    let downloadedOnly = $state(true);

    // Sort
    let sortBy = $state('title'); // 'title' | 'year' | 'rating'
    let sortDir = $state('asc'); // 'asc' | 'desc'

    // Chart toggle
    let chartMode = $state('decade'); // 'decade' | 'year' | 'genre' | 'rating'

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
            if (params.get('status')) filterStatus = params.get('status') || 'all';
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
        if (filterStatus !== 'all') p.set('status', filterStatus);
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
        if (filterStatus !== 'all') {
            if (filterStatus === 'not_downloaded') {
                result = result.filter(m => m.collection_status === 'wanted');
            } else {
                result = result.filter(m => m.watch_status === filterStatus);
            }
        }
        if (filterRatingMin > 0 || filterRatingMax < 10) {
            result = result.filter(m => {
                if (m.rating_value === null) return filterRatingMin === 0;
                return m.rating_value >= filterRatingMin && m.rating_value <= filterRatingMax;
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

    // Rating chart data — individual scores 0-100, line chart
    let chartByRating = $derived.by(() => {
        /** @type {Map<number, {watched: number, unwatched: number}>} */
        const map = new Map();
        for (const m of movies) {
            const r = m.rating_value;
            if (r == null) continue;
            const score = Math.round(r);
            const entry = map.get(score) || { watched: 0, unwatched: 0 };
            if (m.watch_status === 'watched') entry.watched++; else entry.unwatched++;
            map.set(score, entry);
        }
        return [...map.entries()].sort((a, b) => a[0] - b[0]).map(([rating, c]) => ({ rating, ...c }));
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
        if (chartMode === 'rating') {
            return {
                title: { text: "By Rating (IMDb / TMDB / RT / MC)" },
                axisX: { labelFontSize: 10, interval: 10 },
                axisY: { title: "Count", titleFontColor: "#a6adba" },
                toolTip: { shared: true },
                legend: { fontColor: "#a6adba", fontSize: 11 },
                data: [
                    { type: "stackedArea", name: "Watched", color: "#36d399", showInLegend: true, markerSize: 0, lineThickness: 2, dataPoints: chartByRating.map(d => ({ label: String(d.rating), y: d.watched })) },
                    { type: "stackedArea", name: "Unwatched", color: "#a1a1aa", showInLegend: true, markerSize: 0, lineThickness: 2, dataPoints: chartByRating.map(d => ({ label: String(d.rating), y: d.unwatched })) },
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
        filterStatus = 'all';
        filterRatingMin = 0;
        filterRatingMax = 10;
        page = 0;
    }

    let hasActiveFilters = $derived(
        searchQuery || filterGenres.length || filterPersons.length || yearSearch || filterStatus !== 'all' || filterRatingMin > 0 || filterRatingMax < 10
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
        </div>

        <!-- Chart -->
        <div class="relative">
            <div class="chart-toggle">
                <button class="btn btn-xs" class:btn-active={chartMode === 'decade'} onclick={() => chartMode = 'decade'}>Decade</button>
                <button class="btn btn-xs" class:btn-active={chartMode === 'year'} onclick={() => chartMode = 'year'}>Year</button>
                <button class="btn btn-xs" class:btn-active={chartMode === 'genre'} onclick={() => chartMode = 'genre'}>Genre</button>
                <button class="btn btn-xs" class:btn-active={chartMode === 'rating'} onclick={() => chartMode = 'rating'}>Rating</button>
            </div>
            <Chart options={chartOptions} height={240} />
        </div>

        <!-- Picks For You (full width) -->
        {#if sectionsLoaded && (sections.recommended.length > 0 || sections.personRecs.length > 0)}
            {@const picks = [...sections.recommended.slice(0, 8), ...sections.personRecs.flatMap(s => s.items).slice(0, 4)].slice(0, 12)}
            <section class="smart-section">
                <div class="section-header">
                    <h2 class="section-title">🎯 Picks For You</h2>
                    <span class="section-count">unwatched</span>
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
        <div class="space-y-3">
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
                <select class="select select-bordered select-sm bg-base-300/30 w-[130px]" bind:value={filterStatus} onchange={() => page = 0}>
                    <option value="all">All Status</option>
                    <option value="watched">Watched</option>
                    <option value="unwatched">Unwatched</option>
                    <option value="not_downloaded">Not Downloaded</option>
                </select>
                <div class="rating-filter">
                    <span class="text-xs text-base-content/50">Rating</span>
                    <input type="number" min="0" max="10" step="0.5" class="rating-input" bind:value={filterRatingMin} oninput={() => { if (filterRatingMin > filterRatingMax) filterRatingMin = filterRatingMax; page = 0; }} />
                    <span class="text-xs text-base-content/40">–</span>
                    <input type="number" min="0" max="10" step="0.5" class="rating-input" bind:value={filterRatingMax} oninput={() => { if (filterRatingMax < filterRatingMin) filterRatingMax = filterRatingMin; page = 0; }} />
                </div>
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
                        <span class="badge-group-label">Genres</span>
                        {#if filterGenres.length > 1}
                            <button class="mode-chip" onclick={() => genreMode = genreMode === 'any' ? 'all' : 'any'} title="Toggle between Any (OR) and All (AND)">
                                {genreMode === 'any' ? 'any' : 'all'}
                            </button>
                        {/if}
                        {#each filterGenres as g}
                            <span class="filter-badge genre-badge">
                                {g.charAt(0).toUpperCase() + g.slice(1)}
                                <button class="badge-dismiss" onclick={() => removeGenre(g)}>✕</button>
                            </span>
                        {/each}
                    </div>
                {/if}
                {#if filterPersons.length > 0}
                    <span class="stat-divider"></span>
                    <div class="badge-group">
                        <span class="badge-group-label">People</span>
                        {#if filterPersons.length > 1}
                            <button class="mode-chip" onclick={() => personMode = personMode === 'all' ? 'any' : 'all'} title="Toggle between All (AND) and Any (OR)">
                                {personMode === 'all' ? 'all' : 'any'}
                            </button>
                        {/if}
                        {#each filterPersons as p}
                            <span class="filter-badge person-badge">
                                {p.name}
                                <button class="badge-dismiss" onclick={() => removePerson(p.id)}>✕</button>
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
    .mode-chip {
        font-size: 0.6rem; font-weight: 700; text-transform: uppercase;
        padding: 2px 8px; border-radius: 6px; cursor: pointer;
        background: oklch(var(--p) / 0.25); color: oklch(var(--p));
        border: 1px solid oklch(var(--p) / 0.4);
        transition: all 0.15s ease;
        letter-spacing: 0.04em;
        box-shadow: 0 1px 3px oklch(0 0 0 / 0.2);
    }
    .mode-chip:hover {
        background: oklch(var(--p) / 0.4);
        box-shadow: 0 1px 5px oklch(var(--p) / 0.3);
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
