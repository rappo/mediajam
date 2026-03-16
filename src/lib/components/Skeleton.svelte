<script>
    let { lines = 3, type = 'text' } = $props();
</script>

{#if type === 'poster-row'}
    <div class="skel-poster-section">
        <div class="skel-title"></div>
        <div class="skel-poster-row">
            {#each Array(8) as _}
                <div class="skel-poster"></div>
            {/each}
        </div>
    </div>
{:else if type === 'stat-cards'}
    <div class="skel-stat-grid">
        {#each Array(4) as _}
            <div class="skel-stat-card"></div>
        {/each}
    </div>
{:else if type === 'chart'}
    <div class="skel-chart"></div>
{:else if type === 'table'}
    <div class="skel-table">
        <div class="skel-table-header"></div>
        {#each Array(5) as _}
            <div class="skel-table-row"></div>
        {/each}
    </div>
{:else if type === 'timeline'}
    {#each Array(3) as _}
        <div class="skel-timeline-day">
            <div class="skel-title" style="width: 40%"></div>
            {#each Array(4) as __}
                <div class="skel-timeline-entry"></div>
            {/each}
        </div>
    {/each}
{:else}
    {#each Array(lines) as _}
        <div class="skel-line"></div>
    {/each}
{/if}

<style>
    @keyframes shimmer {
        0% { background-position: -200% 0; }
        100% { background-position: 200% 0; }
    }
    .skel-poster-section {
        margin-bottom: 1.5rem;
    }
    .skel-title {
        height: 1rem;
        width: 30%;
        border-radius: 0.5rem;
        background: linear-gradient(90deg, oklch(var(--bc) / 0.06) 25%, oklch(var(--bc) / 0.12) 50%, oklch(var(--bc) / 0.06) 75%);
        background-size: 200% 100%;
        animation: shimmer 1.5s infinite;
        margin-bottom: 0.75rem;
    }
    .skel-poster-row {
        display: flex;
        gap: 0.6rem;
        overflow: hidden;
    }
    .skel-poster {
        flex-shrink: 0;
        width: 130px;
        aspect-ratio: 2/3;
        border-radius: 0.5rem;
        background: linear-gradient(90deg, oklch(var(--bc) / 0.06) 25%, oklch(var(--bc) / 0.12) 50%, oklch(var(--bc) / 0.06) 75%);
        background-size: 200% 100%;
        animation: shimmer 1.5s infinite;
    }
    .skel-stat-grid {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 1rem;
    }
    @media (min-width: 768px) {
        .skel-stat-grid {
            grid-template-columns: repeat(4, 1fr);
        }
    }
    .skel-stat-card {
        height: 80px;
        border-radius: 1rem;
        background: linear-gradient(90deg, oklch(var(--bc) / 0.06) 25%, oklch(var(--bc) / 0.12) 50%, oklch(var(--bc) / 0.06) 75%);
        background-size: 200% 100%;
        animation: shimmer 1.5s infinite;
    }
    .skel-chart {
        height: 320px;
        border-radius: 1rem;
        background: linear-gradient(90deg, oklch(var(--bc) / 0.06) 25%, oklch(var(--bc) / 0.12) 50%, oklch(var(--bc) / 0.06) 75%);
        background-size: 200% 100%;
        animation: shimmer 1.5s infinite;
    }
    .skel-table {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
    }
    .skel-table-header {
        height: 2.5rem;
        border-radius: 0.5rem;
        background: linear-gradient(90deg, oklch(var(--bc) / 0.08) 25%, oklch(var(--bc) / 0.14) 50%, oklch(var(--bc) / 0.08) 75%);
        background-size: 200% 100%;
        animation: shimmer 1.5s infinite;
    }
    .skel-table-row {
        height: 2rem;
        border-radius: 0.25rem;
        background: linear-gradient(90deg, oklch(var(--bc) / 0.04) 25%, oklch(var(--bc) / 0.08) 50%, oklch(var(--bc) / 0.04) 75%);
        background-size: 200% 100%;
        animation: shimmer 1.5s infinite;
    }
    .skel-timeline-day {
        margin-bottom: 1.5rem;
    }
    .skel-timeline-entry {
        height: 3.5rem;
        border-radius: 0.75rem;
        margin-bottom: 0.5rem;
        background: linear-gradient(90deg, oklch(var(--bc) / 0.04) 25%, oklch(var(--bc) / 0.08) 50%, oklch(var(--bc) / 0.04) 75%);
        background-size: 200% 100%;
        animation: shimmer 1.5s infinite;
    }
    .skel-line {
        height: 0.8rem;
        width: 80%;
        border-radius: 0.25rem;
        margin-bottom: 0.5rem;
        background: linear-gradient(90deg, oklch(var(--bc) / 0.06) 25%, oklch(var(--bc) / 0.12) 50%, oklch(var(--bc) / 0.06) 75%);
        background-size: 200% 100%;
        animation: shimmer 1.5s infinite;
    }
    .skel-line:nth-child(2n) {
        width: 60%;
    }
    .skel-line:nth-child(3n) {
        width: 45%;
    }
</style>
