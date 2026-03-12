<script>
    import { onMount } from 'svelte';

    // ─── State ──────────────────────────────────────────────────────────────────
    /** @type {any[]} */
    let backups = $state([]);
    /** @type {any[]} */
    let hiddenBackups = $state([]);
    let loading = $state(true);
    let backingUp = $state(false);
    let restoring = $state(false);
    let showHidden = $state(false);
    let settingsSaving = $state(false);
    let settingsDirty = $state(false);

    // Settings
    let backupEnabled = $state(true);
    let backupFrequency = $state('daily');
    let backupTime = $state('05:00');
    let backupKeepCount = $state(7);
    let backupOnBoot = $state(true);
    let bootBackupKeepCount = $state(3);

    // Restore modal
    let showRestoreModal = $state(false);
    let restoreTarget = $state('');
    let restoreTargetName = $state('');
    let restoreConfirmText = $state('');

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

    // Initial settings snapshot for dirty detection
    let initialSettings = {};
    function snapshotSettings() {
        return JSON.stringify({ backupEnabled, backupFrequency, backupTime, backupKeepCount, backupOnBoot, bootBackupKeepCount });
    }
    $effect(() => {
        const current = snapshotSettings();
        settingsDirty = current !== JSON.stringify(initialSettings);
    });

    // ─── API Calls ──────────────────────────────────────────────────────────────
    async function fetchBackups() {
        try {
            const res = await fetch('/api/backups');
            const data = await res.json();
            if (data.backups) {
                const all = data.backups;
                backups = all.filter(b => !b.isHidden);
                hiddenBackups = all.filter(b => b.isHidden);
            }
            if (data.settings) {
                backupEnabled = data.settings.backupEnabled;
                backupFrequency = data.settings.backupFrequency;
                backupTime = data.settings.backupTime;
                backupKeepCount = data.settings.backupKeepCount;
                backupOnBoot = data.settings.backupOnBoot;
                bootBackupKeepCount = data.settings.bootBackupKeepCount;
                initialSettings = JSON.parse(snapshotSettings());
            }
        } catch (e) {
            showToast('Failed to load backups', 'error');
        } finally {
            loading = false;
        }
    }

    async function createManualBackup() {
        backingUp = true;
        try {
            const res = await fetch('/api/backups', { method: 'POST' });
            const data = await res.json();
            if (data.success) {
                showToast('Backup created', 'success');
                await fetchBackups();
            } else {
                showToast(data.error || 'Backup failed', 'error');
            }
        } catch {
            showToast('Backup failed', 'error');
        } finally {
            backingUp = false;
        }
    }

    async function saveSettings() {
        settingsSaving = true;
        try {
            const res = await fetch('/api/backups/settings', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ backupEnabled, backupFrequency, backupTime, backupKeepCount, backupOnBoot, bootBackupKeepCount })
            });
            const data = await res.json();
            if (data.success) {
                initialSettings = JSON.parse(snapshotSettings());
                showToast('Settings saved', 'success');
            } else {
                showToast(data.error || 'Save failed', 'error');
            }
        } catch {
            showToast('Save failed', 'error');
        } finally {
            settingsSaving = false;
        }
    }

    function openRestoreModal(filename, displayName) {
        restoreTarget = filename;
        restoreTargetName = displayName;
        restoreConfirmText = '';
        showRestoreModal = true;
    }

    async function confirmRestore() {
        if (restoreConfirmText !== 'RESTORE') return;
        restoring = true;
        try {
            const res = await fetch('/api/backups/restore', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filename: restoreTarget })
            });
            const data = await res.json();
            if (data.success) {
                showToast('Restore successful — server is restarting...', 'success');
                showRestoreModal = false;
                // Wait a bit then try to reload
                setTimeout(() => { window.location.reload(); }, 3000);
            } else {
                showToast(data.error || 'Restore failed', 'error');
            }
        } catch {
            showToast('Restore failed', 'error');
        } finally {
            restoring = false;
        }
    }

    async function deleteBackup(filename) {
        try {
            const res = await fetch(`/api/backups/${encodeURIComponent(filename)}`, { method: 'DELETE' });
            const data = await res.json();
            if (data.success) {
                showToast('Backup deleted', 'success');
                await fetchBackups();
            } else {
                showToast(data.error || 'Delete failed', 'error');
            }
        } catch {
            showToast('Delete failed', 'error');
        }
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────────
    function formatDate(dateStr) {
        if (!dateStr) return 'Unknown';
        const d = new Date(dateStr);
        return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) +
            ' at ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    }

    function timeAgo(dateStr) {
        if (!dateStr) return '';
        const d = new Date(dateStr);
        const now = new Date();
        const diffMs = now.getTime() - d.getTime();
        const diffMin = Math.floor(diffMs / 60000);
        if (diffMin < 1) return 'just now';
        if (diffMin < 60) return `${diffMin}m ago`;
        const diffHr = Math.floor(diffMin / 60);
        if (diffHr < 24) return `${diffHr}h ago`;
        const diffDay = Math.floor(diffHr / 24);
        if (diffDay < 7) return `${diffDay}d ago`;
        return `${Math.floor(diffDay / 7)}w ago`;
    }

    function formatSize(bytes) {
        if (!bytes) return '—';
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
        return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    }

    function typeBadge(type) {
        switch (type) {
            case 'auto': return { class: 'badge-primary', label: 'Auto' };
            case 'boot': return { class: 'badge-info', label: 'Boot' };
            case 'manual': return { class: 'badge-accent', label: 'Manual' };
            default: return { class: 'badge-ghost', label: type };
        }
    }

    onMount(fetchBackups);
</script>

<svelte:head>
    <title>Backups — Settings — Mediajam</title>
</svelte:head>

<!-- Settings Card -->
<div class="card bg-base-200/50 border border-base-300">
    <div class="card-body">
        <h2 class="card-title text-lg">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-info" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
            </svg>
            Backup Settings
        </h2>

        <div class="divider my-2 text-xs text-base-content/40">Scheduled Backups</div>

        <div class="flex items-center justify-between">
            <div>
                <div class="text-sm font-medium">Automatic Backups</div>
                <div class="text-xs text-base-content/50">Automatically back up the database on a schedule</div>
            </div>
            <input type="checkbox" class="toggle toggle-primary toggle-sm" bind:checked={backupEnabled} />
        </div>

        {#if backupEnabled}
            <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-3 pl-2 border-l-2 border-primary/20 ml-1">
                <div>
                    <label class="text-xs text-base-content/60" for="backup-frequency">Frequency</label>
                    <select id="backup-frequency" class="select select-bordered select-sm w-full mt-1" bind:value={backupFrequency}>
                        <option value="daily">Daily</option>
                        <option value="every_other_day">Every Other Day</option>
                        <option value="twice_weekly">Twice Weekly (Mon & Thu)</option>
                        <option value="weekly">Weekly</option>
                    </select>
                </div>
                <div>
                    <label class="text-xs text-base-content/60" for="backup-time">Backup Time</label>
                    <input id="backup-time" type="time" class="input input-bordered input-sm w-full mt-1" bind:value={backupTime} />
                </div>
                <div>
                    <label class="text-xs text-base-content/60" for="backup-keep">Keep</label>
                    <div class="flex items-center gap-2 mt-1">
                        <input id="backup-keep" type="number" min="1" max="100" class="input input-bordered input-sm w-20 text-center" bind:value={backupKeepCount} />
                        <span class="text-xs text-base-content/50">backups</span>
                    </div>
                </div>
            </div>
        {/if}

        <div class="divider my-2 text-xs text-base-content/40">Boot Backups</div>

        <div class="flex items-center justify-between">
            <div>
                <div class="text-sm font-medium">Backup on Server Boot</div>
                <div class="text-xs text-base-content/50">Create a backup each time the server starts, before any migrations</div>
            </div>
            <input type="checkbox" class="toggle toggle-info toggle-sm" bind:checked={backupOnBoot} />
        </div>

        {#if backupOnBoot}
            <div class="flex items-center gap-3 mt-2 pl-2 border-l-2 border-info/20 ml-1">
                <label class="text-xs text-base-content/60" for="boot-keep">Keep</label>
                <input id="boot-keep" type="number" min="1" max="50" class="input input-bordered input-sm w-20 text-center" bind:value={bootBackupKeepCount} />
                <span class="text-xs text-base-content/50">boot backups</span>
            </div>
        {/if}

        {#if settingsDirty}
            <div class="flex justify-end mt-4">
                <button class="btn btn-primary btn-sm" onclick={saveSettings} disabled={settingsSaving}>
                    {#if settingsSaving}
                        <span class="loading loading-spinner loading-xs"></span>
                    {/if}
                    Save Settings
                </button>
            </div>
        {/if}
    </div>
</div>

<!-- Backup Now + Timeline -->
<div class="card bg-base-200/50 border border-base-300 mt-6">
    <div class="card-body">
        <div class="flex items-center justify-between">
            <h2 class="card-title text-lg">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-success" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                </svg>
                Backup Timeline
            </h2>
            <button class="btn btn-success btn-sm gap-2" onclick={createManualBackup} disabled={backingUp}>
                {#if backingUp}
                    <span class="loading loading-spinner loading-xs"></span>
                {:else}
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>
                    </svg>
                {/if}
                Backup Now
            </button>
        </div>

        {#if loading}
            <div class="flex justify-center py-8">
                <span class="loading loading-spinner loading-lg text-primary"></span>
            </div>
        {:else if backups.length === 0}
            <div class="text-center py-8 text-base-content/40">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-12 w-12 mx-auto mb-3 opacity-30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                </svg>
                <p class="text-sm">No backups yet</p>
                <p class="text-xs mt-1">Click "Backup Now" to create your first backup</p>
            </div>
        {:else}
            <ul class="timeline timeline-vertical timeline-compact mt-4">
                {#each backups as backup, idx}
                    {@const badge = typeBadge(backup.type)}
                    <li>
                        {#if idx > 0}<hr class="bg-base-300"/>{/if}
                        <div class="timeline-start text-xs text-base-content/40 min-w-[80px] text-right pr-2">
                            {timeAgo(backup.timestamp)}
                        </div>
                        <div class="timeline-middle">
                            <div class="w-3 h-3 rounded-full {backup.type === 'manual' ? 'bg-accent' : backup.type === 'boot' ? 'bg-info' : 'bg-primary'}"></div>
                        </div>
                        <div class="timeline-end timeline-box bg-base-300/50 border-base-300 w-full">
                            <div class="flex items-center justify-between gap-3 flex-wrap">
                                <div class="flex items-center gap-2 min-w-0">
                                    <span class="badge badge-xs {badge.class}">{badge.label}</span>
                                    <div>
                                        <div class="text-sm font-medium">{formatDate(backup.timestamp)}</div>
                                        <div class="text-xs text-base-content/40">{formatSize(backup.sizeBytes)}</div>
                                    </div>
                                </div>
                                <div class="flex items-center gap-1.5 shrink-0">
                                    <button
                                        class="btn btn-ghost btn-xs tooltip tooltip-left"
                                        data-tip="Restore from this backup"
                                        onclick={() => openRestoreModal(backup.filename, formatDate(backup.timestamp))}
                                    >
                                        <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                            <path d="M21 12a9 9 0 11-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/>
                                            <polyline points="21 3 21 8 16 8"/>
                                        </svg>
                                    </button>
                                    <a
                                        href="/api/backups/download/{encodeURIComponent(backup.filename)}"
                                        class="btn btn-ghost btn-xs tooltip tooltip-left"
                                        data-tip="Download"
                                        download
                                    >
                                        <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
                                        </svg>
                                    </a>
                                    {#if backup.type === 'manual'}
                                        <button
                                            class="btn btn-ghost btn-xs text-error/60 tooltip tooltip-left"
                                            data-tip="Delete"
                                            onclick={() => deleteBackup(backup.filename)}
                                        >
                                            <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                                <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/>
                                            </svg>
                                        </button>
                                    {/if}
                                </div>
                            </div>
                        </div>
                        {#if idx === backups.length - 1}<hr class="bg-base-300"/>{/if}
                    </li>
                {/each}
            </ul>
        {/if}
    </div>
</div>

<!-- Hidden / Diverged Backups -->
{#if hiddenBackups.length > 0}
    <div class="card bg-base-200/50 border border-base-300/50 mt-6">
        <div class="card-body">
            <button
                class="flex items-center gap-2 w-full text-left"
                onclick={() => showHidden = !showHidden}
            >
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-base-content/40 transition-transform {showHidden ? 'rotate-90' : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="9 18 15 12 9 6"/>
                </svg>
                <span class="text-sm text-base-content/50">
                    Other database backups ({hiddenBackups.length})
                </span>
                <span class="text-xs text-base-content/30 ml-auto">
                    From previous timeline — kept for safety
                </span>
            </button>

            {#if showHidden}
                <div class="mt-3 space-y-2">
                    {#each hiddenBackups as backup}
                        {@const badge = typeBadge(backup.type)}
                        <div class="flex items-center justify-between px-3 py-2 bg-base-300/30 rounded-lg">
                            <div class="flex items-center gap-2">
                                <span class="badge badge-xs badge-ghost">{badge.label}</span>
                                <span class="text-sm">{formatDate(backup.timestamp)}</span>
                                <span class="text-xs text-base-content/30">{formatSize(backup.sizeBytes)}</span>
                            </div>
                            <div class="flex items-center gap-1.5">
                                <button
                                    class="btn btn-ghost btn-xs"
                                    onclick={() => openRestoreModal(backup.filename, formatDate(backup.timestamp))}
                                >
                                    Restore
                                </button>
                                <a href="/api/backups/download/{encodeURIComponent(backup.filename)}" class="btn btn-ghost btn-xs" download>
                                    Download
                                </a>
                            </div>
                        </div>
                    {/each}
                </div>
            {/if}
        </div>
    </div>
{/if}

<!-- Restore Confirmation Modal -->
{#if showRestoreModal}
    <div class="modal modal-open">
        <div class="modal-box">
            <h3 class="text-lg font-bold text-error">⚠ Restore from Backup</h3>
            <div class="py-4 space-y-3">
                <p class="text-sm">
                    You are about to restore the database from:
                </p>
                <div class="bg-base-300/50 rounded-lg px-3 py-2 text-sm font-medium">
                    {restoreTargetName}
                </div>
                <div class="alert alert-warning text-xs">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                    </svg>
                    <div>
                        <p><strong>This is destructive.</strong> Your current database will be replaced with the backup.</p>
                        <p class="mt-1">A pre-restore backup will be created automatically so you can undo if needed.</p>
                        <p class="mt-1">The server will restart after the restore.</p>
                    </div>
                </div>
                <div>
                    <label class="text-sm" for="restore-confirm">Type <strong>RESTORE</strong> to confirm:</label>
                    <input
                        id="restore-confirm"
                        type="text"
                        class="input input-bordered input-sm w-full mt-1"
                        placeholder="RESTORE"
                        bind:value={restoreConfirmText}
                        onkeydown={(e) => { if (e.key === 'Enter' && restoreConfirmText === 'RESTORE') confirmRestore(); }}
                    />
                </div>
            </div>
            <div class="modal-action">
                <button class="btn btn-ghost btn-sm" onclick={() => showRestoreModal = false}>Cancel</button>
                <button
                    class="btn btn-error btn-sm"
                    disabled={restoreConfirmText !== 'RESTORE' || restoring}
                    onclick={confirmRestore}
                >
                    {#if restoring}
                        <span class="loading loading-spinner loading-xs"></span>
                    {/if}
                    Restore
                </button>
            </div>
        </div>
        <div class="modal-backdrop" onclick={() => showRestoreModal = false}></div>
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
