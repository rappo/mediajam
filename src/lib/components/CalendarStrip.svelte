<!--
  CalendarStrip — multi-week upcoming episodes calendar.
  Shows stacked episode pills per day column, grouped by week.
-->
<script>
    /** @type {{ days: Array<{ date: string, episodes: any[] }> }} */
    let { days } = $props();

    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    /**
     * @param {string} dateStr
     */
    function formatDay(dateStr) {
        const d = new Date(dateStr + 'T12:00:00');
        const today = new Date().toISOString().split('T')[0];
        const isPast = dateStr < today;
        return {
            name: dayNames[d.getDay()],
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
    function statusIcon(ep) {
        if (ep.status === 'downloaded') return { icon: '✓', cls: 'pill-downloaded' };
        if (ep.status === 'available') return { icon: '↓', cls: 'pill-available' };
        return { icon: '○', cls: 'pill-upcoming' };
    }

    // Group days into weeks of 7
    /** @type {Array<Array<{ date: string, episodes: any[] }>>} */
    let weeks = $derived.by(() => {
        /** @type {Array<Array<{ date: string, episodes: any[] }>>} */
        const result = [];
        for (let i = 0; i < days.length; i += 7) {
            const week = days.slice(i, i + 7);
            // Only include weeks that have at least one episode
            if (week.some(d => d.episodes.length > 0)) {
                result.push(week);
            }
        }
        return result;
    });

    /**
     * Format a week label like "Mar 10 — 16" or "Mar 17 — 23"
     * @param {Array<{ date: string }>} week
     */
    function weekLabel(week) {
        if (week.length === 0) return '';
        const first = new Date(week[0].date + 'T12:00:00');
        const last = new Date(week[week.length - 1].date + 'T12:00:00');
        const m1 = first.toLocaleString('en-US', { month: 'short' });
        const m2 = last.toLocaleString('en-US', { month: 'short' });
        if (m1 === m2) {
            return `${m1} ${first.getDate()} – ${last.getDate()}`;
        }
        return `${m1} ${first.getDate()} – ${m2} ${last.getDate()}`;
    }
</script>

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
                            <span class="col-day-name">{info.name}</span>
                            <span class="col-day-num">{info.num}</span>
                        </div>

                        <!-- Episode pills -->
                        <div class="col-pills">
                            {#if day.episodes.length === 0}
                                <div class="col-empty">—</div>
                            {:else}
                                {#each day.episodes as ep}
                                    {@const st = statusIcon(ep)}
                                    <a
                                        href="/tv/{ep.show_id}"
                                        class="ep-pill {st.cls}"
                                        title="{ep.show_title} {epCode(ep)} — {ep.episode_title}"
                                    >
                                        <span class="pill-dot">{st.icon}</span>
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
    .cal-weeks {
        display: flex;
        flex-direction: column;
        gap: 18px;
    }

    .cal-week {
        display: flex;
        flex-direction: column;
        gap: 6px;
    }

    .week-label {
        font-size: 0.65rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: oklch(var(--bc) / 0.35);
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
        border-radius: 12px;
        background: oklch(var(--b2) / 0.4);
        border: 1px solid oklch(var(--bc) / 0.04);
        min-height: 90px;
        overflow: hidden;
        transition: background 0.2s;
    }

    .col-today {
        background: oklch(var(--p) / 0.06);
        border-color: oklch(var(--p) / 0.3);
        box-shadow: 0 0 12px oklch(var(--p) / 0.08);
    }

    .col-past {
        opacity: 0.5;
    }

    .col-head {
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: 8px 4px 6px;
        gap: 1px;
    }
    .head-today {
        color: oklch(var(--p));
    }

    .col-day-name {
        font-size: 0.6rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: oklch(var(--bc) / 0.4);
    }
    .head-today .col-day-name {
        color: oklch(var(--p));
    }

    .col-day-num {
        font-size: 0.85rem;
        font-weight: 700;
        color: oklch(var(--bc) / 0.7);
    }
    .head-today .col-day-num {
        color: oklch(var(--p));
    }

    .col-pills {
        display: flex;
        flex-direction: column;
        gap: 3px;
        padding: 0 4px 6px;
        flex: 1;
    }

    .col-empty {
        display: flex;
        align-items: center;
        justify-content: center;
        flex: 1;
        color: oklch(var(--bc) / 0.12);
        font-size: 0.75rem;
    }

    /* ── Episode pill ── */
    .ep-pill {
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 5px 6px;
        border-radius: 8px;
        text-decoration: none;
        color: inherit;
        transition: background 0.15s, transform 0.15s;
        line-height: 1;
    }
    .ep-pill:hover {
        background: oklch(var(--bc) / 0.08);
        transform: translateY(-1px);
    }

    .pill-dot {
        width: 14px;
        height: 14px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 0.5rem;
        font-weight: 700;
        flex-shrink: 0;
    }

    .pill-downloaded .pill-dot {
        background: oklch(var(--su) / 0.2);
        color: oklch(var(--su));
    }
    .pill-available .pill-dot {
        background: oklch(var(--wa) / 0.2);
        color: oklch(var(--wa));
    }
    .pill-upcoming .pill-dot {
        background: oklch(var(--bc) / 0.08);
        color: oklch(var(--bc) / 0.3);
    }

    .pill-text {
        flex: 1;
        font-size: 0.62rem;
        font-weight: 600;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        min-width: 0;
    }

    .pill-code {
        font-size: 0.52rem;
        color: oklch(var(--bc) / 0.35);
        flex-shrink: 0;
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
