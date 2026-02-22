<script>
    /** @type {{ wizardData: any }} */
    let { wizardData } = $props();

    let syncStatus = $state("idle");
    let logs = $state([]);
    let eventSource = $state(null);

    // Per-library tracking
    let currentLibrary = $state(null);
    let libraryCount = $state(0);
    let libraryIndex = $state(0);
    let parentCount = $state(0);
    let parentIndex = $state(0);
    let libProgress = $state(0);
    let totalSynced = $state(0);
    let totalErrors = $state(0);

    function addLog(message, type = "info") {
        const timestamp = new Date().toLocaleTimeString();
        logs = [...logs, { timestamp, message, type }];
    }

    // Compute overall progress from library position + within-library progress
    function overallProgress() {
        if (libraryCount === 0) return 0;
        const perLib = 100 / libraryCount;
        const base = libraryIndex * perLib;
        const within = (libProgress / 100) * perLib;
        return Math.min(100, Math.round(base + within));
    }

    async function startSync() {
        syncStatus = "syncing";
        logs = [];
        addLog("Starting initial sync...", "info");

        try {
            const res = await fetch("/api/sync", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "start" }),
            });

            if (!res.ok) {
                addLog("Failed to start sync engine.", "error");
                syncStatus = "error";
                return;
            }

            // Connect to SSE stream
            eventSource = new EventSource("/api/sync");

            eventSource.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);

                    if (data.type === "library_start") {
                        currentLibrary = data.libraryName;
                        libraryCount = data.libraryCount;
                        libraryIndex = data.libraryIndex;
                        libProgress = 0;
                        parentCount = 0;
                        parentIndex = 0;
                    } else if (data.type === "library_count") {
                        parentCount = data.parentCount;
                    } else if (data.type === "progress") {
                        if (data.libProgress !== undefined) {
                            libProgress = Math.min(100, data.libProgress);
                        }
                        if (data.parentIndex !== undefined) {
                            parentIndex = data.parentIndex;
                        }
                        if (data.parentCount !== undefined) {
                            parentCount = data.parentCount;
                        }
                        if (data.totalSynced !== undefined) {
                            totalSynced = data.totalSynced;
                        }
                        if (data.errors !== undefined) {
                            totalErrors = data.errors;
                        }
                        if (data.currentItem) {
                            currentLibrary = data.libraryName || currentLibrary;
                        }
                        if (data.libraryIndex !== undefined) {
                            libraryIndex = data.libraryIndex;
                        }
                    } else if (data.type === "library_complete") {
                        if (data.totalSynced !== undefined)
                            totalSynced = data.totalSynced;
                        if (data.totalErrors !== undefined)
                            totalErrors = data.totalErrors;
                        libProgress = 100;
                    } else if (data.type === "complete") {
                        syncStatus = "complete";
                        libProgress = 100;
                        if (data.totalSynced !== undefined)
                            totalSynced = data.totalSynced;
                        if (data.totalErrors !== undefined)
                            totalErrors = data.totalErrors;
                        eventSource?.close();
                    } else if (data.type === "error") {
                        totalErrors++;
                    }

                    // Add log entry
                    if (data.log) {
                        addLog(data.log, data.logType || "info");
                    }
                } catch (e) {
                    // ignore parse errors
                }
            };

            eventSource.onerror = () => {
                if (syncStatus === "syncing") {
                    addLog("Connection lost. Retrying...", "warning");
                }
            };
        } catch (e) {
            addLog("Failed to start sync.", "error");
            syncStatus = "error";
        }
    }

    async function togglePause() {
        const action = syncStatus === "paused" ? "resume" : "pause";
        try {
            await fetch("/api/sync", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action }),
            });

            syncStatus = action === "pause" ? "paused" : "syncing";
            addLog(
                action === "pause" ? "Sync paused." : "Sync resumed.",
                "info",
            );
        } catch (e) {
            addLog(`Failed to ${action} sync.`, "error");
        }
    }

    async function finishSetup() {
        try {
            await fetch("/api/settings", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ setup_complete: 1 }),
            });
            window.location.href = "/";
        } catch (e) {
            addLog("Failed to complete setup.", "error");
        }
    }

    function getLogClass(type) {
        switch (type) {
            case "success":
                return "text-success";
            case "error":
                return "text-error";
            case "warning":
                return "text-warning";
            default:
                return "text-base-content/70";
        }
    }

    // Auto-scroll console
    let consoleEl = $state(null);
    $effect(() => {
        if (logs.length && consoleEl) {
            consoleEl.scrollTop = consoleEl.scrollHeight;
        }
    });
</script>

<div>
    <h2 class="text-2xl font-bold mb-2">Sync Your Library</h2>
    <p class="text-base-content/60 text-sm mb-6">
        Pull metadata from Jellyfin and external APIs to build your statistics
        database.
    </p>

    {#if syncStatus === "idle"}
        <!-- Pre-sync summary -->
        <div class="bg-base-300/30 rounded-xl p-5 mb-6 space-y-3">
            <div class="flex items-center gap-3">
                <div
                    class="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center text-sm"
                >
                    🔗
                </div>
                <div>
                    <span class="text-sm font-medium">Jellyfin Server</span>
                    <p class="text-xs text-base-content/50">
                        {wizardData.jellyfinUrl}
                    </p>
                </div>
            </div>
            <div class="flex items-center gap-3">
                <div
                    class="w-8 h-8 rounded-lg bg-secondary/20 flex items-center justify-center text-sm"
                >
                    📚
                </div>
                <div>
                    <span class="text-sm font-medium">Libraries</span>
                    <p class="text-xs text-base-content/50">
                        {wizardData.selectedLibraries?.length || 0} libraries selected
                    </p>
                </div>
            </div>
            <div class="flex items-center gap-3">
                <div
                    class="w-8 h-8 rounded-lg bg-accent/20 flex items-center justify-center text-sm"
                >
                    🔑
                </div>
                <div>
                    <span class="text-sm font-medium">API Keys</span>
                    <p class="text-xs text-base-content/50">
                        {[
                            wizardData.tvdbApiKey ? "TVDB" : null,
                            wizardData.tmdbApiKey ? "TMDB" : null,
                            wizardData.musicbrainzApiKey ? "MusicBrainz" : null,
                        ]
                            .filter(Boolean)
                            .join(", ") || "None configured — basic sync only"}
                    </p>
                </div>
            </div>
        </div>

        <button class="btn btn-primary btn-lg w-full gap-2" onclick={startSync}>
            <svg
                xmlns="http://www.w3.org/2000/svg"
                class="h-5 w-5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
            >
                <polyline points="23 4 23 10 17 10" /><polyline
                    points="1 20 1 14 7 14"
                /><path
                    d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"
                />
            </svg>
            Begin Sync
        </button>

        <button class="btn btn-ghost btn-sm w-full mt-3" onclick={finishSetup}>
            Skip & finish setup
        </button>
    {:else}
        <!-- Progress Section -->
        <div class="space-y-4">
            <!-- Stats Row -->
            <div class="grid grid-cols-3 gap-3">
                <div class="stat bg-base-300/30 rounded-xl p-3">
                    <div class="stat-title text-xs">Synced</div>
                    <div class="stat-value text-lg text-primary">
                        {totalSynced.toLocaleString()}
                    </div>
                    <div class="stat-desc text-xs">items total</div>
                </div>
                <div class="stat bg-base-300/30 rounded-xl p-3">
                    <div class="stat-title text-xs">Progress</div>
                    <div class="stat-value text-lg">{overallProgress()}%</div>
                    <div class="stat-desc text-xs">
                        {syncStatus === "complete"
                            ? "Done!"
                            : syncStatus === "paused"
                              ? "Paused"
                              : currentLibrary
                                ? "Working..."
                                : "Preparing..."}
                    </div>
                </div>
                <div class="stat bg-base-300/30 rounded-xl p-3">
                    <div class="stat-title text-xs">Errors</div>
                    <div
                        class="stat-value text-lg"
                        class:text-error={totalErrors > 0}
                    >
                        {totalErrors}
                    </div>
                    <div class="stat-desc text-xs">
                        {totalErrors === 0 ? "All good!" : "Check logs"}
                    </div>
                </div>
            </div>

            <!-- Per-library progress -->
            {#if currentLibrary && syncStatus !== "complete"}
                <div class="bg-base-300/20 rounded-xl p-3 space-y-2">
                    <div class="flex justify-between items-center text-sm">
                        <span class="font-medium">📚 {currentLibrary}</span>
                        <span class="text-xs text-base-content/50">
                            Library {libraryIndex + 1} of {libraryCount}
                        </span>
                    </div>
                    <div
                        class="flex justify-between text-xs text-base-content/60 mb-1"
                    >
                        <span>{parentIndex} of {parentCount} items</span>
                        <span>{Math.min(100, libProgress)}%</span>
                    </div>
                    <progress
                        class="progress progress-primary w-full"
                        value={Math.min(100, libProgress)}
                        max="100"
                    ></progress>
                </div>
            {/if}

            <!-- Overall progress bar -->
            <div>
                <div
                    class="flex justify-between text-xs text-base-content/60 mb-1"
                >
                    <span
                        >{syncStatus === "complete"
                            ? "Sync complete!"
                            : "Overall progress"}</span
                    >
                    <span>{overallProgress()}%</span>
                </div>
                <progress
                    class="progress progress-secondary w-full"
                    value={overallProgress()}
                    max="100"
                ></progress>
            </div>

            <!-- Console Log -->
            <div
                bind:this={consoleEl}
                class="sync-console bg-neutral text-neutral-content rounded-xl p-4 h-48 overflow-y-auto border border-base-300"
            >
                {#each logs as log}
                    <div class="flex gap-2 {getLogClass(log.type)}">
                        <span class="opacity-50 shrink-0"
                            >[{log.timestamp}]</span
                        >
                        <span>{log.message}</span>
                    </div>
                {/each}
                {#if syncStatus === "syncing"}
                    <div class="flex items-center gap-2 opacity-50 mt-1">
                        <span class="loading loading-dots loading-xs"></span>
                    </div>
                {/if}
            </div>

            <!-- Controls -->
            <div class="flex gap-3">
                {#if syncStatus === "syncing" || syncStatus === "paused"}
                    <button
                        class="btn btn-outline flex-1"
                        onclick={togglePause}
                    >
                        {#if syncStatus === "paused"}
                            <svg
                                xmlns="http://www.w3.org/2000/svg"
                                class="h-4 w-4"
                                viewBox="0 0 24 24"
                                fill="currentColor"
                            >
                                <polygon points="5 3 19 12 5 21 5 3" />
                            </svg>
                            Resume
                        {:else}
                            <svg
                                xmlns="http://www.w3.org/2000/svg"
                                class="h-4 w-4"
                                viewBox="0 0 24 24"
                                fill="currentColor"
                            >
                                <rect x="6" y="4" width="4" height="16" /><rect
                                    x="14"
                                    y="4"
                                    width="4"
                                    height="16"
                                />
                            </svg>
                            Pause
                        {/if}
                    </button>
                {/if}

                {#if syncStatus === "complete" || syncStatus === "error"}
                    <button
                        class="btn btn-primary flex-1 gap-2"
                        onclick={finishSetup}
                    >
                        <svg
                            xmlns="http://www.w3.org/2000/svg"
                            class="h-5 w-5"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                        >
                            <polyline points="20 6 9 17 4 12" />
                        </svg>
                        Go to Dashboard
                    </button>
                {/if}
            </div>
        </div>
    {/if}
</div>
