<!--
  CalendarStrip — horizontal week view for TV schedule.
  Shows Mon–Sun with show posters on each day.
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
        return {
            name: dayNames[d.getDay()],
            num: d.getDate(),
            month: d.toLocaleString('en-US', { month: 'short' }),
            isToday: dateStr === new Date().toISOString().split('T')[0],
        };
    }

    /**
     * @param {any} ep
     */
    function statusBadge(ep) {
        if (ep.status === 'downloaded') return { text: '✓', class: 'badge-success', title: 'Downloaded' };
        if (ep.status === 'available') return { text: '↓', class: 'badge-warning', title: 'Available for download' };
        return { text: '○', class: 'badge-ghost', title: 'Not yet aired' };
    }

    /**
     * @param {any} ep
     */
    function epCode(ep) {
        return `S${String(ep.season_number).padStart(2, '0')}E${String(ep.item_number).padStart(2, '0')}`;
    }
</script>

<div class="calendar-strip">
    {#each days as day}
        {@const info = formatDay(day.date)}
        <div class="calendar-day" class:today={info.isToday}>
            <div class="day-header" class:today-header={info.isToday}>
                <span class="day-name">{info.name}</span>
                <span class="day-num">{info.month} {info.num}</span>
            </div>
            <div class="day-content">
                {#if day.episodes.length === 0}
                    <div class="empty-day">—</div>
                {:else}
                    {#each day.episodes as ep}
                        {@const badge = statusBadge(ep)}
                        <a href="/tv/{ep.show_id}" class="ep-card" title="{ep.show_title} {epCode(ep)} — {ep.episode_title}">
                            {#if ep.poster_url}
                                <img src={ep.poster_url} alt="" class="ep-poster" loading="lazy" />
                            {:else}
                                <div class="ep-poster placeholder">📺</div>
                            {/if}
                            <div class="ep-info">
                                <span class="ep-show">{ep.show_title}</span>
                                <span class="ep-code">{epCode(ep)}</span>
                            </div>
                            <span class="status-badge {badge.class}" title={badge.title}>{badge.text}</span>
                        </a>
                    {/each}
                {/if}
            </div>
        </div>
    {/each}
</div>

<style>
    .calendar-strip {
        display: grid;
        grid-template-columns: repeat(7, 1fr);
        gap: 6px;
        width: 100%;
    }

    .calendar-day {
        display: flex;
        flex-direction: column;
        border-radius: 10px;
        background: oklch(var(--b2) / 0.5);
        overflow: hidden;
        min-height: 100px;
    }

    .calendar-day.today {
        outline: 2px solid oklch(var(--p) / 0.5);
        background: oklch(var(--p) / 0.06);
    }

    .day-header {
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: 6px 4px 4px;
        font-size: 0.7rem;
        color: oklch(var(--bc) / 0.45);
    }

    .today-header {
        color: oklch(var(--p));
        font-weight: 600;
    }

    .day-name {
        font-weight: 600;
        text-transform: uppercase;
        font-size: 0.6rem;
        letter-spacing: 0.05em;
    }

    .day-num {
        font-size: 0.7rem;
    }

    .day-content {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: 0 4px 6px;
    }

    .empty-day {
        display: flex;
        align-items: center;
        justify-content: center;
        flex: 1;
        color: oklch(var(--bc) / 0.15);
        font-size: 0.75rem;
    }

    .ep-card {
        display: flex;
        align-items: center;
        gap: 5px;
        padding: 4px;
        border-radius: 6px;
        text-decoration: none;
        color: inherit;
        transition: background 0.15s;
        position: relative;
    }

    .ep-card:hover {
        background: oklch(var(--bc) / 0.06);
    }

    .ep-poster {
        width: 28px;
        height: 40px;
        border-radius: 4px;
        object-fit: cover;
        flex-shrink: 0;
    }

    .ep-poster.placeholder {
        display: flex;
        align-items: center;
        justify-content: center;
        background: oklch(var(--b3));
        font-size: 0.75rem;
    }

    .ep-info {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
    }

    .ep-show {
        font-size: 0.65rem;
        font-weight: 600;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .ep-code {
        font-size: 0.55rem;
        color: oklch(var(--bc) / 0.4);
    }

    .status-badge {
        position: absolute;
        top: 2px;
        right: 2px;
        width: 14px;
        height: 14px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 0.5rem;
        font-weight: 700;
    }

    .badge-success {
        background: oklch(var(--su) / 0.2);
        color: oklch(var(--su));
    }

    .badge-warning {
        background: oklch(var(--wa) / 0.2);
        color: oklch(var(--wa));
    }

    .badge-ghost {
        background: oklch(var(--bc) / 0.08);
        color: oklch(var(--bc) / 0.3);
    }

    @media (max-width: 900px) {
        .calendar-strip {
            grid-template-columns: repeat(4, 1fr);
        }
    }

    @media (max-width: 600px) {
        .calendar-strip {
            grid-template-columns: repeat(2, 1fr);
        }
    }
</style>
