<script>
    /**
     * 24-hour radial clock showing activity distribution.
     * @type {{ data: {hour: number, count: number, tv?: number, movie?: number, music?: number}[] }}
     */
    let { data = [] } = $props();

    const SIZE = 280;
    const CENTER = SIZE / 2;
    const OUTER_R = 120;
    const INNER_R = 50;

    // Fill in missing hours
    const hours = $derived.by(() => {
        /** @type {Array<{hour: number, count: number, tv: number, movie: number, music: number}>} */
        const filled = [];
        const map = new Map(data.map(d => [d.hour, d]));
        for (let h = 0; h < 24; h++) {
            const d = map.get(h);
            filled.push({
                hour: h,
                count: d?.count || 0,
                tv: d?.tv || 0,
                movie: d?.movie || 0,
                music: d?.music || 0,
            });
        }
        return filled;
    });

    const maxCount = $derived(Math.max(1, ...hours.map(h => h.count)));

    /**
     * Convert hour to angle (0h = top, clockwise)
     * @param {number} hour
     * @returns {number} angle in radians
     */
    function hourToAngle(hour) {
        return ((hour / 24) * Math.PI * 2) - Math.PI / 2;
    }

    /**
     * Create SVG arc path for a segment
     * @param {number} startHour
     * @param {number} endHour
     * @param {number} innerR
     * @param {number} outerR
     */
    function arcPath(startHour, endHour, innerR, outerR) {
        const a1 = hourToAngle(startHour);
        const a2 = hourToAngle(endHour);

        const x1 = CENTER + Math.cos(a1) * outerR;
        const y1 = CENTER + Math.sin(a1) * outerR;
        const x2 = CENTER + Math.cos(a2) * outerR;
        const y2 = CENTER + Math.sin(a2) * outerR;
        const x3 = CENTER + Math.cos(a2) * innerR;
        const y3 = CENTER + Math.sin(a2) * innerR;
        const x4 = CENTER + Math.cos(a1) * innerR;
        const y4 = CENTER + Math.sin(a1) * innerR;

        return `M ${x1} ${y1} A ${outerR} ${outerR} 0 0 1 ${x2} ${y2} L ${x3} ${y3} A ${innerR} ${innerR} 0 0 0 ${x4} ${y4} Z`;
    }

    // Hour labels at 12, 3, 6, 9 positions
    const CLOCK_LABELS = [
        { hour: 0, label: '12a' },
        { hour: 6, label: '6a' },
        { hour: 12, label: '12p' },
        { hour: 18, label: '6p' },
    ];
</script>

<div class="clock-container">
    <svg viewBox="0 0 {SIZE} {SIZE}" width="{SIZE}" height="{SIZE}">
        <!-- Hour segments -->
        {#each hours as h}
            {@const intensity = h.count / maxCount}
            {@const segR = INNER_R + (OUTER_R - INNER_R) * Math.min(intensity, 1)}
            <path
                d={arcPath(h.hour, h.hour + 1, INNER_R, segR)}
                fill="oklch(var(--p) / {(0.15 + intensity * 0.6).toFixed(2)})"
                stroke="oklch(var(--b1))"
                stroke-width="1"
                class="clock-segment"
            >
                <title>{h.hour}:00 — {h.count} play{h.count !== 1 ? 's' : ''} ({h.tv} TV, {h.movie} movies, {h.music} music)</title>
            </path>
        {/each}

        <!-- Tick marks for every hour -->
        {#each Array(24) as _, i}
            {@const angle = hourToAngle(i)}
            <line
                x1={CENTER + Math.cos(angle) * (OUTER_R + 2)}
                y1={CENTER + Math.sin(angle) * (OUTER_R + 2)}
                x2={CENTER + Math.cos(angle) * (OUTER_R + 6)}
                y2={CENTER + Math.sin(angle) * (OUTER_R + 6)}
                stroke="oklch(var(--bc) / 0.15)"
                stroke-width="1"
            />
        {/each}

        <!-- Cardinal labels -->
        {#each CLOCK_LABELS as cl}
            {@const angle = hourToAngle(cl.hour)}
            <text
                x={CENTER + Math.cos(angle) * (OUTER_R + 16)}
                y={CENTER + Math.sin(angle) * (OUTER_R + 16)}
                text-anchor="middle"
                dominant-baseline="central"
                font-size="11"
                fill="oklch(var(--bc) / 0.5)"
                font-family="Inter, system-ui, sans-serif"
                font-weight="500"
            >{cl.label}</text>
        {/each}

        <!-- Center circle -->
        <circle cx={CENTER} cy={CENTER} r={INNER_R - 2} fill="oklch(var(--b1))" />
        <text
            x={CENTER}
            y={CENTER - 6}
            text-anchor="middle"
            font-size="11"
            fill="oklch(var(--bc) / 0.5)"
            font-family="Inter, system-ui, sans-serif"
        >Activity</text>
        <text
            x={CENTER}
            y={CENTER + 10}
            text-anchor="middle"
            font-size="10"
            fill="oklch(var(--bc) / 0.3)"
            font-family="Inter, system-ui, sans-serif"
        >by hour</text>
    </svg>
</div>

<style>
    .clock-container {
        display: flex;
        justify-content: center;
        padding: 1rem 0;
    }
    .clock-segment {
        transition: opacity 0.15s;
    }
    .clock-segment:hover {
        opacity: 0.8;
    }
</style>
