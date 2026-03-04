<script>
    import { page } from "$app/stores";

    // State
    let visible = $state(false);
    let label = $state("");
    let lastLog = $state("");
    let progress = $state(0);
    let syncType = $state(""); // 'jellyfin' | 'trakt' | 'lastfm' | etc
    let expanded = $state(false);

    /** @type {EventSource | null} */
    let syncES = null;
    /** @type {EventSource | null} */
    let backfillES = null;

    function isOnSyncPage() {
        const path =
            typeof window !== "undefined" ? window.location.pathname : "";
        return path === "/settings/system" || path === "/settings/account";
    }

    function handleSyncMessage(d) {
        if (d.type === "snapshot" && d.running) {
            syncType = d.libraryName
                ? `Jellyfin: ${d.libraryName}`
                : "Jellyfin Sync";
            progress = d.progress || 0;
            if (d.logs && d.logs.length > 0) {
                lastLog = d.logs[d.logs.length - 1].message;
            }
            visible = !isOnSyncPage();
        } else if (d.type === "progress" || d.libraryName) {
            syncType = d.libraryName
                ? `Jellyfin: ${d.libraryName}`
                : syncType || "Jellyfin Sync";
            if (d.libProgress !== undefined) progress = d.libProgress;
            if (d.log) lastLog = d.log;
            visible = !isOnSyncPage();
        } else if (d.type === "complete" || d.type === "error") {
            if (d.log) lastLog = d.log;
            // Show briefly then hide
            visible = !isOnSyncPage();
            setTimeout(() => {
                visible = false;
                syncES?.close();
                syncES = null;
            }, 5000);
        }
    }

    function handleBackfillMessage(d) {
        if (d.type === "snapshot" && d.running) {
            syncType = d.tier ? `${capitalize(d.tier)} Import` : "Import";
            if (d.lastProgress?.progressPercent !== undefined)
                progress = d.lastProgress.progressPercent;
            if (d.logs && d.logs.length > 0) {
                lastLog = d.logs[d.logs.length - 1].message;
            }
            visible = !isOnSyncPage();
        } else if (d.type === "backfill_start") {
            syncType = d.tier ? `${capitalize(d.tier)} Import` : "Import";
            if (d.log) lastLog = d.log;
            visible = !isOnSyncPage();
        } else if (d.type === "backfill_progress") {
            if (d.progressPercent !== undefined) progress = d.progressPercent;
            if (d.log) lastLog = d.log;
            visible = !isOnSyncPage();
        } else if (
            d.type === "backfill_complete" ||
            d.type === "backfill_error"
        ) {
            if (d.log) lastLog = d.log;
            visible = !isOnSyncPage();
            setTimeout(() => {
                visible = false;
                backfillES?.close();
                backfillES = null;
            }, 5000);
        }
    }

    function capitalize(s) {
        return s ? s.charAt(0).toUpperCase() + s.slice(1) : "";
    }

    function connectSync() {
        if (syncES) return;
        syncES = new EventSource("/api/sync");
        let gotConnected = false;
        syncES.onmessage = (event) => {
            try {
                const d = JSON.parse(event.data);
                if (d.type === "connected") {
                    gotConnected = true;
                    return;
                }
                if (d.type === "snapshot") {
                    if (d.running) {
                        handleSyncMessage(d);
                        // Keep listening
                    } else if (gotConnected) {
                        syncES?.close();
                        syncES = null;
                    }
                } else {
                    handleSyncMessage(d);
                }
            } catch {
                /* ignore */
            }
        };
        syncES.onerror = () => {
            syncES?.close();
            syncES = null;
        };
    }

    function connectBackfill() {
        if (backfillES) return;
        backfillES = new EventSource("/api/backfill/history");
        backfillES.onmessage = (event) => {
            try {
                const d = JSON.parse(event.data);
                if (d.type === "connected") {
                    if (!d.isRunning) {
                        backfillES?.close();
                        backfillES = null;
                    }
                    return;
                }
                if (d.type === "snapshot") {
                    if (d.running) {
                        handleBackfillMessage(d);
                    } else {
                        backfillES?.close();
                        backfillES = null;
                    }
                } else {
                    handleBackfillMessage(d);
                }
            } catch {
                /* ignore */
            }
        };
        backfillES.onerror = () => {
            backfillES?.close();
            backfillES = null;
        };
    }

    // Poll both endpoints on mount and on navigation
    $effect(() => {
        // Re-run on navigation
        const _ = $page.url.pathname;
        connectSync();
        connectBackfill();

        // Also update visibility based on current page
        if (isOnSyncPage()) {
            visible = false;
        }

        return () => {
            syncES?.close();
            syncES = null;
            backfillES?.close();
            backfillES = null;
        };
    });
</script>

{#if visible}
    <div
        class="fixed bottom-0 left-0 right-0 z-50 bg-base-300/95 backdrop-blur border-t border-base-content/10 shadow-xl transition-all"
    >
        <div class="max-w-screen-xl mx-auto px-4 py-2 flex items-center gap-3">
            <!-- Spinner -->
            <span
                class="loading loading-spinner loading-sm text-primary shrink-0"
            ></span>

            <!-- Type label -->
            <span class="text-sm font-semibold text-primary shrink-0"
                >{syncType}</span
            >

            <!-- Progress bar -->
            {#if progress > 0}
                <div class="flex-1 max-w-48">
                    <div
                        class="h-1.5 bg-base-content/10 rounded-full overflow-hidden"
                    >
                        <div
                            class="h-full bg-primary rounded-full transition-all duration-300"
                            style="width: {Math.min(progress, 100)}%"
                        ></div>
                    </div>
                </div>
                <span class="text-xs text-base-content/50 shrink-0"
                    >{Math.round(progress)}%</span
                >
            {/if}

            <!-- Last log message (expandable) -->
            <button
                class="flex-1 text-left text-xs text-base-content/60 truncate cursor-pointer hover:text-base-content/80 transition-colors min-w-0"
                onclick={() => (expanded = !expanded)}
                title={lastLog}
            >
                {lastLog}
            </button>

            <!-- Go to settings link -->
            <a
                href={syncType.toLowerCase().includes("jellyfin") &&
                !syncType.toLowerCase().includes("import")
                    ? "/settings/system"
                    : "/settings/account"}
                class="btn btn-xs btn-ghost text-primary shrink-0"
            >
                View
            </a>

            <!-- Dismiss -->
            <button
                class="btn btn-xs btn-ghost btn-circle shrink-0"
                onclick={() => (visible = false)}>✕</button
            >
        </div>

        {#if expanded && lastLog}
            <div class="max-w-screen-xl mx-auto px-4 pb-2">
                <div
                    class="text-xs text-base-content/60 bg-base-100/50 rounded p-2 max-h-20 overflow-y-auto"
                >
                    {lastLog}
                </div>
            </div>
        {/if}
    </div>
{/if}
