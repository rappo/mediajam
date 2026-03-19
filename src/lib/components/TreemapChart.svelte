<script>
    /**
     * Treemap visualization of library composition.
     * Shows nested rectangles proportional to item counts.
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
    const typeColorMap = $derived({
        'type_movie': themeColors.primary,
        'type_show': themeColors.success,
        'type_artist': themeColors.accent,
    });

    // Build treemap data: top-level = media types, nested = statuses
    const treemapData = $derived.by(() => {
        const typeNodes = nodes.filter(n => n.column === 1);
        const totalCount = typeNodes.reduce((s, n) => s + n.count, 0) || 1;

        // For each type node, find its status breakdown via links
        return typeNodes.map(typeNode => {
            const statusLinks = links.filter(l => l.source === typeNode.id && l.target.startsWith('status_'));
            const statusNodes = statusLinks.map(l => {
                const targetNode = nodes.find(n => n.id === l.target);
                return {
                    id: l.target,
                    label: targetNode?.label || l.target,
                    count: l.value,
                };
            }).sort((a, b) => b.count - a.count);

            return {
                id: typeNode.id,
                label: typeNode.label,
                count: typeNode.count,
                pct: (typeNode.count / totalCount) * 100,
                color: typeColorMap[typeNode.id] || themeColors.neutral,
                children: statusNodes,
            };
        }).sort((a, b) => b.count - a.count);
    });

    let hoveredItem = $state(/** @type {string|null} */ (null));
</script>

<div class="treemap-container">
    <!-- Top-level type bars (horizontal) -->
    <div class="treemap-row">
        {#each treemapData as type}
            <div
                class="treemap-type"
                style="flex: {type.count}; background: {type.color}; opacity: {hoveredItem && hoveredItem !== type.id ? 0.3 : 1}"
                role="button"
                tabindex="0"
                onmouseenter={() => hoveredItem = type.id}
                onmouseleave={() => hoveredItem = null}
                onkeydown={() => {}}
            >
                <div class="treemap-type-label">
                    <span class="treemap-type-name">{type.label}</span>
                    <span class="treemap-type-count">{type.count.toLocaleString()}</span>
                    <span class="treemap-type-pct">{type.pct.toFixed(1)}%</span>
                </div>
            </div>
        {/each}
    </div>

    <!-- Status breakdown for each type -->
    {#each treemapData as type}
        <div class="treemap-detail" style="opacity: {hoveredItem && hoveredItem !== type.id ? 0.3 : 1}">
            <div class="treemap-detail-header" style="color: {type.color}">{type.label}</div>
            <div class="treemap-status-row">
                {#each type.children as status}
                    <div
                        class="treemap-status"
                        style="flex: {status.count}; background: {type.color}"
                        title="{status.label}: {status.count.toLocaleString()}"
                    >
                        {#if status.count / type.count > 0.08}
                            <span class="treemap-status-label">{status.label}</span>
                            <span class="treemap-status-count">{status.count.toLocaleString()}</span>
                        {/if}
                    </div>
                {/each}
            </div>
        </div>
    {/each}
</div>

<style>
    .treemap-container {
        display: flex;
        flex-direction: column;
        gap: 12px;
    }
    .treemap-row {
        display: flex;
        gap: 3px;
        height: 80px;
        border-radius: 8px;
        overflow: hidden;
    }
    .treemap-type {
        display: flex;
        align-items: center;
        justify-content: center;
        transition: opacity 0.2s, flex 0.4s;
        cursor: default;
        min-width: 40px;
        border-radius: 4px;
    }
    .treemap-type:first-child { border-radius: 8px 4px 4px 8px; }
    .treemap-type:last-child { border-radius: 4px 8px 8px 4px; }
    .treemap-type-label {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 2px;
        color: oklch(var(--b1));
        text-shadow: 0 1px 2px rgba(0,0,0,0.3);
    }
    .treemap-type-name { font-size: 13px; font-weight: 600; }
    .treemap-type-count { font-size: 18px; font-weight: 700; }
    .treemap-type-pct { font-size: 11px; opacity: 0.7; }
    .treemap-detail {
        transition: opacity 0.2s;
    }
    .treemap-detail-header {
        font-size: 11px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        margin-bottom: 4px;
    }
    .treemap-status-row {
        display: flex;
        gap: 2px;
        height: 36px;
        border-radius: 6px;
        overflow: hidden;
    }
    .treemap-status {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        opacity: 0.55;
        min-width: 2px;
        transition: opacity 0.2s;
        cursor: default;
    }
    .treemap-status:hover { opacity: 0.85; }
    .treemap-status-label {
        font-size: 10px;
        font-weight: 500;
        color: oklch(var(--b1));
        white-space: nowrap;
        text-shadow: 0 1px 2px rgba(0,0,0,0.3);
    }
    .treemap-status-count {
        font-size: 10px;
        font-weight: 700;
        color: oklch(var(--b1));
        text-shadow: 0 1px 2px rgba(0,0,0,0.3);
    }
</style>
