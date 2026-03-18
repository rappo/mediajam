<script>
    /**
     * Sankey / Alluvial diagram — pure SVG, no D3 dependency.
     * Fixed 4-column layout: Total → Media Type → Collection Status → Source
     *
     * @type {{
     *   nodes: Array<{id: string, label: string, column: number, count: number}>,
     *   links: Array<{source: string, target: string, value: number}>,
     *   width?: number,
     *   height?: number
     * }}
     */
    let { nodes = [], links = [], width = 900, height = 500 } = $props();

    const PADDING = { top: 40, right: 20, bottom: 20, left: 20 };
    const NODE_WIDTH = 18;
    const NODE_GAP = 8;
    const COLUMNS = 4;

    // Color palette for media types (flows inherit source color)
    const TYPE_COLORS = {
        'type_movie': 'oklch(0.65 0.18 250)',    // Blue
        'type_show': 'oklch(0.65 0.18 150)',      // Green
        'type_artist': 'oklch(0.65 0.18 300)',    // Purple
    };

    const STATUS_COLORS = {
        'status_owned': 'oklch(0.65 0.15 150)',
        'status_collected': 'oklch(0.65 0.15 150)',
        'status_wanted': 'oklch(0.65 0.15 60)',
        'status_searching': 'oklch(0.65 0.15 30)',
        'status_not_tracked': 'oklch(0.5 0.05 250)',
    };

    const SOURCE_COLORS = {
        'source_jellyfin': 'oklch(0.65 0.15 280)',
        'source_radarr': 'oklch(0.65 0.15 40)',
        'source_sonarr': 'oklch(0.65 0.15 150)',
        'source_lidarr': 'oklch(0.65 0.15 300)',
        'source_other': 'oklch(0.5 0.05 250)',
    };

    /**
     * @param {string} id
     * @returns {string}
     */
    function nodeColor(id) {
        if (id === 'total') return 'oklch(0.7 0.15 250)';
        return TYPE_COLORS[id] || STATUS_COLORS[id] || SOURCE_COLORS[id] || 'oklch(0.6 0.1 250)';
    }

    // Layout computation
    const layout = $derived.by(() => {
        const innerW = width - PADDING.left - PADDING.right;
        const innerH = height - PADDING.top - PADDING.bottom;
        const colSpacing = innerW / (COLUMNS - 1);

        // Group nodes by column
        /** @type {Map<number, typeof nodes>} */
        const columns = new Map();
        for (const n of nodes) {
            const col = columns.get(n.column) || [];
            col.push(n);
            columns.set(n.column, col);
        }

        // Sort each column by count descending for visual stability
        for (const col of columns.values()) {
            col.sort((a, b) => b.count - a.count);
        }

        // Position nodes within each column
        /** @type {Map<string, {x: number, y: number, h: number, label: string, count: number, id: string}>} */
        const nodePositions = new Map();

        for (const [colIdx, colNodes] of columns) {
            const totalCount = colNodes.reduce((s, n) => s + n.count, 0);
            const totalGap = (colNodes.length - 1) * NODE_GAP;
            const availableH = innerH - totalGap;
            const x = PADDING.left + colIdx * colSpacing - NODE_WIDTH / 2;

            let y = PADDING.top;
            for (const n of colNodes) {
                const h = Math.max(4, (n.count / totalCount) * availableH);
                nodePositions.set(n.id, { x, y, h, label: n.label, count: n.count, id: n.id });
                y += h + NODE_GAP;
            }
        }

        // Build link paths with vertical stacking
        // Track consumed height on source (right side) and target (left side)
        /** @type {Map<string, number>} */
        const sourceOffset = new Map();
        /** @type {Map<string, number>} */
        const targetOffset = new Map();

        // Sort links by value descending for visual stability
        const sortedLinks = [...links].sort((a, b) => b.value - a.value);

        /** @type {Array<{path: string, value: number, sourceId: string, targetId: string, color: string, label: string}>} */
        const linkPaths = [];

        for (const link of sortedLinks) {
            const sn = nodePositions.get(link.source);
            const tn = nodePositions.get(link.target);
            if (!sn || !tn) continue;

            const sTotal = nodes.find(n => n.id === link.source)?.count || 1;
            const tTotal = nodes.find(n => n.id === link.target)?.count || 1;

            const bandH_s = (link.value / sTotal) * sn.h;
            const bandH_t = (link.value / tTotal) * tn.h;

            const sOff = sourceOffset.get(link.source) || 0;
            const tOff = targetOffset.get(link.target) || 0;

            const sy1 = sn.y + sOff;
            const sy2 = sy1 + bandH_s;
            const ty1 = tn.y + tOff;
            const ty2 = ty1 + bandH_t;

            sourceOffset.set(link.source, sOff + bandH_s);
            targetOffset.set(link.target, tOff + bandH_t);

            // Bezier curve from source right edge to target left edge
            const sx = sn.x + NODE_WIDTH;
            const tx = tn.x;
            const cx = (sx + tx) / 2;

            const path = `M ${sx} ${sy1}
                C ${cx} ${sy1}, ${cx} ${ty1}, ${tx} ${ty1}
                L ${tx} ${ty2}
                C ${cx} ${ty2}, ${cx} ${sy2}, ${sx} ${sy2}
                Z`;

            // Color flows by their media type origin
            let color = nodeColor(link.source);
            // For status→source links, trace back to the type
            if (link.source.startsWith('status_')) {
                // Find which type feeds into this status most
                const feedingType = sortedLinks
                    .filter(l => l.target === link.source && l.source.startsWith('type_'))
                    .sort((a, b) => b.value - a.value)[0];
                if (feedingType) color = nodeColor(feedingType.source);
            }

            const sLabel = sn.label;
            const tLabel = tn.label;

            linkPaths.push({
                path,
                value: link.value,
                sourceId: link.source,
                targetId: link.target,
                color,
                label: `${sLabel} → ${tLabel}: ${link.value.toLocaleString()}`
            });
        }

        // Column headers
        const headers = ['Total Library', 'Media Type', 'Status', 'Source'];
        /** @type {Array<{x: number, label: string}>} */
        const headerPositions = headers.map((label, i) => ({
            x: PADDING.left + i * colSpacing,
            label,
        }));

        return { nodePositions, linkPaths, headerPositions };
    });

    let hoveredLink = $state(/** @type {string|null} */ (null));
    let hoveredNode = $state(/** @type {string|null} */ (null));

    /**
     * @param {string} linkLabel
     */
    function isLinkHighlighted(linkLabel) {
        if (!hoveredNode && !hoveredLink) return true;
        if (hoveredLink === linkLabel) return true;
        if (hoveredNode) {
            return linkLabel.includes(hoveredNode);
        }
        return false;
    }
</script>

<div class="sankey-container">
    <svg
        viewBox="0 0 {width} {height}"
        preserveAspectRatio="xMidYMid meet"
        class="sankey-svg"
        role="img"
        aria-label="Library composition Sankey diagram"
    >
        <!-- Column headers -->
        {#each layout.headerPositions as header}
            <text
                x={header.x}
                y={PADDING.top - 16}
                text-anchor="middle"
                class="sankey-header"
            >{header.label}</text>
        {/each}

        <!-- Links (flow bands) -->
        <g class="sankey-links">
            {#each layout.linkPaths as link}
                <path
                    d={link.path}
                    fill={link.color}
                    fill-opacity={isLinkHighlighted(link.label) ? 0.35 : 0.08}
                    class="sankey-link"
                    onmouseenter={() => hoveredLink = link.label}
                    onmouseleave={() => hoveredLink = null}
                >
                    <title>{link.label}</title>
                </path>
            {/each}
        </g>

        <!-- Nodes (vertical bars) -->
        <g class="sankey-nodes">
            {#each [...layout.nodePositions.values()] as node}
                <rect
                    x={node.x}
                    y={node.y}
                    width={NODE_WIDTH}
                    height={node.h}
                    rx="3"
                    fill={nodeColor(node.id)}
                    class="sankey-node"
                    class:sankey-node-dimmed={hoveredNode !== null && hoveredNode !== node.id}
                    onmouseenter={() => hoveredNode = node.id}
                    onmouseleave={() => hoveredNode = null}
                >
                    <title>{node.label}: {node.count.toLocaleString()}</title>
                </rect>

                <!-- Label -->
                {@const isLeft = node.x < width / 2}
                <text
                    x={isLeft ? node.x + NODE_WIDTH + 6 : node.x - 6}
                    y={node.y + node.h / 2}
                    text-anchor={isLeft ? 'start' : 'end'}
                    dominant-baseline="central"
                    class="sankey-label"
                    class:sankey-label-dimmed={hoveredNode !== null && hoveredNode !== node.id}
                >
                    {node.label}
                    <tspan class="sankey-count"> ({node.count.toLocaleString()})</tspan>
                </text>
            {/each}
        </g>
    </svg>
</div>

<style>
    .sankey-container {
        width: 100%;
        overflow-x: auto;
    }
    .sankey-svg {
        width: 100%;
        height: auto;
        min-height: 400px;
        max-height: 600px;
    }
    .sankey-header {
        font-family: Inter, system-ui, sans-serif;
        font-size: 12px;
        font-weight: 600;
        fill: oklch(var(--bc) / 0.5);
        text-transform: uppercase;
        letter-spacing: 0.05em;
    }
    .sankey-node {
        transition: opacity 0.2s;
        cursor: default;
    }
    .sankey-node:hover {
        filter: brightness(1.2);
    }
    .sankey-node-dimmed {
        opacity: 0.3;
    }
    .sankey-link {
        transition: fill-opacity 0.2s;
        cursor: default;
    }
    .sankey-link:hover {
        fill-opacity: 0.5 !important;
    }
    .sankey-label {
        font-family: Inter, system-ui, sans-serif;
        font-size: 11px;
        font-weight: 500;
        fill: oklch(var(--bc) / 0.8);
        transition: opacity 0.2s;
        pointer-events: none;
    }
    .sankey-label-dimmed {
        opacity: 0.3;
    }
    .sankey-count {
        font-weight: 400;
        fill: oklch(var(--bc) / 0.4);
        font-size: 10px;
    }
</style>
