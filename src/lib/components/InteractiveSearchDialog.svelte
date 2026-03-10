<script>
    /**
     * InteractiveSearchDialog — triggers an interactive search via *arr API
     * and displays results in a table with download buttons.
     *
     * @component
     * @prop {string} service — 'radarr' | 'sonarr' | 'lidarr'
     * @prop {number} mediaParentId
     * @prop {string} title — media title for the dialog header
     */

    /** @type {{ service: string, mediaParentId: number, title: string }} */
    let { service, mediaParentId, title } = $props();

    let open = $state(false);
    let loading = $state(false);
    let error = $state('');
    let releases = $state(/** @type {any[]} */ ([]));
    let downloading = $state(/** @type {Record<string, boolean>} */ ({}));
    let downloadSuccess = $state(/** @type {Record<string, boolean>} */ ({}));

    export function show() {
        open = true;
        search();
    }

    async function search() {
        loading = true;
        error = '';
        releases = [];
        try {
            const res = await fetch(`/api/arr/${service}/releases?mediaParentId=${mediaParentId}`);
            const data = await res.json();
            if (!res.ok) {
                error = data.error || `HTTP ${res.status}`;
                if (data.timeout) error += '\n\nTip: Retry will try again with the same timeout. If your indexers are slow, try again later.';
            } else {
                releases = data.releases || [];
            }
        } catch (e) {
            error = e instanceof Error ? e.message : 'Network error';
        }
        loading = false;
    }

    /** @param {any} release */
    async function queueDownload(release) {
        const key = release.guid;
        downloading = { ...downloading, [key]: true };
        try {
            const res = await fetch(`/api/arr/${service}/releases`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    guid: release.guid,
                    indexerId: release.indexerId,
                    mediaParentId,
                }),
            });
            const data = await res.json();
            if (data.success) {
                downloadSuccess = { ...downloadSuccess, [key]: true };
            } else {
                alert(data.error || 'Failed to queue download');
            }
        } catch {
            alert('Network error');
        }
        downloading = { ...downloading, [key]: false };
    }

    function close() {
        open = false;
    }

    function formatSize(bytes) {
        if (!bytes) return '—';
        const gb = bytes / (1024 * 1024 * 1024);
        if (gb >= 1) return `${gb.toFixed(1)} GiB`;
        const mb = bytes / (1024 * 1024);
        return `${mb.toFixed(0)} MiB`;
    }

    function formatAge(days) {
        if (days == null) return '—';
        if (days === 0) return 'today';
        if (days === 1) return '1 day';
        if (days < 365) return `${days} days`;
        return `${Math.floor(days / 365)}y ${days % 365}d`;
    }
</script>

<button
    class="btn btn-xs btn-ghost gap-1"
    onclick={show}
    title="Search indexers for available releases"
>
    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
    Download Search
</button>

{#if open}
    <!-- Backdrop -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="fixed inset-0 bg-black/60 z-[200] flex items-center justify-center p-4" onclick={close}>
        <!-- Dialog -->
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
            class="bg-base-200 border border-base-300 rounded-2xl shadow-2xl w-full max-w-6xl max-h-[85vh] flex flex-col overflow-hidden"
            onclick={(e) => e.stopPropagation()}
        >
            <!-- Header -->
            <div class="flex items-center justify-between px-6 py-4 border-b border-base-300">
                <div>
                    <h2 class="font-bold text-lg">Interactive Search</h2>
                    <p class="text-sm text-base-content/50">{title}</p>
                </div>
                <div class="flex items-center gap-2">
                    {#if !loading}
                        <button class="btn btn-sm btn-ghost gap-1" onclick={search}>
                            🔄 Retry
                        </button>
                    {/if}
                    <button class="btn btn-sm btn-ghost btn-circle" onclick={close}>✕</button>
                </div>
            </div>

            <!-- Body -->
            <div class="flex-1 overflow-auto">
                {#if loading}
                    <div class="flex flex-col items-center justify-center py-16 gap-4">
                        <span class="loading loading-spinner loading-lg text-primary"></span>
                        <p class="text-sm text-base-content/50">Querying indexers… this can take 1–3 minutes</p>
                        <p class="text-xs text-base-content/30">Your indexers are being searched in real-time</p>
                    </div>
                {:else if error}
                    <div class="flex flex-col items-center justify-center py-16 gap-3">
                        <span class="text-4xl">⚠️</span>
                        <p class="text-sm text-error max-w-md text-center whitespace-pre-line">{error}</p>
                        <button class="btn btn-sm btn-primary gap-1" onclick={search}>
                            🔄 Retry Search
                        </button>
                    </div>
                {:else if releases.length === 0}
                    <div class="flex flex-col items-center justify-center py-16 gap-3">
                        <span class="text-4xl">🔍</span>
                        <p class="text-sm text-base-content/50">No releases found</p>
                    </div>
                {:else}
                    <table class="table table-xs w-full">
                        <thead class="sticky top-0 bg-base-200 z-10">
                            <tr class="text-xs text-base-content/50 uppercase">
                                <th class="w-10"></th>
                                <th class="w-10">Src</th>
                                <th class="w-20">Age</th>
                                <th>Title</th>
                                <th class="w-28">Indexer</th>
                                <th class="w-20 text-right">Size</th>
                                <th class="w-14 text-center">Peers</th>
                                <th class="w-20">Lang</th>
                                <th class="w-28">Quality</th>
                                <th class="w-16 text-right">Score</th>
                            </tr>
                        </thead>
                        <tbody>
                            {#each releases as release}
                                <tr class="hover:bg-base-300/30 transition-colors {release.rejected ? 'opacity-60' : ''}">
                                    <!-- Download button (first column for visibility) -->
                                    <td>
                                        {#if downloadSuccess[release.guid]}
                                            <span class="badge badge-sm badge-success gap-1">✓ Queued</span>
                                        {:else}
                                            <button
                                                class="btn btn-xs {release.rejected ? 'btn-outline btn-warning' : 'btn-primary'} gap-1"
                                                onclick={() => queueDownload(release)}
                                                disabled={downloading[release.guid]}
                                                title={release.rejected ? 'Download anyway (rejected by quality profile)' : 'Queue download'}
                                            >
                                                {#if downloading[release.guid]}
                                                    <span class="loading loading-spinner loading-xs"></span>
                                                {:else}
                                                    ⬇
                                                {/if}
                                            </button>
                                        {/if}
                                    </td>
                                    <!-- Source icon -->
                                    <td>
                                        {#if release.protocol === 'usenet'}
                                            <span class="badge badge-xs badge-info" title="Usenet">nzb</span>
                                        {:else}
                                            <span class="badge badge-xs badge-warning" title="Torrent">tor</span>
                                        {/if}
                                    </td>
                                    <!-- Age -->
                                    <td class="text-xs text-base-content/60">{formatAge(release.age)}</td>
                                    <!-- Title -->
                                    <td class="max-w-xs">
                                        <div class="truncate text-xs" title={release.title}>
                                            {#if release.infoUrl}
                                                <a href={release.infoUrl} target="_blank" rel="noopener" class="link link-primary">{release.title}</a>
                                            {:else}
                                                {release.title}
                                            {/if}
                                        </div>
                                        {#if release.rejected && release.rejections?.length}
                                            <div class="text-xs text-error/70 truncate" title={release.rejections.join(', ')}>
                                                ⛔ {release.rejections[0]}
                                            </div>
                                        {/if}
                                    </td>
                                    <!-- Indexer -->
                                    <td class="text-xs text-base-content/60">{release.indexer}</td>
                                    <!-- Size -->
                                    <td class="text-xs text-right">{formatSize(release.size)}</td>
                                    <!-- Peers -->
                                    <td class="text-center">
                                        {#if release.protocol === 'torrent'}
                                            <span class="text-xs">{release.seeders ?? '—'}</span>
                                        {:else}
                                            <span class="text-xs text-base-content/30">—</span>
                                        {/if}
                                    </td>
                                    <!-- Languages -->
                                    <td>
                                        {#each (release.languages || []).slice(0, 2) as lang}
                                            <span class="badge badge-xs badge-ghost">{lang}</span>
                                        {/each}
                                    </td>
                                    <!-- Quality -->
                                    <td>
                                        <span class="badge badge-xs {release.quality?.includes('2160') ? 'badge-primary' : release.quality?.includes('1080') ? 'badge-info' : 'badge-ghost'}">
                                            {release.quality}
                                        </span>
                                        {#if release.customFormats?.length}
                                            <div class="flex flex-wrap gap-0.5 mt-0.5">
                                                {#each release.customFormats.slice(0, 3) as cf}
                                                    <span class="badge badge-xs badge-outline text-[9px]">{cf}</span>
                                                {/each}
                                            </div>
                                        {/if}
                                    </td>
                                    <!-- Score -->
                                    <td class="text-right">
                                        <span class="text-xs font-mono {release.customFormatScore > 0 ? 'text-success' : release.customFormatScore < 0 ? 'text-error' : 'text-base-content/40'}">
                                            {release.customFormatScore > 0 ? '+' : ''}{release.customFormatScore}
                                        </span>
                                    </td>
                                </tr>
                            {/each}
                        </tbody>
                    </table>
                {/if}
            </div>

            <!-- Footer -->
            {#if releases.length > 0}
                <div class="px-6 py-3 border-t border-base-300 flex items-center justify-between text-xs text-base-content/40">
                    <span>{releases.length} releases found · {releases.filter(r => !r.rejected).length} accepted</span>
                    <button class="btn btn-ghost btn-xs" onclick={close}>Close</button>
                </div>
            {/if}
        </div>
    </div>
{/if}
