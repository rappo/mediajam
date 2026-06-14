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
            icon: 'calendar-blank',
            label: 'Not Yet Released',
            description: 'This title hasn\'t been released yet.',
            color: 'border-info/30 bg-info/5',
            textColor: 'text-info',
            showActions: false,
        },
        not_tracked: {
            icon: 'help-circle-outline',
            label: 'Not in Library',
            description: 'This hasn\'t been added to your collection yet.',
            color: 'border-warning/30 bg-warning/5',
            textColor: 'text-warning',
            showActions: true,
        },
        wanted: {
            icon: 'list-status',
            label: 'Wanted',
            description: 'Added to your wanted list but not yet downloaded.',
            color: 'border-info/30 bg-info/5',
            textColor: 'text-info',
            showActions: true,
        },
        searching: {
            icon: 'radar',
            label: 'Searching',
            description: '',
            color: 'border-info/30 bg-info/5',
            textColor: 'text-info',
            showActions: true,
        },
        missing: {
            icon: 'alert-outline',
            label: 'Missing File',
            description: 'In your *arr but the file is missing.',
            color: 'border-error/30 bg-error/5',
            textColor: 'text-error',
            showActions: true,
        },
        partial_missing: {
            icon: 'alert-outline',
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
            <svg class="banner-icon {config.textColor}" viewBox="0 0 24 24">
                <path fill="currentColor" d={MDI_PATHS[config.icon]} />
            </svg>
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
                            <svg class="banner-btn-icon" viewBox="0 0 24 24"><path fill="currentColor" d={MDI_PATHS['check-circle-outline']} /></svg>
                        {:else if autoSearchResult === 'error'}
                            <svg class="banner-btn-icon" viewBox="0 0 24 24"><path fill="currentColor" d={MDI_PATHS['alert-circle-outline']} /></svg>
                        {:else}
                            <svg class="banner-btn-icon" viewBox="0 0 24 24"><path fill="currentColor" d={MDI_PATHS['radar']} /></svg>
                        {/if}
                        Auto Search
                    </button>
                    <button
                        class="banner-btn banner-btn-ghost"
                        onclick={handleManualSearch}
                    >
                        <svg class="banner-btn-icon" viewBox="0 0 24 24"><path fill="currentColor" d={MDI_PATHS['magnify']} /></svg>
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

<script module>
    /** MDI icon paths (monochrome) */
    const MDI_PATHS = {
        'calendar-blank': 'M19,19H5V8H19M16,1V3H8V1H6V3H5C3.89,3 3,3.89 3,5V19A2,2 0 0,0 5,21H19A2,2 0 0,0 21,19V5C21,3.89 20.1,3 19,3H18V1',
        'help-circle-outline': 'M11,18H13V16H11V18M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M12,20A8,8 0 0,1 4,12A8,8 0 0,1 12,4A8,8 0 0,1 20,12A8,8 0 0,1 12,20M12,6A4,4 0 0,0 8,10H10A2,2 0 0,1 12,8A2,2 0 0,1 14,10C14,12 11,11.75 11,15H13C13,12.75 16,12.5 16,10A4,4 0 0,0 12,6Z',
        'list-status': 'M16.5,11L13,14.5L9.5,11L8,12.5L13,17.5L18,12.5L16.5,11M5,3H19A2,2 0 0,1 21,5V19A2,2 0 0,1 19,21H5A2,2 0 0,1 3,19V5A2,2 0 0,1 5,3M7.5,7A1.5,1.5 0 0,0 6,8.5A1.5,1.5 0 0,0 7.5,10A1.5,1.5 0 0,0 9,8.5A1.5,1.5 0 0,0 7.5,7M11,7V10H18V7H11Z',
        'radar': 'M19.07,4.93L17.66,6.34C19.1,7.79 20,9.79 20,12A8,8 0 0,1 12,20A8,8 0 0,1 4,12C4,7.92 7.05,4.56 11,4.07V6.09C8.16,6.57 6,9.03 6,12A6,6 0 0,0 12,18A6,6 0 0,0 18,12C18,10.34 17.33,8.84 16.24,7.76L14.83,9.17C15.55,9.9 16,10.9 16,12A4,4 0 0,1 12,16A4,4 0 0,1 8,12C8,9.79 9.79,8 12,8V10A2,2 0 0,0 10,12A2,2 0 0,0 12,14A2,2 0 0,0 14,12C14,11.45 13.78,10.94 13.41,10.59L12,12V4A8,8 0 0,1 20,12H22C22,9.24 20.88,6.74 19.07,4.93Z',
        'magnify': 'M9.5,3A6.5,6.5 0 0,1 16,9.5C16,11.11 15.41,12.59 14.44,13.73L14.71,14H15.5L20.5,19L19,20.5L14,15.5V14.71L13.73,14.44C12.59,15.41 11.11,16 9.5,16A6.5,6.5 0 0,1 3,9.5A6.5,6.5 0 0,1 9.5,3M9.5,5C7,5 5,7 5,9.5C5,12 7,14 9.5,14C12,14 14,12 14,9.5C14,7 12,5 9.5,5Z',
        'alert-outline': 'M12,2L1,21H23M12,6L19.53,19H4.47M11,10V14H13V10M11,16V18H13V16',
        'check-circle-outline': 'M12,2A10,10 0 0,1 22,12A10,10 0 0,1 12,22A10,10 0 0,1 2,12A10,10 0 0,1 12,2M12,4A8,8 0 0,0 4,12A8,8 0 0,0 12,20A8,8 0 0,0 20,12A8,8 0 0,0 12,4M11,16.5L6.5,12L7.91,10.59L11,13.67L16.59,8.09L18,9.5L11,16.5Z',
        'alert-circle-outline': 'M11,15H13V17H11V15M11,7H13V13H11V7M12,2C6.47,2 2,6.5 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M12,20A8,8 0 0,1 4,12A8,8 0 0,1 12,4A8,8 0 0,1 20,12A8,8 0 0,1 12,20Z',
    };
</script>

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
