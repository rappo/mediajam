<script>
    import { onMount } from 'svelte';

    // ─── State ──────────────────────────────────────────────────────────────────
    /** @type {any[]} */
    let snapshots = $state([]);
    let loading = $state(true);
    let creating = $state(false);
    let comparing = $state(false);
    let snapshotLabel = $state('');

    // Compare
    let beforeFile = $state('');
    let afterFile = $state('');
    /** @type {any[]|null} */
    let diffs = $state(null);
    let compareError = $state('');

    // Expandable diff rows
    /** @type {Set<string>} */
    let expandedTables = $state(new Set());

    // Toast
    let toastMessage = $state('');
    let toastType = $state('info');
    let toastTimer = /** @type {ReturnType<typeof setTimeout>|null} */ (null);

    function showToast(message, type = 'info') {
        toastMessage = message;
        toastType = type;
        if (toastTimer) clearTimeout(toastTimer);
        toastTimer = setTimeout(() => { toastMessage = ''; }, 4000);
    }

    // ─── API Calls ──────────────────────────────────────────────────────────────
    async function fetchSnapshots() {
        try {
            const res = await fetch('/api/audit');
            snapshots = await res.json();
        } catch {
            showToast('Failed to load snapshots', 'error');
        } finally {
            loading = false;
        }
    }

    async function takeSnapshot() {
        if (!snapshotLabel.trim()) return;
        creating = true;
        try {
            const res = await fetch('/api/audit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ label: snapshotLabel.trim() })
            });
            const data = await res.json();
            if (data.error) {
                showToast(data.error, 'error');
            } else {
                showToast('Snapshot created', 'success');
                snapshotLabel = '';
                await fetchSnapshots();
            }
        } catch {
            showToast('Failed to create snapshot', 'error');
        } finally {
            creating = false;
        }
    }

    async function deleteSnapshot(filename) {
        try {
            const res = await fetch(`/api/audit/${encodeURIComponent(filename)}`, { method: 'DELETE' });
            const data = await res.json();
            if (data.success) {
                showToast('Snapshot deleted', 'success');
                await fetchSnapshots();
            } else {
                showToast(data.error || 'Delete failed', 'error');
            }
        } catch {
            showToast('Delete failed', 'error');
        }
    }

    async function compareSnapshots() {
        if (!beforeFile || !afterFile) return;
        comparing = true;
        compareError = '';
        diffs = null;
        expandedTables = new Set();
        try {
            const res = await fetch('/api/audit/compare', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ before: beforeFile, after: afterFile })
            });
            const data = await res.json();
            if (data.error) {
                compareError = data.error;
            } else {
                diffs = data.diffs || [];
            }
        } catch {
            compareError = 'Compare request failed';
        } finally {
            comparing = false;
        }
    }

    function toggleTable(table) {
        const next = new Set(expandedTables);
        if (next.has(table)) next.delete(table);
        else next.add(table);
        expandedTables = next;
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────────
    function formatDate(dateStr) {
        if (!dateStr) return 'Unknown';
        const d = new Date(dateStr);
        return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) +
            ' at ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    }

    function formatSize(bytes) {
        if (!bytes) return '—';
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
        return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    }

    function totalRows(rowCounts) {
        if (!rowCounts) return '—';
        return Object.values(rowCounts).reduce((sum, v) => sum + (v > 0 ? v : 0), 0).toLocaleString();
    }

    function diffBadge(diff) {
        const total = diff.added + diff.deleted + diff.modified;
        if (total === 0) return { class: 'badge-ghost', label: 'No changes' };
        const parts = [];
        if (diff.added > 0) parts.push(`+${diff.added}`);
        if (diff.deleted > 0) parts.push(`−${diff.deleted}`);
        if (diff.modified > 0) parts.push(`~${diff.modified}`);
        return { class: total > 0 ? 'badge-warning' : 'badge-ghost', label: parts.join(' ') };
    }

    onMount(fetchSnapshots);
</script>

<svelte:head>
    <title>Audit — Settings — Mediajam</title>
</svelte:head>

<!-- Take Snapshot -->
<div class="card bg-base-200/50 border border-base-300">
    <div class="card-body">
        <h2 class="card-title text-lg">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-info" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>
            </svg>
            Data Audit
        </h2>
        <p class="text-sm text-base-content/50">Take snapshots of your database before and after operations to see exactly what changed.</p>

        <div class="flex items-end gap-3 mt-3">
            <div class="flex-1">
                <label class="text-xs text-base-content/60" for="snapshot-label">Snapshot Label</label>
                <input
                    id="snapshot-label"
                    type="text"
                    class="input input-bordered input-sm w-full mt-1"
                    placeholder="e.g. pre-sync, after-cleanup"
                    bind:value={snapshotLabel}
                    onkeydown={(e) => { if (e.key === 'Enter') takeSnapshot(); }}
                />
            </div>
            <button class="btn btn-info btn-sm gap-2" onclick={takeSnapshot} disabled={creating || !snapshotLabel.trim()}>
                {#if creating}
                    <span class="loading loading-spinner loading-xs"></span>
                {:else}
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/>
                    </svg>
                {/if}
                Take Snapshot
            </button>
        </div>
    </div>
</div>

<!-- Snapshots List -->
<div class="card bg-base-200/50 border border-base-300 mt-6">
    <div class="card-body">
        <h2 class="card-title text-lg">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-success" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
            </svg>
            Snapshots
        </h2>

        {#if loading}
            <div class="flex justify-center py-8">
                <span class="loading loading-spinner loading-lg text-primary"></span>
            </div>
        {:else if snapshots.length === 0}
            <div class="text-center py-8 text-base-content/40">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-12 w-12 mx-auto mb-3 opacity-30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/>
                </svg>
                <p class="text-sm">No snapshots yet</p>
                <p class="text-xs mt-1">Take a snapshot above to get started</p>
            </div>
        {:else}
            <div class="overflow-x-auto">
                <table class="table table-sm">
                    <thead>
                        <tr>
                            <th>Label</th>
                            <th>Timestamp</th>
                            <th>Total Rows</th>
                            <th>Size</th>
                            <th></th>
                        </tr>
                    </thead>
                    <tbody>
                        {#each snapshots as snap}
                            <tr class="hover">
                                <td>
                                    <span class="badge badge-sm badge-outline">{snap.label}</span>
                                </td>
                                <td class="text-sm">{formatDate(snap.timestamp)}</td>
                                <td class="text-sm text-base-content/60">{totalRows(snap.rowCounts)}</td>
                                <td class="text-sm text-base-content/60">{formatSize(snap.sizeBytes)}</td>
                                <td class="text-right">
                                    <button
                                        class="btn btn-ghost btn-xs text-error/60 tooltip tooltip-left"
                                        data-tip="Delete"
                                        onclick={() => deleteSnapshot(snap.filename)}
                                    >
                                        <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                            <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/>
                                        </svg>
                                    </button>
                                </td>
                            </tr>
                        {/each}
                    </tbody>
                </table>
            </div>
        {/if}
    </div>
</div>

<!-- Compare Snapshots -->
{#if snapshots.length >= 2}
    <div class="card bg-base-200/50 border border-base-300 mt-6">
        <div class="card-body">
            <h2 class="card-title text-lg">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-warning" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>
                </svg>
                Compare Snapshots
            </h2>

            <div class="flex items-end gap-3 mt-2 flex-wrap">
                <div class="flex-1 min-w-[140px]">
                    <label class="text-xs text-base-content/60" for="compare-before">Before</label>
                    <select id="compare-before" class="select select-bordered select-sm w-full mt-1" bind:value={beforeFile}>
                        <option value="">Select snapshot…</option>
                        {#each snapshots as snap}
                            <option value={snap.filename}>{snap.label} — {formatDate(snap.timestamp)}</option>
                        {/each}
                    </select>
                </div>
                <div class="flex-1 min-w-[140px]">
                    <label class="text-xs text-base-content/60" for="compare-after">After</label>
                    <select id="compare-after" class="select select-bordered select-sm w-full mt-1" bind:value={afterFile}>
                        <option value="">Select snapshot…</option>
                        {#each snapshots as snap}
                            <option value={snap.filename}>{snap.label} — {formatDate(snap.timestamp)}</option>
                        {/each}
                    </select>
                </div>
                <button class="btn btn-warning btn-sm gap-2" onclick={compareSnapshots} disabled={comparing || !beforeFile || !afterFile}>
                    {#if comparing}
                        <span class="loading loading-spinner loading-xs"></span>
                    {/if}
                    Compare
                </button>
            </div>

            {#if compareError}
                <div class="alert alert-error text-sm mt-4">{compareError}</div>
            {/if}

            {#if diffs}
                <div class="mt-4 space-y-2">
                    {#each diffs as diff}
                        {@const badge = diffBadge(diff)}
                        {@const hasChanges = diff.added + diff.deleted + diff.modified > 0}
                        <div class="bg-base-300/40 rounded-lg border border-base-300">
                            <button
                                class="flex items-center justify-between w-full px-4 py-2.5 text-left"
                                onclick={() => hasChanges && toggleTable(diff.table)}
                                disabled={!hasChanges}
                            >
                                <div class="flex items-center gap-3">
                                    {#if hasChanges}
                                        <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5 text-base-content/40 transition-transform {expandedTables.has(diff.table) ? 'rotate-90' : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                            <polyline points="9 18 15 12 9 6"/>
                                        </svg>
                                    {:else}
                                        <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5 text-success/50" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                            <polyline points="20 6 9 17 4 12"/>
                                        </svg>
                                    {/if}
                                    <span class="text-sm font-medium font-mono">{diff.table}</span>
                                </div>
                                <div class="flex items-center gap-3">
                                    <span class="text-xs text-base-content/40">{diff.beforeCount.toLocaleString()} → {diff.afterCount.toLocaleString()}</span>
                                    <span class="badge badge-xs {badge.class}">{badge.label}</span>
                                </div>
                            </button>

                            {#if expandedTables.has(diff.table) && diff.samples.length > 0}
                                <div class="px-4 pb-3 border-t border-base-300">
                                    <div class="overflow-x-auto mt-2">
                                        <table class="table table-xs">
                                            <thead>
                                                <tr>
                                                    <th>Type</th>
                                                    <th>ID</th>
                                                    <th>Details</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {#each diff.samples as sample}
                                                    <tr>
                                                        <td>
                                                            <span class="badge badge-xs {sample.type === 'added' ? 'badge-success' : sample.type === 'deleted' ? 'badge-error' : 'badge-warning'}">
                                                                {sample.type}
                                                            </span>
                                                        </td>
                                                        <td class="font-mono text-xs">{sample.id}</td>
                                                        <td class="text-xs max-w-xs truncate">
                                                            {#if sample.type === 'modified' && sample.before}
                                                                {#each Object.entries(sample.before).slice(0, 3) as [key, change]}
                                                                    <span class="text-base-content/60">{key}:</span>
                                                                    <span class="text-error/60 line-through">{change.before ?? '∅'}</span>
                                                                    →
                                                                    <span class="text-success">{change.after ?? '∅'}</span>
                                                                    {' '}
                                                                {/each}
                                                            {:else if sample.type === 'added' && sample.after}
                                                                {sample.after.title || sample.after.name || JSON.stringify(sample.after).slice(0, 80)}
                                                            {:else if sample.type === 'deleted' && sample.before}
                                                                {sample.before.title || sample.before.name || JSON.stringify(sample.before).slice(0, 80)}
                                                            {/if}
                                                        </td>
                                                    </tr>
                                                {/each}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            {/if}
                        </div>
                    {/each}
                </div>
            {/if}
        </div>
    </div>
{/if}

<!-- Toast -->
{#if toastMessage}
    <div class="toast toast-end toast-bottom z-50">
        <div class="alert {toastType === 'error' ? 'alert-error' : toastType === 'success' ? 'alert-success' : 'alert-info'} text-sm py-2 shadow-lg">
            {toastMessage}
        </div>
    </div>
{/if}
