<script>
    /**
     * CollectionStatusBanner — full-width banner showing collection/download status.
     * Placed between the hero card and content lists on detail pages.
     * Shows actionable buttons: "Get It" → Auto/Manual download split.
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
        // jellyfinId alone is sufficient proof the item is in the library,
        // even if collection_status was never updated from 'external'
        const inLibrary = !!jellyfinId || collectionStatus === 'collected';
        const hasFile = !!arrHasFile;

        // For shows: treat as "has files" if we have collected episodes in the library,
        // even if arr_has_file is 0 (Sonarr may report no files when specials are missing)
        const effectiveHasFile = hasFile || (mediaType === 'show' && inLibrary && collectedCount && collectedCount > 0);

        // Already in library with files → no banner
        if (inLibrary && effectiveHasFile) return null;
        if (collectionStatus === 'collected' && effectiveHasFile) return null;

        // For shows: if we have most episodes but some are missing, show partial status
        if (mediaType === 'show' && collectedCount && collectedCount > 0 && missingCount && missingCount > 0) {
            return 'partial_missing';
        }

        // Not yet released
        const now = new Date();
        if (premiereDate) {
            const release = new Date(premiereDate);
            if (release > now) return 'not_released';
        } else if (releaseYear && releaseYear > now.getFullYear()) {
            return 'not_released';
        }

        // Not tracked at all (external, no *arr)
        if (collectionStatus === 'external' && !arrId) return 'not_tracked';

        // Wanted (in *arr or marked wanted, no file)
        if (collectionStatus === 'wanted' && !effectiveHasFile) return 'wanted';

        // In *arr but no file
        if (arrId && !effectiveHasFile) {
            if (arrMonitored) return 'searching';
            return 'missing';
        }

        // Has *arr file but not in Jellyfin yet
        if (arrId && effectiveHasFile && !jellyfinId) return null; // will appear after sync

        // External with no *arr
        if (collectionStatus === 'external') return 'not_tracked';

        // Fallback: collected but missing file somehow
        if (!effectiveHasFile && !jellyfinId) return 'not_tracked';

        return null;
    }

    const STATUS_CONFIG = {
        not_released: {
            icon: '📅',
            label: 'Not Yet Released',
            description: 'This title hasn\'t been released yet.',
            color: 'border-info/30 bg-info/5',
            textColor: 'text-info',
            showActions: false,
        },
        not_tracked: {
            icon: '❔',
            label: 'Not in Library',
            description: 'This hasn\'t been added to your collection yet.',
            color: 'border-warning/30 bg-warning/5',
            textColor: 'text-warning',
            showActions: true,
        },
        wanted: {
            icon: '📡',
            label: 'Wanted',
            description: 'Added to your wanted list but not yet downloaded.',
            color: 'border-info/30 bg-info/5',
            textColor: 'text-info',
            showActions: true,
        },
        searching: {
            icon: '🔍',
            label: 'Searching',
            description: '', // dynamically set with title below
            color: 'border-info/30 bg-info/5',
            textColor: 'text-info',
            showActions: true,
        },
        missing: {
            icon: '⚠️',
            label: 'Missing File',
            description: 'In your *arr but the file is missing.',
            color: 'border-error/30 bg-error/5',
            textColor: 'text-error',
            showActions: true,
        },
        partial_missing: {
            icon: '⚠️',
            label: 'Some Files Missing',
            description: '', // dynamically set below
            color: 'border-warning/30 bg-warning/5',
            textColor: 'text-warning',
            showActions: true,
        },
    };

    let status = $derived(deriveStatus());
    let config = $derived(status ? /** @type {Record<string, any>} */ (STATUS_CONFIG)[status] : null);

    // ── Button state machine ───────────────────────────────────
    let expanded = $state(false);
    let autoSearching = $state(false);
    let autoSearchResult = $state(/** @type {'idle'|'success'|'error'} */ ('idle'));

    /** @type {any} */
    let searchDialog = $state(null);

    function handleGetIt() {
        expanded = true;
    }

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
        // After adding to *arr, show the expanded download buttons
        expanded = true;
    }

    let serviceLabel = $derived(service === 'radarr' ? 'Radarr' : service === 'sonarr' ? 'Sonarr' : 'Lidarr');
</script>

{#if status && config}
    <div class="collection-status-banner {config.color}">
        <div class="banner-content">
            <div class="banner-info">
                <span class="banner-icon">{config.icon}</span>
                <div class="banner-text">
                    <span class="banner-label {config.textColor}">{config.label}</span>
                    <span class="banner-desc">
                        {#if status === 'searching'}
                            Searching for {title}.
                        {:else if status === 'partial_missing' && missingCount}
                            {missingCount} episode{missingCount === 1 ? ' is' : 's are'} missing from your library.
                        {:else}
                            {config.description}
                        {/if}
                    </span>
                </div>
            </div>

            {#if config.showActions}
                <div class="banner-actions">
                    {#if !arrId && tmdbId}
                        <!-- Not in *arr yet: show Add dialog -->
                        <ArrAddDialog {service} {mediaParentId} onComplete={onArrAdded} />
                    {:else if arrId && !expanded}
                        <!-- In *arr but no file: show "Get It" -->
                        <button class="btn btn-sm btn-primary gap-1" onclick={handleGetIt}>
                            ↓ Get It
                        </button>
                    {:else if arrId && expanded}
                        <!-- Expanded: Auto + Manual -->
                        <div class="flex gap-2">
                            <button
                                class="btn btn-sm btn-primary gap-1"
                                class:btn-success={autoSearchResult === 'success'}
                                class:btn-error={autoSearchResult === 'error'}
                                onclick={handleAutoSearch}
                                disabled={autoSearching}
                            >
                                {#if autoSearching}
                                    <span class="loading loading-spinner loading-xs"></span>
                                {:else if autoSearchResult === 'success'}
                                    ✅
                                {:else if autoSearchResult === 'error'}
                                    ❌
                                {:else}
                                    ⚡
                                {/if}
                                Re-Search
                            </button>
                            <button
                                class="btn btn-sm btn-ghost gap-1"
                                onclick={handleManualSearch}
                            >
                                🔎 Manual Search
                            </button>
                        </div>
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

        {#if status === 'not_released' && premiereDate}
            <div class="banner-release-date">
                Releases {new Date(premiereDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
            </div>
        {/if}
    </div>
{/if}

<style>
    .collection-status-banner {
        border: 1px solid;
        border-radius: 0.75rem;
        padding: 0.75rem 1rem;
        margin-top: 0.5rem;
    }

    .banner-content {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 1rem;
        flex-wrap: wrap;
    }

    .banner-info {
        display: flex;
        align-items: center;
        gap: 0.625rem;
        min-width: 0;
    }

    .banner-icon {
        font-size: 1.25rem;
        flex-shrink: 0;
    }

    .banner-text {
        display: flex;
        flex-direction: column;
        gap: 0.125rem;
        min-width: 0;
    }

    .banner-label {
        font-weight: 700;
        font-size: 0.875rem;
        line-height: 1.2;
    }

    .banner-desc {
        font-size: 0.75rem;
        color: oklch(var(--bc) / 0.5);
        line-height: 1.3;
    }

    .banner-actions {
        flex-shrink: 0;
    }

    .banner-release-date {
        font-size: 0.7rem;
        color: oklch(var(--bc) / 0.4);
        margin-top: 0.375rem;
        padding-top: 0.375rem;
        border-top: 1px solid oklch(var(--bc) / 0.08);
    }
</style>
