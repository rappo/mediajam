<script>
    import { page } from "$app/stores";

    /*
     * CONVENTION (10+ SECOND RULE):
     *   Any sync or action expected to take 10+ seconds MUST use the
     *   background-browsable pattern: dedicated engine state, SSE streaming,
     *   pause/resume, and SyncFooter visibility. This ensures users can
     *   safely browse away and monitor progress from anywhere in the app.
     *
     * NOTE: SyncFooter uses POLLING (not SSE) to avoid saturating the
     * browser's 6-connection-per-domain HTTP/1.1 limit. SSE connections
     * are long-lived and shared across ALL tabs, so even 2 tabs with
     * 4 SSE each = 8 connections = blocked navigation.
     */

    // State
    let visible = $state(false);
    let lastLog = $state("");
    let progress = $state(0);
    let syncType = $state("");
    let expanded = $state(false);

    function isOnSyncPage() {
        const path =
            typeof window !== "undefined" ? window.location.pathname : "";
        return path === "/settings/system" || path === "/settings/account";
    }

    async function pollSyncStatus() {
        try {
            const res = await fetch("/api/sync/status");
            if (!res.ok) return;
            const data = await res.json();

            // Find the first running sync to display
            if (data.jellyfin) {
                syncType = data.jellyfin.libraryName || "Jellyfin Sync";
                progress = data.jellyfin.progress || 0;
                if (data.jellyfin.lastLog) lastLog = data.jellyfin.lastLog;
                visible = !isOnSyncPage();
            } else if (data.people) {
                syncType = "People Sync";
                progress = data.people.progress || 0;
                if (data.people.lastLog) lastLog = data.people.lastLog;
                visible = !isOnSyncPage();
            } else if (data.backfill) {
                syncType = data.backfill.tier
                    ? `${data.backfill.tier.charAt(0).toUpperCase() + data.backfill.tier.slice(1)} Import`
                    : "Import";
                progress = data.backfill.progress || 0;
                if (data.backfill.lastLog) lastLog = data.backfill.lastLog;
                visible = !isOnSyncPage();
            } else if (data.musicbrainz) {
                syncType = "MusicBrainz Enrich";
                progress = data.musicbrainz.progress || 0;
                if (data.musicbrainz.lastLog)
                    lastLog = data.musicbrainz.lastLog;
                visible = !isOnSyncPage();
            } else {
                // Nothing running — hide if we were showing
                if (visible) {
                    setTimeout(() => {
                        visible = false;
                    }, 3000);
                }
            }
        } catch {
            /* ignore fetch errors */
        }
    }

    // Poll every 5s when authenticated and not on sync page
    $effect(() => {
        const _ = $page.url.pathname;

        if (!$page.data.user || isOnSyncPage()) {
            visible = false;
            return;
        }

        // Initial poll
        pollSyncStatus();

        // Set up interval
        const interval = setInterval(pollSyncStatus, 5000);

        return () => clearInterval(interval);
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
                    : syncType.toLowerCase().includes("people") ||
                        syncType.toLowerCase().includes("musicbrainz")
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
