<script>
    /**
     * Stacked horizontal bar chart for library composition.
     * Shows each media type as a horizontal bar with status segments.
     *
     * @type {{
     *   nodes: Array<{id: string, label: string, column: number, count: number}>,
     *   links: Array<{source: string, target: string, value: number}>,
     * }}
     */
    let { nodes = [], links = [] } = $props();

    import { browser } from '$app/environment';

    const themeColors = $derived.by(() => {
        if (!browser) return { primary: '#6366f1', secondary: '#22c55e', accent: '#a855f7', neutral: '#64748b', success: '#22c55e', warning: '#eab308', error: '#ef4444', info: '#3b82f6' };
        const cs = getComputedStyle(document.documentElement);
        /** @param {string} v */
        const get = (v) => { const val = cs.getPropertyValue(v).trim(); return val ? `oklch(${val})` : ''; };
        return {
            primary: get('--p') || '#6366f1',
            secondary: get('--s') || '#22c55e',
            accent: get('--a') || '#a855f7',
            neutral: get('--n') || '#64748b',
            success: get('--su') || '#22c55e',
            warning: get('--wa') || '#eab308',
            error: get('--er') || '#ef4444',
            info: get('--in') || '#3b82f6',
        };
    });

    /** @type {Record<string, string>} */
    const statusColorMap = $derived({
        'status_owned': themeColors.success,
        'status_collected': themeColors.success,
        'status_wanted': themeColors.warning,
        'status_searching': themeColors.error,
        'status_not_tracked': themeColors.neutral,
        'status_watched_not_owned': themeColors.info,
        'status_external': themeColors.neutral,
        'status_discovered': themeColors.secondary,
        'status_watching': themeColors.info,
        'status_watched': themeColors.success,
        'status_partially_watched': themeColors.warning,
    });

    /** @type {Record<string, string>} */
    const typeColorMap = $derived({
        'type_movie': themeColors.primary,
        'type_show': themeColors.success,
        'type_artist': themeColors.accent,
    });

    // Build bar data
    const barData = $derived.by(() => {
        const typeNodes = nodes.filter(n => n.column === 1).sort((a, b) => b.count - a.count);
        const maxCount = Math.max(...typeNodes.map(n => n.count), 1);

        return typeNodes.map(typeNode => {
            const statusLinks = links
                .filter(l => l.source === typeNode.id && l.target.startsWith('status_'))
                .sort((a, b) => b.value - a.value);

            const segments = statusLinks.map(l => {
                const targetNode = nodes.find(n => n.id === l.target);
                return {
                    id: l.target,
                    label: targetNode?.label || l.target,
                    count: l.value,
                    pct: (l.value / typeNode.count) * 100,
                    color: statusColorMap[l.target] || themeColors.neutral,
                };
            });

            return {
                id: typeNode.id,
                label: typeNode.label,
                count: typeNode.count,
                barWidth: (typeNode.count / maxCount) * 100,
                color: typeColorMap[typeNode.id] || themeColors.neutral,
                segments,
            };
        });
    });

    // Gather unique statuses for legend
    const legendItems = $derived.by(() => {
        /** @type {Map<string, {label: string, color: string}>} */
        const seen = new Map();
        for (const bar of barData) {
            for (const seg of bar.segments) {
                if (!seen.has(seg.id)) {
                    seen.set(seg.id, { label: seg.label, color: seg.color });
                }
            }
        }
        return [...seen.values()];
    });

    let hoveredSegment = $state(/** @type {string|null} */ (null));
</script>

<div class="stacked-bar-container">
    {#each barData as bar}
        <div class="bar-row">
            <div class="bar-label">
                <span class="bar-type-name" style="color: {bar.color}">{bar.label}</span>
                <span class="bar-type-count">{bar.count.toLocaleString()}</span>
            </div>
            <div class="bar-track">
                <div class="bar-fill" style="width: {bar.barWidth}%">
                    {#each bar.segments as seg}
                        <div
                            class="bar-segment"
                            style="flex: {seg.count}; background: {seg.color}; opacity: {hoveredSegment && hoveredSegment !== seg.id ? 0.25 : 1}"
                            title="{seg.label}: {seg.count.toLocaleString()} ({seg.pct.toFixed(1)}%)"
                            role="graphics-symbol"
                            onmouseenter={() => hoveredSegment = seg.id}
                            onmouseleave={() => hoveredSegment = null}
                        >
                            {#if seg.pct > 10}
                                <span class="bar-seg-label">{seg.label}</span>
                            {/if}
                        </div>
                    {/each}
                </div>
            </div>
        </div>
    {/each}

    <!-- Legend -->
    <div class="bar-legend">
        {#each legendItems as item}
            <div class="legend-item">
                <div class="legend-swatch" style="background: {item.color}"></div>
                <span class="legend-text">{item.label}</span>
            </div>
        {/each}
    </div>
</div>

<style>
    .stacked-bar-container {
        display: flex;
        flex-direction: column;
        gap: 16px;
    }
    .bar-row {
        display: flex;
        align-items: center;
        gap: 12px;
    }
    .bar-label {
        min-width: 120px;
        display: flex;
        flex-direction: column;
        text-align: right;
    }
    .bar-type-name {
        font-size: 13px;
        font-weight: 600;
    }
    .bar-type-count {
        font-size: 11px;
        color: oklch(var(--bc) / 0.4);
    }
    .bar-track {
        flex: 1;
        height: 36px;
        background: oklch(var(--bc) / 0.05);
        border-radius: 6px;
        overflow: hidden;
    }
    .bar-fill {
        display: flex;
        height: 100%;
        gap: 1px;
        transition: width 0.5s ease;
    }
    .bar-segment {
        display: flex;
        align-items: center;
        justify-content: center;
        min-width: 2px;
        transition: opacity 0.2s;
        cursor: default;
    }
    .bar-seg-label {
        font-size: 10px;
        font-weight: 500;
        color: oklch(var(--b1));
        white-space: nowrap;
        text-shadow: 0 1px 2px rgba(0,0,0,0.3);
    }
    .bar-legend {
        display: flex;
        flex-wrap: wrap;
        gap: 8px 16px;
        padding-top: 8px;
        border-top: 1px solid oklch(var(--bc) / 0.08);
    }
    .legend-item {
        display: flex;
        align-items: center;
        gap: 6px;
    }
    .legend-swatch {
        width: 10px;
        height: 10px;
        border-radius: 2px;
    }
    .legend-text {
        font-size: 11px;
        color: oklch(var(--bc) / 0.5);
    }
</style>
