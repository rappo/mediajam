<script>
    import { onMount } from 'svelte';

    /**
     * GitHub-style contribution heatmap of daily watch/listen time.
     * @prop {Array<{day: string, seconds: number, plays: number}>} activity
     */
    let { activity = [] } = $props();

    /** @type {HTMLElement|null} */
    let scrollEl = $state(null);

    const WEEKS = 53;
    const DAY_MS = 24 * 60 * 60 * 1000;
    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    let byDay = $derived(new Map(activity.map(a => [a.day, a])));

    // Quartile thresholds over non-zero days → 4 intensity levels (GitHub-style)
    let thresholds = $derived.by(() => {
        const vals = activity.map(a => a.seconds).filter(s => s > 0).sort((a, b) => a - b);
        if (vals.length === 0) return [1, 2, 3];
        const q = (/** @type {number} */ p) => vals[Math.min(vals.length - 1, Math.floor(vals.length * p))];
        return [q(0.25), q(0.5), q(0.75)];
    });

    /** @param {number} seconds */
    function level(seconds) {
        if (!seconds) return 0;
        if (seconds <= thresholds[0]) return 1;
        if (seconds <= thresholds[1]) return 2;
        if (seconds <= thresholds[2]) return 3;
        return 4;
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
                    level: level(row?.seconds || 0),
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

    onMount(() => {
        // Land scrolled to today (right edge)
        if (scrollEl) scrollEl.scrollLeft = scrollEl.scrollWidth;
    });
</script>

<div class="hm-scroll" bind:this={scrollEl}>
    <div class="hm-inner">
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
                                <div
                                    class="hm-cell level-{day.level}"
                                    title="{day.seconds ? `${fmtTime(day.seconds)} · ${day.plays} play${day.plays !== 1 ? 's' : ''}` : 'No activity'} — {day.label}"
                                ></div>
                            {:else}
                                <div class="hm-cell hm-future"></div>
                            {/if}
                        {/each}
                    </div>
                {/each}
            </div>
        </div>
        <div class="hm-legend">
            <span>Less</span>
            <div class="hm-cell level-0"></div>
            <div class="hm-cell level-1"></div>
            <div class="hm-cell level-2"></div>
            <div class="hm-cell level-3"></div>
            <div class="hm-cell level-4"></div>
            <span>More</span>
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
        width: 11px;
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
        height: 11px;
        font-size: 0.6rem;
        line-height: 11px;
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
        width: 11px;
        height: 11px;
        border-radius: 2.5px;
        flex-shrink: 0;
        background: color-mix(in oklab, var(--color-base-content) 7%, transparent);
        transition: transform 0.1s;
    }
    .hm-cell:not(.hm-future):hover {
        transform: scale(1.25);
        outline: 1px solid color-mix(in oklab, var(--color-base-content) 30%, transparent);
    }
    .hm-future {
        background: transparent;
    }
    .hm-cell.level-1 { background: oklch(0.38 0.08 165); }
    .hm-cell.level-2 { background: oklch(0.52 0.12 165); }
    .hm-cell.level-3 { background: oklch(0.66 0.16 165); }
    .hm-cell.level-4 { background: oklch(0.82 0.19 165); }
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
