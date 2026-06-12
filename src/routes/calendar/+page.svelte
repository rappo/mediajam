<script>
    import { onMount } from 'svelte';
    import { imgUrl } from '$lib/utils.js';

    // ── State ──────────────────────────────────────────────────────
    let loading = $state(true);
    /** @type {any[]} */
    let rawDays = $state([]);
    let activeTypes = $state(['movie', 'show', 'artist']);

    // Current month view
    let viewYear = $state(new Date().getFullYear());
    let viewMonth = $state(new Date().getMonth()); // 0-indexed

    const typeLabels = [
        { key: 'show', label: 'TV', icon: '📺', colorVar: '--color-tv' },
        { key: 'movie', label: 'Movies', icon: '🎬', colorVar: '--color-movies' },
        { key: 'artist', label: 'Music', icon: '🎵', colorVar: '--color-music' },
    ];

    const dayHeaders = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    // ── Fetch ──────────────────────────────────────────────────────
    async function fetchMonth() {
        loading = true;
        try {
            const params = new URLSearchParams({
                year: String(viewYear),
                month: String(viewMonth + 1),
                calendarTypes: activeTypes.join(','),
            });
            const res = await fetch(`/api/pages/calendar-month?${params}`);
            if (res.ok) {
                const data = await res.json();
                rawDays = data.days || [];
            }
        } catch (e) {
            console.error('[calendar] fetch error:', e);
        }
        loading = false;
    }

    onMount(fetchMonth);

    // ── Navigation ─────────────────────────────────────────────────
    function prevMonth() {
        if (viewMonth === 0) { viewMonth = 11; viewYear--; }
        else viewMonth--;
        fetchMonth();
    }
    function nextMonth() {
        if (viewMonth === 11) { viewMonth = 0; viewYear++; }
        else viewMonth++;
        fetchMonth();
    }
    function goToday() {
        const now = new Date();
        viewYear = now.getFullYear();
        viewMonth = now.getMonth();
        fetchMonth();
    }

    // ── Type filter ────────────────────────────────────────────────
    function onTypeChange(type, checked) {
        if (checked) {
            activeTypes = [...activeTypes, type];
        } else {
            if (activeTypes.length > 1) {
                activeTypes = activeTypes.filter(t => t !== type);
            }
        }
        fetchMonth();
    }

    // ── Derived data ───────────────────────────────────────────────
    let filteredDays = $derived(
        rawDays.map(day => ({
            ...day,
            items: day.items.filter(it => activeTypes.includes(it.media_type)),
        }))
    );

    let monthLabel = $derived(
        new Date(viewYear, viewMonth).toLocaleString('en-US', { month: 'long', year: 'numeric' })
    );

    /** Build a Sun-Sat calendar grid from the filtered days */
    let calendarWeeks = $derived.by(() => {
        // Build a dateKey → day map
        /** @type {Map<string, any>} */
        const byDate = new Map();
        for (const day of filteredDays) {
            byDate.set(day.date, day);
        }

        const firstOfMonth = new Date(viewYear, viewMonth, 1);
        const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
        const startDow = firstOfMonth.getDay(); // 0=Sun
        const todayISO = new Date().toISOString().split('T')[0];

        /** @type {Array<{date: string, dayNum: number, dayName: string, isToday: boolean, isPast: boolean, isCurrentMonth: boolean, items: any[]}>} */
        const cells = [];

        // Pad leading days from previous month
        for (let i = 0; i < startDow; i++) {
            const d = new Date(viewYear, viewMonth, -(startDow - 1 - i));
            const dateStr = isoDate(d);
            const day = byDate.get(dateStr);
            cells.push({
                date: dateStr,
                dayNum: d.getDate(),
                dayName: dayHeaders[d.getDay()],
                isToday: dateStr === todayISO,
                isPast: dateStr < todayISO,
                isCurrentMonth: false,
                items: day?.items || [],
            });
        }

        // Current month days
        for (let d = 1; d <= daysInMonth; d++) {
            const dateStr = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            const day = byDate.get(dateStr);
            const dow = new Date(viewYear, viewMonth, d).getDay();
            cells.push({
                date: dateStr,
                dayNum: d,
                dayName: dayHeaders[dow],
                isToday: dateStr === todayISO,
                isPast: dateStr < todayISO,
                isCurrentMonth: true,
                items: day?.items || [],
            });
        }

        // Pad trailing days
        while (cells.length % 7 !== 0) {
            const idx = cells.length - startDow - daysInMonth;
            const d = new Date(viewYear, viewMonth + 1, idx + 1);
            const dateStr = isoDate(d);
            const day = byDate.get(dateStr);
            cells.push({
                date: dateStr,
                dayNum: d.getDate(),
                dayName: dayHeaders[d.getDay()],
                isToday: dateStr === todayISO,
                isPast: dateStr < todayISO,
                isCurrentMonth: false,
                items: day?.items || [],
            });
        }

        // Chunk into weeks
        /** @type {Array<typeof cells>} */
        const weeks = [];
        for (let i = 0; i < cells.length; i += 7) {
            weeks.push(cells.slice(i, i + 7));
        }
        return weeks;
    });

    let totalItems = $derived(
        filteredDays.reduce((sum, d) => sum + d.items.length, 0)
    );

    /** @type {Set<string>} */
    let expandedDays = $state(new Set());
    const MAX_VISIBLE = 3;

    // ── Helpers ─────────────────────────────────────────────────────
    function isoDate(d) {
        return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    }

    function dayHeroImage(items) {
        const withPoster = items.filter(i => i.display_poster || i.poster_url);
        if (withPoster.length === 0) return '';
        return imgUrl(withPoster[0].display_poster || withPoster[0].poster_url);
    }

    function typeBadge(type) {
        if (type === 'movie') return 'MOVIE';
        if (type === 'show') return 'TV';
        return 'MUSIC';
    }

    function typeColor(type) {
        if (type === 'movie') return 'var(--color-movies)';
        if (type === 'show') return 'var(--color-tv)';
        return 'var(--color-music)';
    }

    // Check if current month is "now"
    let isCurrentMonth = $derived(
        viewYear === new Date().getFullYear() && viewMonth === new Date().getMonth()
    );
</script>

<svelte:head>
    <title>Mediajam — Calendar</title>
</svelte:head>

<div class="cal-page">
    <!-- Outer hero card -->
    <div class="cal-outer">
        <!-- Ambient glow from first poster found -->
        {#if filteredDays[0]?.items[0]}
            {@const heroSrc = dayHeroImage(filteredDays[0].items)}
            {#if heroSrc}
                <div class="cal-glow" style="background-image: url('{heroSrc}')"></div>
            {/if}
        {/if}

        <div class="cal-inner">
            <!-- Header -->
            <div class="cal-header">
                <div class="cal-header-left">
                    <h1 class="cal-month-title">{monthLabel}</h1>
                    <span class="cal-count">{totalItems} item{totalItems !== 1 ? 's' : ''}</span>
                </div>
                <div class="cal-header-right">
                    <form class="cal-filter">
                        {#each typeLabels as { key, label, icon, colorVar }}
                            <input
                                class="btn btn-xs cal-filter-btn"
                                type="checkbox"
                                name="media-types"
                                aria-label="{icon} {label}"
                                checked={activeTypes.includes(key)}
                                onchange={(e) => onTypeChange(key, e.target.checked)}
                                style="--filter-color: oklch(var({colorVar})); {activeTypes.includes(key) ? `background: oklch(var(${colorVar}) / 0.18); color: oklch(var(${colorVar})); border-color: oklch(var(${colorVar}) / 0.5);` : `opacity: 0.35; border-color: oklch(var(${colorVar}) / 0.15);`}"
                            />
                        {/each}
                    </form>
                    <div class="cal-nav">
                        <button class="cal-nav-btn" onclick={prevMonth} aria-label="Previous month">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg>
                        </button>
                        {#if !isCurrentMonth}
                            <button class="cal-nav-btn cal-today-btn" onclick={goToday}>Today</button>
                        {/if}
                        <button class="cal-nav-btn" onclick={nextMonth} aria-label="Next month">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
                        </button>
                    </div>
                </div>
            </div>

            <!-- Day headers (Sun-Sat) -->
            <div class="cal-day-headers">
                {#each dayHeaders as name, i}
                    <div class="cal-day-header" class:is-weekend={i === 0 || i === 6}>{name}</div>
                {/each}
            </div>

            <!-- Calendar grid -->
            {#if loading}
                <div class="cal-loading">
                    <span class="loading loading-spinner loading-md"></span>
                </div>
            {:else}
                <div class="cal-grid">
                    {#each calendarWeeks as week}
                        {#each week as cell}
                            {@const heroSrc = dayHeroImage(cell.items)}
                            <div
                                class="cal-cell"
                                class:is-today={cell.isToday}
                                class:is-past={cell.isPast && !cell.isToday}
                                class:is-weekend={cell.dayName === 'Sun' || cell.dayName === 'Sat'}
                                class:is-other-month={!cell.isCurrentMonth}
                            >
                                <!-- Day backdrop glow -->
                                {#if heroSrc}
                                    <div class="cal-cell-bg" style="background-image: url('{heroSrc}')"></div>
                                {/if}

                                <!-- Day number -->
                                <div class="cal-cell-head" class:today={cell.isToday}>
                                    <span class="cal-cell-num">{cell.dayNum}</span>
                                </div>

                                <!-- Items -->
                                <div class="cal-cell-body">
                                    {#if cell.items.length === 0}
                                        <div class="cal-cell-empty"></div>
                                    {:else}
                                        {#each (expandedDays.has(cell.date) ? cell.items : cell.items.slice(0, MAX_VISIBLE)) as item}
                                            <a
                                                href={item.href || '/calendar'}
                                                class="cal-item"
                                            >
                                                <!-- Poster -->
                                                <div class="cal-item-poster" class:tall={item.media_type === 'show' || item.media_type === 'movie'}>
                                                    {#if item.display_poster || item.poster_url}
                                                        <img
                                                            src={imgUrl(item.display_poster || item.poster_url)}
                                                            alt={item.title}
                                                            loading="lazy"
                                                        />
                                                    {:else}
                                                        <div class="cal-no-poster">
                                                            {item.media_type === 'movie' ? '🎬' : item.media_type === 'show' ? '📺' : '🎵'}
                                                        </div>
                                                    {/if}
                                                </div>
                                                <!-- Info -->
                                                <div class="cal-item-info">
                                                    <span class="cal-badge" style="background: oklch({typeColor(item.media_type)} / 0.15); color: oklch({typeColor(item.media_type)})">{typeBadge(item.media_type)}</span>
                                                    <span class="cal-item-title">{item.title}</span>
                                                    {#if item.subtitle}
                                                        <span class="cal-item-sub">{item.subtitle}{item.episode_title && item.episode_title !== 'TBA' ? ` — ${item.episode_title}` : ''}</span>
                                                    {:else if item.episode_title && item.episode_title !== 'TBA'}
                                                        <span class="cal-item-sub">{item.episode_title}</span>
                                                    {/if}
                                                </div>
                                            </a>
                                        {/each}
                                        {#if cell.items.length > MAX_VISIBLE && !expandedDays.has(cell.date)}
                                            <button
                                                class="cal-cell-expand"
                                                onclick={() => { expandedDays = new Set([...expandedDays, cell.date]); }}
                                            >
                                                +{cell.items.length - MAX_VISIBLE} more
                                            </button>
                                        {/if}
                                    {/if}
                                </div>
                            </div>
                        {/each}
                    {/each}
                </div>
            {/if}
        </div>
    </div>
</div>

<style>
    /* ══════════════ PAGE ══════════════ */
    .cal-page {
        padding: 0 1rem 2rem;
        max-width: 1400px;
        margin: 0 auto;
    }

    /* ══════════════ OUTER HERO CARD ══════════════ */
    .cal-outer {
        position: relative;
        border-radius: 1rem;
        overflow: hidden;
        isolation: isolate;
    }
    .cal-glow {
        position: absolute;
        inset: 0;
        background-size: cover;
        background-position: center;
        filter: blur(60px) saturate(1.5);
        opacity: 0.12;
        z-index: 0;
        pointer-events: none;
    }
    .cal-inner {
        position: relative;
        z-index: 1;
        background: oklch(var(--b1) / 0.7);
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        border: 1px solid oklch(var(--bc) / 0.08);
        border-radius: 1rem;
        padding: 1.25rem 1.5rem 1rem;
    }

    /* ══════════════ HEADER ══════════════ */
    .cal-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 1rem;
        flex-wrap: wrap;
        gap: 0.5rem;
    }
    .cal-header-left {
        display: flex;
        align-items: baseline;
        gap: 0.75rem;
    }
    .cal-header-right {
        display: flex;
        align-items: center;
        gap: 0.75rem;
    }
    .cal-month-title {
        font-size: 1.4rem;
        font-weight: 800;
        letter-spacing: -0.02em;
        color: oklch(var(--bc) / 0.95);
        margin: 0;
    }
    .cal-count {
        font-size: 0.7rem;
        font-weight: 600;
        color: oklch(var(--bc) / 0.35);
    }

    /* ══════════════ FILTER ══════════════ */
    .cal-filter {
        display: flex;
        gap: 0.25rem;
        align-items: center;
    }
    .cal-filter-btn {
        transition: all 0.2s ease !important;
    }

    /* ══════════════ NAV ══════════════ */
    .cal-nav {
        display: flex;
        gap: 0.25rem;
        align-items: center;
    }
    .cal-nav-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        background: oklch(var(--bc) / 0.06);
        border: 1px solid oklch(var(--bc) / 0.08);
        border-radius: 0.5rem;
        color: oklch(var(--bc) / 0.6);
        padding: 0.35rem 0.5rem;
        cursor: pointer;
        transition: all 0.15s;
        font-size: 0.7rem;
        font-weight: 600;
    }
    .cal-nav-btn:hover {
        background: oklch(var(--bc) / 0.12);
        color: oklch(var(--bc) / 0.9);
    }
    .cal-today-btn {
        background: oklch(var(--p));
        color: oklch(var(--pc));
        border-color: oklch(var(--p));
        padding: 0.35rem 0.75rem;
        font-weight: 700;
    }
    .cal-today-btn:hover {
        background: oklch(var(--p) / 0.85);
        color: oklch(var(--pc));
    }

    /* ══════════════ DAY HEADERS ══════════════ */
    .cal-day-headers {
        display: grid;
        grid-template-columns: repeat(7, 1fr);
        gap: 0.4rem;
        margin-bottom: 0.4rem;
    }
    .cal-day-header {
        text-align: center;
        font-size: 0.6rem;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: oklch(var(--bc) / 0.35);
        padding: 0.3rem 0;
    }
    .cal-day-header.is-weekend {
        color: rgba(251, 191, 36, 0.5);
    }

    /* ══════════════ LOADING ══════════════ */
    .cal-loading {
        display: flex;
        justify-content: center;
        padding: 4rem 0;
    }

    /* ══════════════ GRID ══════════════ */
    .cal-grid {
        display: grid;
        grid-template-columns: repeat(7, 1fr);
        gap: 0.4rem;
    }

    /* ══════════════ DAY CELL ══════════════ */
    .cal-cell {
        min-height: 120px;
        border-radius: 0.65rem;
        overflow: hidden;
        position: relative;
        isolation: isolate;
        border: 1px solid rgba(255, 255, 255, 0.1);
        background: oklch(var(--b1) / 0.5);
        transition: border-color 0.25s, box-shadow 0.25s;
    }
    .cal-cell.is-weekend {
        border-color: rgba(251, 191, 36, 0.2);
    }
    .cal-cell.is-today {
        border-color: oklch(var(--p) / 0.5);
        box-shadow: 0 0 16px oklch(var(--p) / 0.12);
    }
    .cal-cell.is-past {
        opacity: 0.55;
    }
    .cal-cell.is-past:hover {
        opacity: 0.85;
    }
    .cal-cell.is-other-month {
        opacity: 0.3;
    }
    .cal-cell.is-other-month:hover {
        opacity: 0.6;
    }

    .cal-cell-bg {
        position: absolute;
        inset: 0;
        background-size: cover;
        background-position: center;
        filter: blur(30px) saturate(1.3);
        opacity: 0.12;
        z-index: 0;
        pointer-events: none;
    }

    /* Day header */
    .cal-cell-head {
        position: relative;
        z-index: 1;
        display: flex;
        align-items: center;
        padding: 0.4rem 0.5rem 0.25rem;
    }
    .cal-cell-head.today {
        background: oklch(var(--p) / 0.08);
    }
    .cal-cell-num {
        font-size: 0.75rem;
        font-weight: 700;
        color: oklch(var(--bc) / 0.5);
    }
    .cal-cell-head.today .cal-cell-num {
        background: oklch(var(--p));
        color: oklch(var(--pc));
        border-radius: 50%;
        width: 24px;
        height: 24px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 0.68rem;
        font-weight: 900;
    }

    /* Day body */
    .cal-cell-body {
        position: relative;
        z-index: 1;
        padding: 0.25rem 0.35rem 0.35rem;
        display: flex;
        flex-direction: column;
        gap: 0.3rem;
    }

    .cal-cell-empty {
        min-height: 40px;
    }

    .cal-cell-expand {
        display: block;
        width: 100%;
        padding: 0.2rem;
        font-size: 0.55rem;
        font-weight: 700;
        color: oklch(var(--p) / 0.7);
        background: oklch(var(--p) / 0.04);
        border: 1px dashed oklch(var(--p) / 0.15);
        border-radius: 0.25rem;
        cursor: pointer;
        transition: all 0.15s;
        text-align: center;
    }
    .cal-cell-expand:hover {
        color: oklch(var(--p));
        background: oklch(var(--p) / 0.1);
        border-color: oklch(var(--p) / 0.3);
    }

    /* ══════════════ ITEMS ══════════════ */
    .cal-item {
        display: flex;
        gap: 0.35rem;
        padding: 0.25rem;
        border-radius: 0.4rem;
        text-decoration: none;
        color: inherit;
        transition: background 0.15s, transform 0.15s;
        cursor: pointer;
        overflow: hidden;
    }
    .cal-item:hover {
        background: oklch(var(--bc) / 0.06);
        transform: translateY(-1px);
    }

    .cal-item-poster {
        flex-shrink: 0;
        width: 38px;
        height: 38px;
        border-radius: 0.25rem;
        overflow: hidden;
        background: oklch(var(--bc) / 0.06);
    }
    .cal-item-poster.tall { height: 56px; }
    .cal-item-poster img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
    }
    .cal-no-poster {
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 0.9rem;
    }

    .cal-item-info {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 0.08rem;
        padding-top: 0.02rem;
    }

    .cal-badge {
        font-size: 0.4rem;
        font-weight: 800;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        padding: 0.04rem 0.25rem;
        border-radius: 0.15rem;
        width: fit-content;
        line-height: 1.4;
    }

    .cal-item-title {
        font-size: 0.62rem;
        font-weight: 700;
        color: oklch(var(--bc) / 0.9);
        line-height: 1.25;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
    }
    .cal-item-sub {
        font-size: 0.5rem;
        color: oklch(var(--bc) / 0.4);
        display: -webkit-box;
        -webkit-line-clamp: 1;
        -webkit-box-orient: vertical;
        overflow: hidden;
    }

    /* ══════════════ RESPONSIVE ══════════════ */
    @media (max-width: 1000px) {
        .cal-cell { min-height: 100px; }
        .cal-item-poster { width: 30px; height: 30px; }
        .cal-item-poster.tall { height: 44px; }
        .cal-item-title { font-size: 0.55rem; }
        .cal-badge { font-size: 0.35rem; }
    }

    @media (max-width: 767px) {
        .cal-page { padding: 0 0.5rem 1rem; }
        .cal-inner { padding: 0.75rem 0.75rem 0.5rem; }
        .cal-header { flex-direction: column; align-items: flex-start; }
        .cal-month-title { font-size: 1.1rem; }
        .cal-cell { min-height: 70px; }
        .cal-cell-head { padding: 0.25rem 0.3rem 0.15rem; }
        .cal-cell-num { font-size: 0.6rem; }
        .cal-cell-head.today .cal-cell-num { width: 18px; height: 18px; font-size: 0.55rem; }
        .cal-cell-body { padding: 0.15rem 0.2rem 0.2rem; gap: 0.2rem; }
        .cal-item-poster { display: none; }
        .cal-item-title { font-size: 0.5rem; -webkit-line-clamp: 1; }
        .cal-item-sub { display: none; }
        .cal-item { padding: 0.15rem 0.2rem; }
        .cal-grid { gap: 0.2rem; }
    }
</style>
