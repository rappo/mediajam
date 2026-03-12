<script>
    /**
     * InteractiveSearchDialog — triggers an interactive search via *arr API
     * and displays results in a full-screen native dialog with download buttons.
     *
     * @component
     * @prop {string} service — 'radarr' | 'sonarr' | 'lidarr'
     * @prop {number} mediaParentId
     * @prop {string} title — media title for the dialog header
     */

    /** @type {{ service: string, mediaParentId: number, title: string }} */
    let { service, mediaParentId, title } = $props();

    let loading = $state(false);
    let error = $state('');
    let releases = $state(/** @type {any[]} */ ([]));
    let downloading = $state(/** @type {Record<string, boolean>} */ ({}));
    let downloadSuccess = $state(/** @type {Record<string, boolean>} */ ({}));
    /** @type {HTMLDialogElement|null} */
    let dialogEl = $state(null);

    export function show() {
        dialogEl?.showModal();
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
        dialogEl?.close();
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
        if (days < 365) return `${days}d`;
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

<!-- Native <dialog> renders in the top-layer, immune to parent overflow:hidden -->
<dialog
    bind:this={dialogEl}
    class="modal-dialog"
    onclick={(e) => { if (e.target === dialogEl) close(); }}
>
    <div class="dialog-content">
        <!-- Header -->
        <div class="dialog-header">
            <div>
                <h2 class="dialog-title">Interactive Search</h2>
                <p class="dialog-subtitle">{title}</p>
            </div>
            <div class="dialog-header-actions">
                {#if !loading}
                    <button class="btn btn-sm btn-ghost gap-1" onclick={search}>
                        🔄 Retry
                    </button>
                {/if}
                <button class="btn btn-sm btn-ghost btn-circle" onclick={close}>✕</button>
            </div>
        </div>

        <!-- Body -->
        <div class="dialog-body">
            {#if loading}
                <div class="dialog-empty-state">
                    <span class="loading loading-spinner loading-lg text-primary"></span>
                    <p class="text-sm text-base-content/50">Querying indexers… this can take 1–3 minutes</p>
                    <p class="text-xs text-base-content/30">Your indexers are being searched in real-time</p>
                </div>
            {:else if error}
                <div class="dialog-empty-state">
                    <span class="text-4xl">⚠️</span>
                    <p class="text-sm text-error max-w-md text-center whitespace-pre-line">{error}</p>
                    <button class="btn btn-sm btn-primary gap-1" onclick={search}>
                        🔄 Retry Search
                    </button>
                </div>
            {:else if releases.length === 0}
                <div class="dialog-empty-state">
                    <span class="text-4xl">🔍</span>
                    <p class="text-sm text-base-content/50">No releases found</p>
                </div>
            {:else}
                <table class="release-table">
                    <thead>
                        <tr>
                            <th class="col-action"></th>
                            <th class="col-src">Src</th>
                            <th class="col-age">Age</th>
                            <th class="col-title">Release Name</th>
                            <th class="col-indexer">Indexer</th>
                            <th class="col-size">Size</th>
                            <th class="col-peers">Peers</th>
                            <th class="col-lang">Lang</th>
                            <th class="col-quality">Quality</th>
                            <th class="col-score">Score</th>
                        </tr>
                    </thead>
                    <tbody>
                        {#each releases as release}
                            <tr class:rejected={release.rejected}>
                                <!-- Download button -->
                                <td class="col-action">
                                    {#if downloadSuccess[release.guid]}
                                        <span class="badge badge-sm badge-success gap-1">✓</span>
                                    {:else}
                                        <button
                                            class="btn btn-xs {release.rejected ? 'btn-outline btn-warning' : 'btn-primary'}"
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
                                <td class="col-src">
                                    {#if release.protocol === 'usenet'}
                                        <span class="badge badge-xs badge-info" title="Usenet">nzb</span>
                                    {:else}
                                        <span class="badge badge-xs badge-warning" title="Torrent">tor</span>
                                    {/if}
                                </td>
                                <!-- Age -->
                                <td class="col-age">{formatAge(release.age)}</td>
                                <!-- Title — full name, wraps -->
                                <td class="col-title">
                                    <div class="release-name">
                                        {#if release.infoUrl}
                                            <a href={release.infoUrl} target="_blank" rel="noopener" class="link link-primary">{release.title}</a>
                                        {:else}
                                            {release.title}
                                        {/if}
                                    </div>
                                    {#if release.rejected && release.rejections?.length}
                                        <div class="release-rejection">
                                            ⛔ {release.rejections.join(' · ')}
                                        </div>
                                    {/if}
                                </td>
                                <!-- Indexer -->
                                <td class="col-indexer">{release.indexer}</td>
                                <!-- Size -->
                                <td class="col-size">{formatSize(release.size)}</td>
                                <!-- Peers -->
                                <td class="col-peers">
                                    {#if release.protocol === 'torrent'}
                                        <span>{release.seeders ?? '—'}</span>
                                    {:else}
                                        <span class="text-base-content/30">—</span>
                                    {/if}
                                </td>
                                <!-- Languages -->
                                <td class="col-lang">
                                    {#each (release.languages || []).slice(0, 2) as lang}
                                        <span class="badge badge-xs badge-ghost">{lang}</span>
                                    {/each}
                                </td>
                                <!-- Quality -->
                                <td class="col-quality">
                                    <span class="badge badge-xs {release.quality?.includes('2160') ? 'badge-primary' : release.quality?.includes('1080') ? 'badge-info' : 'badge-ghost'}">
                                        {release.quality}
                                    </span>
                                    {#if release.customFormats?.length}
                                        <div class="custom-formats">
                                            {#each release.customFormats.slice(0, 3) as cf}
                                                <span class="badge badge-xs badge-outline text-[9px]">{cf}</span>
                                            {/each}
                                        </div>
                                    {/if}
                                </td>
                                <!-- Score -->
                                <td class="col-score">
                                    <span class="font-mono {release.customFormatScore > 0 ? 'text-success' : release.customFormatScore < 0 ? 'text-error' : 'text-base-content/40'}">
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
            <div class="dialog-footer">
                <span>{releases.length} releases · {releases.filter(r => !r.rejected).length} accepted</span>
                <button class="btn btn-ghost btn-xs" onclick={close}>Close</button>
            </div>
        {/if}
    </div>
</dialog>

<style>
    /* ── Native <dialog> styling ── */
    .modal-dialog {
        position: fixed;
        inset: 0;
        width: 100vw;
        height: 100vh;
        max-width: 100vw;
        max-height: 100vh;
        margin: 0;
        padding: 1rem;
        border: none;
        background: transparent;
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .modal-dialog::backdrop {
        background: rgba(0, 0, 0, 0.7);
        backdrop-filter: blur(4px);
    }

    /* Hide when not open */
    .modal-dialog:not([open]) {
        display: none;
    }

    .dialog-content {
        background: oklch(var(--b2));
        border: 1px solid oklch(var(--b3));
        border-radius: 1rem;
        box-shadow: 0 25px 50px -12px rgb(0 0 0 / 0.5);
        width: 100%;
        max-width: 80rem; /* 1280px — much wider */
        max-height: 90vh;
        display: flex;
        flex-direction: column;
        overflow: hidden;
    }

    /* ── Header ── */
    .dialog-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 1rem 1.5rem;
        border-bottom: 1px solid oklch(var(--b3));
        flex-shrink: 0;
    }

    .dialog-title {
        font-size: 1.125rem;
        font-weight: 700;
    }

    .dialog-subtitle {
        font-size: 0.875rem;
        opacity: 0.5;
    }

    .dialog-header-actions {
        display: flex;
        align-items: center;
        gap: 0.5rem;
    }

    /* ── Body ── */
    .dialog-body {
        flex: 1;
        overflow: auto;
        min-height: 0;
    }

    .dialog-empty-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 4rem 1rem;
        gap: 0.75rem;
    }

    /* ── Table ── */
    .release-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 0.8125rem;
    }

    .release-table thead {
        position: sticky;
        top: 0;
        background: oklch(var(--b2));
        z-index: 10;
    }

    .release-table th {
        text-align: left;
        padding: 0.5rem 0.75rem;
        font-size: 0.6875rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        opacity: 0.5;
        white-space: nowrap;
        border-bottom: 1px solid oklch(var(--b3));
    }

    .release-table td {
        padding: 0.5rem 0.75rem;
        vertical-align: top;
        border-bottom: 1px solid oklch(var(--b3) / 0.3);
    }

    .release-table tbody tr {
        transition: background 0.15s;
    }

    .release-table tbody tr:hover {
        background: oklch(var(--b3) / 0.3);
    }

    .release-table tbody tr.rejected {
        opacity: 0.5;
    }

    /* Column widths */
    .col-action { width: 2.5rem; }
    .col-src { width: 2.5rem; }
    .col-age { width: 3.5rem; white-space: nowrap; }
    .col-title { min-width: 20rem; }
    .col-indexer { width: 7rem; white-space: nowrap; }
    .col-size { width: 5rem; text-align: right; white-space: nowrap; }
    .col-peers { width: 3rem; text-align: center; }
    .col-lang { width: 5rem; }
    .col-quality { width: 8rem; }
    .col-score { width: 3.5rem; text-align: right; }

    /* Release name — allow wrapping */
    .release-name {
        word-break: break-word;
        line-height: 1.4;
    }

    .release-rejection {
        font-size: 0.6875rem;
        color: oklch(var(--er) / 0.7);
        margin-top: 0.25rem;
    }

    .custom-formats {
        display: flex;
        flex-wrap: wrap;
        gap: 0.25rem;
        margin-top: 0.25rem;
    }

    /* ── Footer ── */
    .dialog-footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0.75rem 1.5rem;
        border-top: 1px solid oklch(var(--b3));
        font-size: 0.75rem;
        opacity: 0.5;
        flex-shrink: 0;
    }

    /* Responsive: on small screens, go full width */
    @media (max-width: 768px) {
        .modal-dialog {
            padding: 0;
        }

        .dialog-content {
            max-width: 100%;
            max-height: 100%;
            border-radius: 0;
        }

        .col-indexer, .col-lang, .col-peers {
            display: none;
        }
    }
</style>
