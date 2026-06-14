<!--
  ProgressCard — show/artist card with progress bar.
  Usage: <ProgressCard title="South Park" watched={32} total={331} posterUrl="..." link="/tv/123" reason="..." />
-->
<script>
    import MdiIcon from '$lib/components/MdiIcon.svelte';
    import { mdiFolder } from '@mdi/js';
    /** @type {{ title: string, watched: number, total: number, posterUrl?: string|null, link?: string|null, reason?: string|null }} */
    let { title, watched, total, posterUrl = null, link = null, reason = null } = $props();

    const pct = total > 0 ? Math.round((watched / total) * 100) : 0;
</script>

{#if link}
    <a href={link} class="progress-card" title="{title}: {watched}/{total} ({pct}%)">
        {#if posterUrl}
            <img src={posterUrl} alt="" class="card-poster" loading="lazy" />
        {:else}
            <div class="card-poster placeholder"><MdiIcon icon={mdiFolder} size={20} /></div>
        {/if}
        <div class="card-body">
            <span class="card-title">{title}</span>
            <div class="progress-row">
                <div class="progress-bar">
                    <div class="progress-fill" style="width: {pct}%"></div>
                </div>
                <span class="progress-label">{pct}%</span>
            </div>
            <span class="progress-detail">{watched} / {total}</span>
            {#if reason}
                <span class="card-reason">{reason}</span>
            {/if}
        </div>
    </a>
{:else}
    <div class="progress-card">
        {#if posterUrl}
            <img src={posterUrl} alt="" class="card-poster" loading="lazy" />
        {:else}
            <div class="card-poster placeholder"><MdiIcon icon={mdiFolder} size={20} /></div>
        {/if}
        <div class="card-body">
            <span class="card-title">{title}</span>
            <div class="progress-row">
                <div class="progress-bar">
                    <div class="progress-fill" style="width: {pct}%"></div>
                </div>
                <span class="progress-label">{pct}%</span>
            </div>
            <span class="progress-detail">{watched} / {total}</span>
            {#if reason}
                <span class="card-reason">{reason}</span>
            {/if}
        </div>
    </div>
{/if}

<style>
    .progress-card {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px;
        border-radius: 10px;
        background: oklch(var(--b2) / 0.5);
        text-decoration: none;
        color: inherit;
        transition: background 0.15s, transform 0.1s;
    }

    a.progress-card:hover {
        background: oklch(var(--bc) / 0.06);
        transform: translateY(-1px);
    }

    .card-poster {
        width: 44px;
        height: 64px;
        border-radius: 6px;
        object-fit: cover;
        flex-shrink: 0;
    }

    .card-poster.placeholder {
        display: flex;
        align-items: center;
        justify-content: center;
        background: oklch(var(--b3));
        font-size: 1.2rem;
    }

    .card-body {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 3px;
    }

    .card-title {
        font-size: 0.8rem;
        font-weight: 600;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .progress-row {
        display: flex;
        align-items: center;
        gap: 6px;
    }

    .progress-bar {
        flex: 1;
        height: 5px;
        border-radius: 3px;
        background: oklch(var(--bc) / 0.1);
        overflow: hidden;
    }

    .progress-fill {
        height: 100%;
        border-radius: 3px;
        background: oklch(var(--p) / 0.7);
        transition: width 0.3s ease;
    }

    .progress-label {
        font-size: 0.6rem;
        color: oklch(var(--bc) / 0.5);
        font-weight: 600;
        width: 30px;
        text-align: right;
        flex-shrink: 0;
    }

    .progress-detail {
        font-size: 0.6rem;
        color: oklch(var(--bc) / 0.35);
    }

    .card-reason {
        font-size: 0.6rem;
        color: oklch(var(--bc) / 0.4);
        font-style: italic;
    }
</style>
