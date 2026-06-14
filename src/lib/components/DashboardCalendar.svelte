<script>
    import { imgUrl } from "$lib/utils.js";
    import MdiIcon from '$lib/components/MdiIcon.svelte';
    import { mdiCalendar, mdiTelevision, mdiMovieOpen, mdiMusic } from '@mdi/js';

    let { upcoming = [], onSettingsChange = () => {} } = $props();

    let calendarDays = $state(7);
    let activeTypes = $state(['movie', 'show', 'artist']);
    /** @type {Set<string>} Track which day dates are expanded */
    let expandedDays = $state(new Set());
    const MAX_VISIBLE = 3;

    const typeLabels = [
        { key: 'show', label: 'TV', icon: '📺', colorVar: '--color-tv' },
        { key: 'movie', label: 'Movies', icon: '🎬', colorVar: '--color-movies' },
        { key: 'artist', label: 'Music', icon: '🎵', colorVar: '--color-music' },
    ];

    let filteredDays = $derived(
        upcoming.map(day => ({
            ...day,
            items: day.items.filter(it => activeTypes.includes(it.media_type)),
        }))
    );

    /** Chunk filtered days into rows of 7 */
    let weekRows = $derived.by(() => {
        const rows = [];
        for (let i = 0; i < filteredDays.length; i += 7) {
            rows.push(filteredDays.slice(i, i + 7));
        }
        return rows;
    });

    let rangeLabel = $derived.by(() => {
        const weeks = Math.floor(calendarDays / 7);
        if (weeks <= 1) return '1 week';
        return `${weeks} weeks`;
    });

    function onTypeChange(type, checked) {
        if (checked) {
            activeTypes = [...activeTypes, type];
        } else {
            if (activeTypes.length > 1) {
                activeTypes = activeTypes.filter(t => t !== type);
            }
        }
        onSettingsChange({ calendarDays, calendarTypes: activeTypes });
    }

    function resetTypes() {
        activeTypes = ['movie', 'show', 'artist'];
        onSettingsChange({ calendarDays, calendarTypes: activeTypes });
    }

    function showMore() {
        calendarDays += 7;
        onSettingsChange({ calendarDays, calendarTypes: activeTypes });
    }

    function typeBadge(type) {
        if (type === 'movie') return 'MOVIE';
        if (type === 'show') return 'TV SHOW';
        return 'MUSIC';
    }
</script>

<div class="cal-wrap">
    <!-- Header row -->
    <div class="cal-header">
        <div class="cal-header-left">
            <span class="cal-icon"><MdiIcon icon={mdiCalendar} size={16} /></span>
            <h3 class="cal-title">Upcoming releases · {rangeLabel}</h3>
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
                <input class="btn btn-xs btn-square" type="reset" value="×" onclick={resetTypes} />
            </form>
            <a href="/calendar" class="cal-link">Calendar →</a>
        </div>
    </div>

    <!-- Week rows -->
    {#each weekRows as week, wi}
        <div class="cal-strip" class:cal-strip-extra={wi > 0}>
            {#each week as day}
                <div class="cal-day" class:is-today={day.isToday}>
                    <!-- Day header -->
                    <div class="cal-day-head" class:today={day.isToday}>
                        <span class="cal-day-name">{day.dayName.toUpperCase()}</span>
                        <span class="cal-day-num">{day.dayNum}</span>
                    </div>

                    <!-- Items -->
                    <div class="cal-day-body">
                        {#if day.items.length === 0}
                            <div class="cal-empty">—</div>
                        {:else}
                            {#each (expandedDays.has(day.date) ? day.items : day.items.slice(0, MAX_VISIBLE)) as item}
                                <a
                                    href={item.href || '/calendar'}
                                    class="cal-item type-{item.media_type}"
                                    title="{item.title}{item.episode_title ? ` — ${item.episode_title}` : ''}"
                                >
                                    <!-- Poster -->
                                    <div class="cal-item-poster">
                                        {#if item.display_poster || item.poster_url}
                                            <img
                                                src={imgUrl(item.display_poster || item.poster_url)}
                                                alt={item.title}
                                                loading="lazy"
                                            />
                                        {:else}
                                            <div class="cal-item-no-poster">
                                                {#if item.media_type === 'movie'}<MdiIcon icon={mdiMovieOpen} size={16} />{:else if item.media_type === 'show'}<MdiIcon icon={mdiTelevision} size={16} />{:else}<MdiIcon icon={mdiMusic} size={16} />{/if}
                                            </div>
                                        {/if}
                                    </div>
                                    <!-- Info -->
                                    <div class="cal-item-info">
                                        <span class="cal-badge type-{item.media_type}">{typeBadge(item.media_type)}</span>
                                        <span class="cal-item-title">{item.title}</span>
                                        {#if item.subtitle}
                                            <span class="cal-item-sub">{item.subtitle}{item.episode_title && item.episode_title !== 'TBA' ? ` — ${item.episode_title}` : ''}</span>
                                        {:else if item.episode_title && item.episode_title !== 'TBA'}
                                            <span class="cal-item-sub">{item.episode_title}</span>
                                        {/if}
                                    </div>
                                </a>
                            {/each}
                            {#if day.items.length > MAX_VISIBLE && !expandedDays.has(day.date)}
                                <button
                                    class="cal-day-expand"
                                    onclick={() => { expandedDays = new Set([...expandedDays, day.date]); }}
                                >
                                    +{day.items.length - MAX_VISIBLE} more
                                </button>
                            {/if}
                        {/if}
                    </div>
                </div>
            {/each}
        </div>
    {/each}

    <!-- Show more button -->
    <button class="cal-show-more" onclick={showMore}>
        Show more +
    </button>
</div>

<style>
    .cal-wrap {
        background: #171f2e;
        border: 1px solid rgba(255,255,255,0.08);
        border-radius: 1rem;
        padding: 1rem 1.25rem 0.75rem;
    }

    /* ── Header ──────────────────────────────── */
    .cal-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 0.75rem;
        flex-wrap: wrap;
        gap: 0.5rem;
    }
    .cal-header-left {
        display: flex;
        align-items: center;
        gap: 0.4rem;
    }
    .cal-header-right {
        display: flex;
        align-items: center;
        gap: 0.5rem;
    }
    .cal-icon {
        font-size: 0.9rem;
        opacity: 0.7;
    }
    .cal-title {
        font-size: 0.9rem;
        font-weight: 700;
        color: oklch(var(--bc) / 0.9);
        margin: 0;
    }
    .cal-link {
        font-size: 0.65rem;
        font-weight: 600;
        color: oklch(var(--p));
        text-decoration: none;
        padding: 0.2rem 0.6rem;
        border-radius: 0.4rem;
        border: 1px solid oklch(var(--p) / 0.2);
        transition: all 0.15s;
        white-space: nowrap;
    }
    .cal-link:hover {
        background: oklch(var(--p) / 0.1);
        border-color: oklch(var(--p) / 0.4);
    }

    /* ── Filter (DaisyUI checkboxes) ────────── */
    .cal-filter {
        display: flex;
        gap: 0.25rem;
        align-items: center;
    }
    .cal-filter-btn {
        transition: all 0.2s ease !important;
    }

    /* ── Day Strip ──────────────────────────── */
    .cal-strip {
        display: flex;
        gap: 0.5rem;
        overflow-x: auto;
        scrollbar-width: none;
        padding: 0;
        border-radius: 0.75rem;
    }
    .cal-strip::-webkit-scrollbar { display: none; }
    .cal-strip-extra {
        margin-top: 0.5rem;
    }

    .cal-day {
        flex: 1 0 0;
        min-width: 130px;
        border-radius: 0.65rem;
        background: #1e293b;
        border: 1px solid rgba(255,255,255,0.08);
        overflow: hidden;
        will-change: transform;
        -webkit-backface-visibility: hidden;
        backface-visibility: hidden;
        transition: border-color 0.25s, box-shadow 0.25s;
    }
    .cal-day.is-today {
        border-color: oklch(var(--p) / 0.7);
        box-shadow: 0 0 20px oklch(var(--p) / 0.15);
    }

    /* Day header */
    .cal-day-head {
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: 0.5rem 0.5rem 0.4rem;
        border-bottom: 1px solid oklch(var(--bc) / 0.05);
    }
    .cal-day-head.today {
        background: oklch(var(--p) / 0.08);
    }
    .cal-day-name {
        font-size: 0.6rem;
        font-weight: 700;
        letter-spacing: 0.06em;
        color: oklch(var(--bc) / 0.35);
    }
    .cal-day-head.today .cal-day-name { color: oklch(var(--p) / 0.8); }
    .cal-day-num {
        font-size: 1.4rem;
        font-weight: 800;
        color: oklch(var(--bc) / 0.7);
        line-height: 1.1;
    }
    .cal-day-head.today .cal-day-num { color: oklch(var(--p)); }

    /* Day body */
    .cal-day-body {
        padding: 0.4rem;
        display: flex;
        flex-direction: column;
        gap: 0.35rem;
        min-height: 90px;
    }

    .cal-empty {
        font-size: 0.7rem;
        color: oklch(var(--bc) / 0.1);
        text-align: center;
        padding: 2rem 0;
    }

    .cal-day-expand {
        display: block;
        width: 100%;
        padding: 0.25rem;
        font-size: 0.6rem;
        font-weight: 700;
        color: oklch(var(--p) / 0.7);
        background: oklch(var(--p) / 0.04);
        border: 1px dashed oklch(var(--p) / 0.15);
        border-radius: 0.3rem;
        cursor: pointer;
        transition: all 0.15s;
        text-align: center;
    }
    .cal-day-expand:hover {
        color: oklch(var(--p));
        background: oklch(var(--p) / 0.1);
        border-color: oklch(var(--p) / 0.3);
    }

    /* ── Calendar Items ──────────────────────── */
    .cal-item {
        display: flex;
        gap: 0.4rem;
        padding: 0.3rem;
        border-radius: 0.45rem;
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
        width: 44px;
        height: 44px;
        border-radius: 0.3rem;
        overflow: hidden;
        background: oklch(var(--bc) / 0.06);
    }
    /* TV/Movie posters are tall, Music is square */
    .cal-item.type-show .cal-item-poster,
    .cal-item.type-movie .cal-item-poster {
        height: 66px;
    }
    .cal-item-poster img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
    }
    .cal-item-no-poster {
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 1rem;
    }

    .cal-item-info {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 0.1rem;
        padding-top: 0.05rem;
    }

    .cal-badge {
        font-size: 0.45rem;
        font-weight: 800;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        padding: 0.06rem 0.3rem;
        border-radius: 0.2rem;
        width: fit-content;
        line-height: 1.4;
    }
    .cal-badge.type-show { background: oklch(var(--color-tv) / 0.2); color: oklch(var(--color-tv)); }
    .cal-badge.type-movie { background: oklch(var(--color-movies) / 0.2); color: oklch(var(--color-movies)); }
    .cal-badge.type-artist { background: oklch(var(--color-music) / 0.2); color: oklch(var(--color-music)); }

    .cal-item-title {
        font-size: 0.68rem;
        font-weight: 700;
        color: oklch(var(--bc) / 0.9);
        line-height: 1.25;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
    }
    .cal-item-sub {
        font-size: 0.55rem;
        color: oklch(var(--bc) / 0.4);
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
    }

    /* ── Show More Button ────────────────────── */
    .cal-show-more {
        display: block;
        width: 100%;
        margin-top: 0.6rem;
        padding: 0.4rem;
        font-size: 0.7rem;
        font-weight: 600;
        color: oklch(var(--bc) / 0.5);
        background: transparent;
        border: 1px dashed oklch(var(--bc) / 0.1);
        border-radius: 0.5rem;
        cursor: pointer;
        transition: all 0.15s;
    }
    .cal-show-more:hover {
        color: oklch(var(--p));
        border-color: oklch(var(--p) / 0.3);
        background: oklch(var(--p) / 0.04);
    }

    @media (max-width: 767px) {
        .cal-day { min-width: 110px; }
        .cal-item-poster { width: 36px; height: 36px; }
        .cal-item.type-show .cal-item-poster,
        .cal-item.type-movie .cal-item-poster { height: 54px; }
        .cal-header { flex-direction: column; align-items: flex-start; }
    }
</style>
