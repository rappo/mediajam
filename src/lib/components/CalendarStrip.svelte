<!--
  CalendarStrip — Shared calendar component for TV episodes and music releases.
  Supports navigating to past/future weeks via prev/next buttons.
  Use `mode="tv"` (default) or `mode="music"` to control rendering.
-->
<script>
    import { imgUrl } from "$lib/utils.js";

    /** @type {{ days: Array<{ date: string, episodes: any[] }>, onNavigate?: (offset: number) => void, weekOffset?: number, mode?: 'tv' | 'music' }} */
    let { days, onNavigate, weekOffset = 0, mode = 'tv' } = $props();

    const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

    /**
     * @param {string} dateStr
     */
    function formatDay(dateStr) {
        const d = new Date(dateStr + 'T12:00:00');
        const today = new Date().toISOString().split('T')[0];
        const isPast = dateStr < today;
        return {
            name: dayNames[(d.getDay() + 6) % 7],
            num: d.getDate(),
            isToday: dateStr === today,
            isPast,
        };
    }

    /** @param {any} ep */
    function epCode(ep) {
        return `S${String(ep.season_number).padStart(2, '0')}E${String(ep.item_number).padStart(2, '0')}`;
    }

    /** @param {any} item */
    function cardClass(item) {
        if (item.status === 'downloaded') return 'card-downloaded';
        if (item.status === 'available') return 'card-available';
        return 'card-upcoming';
    }

    /** @param {any} item */
    function itemLink(item) {
        if (mode === 'music') {
            return `/music/${item.artist_id}/${item.album_id || item.show_id}`;
        }
        return `/tv/${item.show_id}`;
    }

    /** @param {any} item */
    function itemTitle(item) {
        if (mode === 'music') {
            return `${item.artist_title || item.show_title} — ${item.album_title || item.episode_title}`;
        }
        return `${item.show_title} ${epCode(item)} — ${item.episode_title}`;
    }

    // Group days into weeks of 7
    /** @type {Array<Array<{ date: string, episodes: any[] }>>} */
    let weeks = $derived.by(() => {
        /** @type {Array<Array<{ date: string, episodes: any[] }>>} */
        const result = [];
        for (let i = 0; i < days.length; i += 7) {
            result.push(days.slice(i, i + 7));
        }
        return result;
    });

    /**
     * @param {Array<{ date: string }>} week
     */
    function weekLabel(week) {
        if (week.length === 0) return '';
        const first = new Date(week[0].date + 'T12:00:00');
        const last = new Date(week[week.length - 1].date + 'T12:00:00');
        const m1 = first.toLocaleString('en-US', { month: 'short' }).toUpperCase();
        const m2 = last.toLocaleString('en-US', { month: 'short' }).toUpperCase();
        if (m1 === m2) {
            return `${m1} ${first.getDate()} – ${last.getDate()}`;
        }
        return `${m1} ${first.getDate()} – ${m2} ${last.getDate()}`;
    }
</script>

<!-- Navigation header -->
<div class="cal-nav">
    <button class="nav-btn" onclick={() => onNavigate?.(weekOffset - 3)} title="Previous 3 weeks">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        Prev
    </button>
    {#if weekOffset !== 0}
        <button class="nav-btn nav-today" onclick={() => onNavigate?.(0)}>Today</button>
    {/if}
    <button class="nav-btn" onclick={() => onNavigate?.(weekOffset + 3)} title="Next 3 weeks">
        Next
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
    </button>
</div>

<div class="cal-weeks">
    {#each weeks as week}
        {@const weekHasItems = week.some(d => d.episodes?.length > 0)}
        <div class="cal-week">
            <div class="week-label">{weekLabel(week)}</div>
            {#if weekHasItems}
            <div class="cal-grid">
                {#each week as day}
                    {@const info = formatDay(day.date)}
                    <div class="cal-col" class:col-today={info.isToday} class:col-past={info.isPast && !info.isToday}>
                        <!-- Day header -->
                        <div class="col-head">
                            <span class="col-day-name" class:name-today={info.isToday}>{info.name}</span>
                            <span class="col-day-num" class:num-today={info.isToday}>{info.num}</span>
                        </div>

                        <!-- Cards -->
                        <div class="col-cards">
                            {#if day.episodes.length === 0}
                                <div class="col-empty">—</div>
                            {:else}
                                {#each day.episodes as item}
                                    <a
                                        href={itemLink(item)}
                                        class="ep-card {cardClass(item)} {mode === 'music' ? 'music-card' : ''}"
                                        title={itemTitle(item)}
                                    >
                                        <!-- Poster thumbnail -->
                                        <div class="card-poster" class:poster-square={mode === 'music'}>
                                            {#if item.poster_url}
                                                <img src={imgUrl(item.poster_url, 80)} alt="" loading="lazy" />
                                            {:else}
                                                <div class="poster-fallback">{mode === 'music' ? '🎵' : '📺'}</div>
                                            {/if}
                                        </div>
                                        <!-- Info -->
                                        <div class="card-info">
                                            {#if mode === 'music'}
                                                <span class="card-show">{item.artist_title || item.show_title}</span>
                                                <span class="card-title">{item.album_title || item.episode_title}</span>
                                            {:else}
                                                <span class="card-show">{item.show_title}</span>
                                                <span class="card-ep">{epCode(item)}</span>
                                                {#if item.episode_title}
                                                    <span class="card-title">{item.episode_title}</span>
                                                {/if}
                                            {/if}
                                        </div>
                                    </a>
                                {/each}
                            {/if}
                        </div>
                    </div>
                {/each}
            </div>
            {:else}
                <p class="text-xs text-base-content/30 py-2 pl-1">No releases this week</p>
            {/if}
        </div>
    {/each}
</div>

<style>
    /* ── Navigation ── */
    .cal-nav {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 6px;
        margin-bottom: 14px;
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

    /* ── Weeks ── */
    .cal-weeks {
        display: flex;
        flex-direction: column;
        gap: 28px;
    }

    .cal-week {
        display: flex;
        flex-direction: column;
        gap: 6px;
    }

    .week-label {
        font-size: 0.75rem;
        font-weight: 800;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: oklch(var(--bc) / 0.5);
        padding-left: 2px;
    }

    .cal-grid {
        display: grid;
        grid-template-columns: repeat(7, 1fr);
        gap: 6px;
        width: 100%;
    }

    .cal-col {
        display: flex;
        flex-direction: column;
        min-height: 80px;
    }

    .col-past {
        opacity: 0.35;
    }

    .col-today {
        /* subtle column highlight */
    }

    /* ── Day header ── */
    .col-head {
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: 2px 4px 6px;
        gap: 1px;
    }
    .col-day-name {
        font-size: 0.6rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: oklch(var(--bc) / 0.35);
    }
    .name-today {
        color: oklch(var(--p));
    }

    .col-day-num {
        font-size: 1rem;
        font-weight: 800;
        color: oklch(var(--bc) / 0.75);
        line-height: 1;
    }
    .num-today {
        color: oklch(var(--pc)) !important;
        background: oklch(var(--p));
        border-radius: 50%;
        width: 28px;
        height: 28px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 0.85rem;
        font-weight: 900;
    }

    .col-cards {
        display: flex;
        flex-direction: column;
        gap: 5px;
        flex: 1;
    }

    .col-empty {
        display: flex;
        align-items: center;
        justify-content: center;
        flex: 1;
        color: oklch(var(--bc) / 0.06);
        font-size: 0.6rem;
    }

    /* ── Card ── */
    .ep-card {
        display: flex;
        gap: 6px;
        padding: 5px;
        border-radius: 8px;
        text-decoration: none;
        color: oklch(var(--bc) / 0.85);
        transition: transform 0.12s, box-shadow 0.15s, background 0.15s;
        line-height: 1.2;
        border: 1px solid transparent;
    }
    .ep-card:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 14px oklch(0 0 0 / 0.35);
    }

    /* Poster thumbnail */
    .card-poster {
        flex-shrink: 0;
        width: 32px;
        height: 46px;
        border-radius: 4px;
        overflow: hidden;
        background: oklch(0.18 0 0);
    }
    .card-poster.poster-square {
        width: 40px;
        height: 40px;
        border-radius: 6px;
    }
    .card-poster img {
        width: 100%;
        height: 100%;
        object-fit: cover;
    }
    .poster-fallback {
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 0.7rem;
        color: oklch(var(--bc) / 0.2);
    }

    /* Card info */
    .card-info {
        display: flex;
        flex-direction: column;
        gap: 1px;
        min-width: 0;
        overflow: hidden;
    }
    .card-show {
        font-size: 0.6rem;
        font-weight: 700;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .card-ep {
        font-size: 0.5rem;
        font-weight: 600;
        color: oklch(var(--bc) / 0.4);
        letter-spacing: 0.03em;
    }
    .card-title {
        font-size: 0.48rem;
        color: oklch(var(--bc) / 0.35);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    /* ── Status-based card backgrounds ── */

    /* Downloaded / Collected — green tinted */
    .card-downloaded {
        background: oklch(0.2 0.035 155);
        border-color: oklch(0.32 0.06 155);
    }
    .card-downloaded .card-show {
        color: oklch(0.82 0.12 155);
    }
    .card-downloaded .card-ep {
        color: oklch(0.65 0.08 155);
    }

    /* Available — amber tinted */
    .card-available {
        background: oklch(0.22 0.04 85);
        border-color: oklch(0.35 0.06 85);
    }
    .card-available .card-show {
        color: oklch(0.82 0.1 85);
    }
    .card-available .card-ep {
        color: oklch(0.65 0.07 85);
    }

    /* Upcoming — neutral dark */
    .card-upcoming {
        background: oklch(0.2 0.008 260);
        border-color: oklch(0.28 0.01 260);
    }
    .card-upcoming .card-show {
        color: oklch(var(--bc) / 0.8);
    }

    /* ── Music-mode card overrides — violet tint ── */
    .music-card.card-downloaded {
        background: oklch(0.2 0.04 290);
        border-color: oklch(0.32 0.06 290);
    }
    .music-card.card-downloaded .card-show {
        color: oklch(0.82 0.1 290);
    }
    .music-card.card-available {
        background: oklch(0.22 0.04 55);
        border-color: oklch(0.35 0.06 55);
    }
    .music-card.card-available .card-show {
        color: oklch(0.82 0.1 55);
    }
    .music-card.card-upcoming {
        background: oklch(0.2 0.015 290);
        border-color: oklch(0.28 0.025 290);
    }
    .music-card.card-upcoming .card-show {
        color: oklch(0.82 0.08 290);
    }

    @media (max-width: 1100px) {
        .card-poster {
            width: 26px;
            height: 38px;
        }
        .card-poster.poster-square {
            width: 34px;
            height: 34px;
        }
    }

    @media (max-width: 900px) {
        .cal-grid {
            grid-template-columns: repeat(4, 1fr);
        }
    }

    @media (max-width: 600px) {
        .cal-grid {
            grid-template-columns: repeat(2, 1fr);
        }
    }
</style>
