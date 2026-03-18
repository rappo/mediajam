<script>
    /**
     * GitHub-style contribution heatmap.
     * @type {{ data: {day: string, count: number}[], onDayClick?: (day: string) => void }}
     */
    let { data = [], onDayClick } = $props();

    const CELL_SIZE = 13;
    const GAP = 3;
    const TOTAL = CELL_SIZE + GAP;
    const WEEKS = 53;
    const LABEL_WIDTH = 28;

    const MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const DAY_LABELS = ['', 'Mon', '', 'Wed', '', 'Fri', ''];

    // Build a map from date string -> count
    const countMap = $derived.by(() => {
        /** @type {Map<string, number>} */
        const m = new Map();
        for (const d of data) m.set(d.day, d.count);
        return m;
    });

    // Build grid: 53 columns × 7 rows, starting from 52 weeks ago
    const grid = $derived.by(() => {
        const today = new Date();
        // Go back to the start of the week, 52 weeks ago
        const start = new Date(today);
        start.setDate(start.getDate() - start.getDay() - (52 * 7));

        /** @type {Array<{x: number, y: number, date: string, count: number, label: string}>} */
        const cells = [];
        /** @type {Array<{x: number, label: string}>} */
        const months = [];

        let lastMonth = -1;
        const d = new Date(start);

        for (let week = 0; week < WEEKS; week++) {
            for (let dow = 0; dow < 7; dow++) {
                const dateStr = d.toISOString().slice(0, 10);
                const count = countMap.get(dateStr) || 0;
                const month = d.getMonth();

                if (month !== lastMonth) {
                    months.push({ x: LABEL_WIDTH + week * TOTAL, label: MONTH_LABELS[month] });
                    lastMonth = month;
                }

                if (d <= today) {
                    cells.push({
                        x: LABEL_WIDTH + week * TOTAL,
                        y: 20 + dow * TOTAL,
                        date: dateStr,
                        count,
                        label: `${d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}: ${count} play${count !== 1 ? 's' : ''}`
                    });
                }

                d.setDate(d.getDate() + 1);
            }
        }

        return { cells, months };
    });

    const maxCount = $derived(Math.max(1, ...grid.cells.map(c => c.count)));

    /**
     * @param {number} count
     * @returns {string}
     */
    function cellColor(count) {
        if (count === 0) return 'oklch(var(--b3))';
        const intensity = Math.min(count / maxCount, 1);
        // Scale from 0.15 to 0.7 opacity of primary color
        const alpha = 0.15 + intensity * 0.55;
        return `oklch(var(--p) / ${alpha.toFixed(2)})`;
    }

    const svgWidth = LABEL_WIDTH + WEEKS * TOTAL;
    const svgHeight = 20 + 7 * TOTAL + 16;
</script>

<div class="heatmap-container">
    <svg
        viewBox="0 0 {svgWidth} {svgHeight}"
        width="100%"
        style="max-width: {svgWidth}px;"
        role="img"
        aria-label="Activity heatmap"
    >
        <!-- Month labels -->
        {#each grid.months as m}
            <text x={m.x} y="12" class="heatmap-label" font-size="10" fill="oklch(var(--bc) / 0.4)">{m.label}</text>
        {/each}

        <!-- Day labels -->
        {#each DAY_LABELS as label, i}
            {#if label}
                <text x="0" y={20 + i * TOTAL + CELL_SIZE - 2} class="heatmap-label" font-size="9" fill="oklch(var(--bc) / 0.3)">{label}</text>
            {/if}
        {/each}

        <!-- Cells -->
        {#each grid.cells as cell}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <rect
                x={cell.x}
                y={cell.y}
                width={CELL_SIZE}
                height={CELL_SIZE}
                rx="2"
                fill={cellColor(cell.count)}
                class="heatmap-cell"
                class:heatmap-cell-active={cell.count > 0}
                role={onDayClick ? 'button' : undefined}
                tabindex={onDayClick ? 0 : undefined}
                onclick={() => onDayClick?.(cell.date)}
            >
                <title>{cell.label}</title>
            </rect>
        {/each}
    </svg>

    <!-- Legend -->
    <div class="heatmap-legend">
        <span class="heatmap-legend-label">Less</span>
        {#each [0, 0.25, 0.5, 0.75, 1] as level}
            <div
                class="heatmap-legend-cell"
                style="background: {level === 0 ? 'oklch(var(--b3))' : `oklch(var(--p) / ${(0.15 + level * 0.55).toFixed(2)})`}"
            ></div>
        {/each}
        <span class="heatmap-legend-label">More</span>
    </div>
</div>

<style>
    .heatmap-container {
        overflow-x: auto;
        padding: 0.5rem 0;
    }
    .heatmap-label {
        font-family: Inter, system-ui, sans-serif;
    }
    .heatmap-cell {
        transition: opacity 0.15s;
        cursor: default;
    }
    .heatmap-cell-active:hover {
        opacity: 0.8;
        stroke: oklch(var(--bc) / 0.3);
        stroke-width: 1;
    }
    .heatmap-legend {
        display: flex;
        align-items: center;
        gap: 3px;
        justify-content: flex-end;
        margin-top: 0.25rem;
        padding-right: 0.25rem;
    }
    .heatmap-legend-label {
        font-size: 0.65rem;
        opacity: 0.4;
        margin: 0 0.25rem;
    }
    .heatmap-legend-cell {
        width: 11px;
        height: 11px;
        border-radius: 2px;
    }
</style>
