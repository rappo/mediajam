<script>
    /** @type {{ onStepComplete: (data: any) => void }} */
    let { onStepComplete } = $props();

    // Import from backup
    let showImport = $state(false);
    let importingBackup = $state(false);
    let importError = $state("");

    async function importBackup(event) {
        const file = event.target?.files?.[0];
        if (!file) return;
        importingBackup = true;
        importError = "";
        try {
            const res = await fetch("/api/backup/import?mode=overwrite", {
                method: "POST",
                body: file,
            });

            if (res.status === 413) {
                importError = `File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). The server rejected the upload — this may be a body size limit issue.`;
            } else if (res.status === 403) {
                importError =
                    "Permission denied. Only admins can import backups.";
            } else if (!res.ok) {
                let detail = "";
                try {
                    const body = await res.json();
                    detail = body.error || JSON.stringify(body);
                } catch {
                    detail = await res.text().catch(() => `HTTP ${res.status}`);
                }
                importError = `Import failed (${res.status}): ${detail}`;
            } else {
                const result = await res.json();
                if (result.success) {
                    window.location.href = "/";
                } else {
                    importError =
                        result.error ||
                        "Import completed but reported errors. Check the server logs.";
                }
            }
        } catch (e) {
            if (e instanceof TypeError && e.message.includes("fetch")) {
                importError =
                    "Network error — could not reach the server. Is it running?";
            } else {
                importError =
                    e instanceof Error
                        ? e.message
                        : "An unexpected error occurred during import.";
            }
        }
        importingBackup = false;
    }
</script>

<div>
    <h2 class="text-2xl font-bold mb-2">Welcome to Mediajam! 🎬🎵</h2>
    <p class="text-base-content/60 text-sm mb-6">
        Beautiful analytics and tracking for your Jellyfin media server —
        movies, TV, music, and more.
    </p>

    <div class="bg-base-300/30 rounded-xl p-5 mb-6 space-y-4">
        <p class="text-sm text-base-content/70">
            This setup wizard will walk you through connecting your services.
            Everything configured here can be changed later in Settings —
            nothing is permanent.
        </p>

        <div class="space-y-2 text-sm text-base-content/60">
            <div class="flex items-center gap-2">
                <span class="text-base">🔍</span>
                <span>Connect your Jellyfin server</span>
            </div>
            <div class="flex items-center gap-2">
                <span class="text-base">👤</span>
                <span>Create your admin account</span>
            </div>
            <div class="flex items-center gap-2">
                <span class="text-base">📚</span>
                <span>Choose which libraries to track</span>
            </div>
            <div class="flex items-center gap-2">
                <span class="text-base">🔑</span>
                <span>Add API keys for metadata enrichment</span>
            </div>
            <div class="flex items-center gap-2">
                <span class="text-base">🔗</span>
                <span>Connect Trakt, Last.fm, and other integrations</span>
            </div>
            <div class="flex items-center gap-2">
                <span class="text-base">🔄</span>
                <span>Sync your library and import history</span>
            </div>
        </div>
    </div>

    <button
        class="btn btn-primary btn-lg w-full gap-2"
        onclick={() => onStepComplete({})}
    >
        Let's Go!
        <svg
            xmlns="http://www.w3.org/2000/svg"
            class="h-5 w-5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
        >
            <polyline points="9 18 15 12 9 6" />
        </svg>
    </button>

    <!-- Import from backup -->
    <div class="mt-6 pt-4 border-t border-base-300/50 text-center">
        {#if !showImport}
            <button
                class="btn btn-ghost btn-xs text-base-content/40 gap-1"
                onclick={() => (showImport = true)}
            >
                <svg
                    xmlns="http://www.w3.org/2000/svg"
                    class="w-3.5 h-3.5"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                >
                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                    <polyline points="17 8 12 3 7 8" />
                    <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
                Restore from a backup
            </button>
        {:else}
            <div class="space-y-2">
                <p class="text-xs text-base-content/50">
                    Upload a Mediajam backup ZIP to restore all data and skip
                    setup.
                </p>
                {#if importingBackup}
                    <div class="flex items-center justify-center gap-2">
                        <span
                            class="loading loading-spinner loading-sm text-primary"
                        ></span>
                        <span class="text-sm text-base-content/60"
                            >Importing...</span
                        >
                    </div>
                {:else}
                    <input
                        type="file"
                        accept=".zip"
                        class="file-input file-input-xs file-input-bordered"
                        onchange={importBackup}
                    />
                {/if}
                {#if importError}
                    <p class="text-xs text-error">{importError}</p>
                {/if}
            </div>
        {/if}
    </div>
</div>
