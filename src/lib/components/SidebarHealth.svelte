<script>
    import { onMount } from 'svelte';
    import { jellyfinAuthInvalid } from '$lib/stores/auth.js';
    import MdiIcon from '$lib/components/MdiIcon.svelte';
    import { mdiServerNetwork } from '@mdi/js';

    const SERVICES = [
        { key: 'sonarr', name: 'Sonarr', color: '0.65 0.17 250' },
        { key: 'radarr', name: 'Radarr', color: '0.72 0.18 40' },
        { key: 'lidarr', name: 'Lidarr', color: '0.70 0.17 145' },
    ];

    let arrData = $state(null);

    async function refresh() {
        try {
            const res = await fetch('/api/arr/wanted');
            if (res.ok) arrData = await res.json();
        } catch { /* silent */ }
    }

    onMount(() => {
        refresh();
        const timer = setInterval(refresh, 60_000);
        return () => clearInterval(timer);
    });

    let services = $derived.by(() => {
        if (!arrData?.summary?.byService) return [];
        return SERVICES
            .filter(svc => (arrData.summary.byService[svc.key] ?? -1) >= 0 ||
                           (arrData.items || []).some(i => i.service === svc.key))
            .map(svc => {
                const items = arrData.items || [];
                const hasFailed = items.some(i => i.service === svc.key && i.reason === 'failed');
                const failedCount = items.filter(i => i.service === svc.key && i.reason === 'failed').length;
                const queueCount = items.filter(i => i.service === svc.key && i.reason === 'in_queue').length;
                let status = 'ok';
                let label = 'Healthy';
                if (hasFailed) {
                    status = 'warning';
                    label = `${failedCount} failed download${failedCount !== 1 ? 's' : ''}`;
                } else if (queueCount > 0) {
                    label = 'Downloading';
                }
                return { ...svc, status, label };
            });
    });

    let jellyfinOk = $derived(!$jellyfinAuthInvalid);
</script>

<div class="sh-wrap">
    <div class="sh-header">
        <MdiIcon icon={mdiServerNetwork} size={12} />
        <span>Services</span>
    </div>

    <!-- Jellyfin -->
    <div class="sh-row">
        <span class="sh-dot" class:dot-ok={jellyfinOk} class:dot-err={!jellyfinOk}></span>
        <span class="sh-name">Jellyfin</span>
        <span class="sh-detail">{jellyfinOk ? 'Healthy' : 'Auth Error'}</span>
    </div>

    <!-- Arr services -->
    {#each services as svc}
        <div class="sh-row">
            <span class="sh-dot" class:dot-ok={svc.status === 'ok'} class:dot-warn={svc.status === 'warning'}></span>
            <span class="sh-name" style="color: oklch({svc.color} / 0.5)">{svc.name}</span>
            <span class="sh-detail" class:sh-warn={svc.status === 'warning'}>{svc.label}</span>
        </div>
    {/each}

    {#if services.length === 0 && arrData !== null}
        <div class="sh-row sh-empty">
            <span class="sh-detail">No arr services</span>
        </div>
    {/if}
</div>

<style>
    .sh-wrap {
        display: flex;
        flex-direction: column;
        gap: 0.2rem;
        padding: 0.4rem 0.6rem;
    }
    .sh-header {
        display: flex;
        align-items: center;
        gap: 0.3rem;
        font-size: 0.6rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: oklch(0.60 0 0);
        margin-bottom: 0.15rem;
    }
    .sh-row {
        display: flex;
        align-items: center;
        gap: 0.35rem;
        font-size: 0.7rem;
        line-height: 1.1;
    }
    .sh-dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        flex-shrink: 0;
        background: oklch(var(--bc) / 0.2);
    }
    .sh-dot.dot-ok {
        background: oklch(0.72 0.19 145 / 0.6);
    }
    .sh-dot.dot-warn {
        background: oklch(0.80 0.18 80 / 0.7);
    }
    .sh-dot.dot-err {
        background: oklch(0.65 0.2 25 / 0.7);
    }
    .sh-name {
        font-weight: 500;
        color: oklch(0.65 0 0);
        white-space: nowrap;
    }
    .sh-detail {
        font-size: 0.6rem;
        color: oklch(0.60 0 0);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    .sh-detail.sh-warn {
        color: oklch(0.80 0.18 80 / 0.6);
    }
    .sh-empty {
        justify-content: center;
    }
</style>
