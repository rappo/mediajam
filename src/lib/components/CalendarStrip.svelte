<!--
  CalendarStrip — multi-week upcoming episodes calendar with pagination.
  Shows stacked episode pills per day column, grouped by week.
  Supports navigating to past/future weeks via prev/next buttons.
-->
<script>
    /** @type {{ days: Array<{ date: string, episodes: any[] }>, onNavigate?: (offset: number) => void, weekOffset?: number }} */
    let { days, onNavigate, weekOffset = 0 } = $props();

    const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

    /**
     * @param {string} dateStr
     */
    function formatDay(dateStr) {
        const d = new Date(dateStr + 'T12:00:00');
        const today = new Date().toISOString().split('T')[0];
        const isPast = dateStr < today;
        return {
            name: dayNames[(d.getDay() + 6) % 7], // Monday-based index
            num: d.getDate(),
            month: d.toLocaleString('en-US', { month: 'short' }),
            isToday: dateStr === today,
            isPast,
        };
    }

    /**
     * @param {any} ep
     */
    function epCode(ep) {
        return `S${String(ep.season_number).padStart(2, '0')}E${String(ep.item_number).padStart(2, '0')}`;
    }

    /**
     * @param {any} ep
     */
    function statusClass(ep) {
        if (ep.status === 'downloaded') return 'pill-downloaded';
        if (ep.status === 'available') return 'pill-available';
        return 'pill-upcoming';
    }

    /**
     * @param {any} ep
     */
    function statusDot(ep) {
        if (ep.status === 'downloaded') return '▸';
        if (ep.status === 'available') return '◆';
        return '○';
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
     * Format a week label like "MAR 10 – 16" or "MAR 17 – 23"
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
    <button
        class="nav-btn"
        onclick={() => onNavigate?.(weekOffset - 3)}
        title="Previous 3 weeks"
    >← Prev</button>
    {#if weekOffset !== 0}
        <button
            class="nav-btn nav-today"
            onclick={() => onNavigate?.(0)}
        >Today</button>
    {/if}
    <button
        class="nav-btn"
        onclick={() => onNavigate?.(weekOffset + 3)}
        title="Next 3 weeks"
    >Next →</button>
</div>

<div class="cal-weeks">
    {#each weeks as week, wi}
        <div class="cal-week">
            <div class="week-label">{weekLabel(week)}</div>
            <div class="cal-grid">
                {#each week as day}
                    {@const info = formatDay(day.date)}
                    <div class="cal-col" class:col-today={info.isToday} class:col-past={info.isPast && !info.isToday}>
                        <!-- Day header -->
                        <div class="col-head" class:head-today={info.isToday}>
                            <span class="col-day-name">{info.name.toUpperCase()}</span>
                            <span class="col-day-num" class:num-today={info.isToday}>{info.num}</span>
                        </div>

                        <!-- Episode pills -->
                        <div class="col-pills">
                            {#if day.episodes.length === 0}
                                <div class="col-empty">—</div>
                            {:else}
                                {#each day.episodes as ep}
                                    <a
                                        href="/tv/{ep.show_id}"
                                        class="ep-pill {statusClass(ep)}"
                                        title="{ep.show_title} {epCode(ep)} — {ep.episode_title}"
                                    >
                                        <span class="pill-dot">{statusDot(ep)}</span>
                                        <span class="pill-text">{ep.show_title}</span>
                                        <span class="pill-code">{epCode(ep)}</span>
                                    </a>
                                {/each}
                            {/if}
                        </div>
                    </div>
                {/each}
            </div>
        </div>
    {/each}
</div>

<style>
    /* ── Navigation ── */
    .cal-nav {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 8px;
        margin-bottom: 12px;
    }
    .nav-btn {
        background: oklch(var(--b2));
        border: 1px solid oklch(var(--bc) / 0.1);
        color: oklch(var(--bc) / 0.7);
        padding: 4px 14px;
        border-radius: 6px;
        font-size: 0.7rem;
        font-weight: 600;
        cursor: pointer;
        transition: background 0.15s, color 0.15s;
    }
    .nav-btn:hover {
        background: oklch(var(--bc) / 0.1);
        color: oklch(var(--bc));
    }
    .nav-today {
        background: oklch(var(--p) / 0.15);
        color: oklch(var(--p));
        border-color: oklch(var(--p) / 0.3);
    }
    .nav-today:hover {
        background: oklch(var(--p) / 0.25);
    }

    /* ── Weeks container ── */
    .cal-weeks {
        display: flex;
        flex-direction: column;
        gap: 20px;
    }

    .cal-week {
        display: flex;
        flex-direction: column;
        gap: 4px;
    }

    .week-label {
        font-size: 0.8rem;
        font-weight: 800;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: oklch(var(--bc) / 0.55);
        padding-left: 2px;
        margin-bottom: 2px;
    }

    .cal-grid {
        display: grid;
        grid-template-columns: repeat(7, 1fr);
        gap: 4px;
        width: 100%;
    }

    .cal-col {
        display: flex;
        flex-direction: column;
        min-height: 70px;
        overflow: hidden;
    }

    .col-past {
        opacity: 0.35;
    }

    /* ── Day header ── */
    .col-head {
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: 3px 4px 5px;
        gap: 0;
    }
    .col-day-name {
        font-size: 0.55rem;
        font-weight: 700;
        letter-spacing: 0.1em;
        color: oklch(var(--bc) / 0.35);
    }
    .col-day-num {
        font-size: 1rem;
        font-weight: 800;
        color: oklch(var(--bc) / 0.75);
        line-height: 1.25;
    }

    .head-today .col-day-name {
        color: oklch(var(--p));
    }
    .num-today {
        color: oklch(var(--pc)) !important;
        background: oklch(var(--p));
        border-radius: 50%;
        width: 26px;
        height: 26px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 0.85rem;
    }

    .col-pills {
        display: flex;
        flex-direction: column;
        gap: 3px;
        flex: 1;
    }

    .col-empty {
        display: flex;
        align-items: center;
        justify-content: center;
        flex: 1;
        color: oklch(var(--bc) / 0.06);
        font-size: 0.65rem;
    }

    /* ── Episode pill — dark card style ── */
    .ep-pill {
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 5px 7px;
        border-radius: 6px;
        text-decoration: none;
        color: oklch(var(--bc) / 0.8);
        transition: background 0.12s, transform 0.12s, box-shadow 0.15s;
        line-height: 1.2;
        background: oklch(0.22 0.005 260);
        border: 1px solid oklch(0.3 0.005 260);
        box-shadow: 0 1px 4px oklch(0 0 0 / 0.15);
    }
    .ep-pill:hover {
        background: oklch(var(--bc) / 0.12);
        transform: translateY(-1px);
        box-shadow: 0 3px 10px oklch(0 0 0 / 0.25);
    }

    .pill-dot {
        font-size: 0.5rem;
        flex-shrink: 0;
        line-height: 1;
    }

    /* Downloaded pills — green tint */
    .pill-downloaded {
        background: oklch(0.22 0.03 155);
        border-color: oklch(0.35 0.06 155);
    }
    .pill-downloaded .pill-dot {
        color: oklch(var(--su));
    }
    .pill-downloaded .pill-text {
        color: oklch(var(--su) / 0.9);
    }
    .pill-downloaded .pill-code {
        color: oklch(var(--su) / 0.5);
    }

    /* Available pills — amber tint */
    .pill-available {
        background: oklch(0.24 0.04 85);
        border-color: oklch(0.38 0.06 85);
    }
    .pill-available .pill-dot {
        color: oklch(var(--wa));
    }
    .pill-available .pill-text {
        color: oklch(var(--wa) / 0.9);
    }
    .pill-available .pill-code {
        color: oklch(var(--wa) / 0.5);
    }

    /* Upcoming pills — neutral dark card */
    .pill-upcoming {
        background: oklch(0.22 0.005 260);
        border-color: oklch(0.3 0.005 260);
    }
    .pill-upcoming .pill-dot {
        color: oklch(var(--bc) / 0.25);
    }

    .pill-text {
        flex: 1;
        font-size: 0.6rem;
        font-weight: 600;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        min-width: 0;
    }

    .pill-code {
        font-size: 0.5rem;
        font-weight: 600;
        color: oklch(var(--bc) / 0.3);
        flex-shrink: 0;
        letter-spacing: 0.02em;
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
