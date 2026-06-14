<script>
    import { onMount } from 'svelte';
    import MdiIcon from "$lib/components/MdiIcon.svelte";
    import { mdiShieldCheck, mdiContentSave, mdiChevronRight, mdiClockOutline, mdiRefresh, mdiDownload, mdiDelete, mdiAlert } from '@mdi/js';

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
    let backupIncludeImages = $state(false);

    // Restore modal
    let showRestoreModal = $state(false);
    let restoreTarget = $state('');
    let restoreTargetName = $state('');
    let restoreConfirmText = $state('');

    // Toast
    let toastMessage = $state('');
    let toastType = $state('info');
    let toastTimer = /** @type {ReturnType<typeof setTimeout>|null} */ (null);

    // Backup History accordion
    let historyExpanded = $state(false);

    // ─── Import / Export State ──────────────────────────────────────────────────
    let exporting = $state(false);
    let exportSensitive = $state(false);
    let exportPasswords = $state(false);
    let exportTokens = $state(false);
    let exportApiKeys = $state(false);
    let exportImages = $state(false);

    let importFile = $state(null);
    let importMode = $state("merge");
    let importPrefer = $state("new");
    let importing = $state(false);
    let importResult = $state(null);
    let importError = $state('');

    function showToast(message, type = 'info') {
        toastMessage = message;
        toastType = type;
        if (toastTimer) clearTimeout(toastTimer);
        toastTimer = setTimeout(() => { toastMessage = ''; }, 4000);
    }

    // Initial settings snapshot for dirty detection
    let initialSettings = {};
    function snapshotSettings() {
        return JSON.stringify({ backupEnabled, backupFrequency, backupTime, backupKeepCount, backupOnBoot, bootBackupKeepCount, backupIncludeImages });
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
                backupIncludeImages = data.settings.backupIncludeImages ?? false;
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
                body: JSON.stringify({ backupEnabled, backupFrequency, backupTime, backupKeepCount, backupOnBoot, bootBackupKeepCount, backupIncludeImages })
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

    // ─── Import / Export ─────────────────────────────────────────────────────────
    async function exportData() {
        exporting = true;
        importError = '';
        try {
            const params = new URLSearchParams();
            if (exportPasswords) params.set("includePasswords", "1");
            if (exportTokens) params.set("includeTokens", "1");
            if (exportApiKeys) params.set("includeApiKeys", "1");
            if (exportImages) params.set("includeImages", "1");
            const url = `/api/backup${params.toString() ? "?" + params.toString() : ""}`;
            const res = await fetch(url);
            if (!res.ok) throw new Error("Export failed");
            const blob = await res.blob();
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            const now = new Date();
            const ts = `${now.toISOString().split("T")[0]}_${String(now.getHours()).padStart(2, "0")}-${String(now.getMinutes()).padStart(2, "0")}`;
            a.download = `mediajam-backup-${ts}.zip`;
            a.click();
            URL.revokeObjectURL(a.href);
        } catch (e) {
            importError = e instanceof Error ? e.message : "Export failed";
        }
        exporting = false;
    }

    async function importData() {
        if (!importFile) return;
        importing = true;
        importResult = null;
        try {
            const params = new URLSearchParams({ mode: importMode });
            if (importMode === "merge") params.set("prefer", importPrefer);
            const res = await fetch(`/api/backup/import?${params.toString()}`, {
                method: "POST",
                body: importFile,
            });
            importResult = await res.json();
        } catch (e) {
            importResult = {
                success: false,
                error: e instanceof Error ? e.message : "Import failed",
            };
        }
        importing = false;
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
            <MdiIcon icon={mdiShieldCheck} size={20} class="text-info" />
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

        <div class="divider my-2 text-xs text-base-content/40">Storage</div>

        <div class="flex items-center justify-between">
            <div>
                <div class="text-sm font-medium">Include Cached Images</div>
                <div class="text-xs text-base-content/50">Include the image cache in backups (significantly increases backup size)</div>
            </div>
            <input type="checkbox" class="toggle toggle-warning toggle-sm" bind:checked={backupIncludeImages} />
        </div>

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

<!-- Backup Now -->
<div class="card bg-base-200/50 border border-base-300 mt-6">
    <div class="card-body">
        <div class="flex items-center justify-between">
            <h2 class="card-title text-lg">
                <MdiIcon icon={mdiContentSave} size={20} class="text-success" />
                Quick Backup
            </h2>
            <button class="btn btn-success btn-sm gap-2" onclick={createManualBackup} disabled={backingUp}>
                {#if backingUp}
                    <span class="loading loading-spinner loading-xs"></span>
                {:else}
                    <MdiIcon icon={mdiContentSave} size={16} />
                {/if}
                Backup Now
            </button>
        </div>
        {#if backups.length > 0}
            <p class="text-xs text-base-content/50 mt-1">Last backup: {timeAgo(backups[0]?.timestamp)} ({formatSize(backups[0]?.sizeBytes)})</p>
        {/if}
    </div>
</div>

<!-- Backup History (collapsed accordion) -->
<div class="card bg-base-200/50 border border-base-300 mt-6">
    <div class="card-body">
        <button
            class="flex items-center gap-2 w-full text-left"
            onclick={() => historyExpanded = !historyExpanded}
        >
            <MdiIcon icon={mdiChevronRight} size={16} class="text-base-content/40 transition-transform {historyExpanded ? 'rotate-90' : ''}" />
            <MdiIcon icon={mdiClockOutline} size={20} class="text-success" />
            <span class="font-semibold">Backup History</span>
            {#if backups.length > 0}
                <span class="badge badge-sm badge-ghost ml-1">{backups.length}</span>
            {/if}
        </button>

        {#if historyExpanded}
            <div class="mt-4">
                {#if loading}
                    <div class="flex justify-center py-8">
                        <span class="loading loading-spinner loading-lg text-primary"></span>
                    </div>
                {:else if backups.length === 0}
                    <div class="text-center py-8 text-base-content/40">
                        <MdiIcon icon={mdiShieldCheck} size={48} class="mx-auto mb-3 opacity-30" />
                        <p class="text-sm">No backups yet</p>
                        <p class="text-xs mt-1">Click "Backup Now" to create your first backup</p>
                    </div>
                {:else}
                    <ul class="timeline timeline-vertical timeline-compact">
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
                                                <MdiIcon icon={mdiRefresh} size={14} />
                                            </button>
                                            <a
                                                href="/api/backups/download/{encodeURIComponent(backup.filename)}"
                                                class="btn btn-ghost btn-xs tooltip tooltip-left"
                                                data-tip="Download"
                                                download
                                            >
                                                <MdiIcon icon={mdiDownload} size={14} />
                                            </a>
                                            {#if backup.type === 'manual'}
                                                <button
                                                    class="btn btn-ghost btn-xs text-error/60 tooltip tooltip-left"
                                                    data-tip="Delete"
                                                    onclick={() => deleteBackup(backup.filename)}
                                                >
                                                    <MdiIcon icon={mdiDelete} size={14} />
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

                <!-- Hidden / Diverged Backups -->
                {#if hiddenBackups.length > 0}
                    <div class="mt-4 pt-4 border-t border-base-300/50">
                        <button
                            class="flex items-center gap-2 w-full text-left"
                            onclick={() => showHidden = !showHidden}
                        >
                            <MdiIcon icon={mdiChevronRight} size={16} class="text-base-content/40 transition-transform {showHidden ? 'rotate-90' : ''}" />
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
                {/if}
            </div>
        {/if}
    </div>
</div>

<!-- Import / Export Data -->
<div class="card bg-base-200/50 border border-base-300 mt-6">
    <div class="card-body">
        <h2 class="card-title text-lg">
            <MdiIcon icon={mdiDownload} size={20} class="text-info" />
            Import / Export Data
        </h2>

        <!-- Export Section -->
        <div class="space-y-3 mt-2">
            <h3 class="text-sm font-medium">Export Data</h3>
            <p class="text-xs text-base-content/50">
                Download a complete backup of all data including history,
                metadata, settings, and uploads.
            </p>

            <!-- Sensitive data opt-in -->
            <div class="bg-base-300/30 rounded-lg p-3 space-y-2">
                <label class="flex items-start gap-2 cursor-pointer">
                    <input
                        type="checkbox"
                        class="checkbox checkbox-sm checkbox-warning mt-0.5"
                        bind:checked={exportSensitive}
                    />
                    <span class="text-xs text-base-content/70">
                        <span class="font-semibold text-warning">Include encrypted data.</span> I understand including passwords/keys is risky. Include:
                    </span>
                </label>

                {#if exportSensitive}
                    <div class="ml-7 space-y-1.5">
                        <label class="flex items-center gap-2 cursor-pointer">
                            <input type="checkbox" class="checkbox checkbox-xs" bind:checked={exportPasswords} />
                            <span class="text-xs">Password hashes <span class="text-base-content/40">(all accounts)</span></span>
                        </label>
                        <label class="flex items-center gap-2 cursor-pointer">
                            <input type="checkbox" class="checkbox checkbox-xs" bind:checked={exportTokens} />
                            <span class="text-xs">Access tokens <span class="text-base-content/40">(Trakt, Last.fm, Jellyfin)</span></span>
                        </label>
                        <label class="flex items-center gap-2 cursor-pointer">
                            <input type="checkbox" class="checkbox checkbox-xs" bind:checked={exportApiKeys} />
                            <span class="text-xs">API keys <span class="text-base-content/40">(TVDB, TMDB, MusicBrainz, OMDb, Discogs, Trakt, Last.fm, Radarr, Sonarr, Lidarr)</span></span>
                        </label>
                    </div>
                {/if}
            </div>

            <!-- Cached images opt-in -->
            <div class="bg-base-300/30 rounded-lg p-3">
                <label class="flex items-start gap-2 cursor-pointer">
                    <input type="checkbox" class="checkbox checkbox-sm mt-0.5" bind:checked={exportImages} />
                    <span class="text-xs text-base-content/70">
                        <span class="font-semibold">Include cached images.</span>
                        Adds all locally cached poster/photo images to the backup.
                        <span class="text-base-content/40">This may significantly increase the backup file size.</span>
                    </span>
                </label>
            </div>

            <button
                class="btn btn-sm btn-info gap-2"
                onclick={exportData}
                disabled={exporting}
            >
                {#if exporting}
                    <span class="loading loading-spinner loading-xs"></span>
                {:else}
                    <MdiIcon icon={mdiDownload} size={16} />
                {/if}
                Download Backup
            </button>

            {#if importError}
                <p class="text-xs text-error">{importError}</p>
            {/if}
        </div>

        <div class="divider my-2"></div>

        <!-- Import Section -->
        <div class="space-y-3">
            <h3 class="text-sm font-medium">Import Data</h3>
            <p class="text-xs text-base-content/50">
                Restore data from a Mediajam backup ZIP file.
            </p>

            <input
                type="file"
                accept=".zip"
                class="file-input file-input-sm file-input-bordered w-full max-w-xs"
                onchange={(e) => {
                    importFile = e.target?.files?.[0] || null;
                    importResult = null;
                }}
            />

            {#if importFile}
                <div class="flex flex-wrap gap-3 items-center">
                    <div class="form-control">
                        <label class="label py-0">
                            <span class="label-text text-xs">Mode</span>
                        </label>
                        <select class="select select-sm select-bordered" bind:value={importMode}>
                            <option value="overwrite">Overwrite all</option>
                            <option value="merge">Merge data</option>
                        </select>
                    </div>

                    {#if importMode === "merge"}
                        <div class="form-control">
                            <label class="label py-0">
                                <span class="label-text text-xs">Prefer</span>
                            </label>
                            <select class="select select-sm select-bordered" bind:value={importPrefer}>
                                <option value="new">New data wins</option>
                                <option value="old">Existing data wins</option>
                            </select>
                        </div>
                    {/if}

                    <button
                        class="btn btn-sm btn-warning gap-2 self-end"
                        onclick={importData}
                        disabled={importing}
                    >
                        {#if importing}
                            <span class="loading loading-spinner loading-xs"></span>
                        {/if}
                        Import
                    </button>
                </div>

                {#if importMode === "overwrite"}
                    <div class="alert alert-warning alert-sm">
                        <MdiIcon icon={mdiAlert} size={16} class="shrink-0" />
                        <span class="text-xs">This will delete all existing data and replace it with the backup.</span>
                    </div>
                {/if}
            {/if}

            {#if importResult}
                <div class="rounded-xl p-4 border {importResult.success ? 'bg-success/5 border-success/20 text-base-content' : 'bg-error/5 border-error/20 text-base-content'}">
                    <div class="w-full">
                        {#if importResult.success}
                            <p class="text-sm font-medium">Import complete ({importResult.mode})</p>
                            <div class="text-xs mt-1 grid grid-cols-2 gap-x-4 gap-y-0.5">
                                {#each Object.entries(importResult.results?.imported || {}) as [table, count]}
                                    <span class="text-base-content/60">{table}:</span>
                                    <span>{count}</span>
                                {/each}
                            </div>
                            {#if importResult.results?.errors?.length > 0}
                                <p class="text-xs text-error mt-1">{importResult.results.errors.join(", ")}</p>
                            {/if}
                        {:else}
                            <p class="text-sm">{importResult.error || "Import failed"}</p>
                        {/if}
                    </div>
                </div>
            {/if}
        </div>
    </div>
</div>

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
                    <MdiIcon icon={mdiAlert} size={16} class="shrink-0" />
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
