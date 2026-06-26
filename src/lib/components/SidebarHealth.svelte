<script>
    import { onMount } from 'svelte';
    import { jellyfinAuthInvalid } from '$lib/stores/auth.js';
    import { playerStatus, startPolling, launchJellyfin } from '$lib/stores/player.js';
    import MdiIcon from '$lib/components/MdiIcon.svelte';
    import ServiceIcon from '$lib/components/ServiceIcon.svelte';
    import { mdiServerNetwork, mdiPlay, mdiTelevision, mdiRocketLaunch } from '@mdi/js';

    const SERVICES = [
        { key: 'sonarr', name: 'Sonarr', color: '0.65 0.17 250' },
        { key: 'radarr', name: 'Radarr', color: '0.72 0.18 40' },
        { key: 'lidarr', name: 'Lidarr', color: '0.70 0.17 145' },
    ];

    let arrData = $state(null);
    /** @type {Record<string, string|null>} */
    let serviceUrls = $state({});

    async function refresh() {
        try {
            const res = await fetch('/api/arr/wanted');
            if (res.ok) arrData = await res.json();
        } catch { /* silent */ }
    }

    async function loadUrls() {
        try {
            const res = await fetch('/api/service-urls');
            if (res.ok) serviceUrls = await res.json();
        } catch { /* silent */ }
    }

    onMount(() => {
        refresh();
        loadUrls();
        const timer = setInterval(refresh, 60_000);
        const stopPlayerPolling = startPolling();
        return () => {
            clearInterval(timer);
            stopPlayerPolling();
        };
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
                return { ...svc, status, label, url: serviceUrls[svc.key] || null };
            });
    });

    let jellyfinOk = $derived(!$jellyfinAuthInvalid);
    let jellyfinUrl = $derived(serviceUrls.jellyfin || null);

    // Player status
    let ps = $derived($playerStatus);
    let playerStatusLabel = $derived.by(() => {
        if (!ps) return '';
        switch (ps.status) {
            case 'playing': {
                const np = ps.nowPlaying;
                if (np?.seriesName) return `${np.seriesName}`;
                if (np?.name) return np.name;
                return 'Playing';
            }
            case 'idle': return 'Idle';
            case 'online': return 'Online';
            case 'busy': return ps.currentApp || 'Busy';
            case 'offline': return 'Offline';
            default: return '';
        }
    });

    let launchingJellyfin = $state(false);
    async function handleLaunchJellyfin() {
        launchingJellyfin = true;
        await launchJellyfin();
        launchingJellyfin = false;
    }
</script>

<div class="sh-wrap">
    <div class="sh-header">
        <MdiIcon icon={mdiServerNetwork} size={12} />
        <span>Services</span>
    </div>

    <!-- Jellyfin -->
    <div class="sh-row">
        <span class="sh-dot" class:dot-ok={jellyfinOk} class:dot-err={!jellyfinOk}></span>
        <ServiceIcon service="jellyfin" size="w-3.5 h-3.5" />
        {#if jellyfinUrl}
            <a href={jellyfinUrl} target="_blank" rel="noopener noreferrer" class="sh-name sh-link">Jellyfin</a>
        {:else}
            <span class="sh-name">Jellyfin</span>
        {/if}
        <span class="sh-detail">{jellyfinOk ? 'Healthy' : 'Auth Error'}</span>
    </div>

    <!-- Arr services -->
    {#each services as svc}
        <div class="sh-row">
            <span class="sh-dot" class:dot-ok={svc.status === 'ok'} class:dot-warn={svc.status === 'warning'}></span>
            <ServiceIcon service={svc.key} size="w-3.5 h-3.5" />
            {#if svc.url}
                <a href={svc.url} target="_blank" rel="noopener noreferrer" class="sh-name sh-link" style="color: oklch({svc.color} / 0.5)">{svc.name}</a>
            {:else}
                <span class="sh-name" style="color: oklch({svc.color} / 0.5)">{svc.name}</span>
            {/if}
            <span class="sh-detail" class:sh-warn={svc.status === 'warning'}>{svc.label}</span>
        </div>
    {/each}

    {#if services.length === 0 && arrData !== null}
        <div class="sh-row sh-empty">
            <span class="sh-detail">No arr services</span>
        </div>
    {/if}

    {#if ps}
        <div class="sh-divider"></div>
        <div class="sh-header">
            <MdiIcon icon={mdiTelevision} size={12} />
            <span>Player</span>
        </div>
        <div class="sh-row">
            <span
                class="sh-dot"
                class:dot-ok={ps.status === 'idle' || ps.status === 'online'}
                class:dot-playing={ps.status === 'playing'}
                class:dot-warn={ps.status === 'busy'}
                class:dot-err={ps.status === 'offline'}
            ></span>
            <a href="/settings/account" class="sh-name sh-link">{ps.deviceName || 'Player'}</a>
            <span class="sh-detail" class:sh-playing={ps.status === 'playing'}
                title={playerStatusLabel}>{playerStatusLabel}</span>
            {#if ps.canLaunch && (ps.status === 'online' || ps.status === 'idle')}
                <button
                    class="sh-launch-btn"
                    onclick={handleLaunchJellyfin}
                    disabled={launchingJellyfin}
                    title="Launch Jellyfin"
                >
                    <MdiIcon icon={mdiRocketLaunch} size={10} />
                </button>
            {/if}
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
    .sh-link {
        text-decoration: none;
        transition: opacity 0.15s;
    }
    .sh-link:hover {
        opacity: 0.8;
        text-decoration: underline;
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
    .sh-divider {
        height: 1px;
        background: oklch(var(--bc) / 0.08);
        margin: 0.2rem 0;
    }
    .sh-dot.dot-playing {
        background: oklch(0.60 0.17 250 / 0.7);
    }
    .sh-detail.sh-playing {
        color: oklch(0.65 0.12 250);
    }
    .sh-launch-btn {
        display: inline-flex; align-items: center; justify-content: center;
        width: 16px; height: 16px; border-radius: 50%;
        background: oklch(0.55 0.15 145 / 0.6);
        color: white; border: none;
        cursor: pointer; transition: all 0.15s;
        flex-shrink: 0; margin-left: auto;
    }
    .sh-launch-btn:hover:not(:disabled) {
        background: oklch(0.60 0.18 145);
        transform: scale(1.15);
    }
    .sh-launch-btn:disabled {
        opacity: 0.5;
        cursor: wait;
    }
</style>
