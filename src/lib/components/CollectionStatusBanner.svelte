<script>
    /**
     * CollectionStatusBanner — thin bar showing collection/download status.
     * Placed between the hero card and content lists on detail pages.
     * Shows actionable buttons: Auto Search + Manual Search directly.
     *
     * @component
     */
    import ArrAddDialog from '$lib/components/ArrAddDialog.svelte';
    import InteractiveSearchDialog from '$lib/components/InteractiveSearchDialog.svelte';
    import MdiIcon from '$lib/components/MdiIcon.svelte';
    import { mdiCalendarBlank, mdiHelpCircleOutline, mdiListStatus, mdiRadar, mdiMagnify, mdiAlertOutline, mdiCheckCircleOutline, mdiAlertCircleOutline } from '@mdi/js';
    import { invalidateAll } from '$app/navigation';

    /**
     * @type {{
     *   mediaParentId: number,
     *   mediaType: 'movie' | 'show' | 'artist',
     *   title: string,
     *   collectionStatus: string,
     *   arrHasFile: number | boolean,
     *   arrId: number | null,
     *   arrMonitored: number | boolean,
     *   releaseYear: number | null,
     *   premiereDate: string | null,
     *   service: 'radarr' | 'sonarr' | 'lidarr',
     *   jellyfinId: string | null,
     *   tmdbId: number | null,
     *   collectedCount?: number | null,
     *   missingCount?: number | null,
     *   onStatusChange?: () => void,
     * }}
     */
    let {
        mediaParentId,
        mediaType,
        title = '',
        collectionStatus = 'collected',
        arrHasFile = 0,
        arrId = null,
        arrMonitored = 0,
        releaseYear = null,
        premiereDate = null,
        service = 'radarr',
        jellyfinId = null,
        tmdbId = null,
        collectedCount = null,
        missingCount = null,
        onStatusChange,
    } = $props();

    // ── Status derivation ──────────────────────────────────────
    function deriveStatus() {
        const inLibrary = !!jellyfinId || collectionStatus === 'collected';
        const hasFile = !!arrHasFile;
        const effectiveHasFile = hasFile || (mediaType === 'show' && inLibrary && collectedCount && collectedCount > 0);

        if (inLibrary && effectiveHasFile) return null;
        if (collectionStatus === 'collected' && effectiveHasFile) return null;

        if (mediaType === 'show' && collectedCount && collectedCount > 0 && missingCount && missingCount > 0) {
            return 'partial_missing';
        }

        const now = new Date();
        if (premiereDate) {
            const release = new Date(premiereDate);
            if (release > now) return 'not_released';
        } else if (releaseYear && releaseYear > now.getFullYear()) {
            return 'not_released';
        }

        if (collectionStatus === 'external' && !arrId) return 'not_tracked';
        if (collectionStatus === 'wanted' && !effectiveHasFile) return 'wanted';

        if (arrId && !effectiveHasFile) {
            if (arrMonitored) return 'searching';
            return 'missing';
        }

        if (arrId && effectiveHasFile && !jellyfinId) return null;
        if (collectionStatus === 'external') return 'not_tracked';
        if (!effectiveHasFile && !jellyfinId) return 'not_tracked';

        return null;
    }

    const STATUS_CONFIG = {
        not_released: {
            icon: mdiCalendarBlank,
            label: 'Not Yet Released',
            description: 'This title hasn\'t been released yet.',
            color: 'border-info/30 bg-info/5',
            textColor: 'text-info',
            showActions: false,
        },
        not_tracked: {
            icon: mdiHelpCircleOutline,
            label: 'Not in Library',
            description: 'This hasn\'t been added to your collection yet.',
            color: 'border-warning/30 bg-warning/5',
            textColor: 'text-warning',
            showActions: true,
        },
        wanted: {
            icon: mdiListStatus,
            label: 'Wanted',
            description: 'Added to your wanted list but not yet downloaded.',
            color: 'border-info/30 bg-info/5',
            textColor: 'text-info',
            showActions: true,
        },
        searching: {
            icon: mdiRadar,
            label: 'Searching',
            description: '',
            color: 'border-info/30 bg-info/5',
            textColor: 'text-info',
            showActions: true,
        },
        missing: {
            icon: mdiAlertOutline,
            label: 'Missing File',
            description: 'In your *arr but the file is missing.',
            color: 'border-error/30 bg-error/5',
            textColor: 'text-error',
            showActions: true,
        },
        partial_missing: {
            icon: mdiAlertOutline,
            label: 'Some Files Missing',
            description: '',
            color: 'border-warning/30 bg-warning/5',
            textColor: 'text-warning',
            showActions: true,
        },
    };

    let status = $derived(deriveStatus());
    let config = $derived(status ? /** @type {Record<string, any>} */ (STATUS_CONFIG)[status] : null);

    // ── Button state ──────────────────────────────────────────
    let autoSearching = $state(false);
    let autoSearchResult = $state(/** @type {'idle'|'success'|'error'} */ ('idle'));

    /** @type {any} */
    let searchDialog = $state(null);

    async function handleAutoSearch() {
        autoSearching = true;
        autoSearchResult = 'idle';
        try {
            const res = await fetch(`/api/arr/${service}/search`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mediaParentId }),
            });
            if (!res.ok) {
                const r = await res.json();
                throw new Error(r.error || 'Search failed');
            }
            autoSearchResult = 'success';
            onStatusChange?.();
            setTimeout(() => { autoSearchResult = 'idle'; }, 3000);
        } catch (e) {
            console.error('[banner] Auto search failed:', e);
            autoSearchResult = 'error';
            setTimeout(() => { autoSearchResult = 'idle'; }, 5000);
        }
        autoSearching = false;
    }

    function handleManualSearch() {
        searchDialog?.show?.();
    }

    async function onArrAdded() {
        await invalidateAll();
        onStatusChange?.();
    }

    let serviceLabel = $derived(service === 'radarr' ? 'Radarr' : service === 'sonarr' ? 'Sonarr' : 'Lidarr');
</script>

{#if status && config}
    <div class="collection-status-banner {config.color}">
        <div class="banner-info">
            <MdiIcon icon={config.icon} size={16} class="{config.textColor}" />
            <span class="banner-label {config.textColor}">{config.label}</span>
            <span class="banner-desc">
                {#if status === 'searching'}
                    Searching for {title}.
                {:else if status === 'partial_missing' && missingCount}
                    {missingCount} episode{missingCount === 1 ? '' : 's'} missing
                {:else if status === 'not_released' && premiereDate}
                    {new Date(premiereDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                {:else}
                    {config.description}
                {/if}
            </span>
        </div>

        {#if config.showActions}
            <div class="banner-actions">
                {#if !arrId && tmdbId}
                    <ArrAddDialog {service} {mediaParentId} onComplete={onArrAdded} />
                {:else if arrId}
                    <button
                        class="banner-btn banner-btn-primary"
                        class:banner-btn-success={autoSearchResult === 'success'}
                        class:banner-btn-error={autoSearchResult === 'error'}
                        onclick={handleAutoSearch}
                        disabled={autoSearching}
                    >
                        {#if autoSearching}
                            <span class="loading loading-spinner loading-xs"></span>
                        {:else if autoSearchResult === 'success'}
                            <MdiIcon icon={mdiCheckCircleOutline} size={13} />
                        {:else if autoSearchResult === 'error'}
                            <MdiIcon icon={mdiAlertCircleOutline} size={13} />
                        {:else}
                            <MdiIcon icon={mdiRadar} size={13} />
                        {/if}
                        Auto Search
                    </button>
                    <button
                        class="banner-btn banner-btn-ghost"
                        onclick={handleManualSearch}
                    >
                        <MdiIcon icon={mdiMagnify} size={13} />
                        Manual Search
                    </button>
                    <InteractiveSearchDialog
                        {service}
                        {mediaParentId}
                        title="{title} ({releaseYear || ''})"
                        bind:this={searchDialog}
                    />
                {/if}
            </div>
        {/if}
    </div>
{/if}



<style>
    .collection-status-banner {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.75rem;
        flex-wrap: wrap;
        border: 1px solid;
        border-radius: 0.6rem;
        padding: 0.4rem 0.75rem;
        margin-top: 0.5rem;
        background: oklch(var(--b1) / 0.65);
        backdrop-filter: blur(16px) brightness(0.85);
        -webkit-backdrop-filter: blur(16px) brightness(0.85);
    }

    .banner-info {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        min-width: 0;
    }

    .banner-icon {
        width: 16px;
        height: 16px;
        flex-shrink: 0;
    }

    .banner-label {
        font-weight: 700;
        font-size: 0.8rem;
        white-space: nowrap;
    }

    .banner-desc {
        font-size: 0.7rem;
        color: oklch(var(--bc) / 0.45);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .banner-actions {
        display: flex;
        align-items: center;
        gap: 0.35rem;
        flex-shrink: 0;
    }

    .banner-btn {
        display: inline-flex;
        align-items: center;
        gap: 0.3rem;
        padding: 0.2rem 0.6rem;
        border-radius: 0.4rem;
        font-size: 0.7rem;
        font-weight: 600;
        border: none;
        cursor: pointer;
        transition: all 0.15s;
        white-space: nowrap;
    }

    .banner-btn-primary {
        background: oklch(var(--p));
        color: oklch(var(--pc));
    }
    .banner-btn-primary:hover {
        background: oklch(var(--p) / 0.85);
    }
    .banner-btn-primary:disabled {
        opacity: 0.6;
        cursor: not-allowed;
    }

    .banner-btn-success {
        background: oklch(var(--su)) !important;
        color: oklch(var(--suc)) !important;
    }
    .banner-btn-error {
        background: oklch(var(--er)) !important;
        color: oklch(var(--erc)) !important;
    }

    .banner-btn-ghost {
        background: oklch(var(--bc) / 0.08);
        color: oklch(var(--bc) / 0.7);
    }
    .banner-btn-ghost:hover {
        background: oklch(var(--bc) / 0.15);
        color: oklch(var(--bc) / 0.9);
    }

    .banner-btn-icon {
        width: 13px;
        height: 13px;
        flex-shrink: 0;
    }
</style>
