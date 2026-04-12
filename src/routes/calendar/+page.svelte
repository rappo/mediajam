<script>
    import { onMount } from 'svelte';
    import Skeleton from "$lib/components/Skeleton.svelte";
    import { imgUrl } from "$lib/utils.js";

    // ── State ──────────────────────────────────────────────────────
    let loaded = $state(false);
    let loading = $state(false);
    /** @type {any[]} */
    let items = $state([]);
    /** @type {number[]} */
    let years = $state([]);
    let totalCount = $state(0);
    let filteredCount = $state(0);

    // Filters
    let viewMode = $state('list'); // 'grid' | 'list'
    let typeFilter = $state('all'); // 'all' | 'movie' | 'show' | 'artist'
    let statusFilter = $state('all'); // 'all' | 'watched' | 'unwatched' | 'in_progress'
    let spanPreset = $state('last30d'); // 'last7d' | 'last30d' | 'last90d' | 'lastYear' | 'custom'
    let futureDays = $state(7);
    let selectedYear = $state(new Date().getFullYear());
    let selectedMonth = $state(0); // 0 = all months

    // Sort
    let sortNewestFirst = $state(true);

    // ── Fetch ──────────────────────────────────────────────────────
    async function fetchCalendar() {
        loading = true;
        const params = new URLSearchParams();
        params.set('type', typeFilter);
        params.set('status', statusFilter);
        params.set('span', spanPreset);
        params.set('futureDays', String(futureDays));
        if (spanPreset === 'custom') {
            params.set('year', String(selectedYear));
            if (selectedMonth > 0) params.set('month', String(selectedMonth));
        }
        try {
            const res = await fetch(`/api/pages/calendar?${params}`);
            const d = await res.json();
            items = d.items || [];
            years = d.years || [];
            totalCount = d.totalCount || 0;
            filteredCount = d.filteredCount || 0;
        } catch (e) {
            console.error('[calendar] Failed to fetch:', e);
        }
        loading = false;
        loaded = true;
    }

    onMount(() => fetchCalendar());

    // Re-fetch when filters change
    $effect(() => {
        // Touch all reactive filter values to create dependencies
        typeFilter; statusFilter; spanPreset; futureDays; selectedYear; selectedMonth;
        if (loaded) fetchCalendar();
    });

    // ── Derived data ───────────────────────────────────────────────

    /** Items sorted by current sort preference */
    let sortedItems = $derived.by(() => {
        const sorted = [...items];
        if (!sortNewestFirst) sorted.reverse();
        return sorted;
    });

    /** Items grouped by month for list view */
    let groupedByMonth = $derived.by(() => {
        /** @type {Map<string, any[]>} */
        const groups = new Map();
        for (const item of sortedItems) {
            const d = item.release_date || `${item.release_year}-01-01`;
            const key = d.substring(0, 7); // YYYY-MM
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key)?.push(item);
        }
        return [...groups.entries()].map(([key, items]) => ({
            key,
            label: formatMonthLabel(key),
            items,
        }));
    });

    /** Items grouped into a calendar grid for the grid view */
    let calendarGrid = $derived.by(() => {
        // Determine the month to display
        const month = gridMonth;
        const year = gridYear;
        const firstDay = new Date(year, month - 1, 1);
        const lastDay = new Date(year, month, 0);
        const daysInMonth = lastDay.getDate();

        // Start from Monday
        let startDow = firstDay.getDay(); // 0=Sun
        startDow = startDow === 0 ? 6 : startDow - 1; // 0=Mon

        /** @type {Array<{date: string, day: number, isToday: boolean, isPast: boolean, items: any[]}>} */
        const cells = [];

        // Pad leading empty days
        for (let i = 0; i < startDow; i++) {
            cells.push({ date: '', day: 0, isToday: false, isPast: false, items: [] });
        }

        const todayISO = new Date().toISOString().split('T')[0];

        // Build lookup for items by date
        /** @type {Map<string, any[]>} */
        const byDate = new Map();
        for (const item of items) {
            const d = item.release_date || `${item.release_year}-01-01`;
            if (!byDate.has(d)) byDate.set(d, []);
            byDate.get(d)?.push(item);
        }

        for (let d = 1; d <= daysInMonth; d++) {
            const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            cells.push({
                date: dateStr,
                day: d,
                isToday: dateStr === todayISO,
                isPast: dateStr < todayISO,
                items: byDate.get(dateStr) || [],
            });
        }

        // Fill trailing to complete last week
        while (cells.length % 7 !== 0) {
            cells.push({ date: '', day: 0, isToday: false, isPast: false, items: [] });
        }

        // Chunk into weeks
        /** @type {Array<typeof cells>} */
        const weeks = [];
        for (let i = 0; i < cells.length; i += 7) {
            weeks.push(cells.slice(i, i + 7));
        }

        return { year, month, weeks };
    });

    // Grid view month tracking
    let gridYear = $state(new Date().getFullYear());
    let gridMonth = $state(new Date().getMonth() + 1);

    function gridPrevMonth() {
        if (gridMonth === 1) { gridMonth = 12; gridYear--; }
        else gridMonth--;
        // Update filters to fetch data for this month
        spanPreset = 'custom';
        selectedYear = gridYear;
        selectedMonth = gridMonth;
    }

    function gridNextMonth() {
        if (gridMonth === 12) { gridMonth = 1; gridYear++; }
        else gridMonth++;
        spanPreset = 'custom';
        selectedYear = gridYear;
        selectedMonth = gridMonth;
    }

    function gridToday() {
        const now = new Date();
        gridYear = now.getFullYear();
        gridMonth = now.getMonth() + 1;
        spanPreset = 'custom';
        selectedYear = gridYear;
        selectedMonth = gridMonth;
    }

    // When switching to grid mode, sync grid month
    function setViewMode(mode) {
        viewMode = mode;
        if (mode === 'grid') {
            if (spanPreset !== 'custom') {
                spanPreset = 'custom';
                selectedMonth = gridMonth;
                selectedYear = gridYear;
            }
        }
    }

    // ── Helpers ─────────────────────────────────────────────────────

    /** @param {string} key YYYY-MM */
    function formatMonthLabel(key) {
        const [y, m] = key.split('-').map(Number);
        const d = new Date(y, m - 1, 1);
        return d.toLocaleString('en-US', { month: 'long', year: 'numeric' });
    }

    /** @param {string} dateStr */
    function formatDate(dateStr) {
        if (!dateStr) return '';
        const d = new Date(dateStr + 'T12:00:00');
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }

    /** @param {string} mediaType */
    function typeIcon(mediaType) {
        const icons = { movie: '🎬', show: '📺', album: '🎵', artist: '🎵' };
        return icons[mediaType] || '📦';
    }

    /** @param {string} mediaType */
    function typeBadgeClass(mediaType) {
        const classes = {
            movie: 'type-movie',
            show: 'type-show',
            album: 'type-album',
            artist: 'type-album',
        };
        return classes[mediaType] || '';
    }

    /** @param {string} status */
    function statusBadgeClass(status) {
        const classes = {
            watched: 'status-watched',
            unwatched: 'status-unwatched',
            in_progress: 'status-inprogress',
        };
        return classes[status] || 'status-unwatched';
    }

    /** @param {string} status */
    function statusLabel(status) {
        if (status === 'watched') return 'Watched';
        if (status === 'in_progress') return 'In Progress';
        return 'Unwatched';
    }

    const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

    const spanOptions = [
        { value: 'last7d', label: 'Last 7 days' },
        { value: 'last30d', label: 'Last 30 days' },
        { value: 'last90d', label: 'Last 3 months' },
        { value: 'lastYear', label: 'Last year' },
        { value: 'custom', label: 'Custom' },
    ];

    const futureOptions = [
        { value: 0, label: 'None' },
        { value: 7, label: '+7 days' },
        { value: 30, label: '+30 days' },
        { value: 90, label: '+90 days' },
    ];
</script>

<svelte:head>
    <title>Mediajam — Calendar</title>
</svelte:head>

<div class="page-wrap max-w-6xl mx-auto">
    <!-- Header -->
    <div class="page-header">
        <div>
            <h1 class="page-title">Calendar</h1>
            <p class="page-sub">
                {#if loaded}
                    {filteredCount.toLocaleString()} items
                    {#if filteredCount !== totalCount}
                        of {totalCount.toLocaleString()} in library
                    {/if}
                {:else}
                    Loading...
                {/if}
            </p>
        </div>
    </div>

    <!-- Toolbar -->
    <div class="toolbar">
        <!-- Row 1: View toggle + Type filter + Status filter -->
        <div class="toolbar-row">
            <!-- View toggle -->
            <div class="view-toggle">
                <button
                    class="toggle-btn {viewMode === 'list' ? 'active' : ''}"
                    onclick={() => setViewMode('list')}
                    title="List view"
                >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                        <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/>
                        <circle cx="4" cy="6" r="1" fill="currentColor"/><circle cx="4" cy="12" r="1" fill="currentColor"/><circle cx="4" cy="18" r="1" fill="currentColor"/>
                    </svg>
                </button>
                <button
                    class="toggle-btn {viewMode === 'grid' ? 'active' : ''}"
                    onclick={() => setViewMode('grid')}
                    title="Calendar grid"
                >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
                    </svg>
                </button>
            </div>

            <!-- Type filter pills -->
            <div class="filter-pills">
                {#each [['all', 'All'], ['movie', '🎬 Movies'], ['show', '📺 TV'], ['artist', '🎵 Music']] as [val, label]}
                    <button
                        class="pill {typeFilter === val ? 'pill-active' : ''}"
                        onclick={() => { typeFilter = val; }}
                    >{label}</button>
                {/each}
            </div>

            <!-- Status filter pills -->
            <div class="filter-pills">
                {#each [['all', 'All'], ['watched', '✓ Watched'], ['unwatched', 'Unwatched'], ['in_progress', '◐ In Progress']] as [val, label]}
                    <button
                        class="pill {statusFilter === val ? 'pill-active' : ''}"
                        onclick={() => { statusFilter = val; }}
                    >{label}</button>
                {/each}
            </div>
        </div>

        <!-- Row 2: Time span + Future padding + Sort -->
        <div class="toolbar-row">
            <!-- Time span -->
            <div class="filter-group">
                <label class="filter-label">Range</label>
                <div class="filter-pills">
                    {#each spanOptions as opt}
                        <button
                            class="pill pill-sm {spanPreset === opt.value ? 'pill-active' : ''}"
                            onclick={() => {
                                spanPreset = opt.value;
                                if (opt.value === 'custom' && viewMode === 'grid') {
                                    selectedYear = gridYear;
                                    selectedMonth = gridMonth;
                                }
                            }}
                        >{opt.label}</button>
                    {/each}
                </div>
            </div>

            {#if spanPreset === 'custom'}
                <!-- Year/Month selectors -->
                <div class="filter-group">
                    <label class="filter-label">Year</label>
                    <select class="select select-sm select-bordered" bind:value={selectedYear}>
                        {#each years as y}
                            <option value={y}>{y}</option>
                        {/each}
                    </select>
                </div>
                {#if viewMode === 'list'}
                    <div class="filter-group">
                        <label class="filter-label">Month</label>
                        <select class="select select-sm select-bordered" bind:value={selectedMonth}>
                            <option value={0}>All</option>
                            {#each monthNames as m, i}
                                <option value={i + 1}>{m}</option>
                            {/each}
                        </select>
                    </div>
                {/if}
            {/if}

            <!-- Future padding -->
            <div class="filter-group">
                <label class="filter-label">Future</label>
                <div class="filter-pills">
                    {#each futureOptions as opt}
                        <button
                            class="pill pill-sm {futureDays === opt.value ? 'pill-active' : ''}"
                            onclick={() => { futureDays = opt.value; }}
                        >{opt.label}</button>
                    {/each}
                </div>
            </div>

            <!-- Sort (list mode only) -->
            {#if viewMode === 'list'}
                <button
                    class="sort-btn"
                    onclick={() => { sortNewestFirst = !sortNewestFirst; }}
                    title="Toggle sort order"
                >
                    {sortNewestFirst ? '↓ Newest' : '↑ Oldest'}
                </button>
            {/if}
        </div>
    </div>

    <!-- Loading -->
    {#if !loaded}
        <Skeleton type="poster-row" />
        <Skeleton type="poster-row" />
    {:else if loading}
        <div class="loading-overlay">
            <span class="loading loading-spinner loading-md"></span>
        </div>
    {/if}

    <!-- ═══ CALENDAR GRID VIEW ═══ -->
    {#if viewMode === 'grid' && loaded}
        <div class="cal-section">
            <!-- Grid month nav -->
            <div class="grid-nav">
                <button class="nav-btn" onclick={gridPrevMonth}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg>
                </button>
                <span class="grid-month-label">
                    {monthNames[calendarGrid.month - 1]} {calendarGrid.year}
                </span>
                <button class="nav-btn" onclick={gridNextMonth}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
                </button>
                <button class="nav-btn nav-today" onclick={gridToday}>Today</button>
            </div>

            <!-- Day names header -->
            <div class="grid-header">
                {#each dayNames as day}
                    <div class="grid-day-name">{day}</div>
                {/each}
            </div>

            <!-- Weeks -->
            {#each calendarGrid.weeks as week}
                <div class="grid-week">
                    {#each week as cell}
                        <div class="grid-cell" class:cell-empty={!cell.date} class:cell-today={cell.isToday} class:cell-past={cell.isPast && !cell.isToday}>
                            {#if cell.date}
                                <div class="cell-day" class:day-today={cell.isToday}>{cell.day}</div>
                                <div class="cell-items">
                                    {#each cell.items.slice(0, 4) as item}
                                        <a href={item.href} class="cell-item" title="{item.title}{item.subtitle ? ' — ' + item.subtitle : ''} ({statusLabel(item.watch_status)})">
                                            {#if item.poster_url}
                                                <img src={imgUrl(item.poster_url, 60)} alt="" loading="lazy" class="cell-poster" />
                                            {:else}
                                                <div class="cell-poster cell-poster-ph">{typeIcon(item.media_type)}</div>
                                            {/if}
                                            <span class="cell-dot {statusBadgeClass(item.watch_status)}"></span>
                                        </a>
                                    {/each}
                                    {#if cell.items.length > 4}
                                        <span class="cell-more">+{cell.items.length - 4}</span>
                                    {/if}
                                </div>
                            {/if}
                        </div>
                    {/each}
                </div>
            {/each}
        </div>
    {/if}

    <!-- ═══ LIST VIEW ═══ -->
    {#if viewMode === 'list' && loaded}
        {#if groupedByMonth.length === 0}
            <div class="empty-state">
                <span class="empty-icon">📅</span>
                <p class="empty-text">No items match the current filters</p>
            </div>
        {:else}
            {#each groupedByMonth as group}
                <section class="month-group">
                    <h2 class="month-label">{group.label}</h2>
                    <div class="list-items">
                        {#each group.items as item}
                            <a href={item.href} class="list-item">
                                <!-- Poster -->
                                <div class="list-poster" class:poster-square={item.media_type === 'album'}>
                                    {#if item.poster_url}
                                        <img src={imgUrl(item.poster_url, 80)} alt="" loading="lazy" />
                                    {:else}
                                        <div class="poster-ph">{typeIcon(item.media_type)}</div>
                                    {/if}
                                </div>
                                <!-- Info -->
                                <div class="list-info">
                                    <span class="list-title">{item.title}</span>
                                    {#if item.subtitle}
                                        <span class="list-subtitle">{item.subtitle}</span>
                                    {/if}
                                    <div class="list-meta">
                                        <span class="type-badge {typeBadgeClass(item.media_type)}">{typeIcon(item.media_type)} {item.media_type === 'album' ? 'Album' : item.media_type === 'show' ? 'TV' : 'Movie'}</span>
                                        {#if item.release_date && !item.release_date.endsWith('-01-01')}
                                            <span class="list-date">{formatDate(item.release_date)}</span>
                                        {/if}
                                        {#if item.collected_children != null}
                                            <span class="list-eps">{item.watched_children}/{item.collected_children} eps</span>
                                        {/if}
                                        {#if item.play_count > 0 && item.media_type === 'movie'}
                                            <span class="list-plays">{item.play_count} play{item.play_count !== 1 ? 's' : ''}</span>
                                        {/if}
                                    </div>
                                </div>
                                <!-- Status -->
                                <div class="list-status">
                                    <span class="status-badge {statusBadgeClass(item.watch_status)}">{statusLabel(item.watch_status)}</span>
                                    <span class="list-year">{item.release_year}</span>
                                </div>
                            </a>
                        {/each}
                    </div>
                </section>
            {/each}
        {/if}
    {/if}
</div>

<style>
    /* ── Page Layout ── */
    .page-wrap {
        display: flex;
        flex-direction: column;
        gap: 1.5rem;
        padding: 0 1.5rem 2rem;
    }
    .page-header {
        display: flex;
        align-items: flex-end;
        justify-content: space-between;
    }
    .page-title {
        font-size: 1.75rem;
        font-weight: 800;
        letter-spacing: -0.02em;
    }
    .page-sub {
        font-size: 0.8rem;
        color: oklch(var(--bc) / 0.45);
        margin-top: 2px;
    }

    /* ── Toolbar ── */
    .toolbar {
        display: flex;
        flex-direction: column;
        gap: 10px;
        background: oklch(var(--b2) / 0.4);
        border: 1px solid oklch(var(--bc) / 0.06);
        border-radius: 12px;
        padding: 14px 16px;
    }
    .toolbar-row {
        display: flex;
        align-items: center;
        gap: 12px;
        flex-wrap: wrap;
    }

    /* View toggle */
    .view-toggle {
        display: flex;
        background: oklch(var(--b3) / 0.5);
        border-radius: 8px;
        overflow: hidden;
        border: 1px solid oklch(var(--bc) / 0.06);
    }
    .toggle-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 36px;
        height: 32px;
        background: transparent;
        border: none;
        color: oklch(var(--bc) / 0.4);
        cursor: pointer;
        transition: all 0.15s;
    }
    .toggle-btn.active {
        background: oklch(var(--p) / 0.15);
        color: oklch(var(--p));
    }
    .toggle-btn:hover:not(.active) {
        color: oklch(var(--bc) / 0.7);
        background: oklch(var(--bc) / 0.05);
    }

    /* Filter pills */
    .filter-pills {
        display: flex;
        gap: 4px;
        flex-wrap: wrap;
    }
    .pill {
        padding: 5px 12px;
        border-radius: 8px;
        font-size: 0.72rem;
        font-weight: 600;
        background: oklch(var(--b3) / 0.5);
        border: 1px solid oklch(var(--bc) / 0.06);
        color: oklch(var(--bc) / 0.55);
        cursor: pointer;
        transition: all 0.15s;
        white-space: nowrap;
    }
    .pill:hover {
        background: oklch(var(--bc) / 0.08);
        color: oklch(var(--bc) / 0.8);
    }
    .pill-active {
        background: oklch(var(--p) / 0.15);
        border-color: oklch(var(--p) / 0.3);
        color: oklch(var(--p));
    }
    .pill-sm {
        padding: 3px 10px;
        font-size: 0.65rem;
    }

    /* Filter groups */
    .filter-group {
        display: flex;
        align-items: center;
        gap: 6px;
    }
    .filter-label {
        font-size: 0.6rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: oklch(var(--bc) / 0.35);
        white-space: nowrap;
    }

    /* Sort button */
    .sort-btn {
        margin-left: auto;
        padding: 4px 12px;
        border-radius: 8px;
        font-size: 0.68rem;
        font-weight: 600;
        background: oklch(var(--b3) / 0.5);
        border: 1px solid oklch(var(--bc) / 0.06);
        color: oklch(var(--bc) / 0.55);
        cursor: pointer;
        transition: all 0.15s;
    }
    .sort-btn:hover {
        background: oklch(var(--bc) / 0.08);
        color: oklch(var(--bc) / 0.8);
    }

    /* Loading overlay */
    .loading-overlay {
        display: flex;
        justify-content: center;
        padding: 2rem 0;
    }

    /* ── Calendar Grid View ── */
    .cal-section {
        display: flex;
        flex-direction: column;
        gap: 4px;
    }

    .grid-nav {
        display: flex;
        align-items: center;
        gap: 8px;
        justify-content: center;
        margin-bottom: 8px;
    }
    .nav-btn {
        display: flex;
        align-items: center;
        gap: 4px;
        background: oklch(0.22 0.005 260);
        border: 1px solid oklch(0.3 0.005 260);
        color: oklch(var(--bc) / 0.65);
        padding: 5px 14px;
        border-radius: 8px;
        font-size: 0.7rem;
        font-weight: 600;
        cursor: pointer;
        transition: background 0.15s, color 0.15s, border-color 0.15s;
    }
    .nav-btn:hover {
        background: oklch(0.28 0.01 260);
        color: oklch(var(--bc));
        border-color: oklch(0.4 0.01 260);
    }
    .nav-today {
        background: oklch(var(--p) / 0.15);
        color: oklch(var(--p));
        border-color: oklch(var(--p) / 0.3);
    }
    .nav-today:hover {
        background: oklch(var(--p) / 0.25);
    }

    .grid-month-label {
        font-size: 1rem;
        font-weight: 800;
        min-width: 160px;
        text-align: center;
    }

    .grid-header {
        display: grid;
        grid-template-columns: repeat(7, 1fr);
        gap: 2px;
    }
    .grid-day-name {
        text-align: center;
        font-size: 0.6rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: oklch(var(--bc) / 0.35);
        padding: 6px 0;
    }

    .grid-week {
        display: grid;
        grid-template-columns: repeat(7, 1fr);
        gap: 2px;
    }

    .grid-cell {
        min-height: 90px;
        background: oklch(var(--b2) / 0.3);
        border: 1px solid oklch(var(--bc) / 0.04);
        border-radius: 8px;
        padding: 4px;
        display: flex;
        flex-direction: column;
        gap: 3px;
        transition: background 0.12s;
    }
    .grid-cell:hover:not(.cell-empty) {
        background: oklch(var(--b2) / 0.6);
    }
    .cell-empty {
        background: transparent;
        border-color: transparent;
    }
    .cell-today {
        border-color: oklch(var(--p) / 0.4);
        background: oklch(var(--p) / 0.05);
    }
    .cell-past {
        opacity: 0.55;
    }

    .cell-day {
        font-size: 0.7rem;
        font-weight: 700;
        color: oklch(var(--bc) / 0.6);
        line-height: 1;
        padding: 2px 4px;
    }
    .day-today {
        color: oklch(var(--pc));
        background: oklch(var(--p));
        border-radius: 50%;
        width: 22px;
        height: 22px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 0.65rem;
        font-weight: 900;
    }

    .cell-items {
        display: flex;
        flex-wrap: wrap;
        gap: 3px;
        flex: 1;
    }
    .cell-item {
        position: relative;
        width: 28px;
        height: 40px;
        border-radius: 4px;
        overflow: hidden;
        transition: transform 0.12s, box-shadow 0.12s;
    }
    .cell-item:hover {
        transform: scale(1.15);
        box-shadow: 0 2px 10px oklch(0 0 0 / 0.4);
        z-index: 5;
    }
    .cell-poster {
        width: 100%;
        height: 100%;
        object-fit: cover;
    }
    .cell-poster-ph {
        display: flex;
        align-items: center;
        justify-content: center;
        background: oklch(var(--b3));
        font-size: 0.6rem;
    }
    .cell-dot {
        position: absolute;
        bottom: 2px;
        right: 2px;
        width: 7px;
        height: 7px;
        border-radius: 50%;
        border: 1px solid oklch(0 0 0 / 0.3);
    }
    .cell-more {
        font-size: 0.5rem;
        color: oklch(var(--bc) / 0.4);
        font-weight: 600;
        display: flex;
        align-items: flex-end;
    }

    /* ── List View ── */
    .month-group {
        display: flex;
        flex-direction: column;
        gap: 6px;
    }
    .month-label {
        font-size: 0.85rem;
        font-weight: 800;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: oklch(var(--bc) / 0.45);
        padding: 4px 0;
        border-bottom: 1px solid oklch(var(--bc) / 0.06);
    }
    .list-items {
        display: flex;
        flex-direction: column;
        gap: 2px;
    }
    .list-item {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 8px 10px;
        border-radius: 10px;
        text-decoration: none;
        color: inherit;
        transition: background 0.12s, transform 0.12s;
    }
    .list-item:hover {
        background: oklch(var(--b2) / 0.5);
        transform: translateX(2px);
    }

    /* Poster */
    .list-poster {
        flex-shrink: 0;
        width: 38px;
        height: 56px;
        border-radius: 6px;
        overflow: hidden;
        background: oklch(var(--b3));
    }
    .list-poster.poster-square {
        width: 48px;
        height: 48px;
    }
    .list-poster img {
        width: 100%;
        height: 100%;
        object-fit: cover;
    }
    .poster-ph {
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 1.1rem;
        color: oklch(var(--bc) / 0.2);
    }

    /* List info */
    .list-info {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 2px;
    }
    .list-title {
        font-size: 0.82rem;
        font-weight: 650;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .list-subtitle {
        font-size: 0.68rem;
        color: oklch(var(--bc) / 0.5);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .list-meta {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
    }
    .list-date, .list-eps, .list-plays {
        font-size: 0.6rem;
        color: oklch(var(--bc) / 0.35);
    }

    /* List status */
    .list-status {
        flex-shrink: 0;
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 3px;
    }
    .list-year {
        font-size: 0.6rem;
        color: oklch(var(--bc) / 0.3);
        font-weight: 600;
    }

    /* ── Badges ── */
    .type-badge {
        font-size: 0.55rem;
        font-weight: 700;
        padding: 1px 7px;
        border-radius: 6px;
        text-transform: uppercase;
        letter-spacing: 0.04em;
    }
    .type-movie {
        background: oklch(0.35 0.08 350 / 0.2);
        color: oklch(0.78 0.12 350);
    }
    .type-show {
        background: oklch(0.35 0.08 260 / 0.2);
        color: oklch(0.78 0.12 260);
    }
    .type-album {
        background: oklch(0.35 0.08 290 / 0.2);
        color: oklch(0.78 0.12 290);
    }

    .status-badge {
        font-size: 0.55rem;
        font-weight: 700;
        padding: 2px 8px;
        border-radius: 6px;
    }
    .status-watched {
        background: #16a34a;
        color: #fff;
    }
    .status-unwatched {
        background: oklch(var(--bc) / 0.1);
        color: oklch(var(--bc) / 0.5);
    }
    .status-inprogress {
        background: #ca8a04;
        color: #fff;
    }

    /* Empty state */
    .empty-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 8px;
        padding: 4rem 0;
    }
    .empty-icon {
        font-size: 3rem;
        opacity: 0.3;
    }
    .empty-text {
        font-size: 0.85rem;
        color: oklch(var(--bc) / 0.35);
    }

    /* ── Responsive ── */
    @media (max-width: 900px) {
        .toolbar-row {
            flex-direction: column;
            align-items: flex-start;
        }
        .grid-cell {
            min-height: 70px;
        }
        .cell-item {
            width: 24px;
            height: 34px;
        }
    }

    @media (max-width: 600px) {
        .grid-week, .grid-header {
            grid-template-columns: repeat(7, 1fr);
        }
        .grid-cell {
            min-height: 50px;
            padding: 2px;
        }
        .cell-item {
            width: 20px;
            height: 28px;
        }
        .list-poster {
            width: 30px;
            height: 44px;
        }
    }
</style>
