<script>
    import { onMount } from 'svelte';

    /**
     * GitHub-style contribution heatmap of daily watch/listen time.
     * @prop {Array<{day: string, seconds: number, plays: number}>} activity
     * @prop {string[]} [types] — active media-type filter, used to carry the
     *   selection into the History link when exactly one type is chosen
     */
    let { activity = [], types = [] } = $props();

    /** @type {HTMLElement|null} */
    let scrollEl = $state(null);

    const WEEKS = 53;
    const DAY_MS = 24 * 60 * 60 * 1000;
    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    let byDay = $derived(new Map(activity.map(a => [a.day, a])));

    // Continuous intensity: each cell's brightness is proportional to
    // sqrt(seconds / busiest day), so the outlier day is visibly the brightest
    // instead of sharing a bucket with everything above the 75th percentile.
    /** @param {number} seconds @param {number} max */
    function cellColor(seconds, max) {
        const t = Math.sqrt(seconds / (max || 1));
        const l = 0.33 + 0.50 * t;
        const c = 0.06 + 0.13 * t;
        return `oklch(${l.toFixed(3)} ${c.toFixed(3)} 165)`;
    }

    /** @param {Date} d */
    function iso(d) { return d.toISOString().slice(0, 10); }

    // Grid: columns = weeks (Sunday-first), last column = current week
    let grid = $derived.by(() => {
        const today = new Date();
        today.setHours(12, 0, 0, 0); // noon avoids DST edge cases in day math
        const start = new Date(today.getTime() - ((WEEKS - 1) * 7 + today.getDay()) * DAY_MS);

        /** @type {{ days: any[], monthLabel: string | null }[]} */
        const weeks = [];
        let prevMonth = -1;
        for (let w = 0; w < WEEKS; w++) {
            const days = [];
            for (let d = 0; d < 7; d++) {
                const date = new Date(start.getTime() + (w * 7 + d) * DAY_MS);
                if (date > today) { days.push(null); continue; }
                const key = iso(date);
                const row = byDay.get(key);
                days.push({
                    key,
                    seconds: row?.seconds || 0,
                    plays: row?.plays || 0,
                    weekend: d === 0 || d === 6,
                    label: date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }),
                });
            }
            const firstDay = new Date(start.getTime() + w * 7 * DAY_MS);
            const month = firstDay.getMonth();
            weeks.push({ days, monthLabel: month !== prevMonth && w < WEEKS - 1 ? MONTHS[month] : null });
            prevMonth = month;
        }
        return weeks;
    });

    /** @param {number} seconds */
    function fmtTime(seconds) {
        const h = seconds / 3600;
        if (h >= 1) return `${h.toFixed(1)}h`;
        return `${Math.round(seconds / 60)}m`;
    }

    // Legend range: the busiest day sets the top of the scale
    let maxSeconds = $derived(activity.reduce((m, a) => Math.max(m, a.seconds || 0), 0));

    /** Link a day square to History, pre-filtered to that day (and the active type) */
    function historyHref(/** @type {string} */ day) {
        const params = new URLSearchParams({ from: day, to: day });
        if (types.length === 1) params.set('type', types[0]);
        return `/history?${params}`;
    }

    // Fit the grid to the card width: size cells from the available space
    // (clamped so narrow screens fall back to horizontal scrolling).
    let cellPx = $state(11);
    $effect(() => {
        if (!scrollEl) return;
        const measure = () => {
            // 30px day-label column + 4px body gap + 52 inter-week gaps of 3px
            const avail = scrollEl.clientWidth - 30 - 4 - 52 * 3;
            cellPx = Math.max(10, Math.min(20, Math.floor(avail / WEEKS)));
        };
        measure();
        const ro = new ResizeObserver(measure);
        ro.observe(scrollEl);
        return () => ro.disconnect();
    });

    onMount(() => {
        // Land scrolled to today (right edge)
        if (scrollEl) scrollEl.scrollLeft = scrollEl.scrollWidth;
    });
</script>

<div class="hm-scroll" bind:this={scrollEl}>
    <div class="hm-inner" style="--cell: {cellPx}px">
        <div class="hm-months">
            {#each grid as week}
                <span class="hm-month">{week.monthLabel || ''}</span>
            {/each}
        </div>
        <div class="hm-body">
            <div class="hm-daylabels">
                <span></span><span>Mon</span><span></span><span>Wed</span><span></span><span>Fri</span><span></span>
            </div>
            <div class="hm-grid">
                {#each grid as week}
                    <div class="hm-week">
                        {#each week.days as day}
                            {#if day}
                                <a
                                    href={historyHref(day.key)}
                                    class="hm-cell"
                                    class:hm-wknd={day.weekend && !day.seconds}
                                    style={day.seconds ? `background: ${cellColor(day.seconds, maxSeconds)}` : ''}
                                    title="{day.seconds ? `${fmtTime(day.seconds)} · ${day.plays} play${day.plays !== 1 ? 's' : ''}` : 'No activity'} — {day.label}"
                                    aria-label="View history for {day.label}"
                                ></a>
                            {:else}
                                <div class="hm-cell hm-future"></div>
                            {/if}
                        {/each}
                    </div>
                {/each}
            </div>
        </div>
        <div class="hm-legend">
            <span>0</span>
            <div class="hm-gradient"></div>
            <span>{fmtTime(maxSeconds)}</span>
        </div>
    </div>
</div>

<style>
    .hm-scroll {
        overflow-x: auto;
        scrollbar-width: thin;
    }
    .hm-inner {
        width: fit-content;
        min-width: 100%;
    }
    .hm-months {
        display: flex;
        gap: 3px;
        margin-left: 34px;
        margin-bottom: 3px;
    }
    .hm-month {
        width: var(--cell, 11px);
        flex-shrink: 0;
        font-size: 0.6rem;
        color: color-mix(in oklab, var(--color-base-content) 45%, transparent);
        overflow: visible;
        white-space: nowrap;
    }
    .hm-body {
        display: flex;
        gap: 4px;
    }
    .hm-daylabels {
        display: flex;
        flex-direction: column;
        gap: 3px;
        width: 30px;
        flex-shrink: 0;
    }
    .hm-daylabels span {
        height: var(--cell, 11px);
        font-size: 0.6rem;
        line-height: var(--cell, 11px);
        color: color-mix(in oklab, var(--color-base-content) 45%, transparent);
        text-align: right;
    }
    .hm-grid {
        display: flex;
        gap: 3px;
    }
    .hm-week {
        display: flex;
        flex-direction: column;
        gap: 3px;
    }
    .hm-cell {
        display: block;
        width: var(--cell, 11px);
        height: var(--cell, 11px);
        border-radius: 3px;
        flex-shrink: 0;
        background: color-mix(in oklab, var(--color-base-content) 7%, transparent);
        transition: transform 0.1s;
    }
    .hm-cell:not(.hm-future):hover {
        transform: scale(1.25);
        outline: 1px solid color-mix(in oklab, var(--color-base-content) 30%, transparent);
    }
    /* Empty weekend days sit slightly lighter so Sat/Sun read as bands */
    .hm-cell.hm-wknd {
        background: color-mix(in oklab, var(--color-base-content) 14%, transparent);
    }
    .hm-future {
        background: transparent;
    }
    .hm-gradient {
        width: 72px;
        height: 9px;
        border-radius: 5px;
        background: linear-gradient(to right,
            color-mix(in oklab, var(--color-base-content) 7%, transparent),
            oklch(0.45 0.09 165),
            oklch(0.83 0.19 165));
    }
    .hm-legend {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 3px;
        margin-top: 0.5rem;
        font-size: 0.6rem;
        color: color-mix(in oklab, var(--color-base-content) 45%, transparent);
    }
    .hm-legend span { margin: 0 0.2rem; }
</style>
