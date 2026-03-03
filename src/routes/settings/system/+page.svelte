<script>
    import ServiceIcon from "$lib/components/ServiceIcon.svelte";
    import { page } from "$app/stores";

    /** @type {{ data: import('./$types').PageData }} */
    let { data } = $props();

    // ─── Form State ──────────────────────────────────────────────────────────────
    let jellyfinUrl = $state(data.settings.jellyfinUrl || "");
    let tvdbApiKey = $state("");
    let tmdbApiKey = $state("");
    let musicbrainzApiKey = $state("");
    let traktClientId = $state("");
    let traktClientSecret = $state("");
    let lastfmApiKey = $state("");
    let lastfmSharedSecret = $state("");
    let jellyfinPrDbPath = $state(data.settings.jellyfinPrDbPath || "");
    let jellyfinSyncCheck = $state(!!data.settings.jellyfinSyncCheck);

    // Snapshot initial values for dirty detection and undo
    const initialValues = {
        jellyfinUrl: data.settings.jellyfinUrl || "",
        tvdbApiKey: "",
        tmdbApiKey: "",
        musicbrainzApiKey: "",
        traktClientId: "",
        traktClientSecret: "",
        lastfmApiKey: "",
        lastfmSharedSecret: "",
        jellyfinPrDbPath: data.settings.jellyfinPrDbPath || "",
        jellyfinSyncCheck: !!data.settings.jellyfinSyncCheck,
    };

    let saving = $state(false);
    let error = $state("");

    // ─── Dirty Detection ─────────────────────────────────────────────────────────
    let isDirty = $derived(
        jellyfinUrl !== initialValues.jellyfinUrl ||
            tvdbApiKey !== initialValues.tvdbApiKey ||
            tmdbApiKey !== initialValues.tmdbApiKey ||
            musicbrainzApiKey !== initialValues.musicbrainzApiKey ||
            traktClientId !== initialValues.traktClientId ||
            traktClientSecret !== initialValues.traktClientSecret ||
            lastfmApiKey !== initialValues.lastfmApiKey ||
            lastfmSharedSecret !== initialValues.lastfmSharedSecret ||
            jellyfinPrDbPath !== initialValues.jellyfinPrDbPath ||
            jellyfinSyncCheck !== initialValues.jellyfinSyncCheck,
    );

    // ─── Undo Toast ──────────────────────────────────────────────────────────────
    let showUndoToast = $state(false);
    let undoSnapshot = $state(null);
    let undoTimer = $state(null);

    function snapshotCurrentValues() {
        return {
            jellyfinUrl,
            tvdbApiKey,
            tmdbApiKey,
            musicbrainzApiKey,
            traktClientId,
            traktClientSecret,
            lastfmApiKey,
            lastfmSharedSecret,
            jellyfinPrDbPath,
            jellyfinSyncCheck,
        };
    }

    function restoreValues(snapshot) {
        jellyfinUrl = snapshot.jellyfinUrl;
        tvdbApiKey = snapshot.tvdbApiKey;
        tmdbApiKey = snapshot.tmdbApiKey;
        musicbrainzApiKey = snapshot.musicbrainzApiKey;
        traktClientId = snapshot.traktClientId;
        traktClientSecret = snapshot.traktClientSecret;
        lastfmApiKey = snapshot.lastfmApiKey;
        lastfmSharedSecret = snapshot.lastfmSharedSecret;
        jellyfinPrDbPath = snapshot.jellyfinPrDbPath;
        jellyfinSyncCheck = snapshot.jellyfinSyncCheck;
    }

    // ─── Validation ──────────────────────────────────────────────────────────────
    /** @type {Record<string, { status: 'idle' | 'checking' | 'valid' | 'invalid', message: string }>} */
    let validation = $state({
        tvdb: { status: "idle", message: "" },
        tmdb: { status: "idle", message: "" },
        trakt: { status: "idle", message: "" },
        lastfm: { status: "idle", message: "" },
    });

    async function validateService(service, credentials) {
        validation[service] = { status: "checking", message: "Checking..." };
        try {
            const res = await fetch("/api/settings/validate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ service, credentials }),
            });
            const result = await res.json();
            validation[service] = {
                status: result.valid ? "valid" : "invalid",
                message: result.message,
            };
        } catch {
            validation[service] = {
                status: "invalid",
                message: "Connection error",
            };
        }
    }

    // Auto-validate when keys are entered
    $effect(() => {
        if (tvdbApiKey && tvdbApiKey.length > 8 && tvdbApiKey !== "••••••••") {
            validateService("tvdb", { tvdb_api_key: tvdbApiKey });
        } else if (!tvdbApiKey) {
            validation.tvdb = { status: "idle", message: "" };
        }
    });
    $effect(() => {
        if (tmdbApiKey && tmdbApiKey.length > 8 && tmdbApiKey !== "••••••••") {
            validateService("tmdb", { tmdb_api_key: tmdbApiKey });
        } else if (!tmdbApiKey) {
            validation.tmdb = { status: "idle", message: "" };
        }
    });
    $effect(() => {
        if (traktClientId && traktClientId.length > 8) {
            validateService("trakt", { trakt_client_id: traktClientId });
        } else if (!traktClientId) {
            validation.trakt = { status: "idle", message: "" };
        }
    });
    $effect(() => {
        if (
            lastfmApiKey &&
            lastfmApiKey.length > 8 &&
            lastfmApiKey !== "••••••••"
        ) {
            validateService("lastfm", { lastfm_api_key: lastfmApiKey });
        } else if (!lastfmApiKey) {
            validation.lastfm = { status: "idle", message: "" };
        }
    });

    // ─── Save ────────────────────────────────────────────────────────────────────
    async function saveSettings() {
        saving = true;
        error = "";

        // Snapshot pre-save values for undo
        const preSnapshot = snapshotCurrentValues();

        try {
            const payload = { jellyfin_url: jellyfinUrl };

            if (tvdbApiKey && tvdbApiKey !== "••••••••")
                payload.tvdb_api_key = tvdbApiKey;
            if (tmdbApiKey && tmdbApiKey !== "••••••••")
                payload.tmdb_api_key = tmdbApiKey;
            if (musicbrainzApiKey && musicbrainzApiKey !== "••••••••")
                payload.musicbrainz_api_key = musicbrainzApiKey;
            if (traktClientId) payload.trakt_client_id = traktClientId;
            if (traktClientSecret)
                payload.trakt_client_secret = traktClientSecret;
            if (lastfmApiKey) payload.lastfm_api_key = lastfmApiKey;
            if (lastfmSharedSecret)
                payload.lastfm_shared_secret = lastfmSharedSecret;
            payload.jellyfin_pr_db_path = jellyfinPrDbPath;
            payload.jellyfin_sync_check = jellyfinSyncCheck ? 1 : 0;

            const res = await fetch("/api/settings", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });
            const result = await res.json();

            if (result.success) {
                // Update initial values so dirty detection resets
                Object.assign(initialValues, snapshotCurrentValues());

                // Show undo toast
                undoSnapshot = preSnapshot;
                showUndoToast = true;
                if (undoTimer) clearTimeout(undoTimer);
                undoTimer = setTimeout(() => {
                    showUndoToast = false;
                    undoSnapshot = null;
                }, 8000);
            } else {
                error = result.error || "Failed to save settings.";
            }
        } catch {
            error = "An error occurred.";
        }

        saving = false;
    }

    async function undoSave() {
        if (!undoSnapshot) return;
        const snapshot = undoSnapshot;
        restoreValues(snapshot);
        showUndoToast = false;
        if (undoTimer) clearTimeout(undoTimer);

        // Re-save with the old values
        await saveSettings();
        // Hide the toast that the re-save creates
        showUndoToast = false;
        if (undoTimer) clearTimeout(undoTimer);
    }

    // ─── Sync State ──────────────────────────────────────────────────────────────
    let syncStatus = $state("idle");
    let syncProgress = $state(0);
    let syncLibrary = $state("");
    let syncItemsSynced = $state(0);
    let syncErrors = $state(0);
    let syncLogs = $state([]);
    /** @type {EventSource | null} */
    let syncEventSource = $state(null);
    let copyFeedback = $state(false);
    /** @type {HTMLDivElement | null} */
    let consoleEl = $state(null);

    $effect(() => {
        if (syncLogs.length && consoleEl) {
            consoleEl.scrollTop = consoleEl.scrollHeight;
        }
    });

    function addSyncLog(message, type = "info") {
        syncLogs = [
            ...syncLogs.slice(-100),
            { time: new Date().toLocaleTimeString(), message, type },
        ];
    }

    /** Shared handler for all SSE messages */
    function handleSSEMessage(d) {
        if (d.type === "snapshot") {
            syncStatus = d.paused ? "paused" : "syncing";
            syncLibrary = d.libraryName || "";
            syncProgress = d.progress || 0;
            syncItemsSynced = d.itemsSynced || 0;
            syncErrors = d.errors || 0;
            if (d.logs?.length) syncLogs = d.logs;
        } else if (d.type === "library_start") {
            syncLibrary = d.libraryName;
        } else if (d.type === "progress") {
            if (d.libProgress !== undefined) syncProgress = d.libProgress;
            if (d.totalSynced !== undefined) syncItemsSynced = d.totalSynced;
            if (d.errors !== undefined) syncErrors = d.errors;
            if (d.libraryName) syncLibrary = d.libraryName;
        } else if (d.type === "library_complete") {
            if (d.totalSynced !== undefined) syncItemsSynced = d.totalSynced;
            if (d.totalErrors !== undefined) syncErrors = d.totalErrors;
        } else if (d.type === "complete") {
            syncStatus = "complete";
            syncProgress = 100;
            if (d.totalSynced !== undefined) syncItemsSynced = d.totalSynced;
            syncEventSource?.close();
        } else if (d.type === "error") {
            syncErrors++;
        }
        if (d.log) addSyncLog(d.log, d.logType || "info");
    }

    /** Connect to SSE and wire up shared handler */
    function connectSSE() {
        if (syncEventSource) syncEventSource.close();
        syncEventSource = new EventSource("/api/sync");
        syncEventSource.onmessage = (event) => {
            try {
                handleSSEMessage(JSON.parse(event.data));
            } catch {
                /* ignore */
            }
        };
        syncEventSource.onerror = () => {
            if (syncStatus === "syncing")
                addSyncLog("Connection lost.", "warning");
        };
    }

    // Auto-reconnect on mount if sync is running
    $effect(() => {
        const es = new EventSource("/api/sync");
        let adopted = false;
        es.onmessage = (event) => {
            try {
                const d = JSON.parse(event.data);
                if (d.type === "snapshot" && d.running) {
                    adopted = true;
                    syncEventSource = es;
                    handleSSEMessage(d);
                    es.onmessage = (ev) => {
                        try {
                            handleSSEMessage(JSON.parse(ev.data));
                        } catch {
                            /* ignore */
                        }
                    };
                    es.onerror = () => {
                        if (syncStatus === "syncing")
                            addSyncLog("Connection lost.", "warning");
                    };
                } else if (!adopted) {
                    es.close();
                }
            } catch {
                es.close();
            }
        };
        es.onerror = () => {
            if (!adopted) es.close();
        };
        return () => {
            if (!adopted) es.close();
        };
    });

    async function triggerSync(
        libraryId = null,
        libraryName = null,
        force = false,
    ) {
        syncStatus = "syncing";
        syncProgress = 0;
        syncItemsSynced = 0;
        syncErrors = 0;
        syncLogs = [];

        const label = libraryName
            ? `Syncing ${libraryName}${force ? " (full)" : ""}...`
            : force
              ? "Starting full re-sync..."
              : "Starting sync...";
        addSyncLog(label, "info");

        try {
            const res = await fetch("/api/sync", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "start", libraryId, force }),
            });
            const result = await res.json();

            if (!result.success) {
                addSyncLog(result.error || "Failed to start sync.", "error");
                syncStatus = "error";
                return;
            }

            connectSSE();
        } catch {
            addSyncLog("Failed to start sync.", "error");
            syncStatus = "error";
        }
    }

    async function toggleSyncPause() {
        const action = syncStatus === "paused" ? "resume" : "pause";
        await fetch("/api/sync", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action }),
        });
        syncStatus = action === "pause" ? "paused" : "syncing";
        addSyncLog(action === "pause" ? "Paused." : "Resumed.", "info");
    }

    function getLogClass(type) {
        if (type === "success") return "text-success";
        if (type === "error") return "text-error";
        if (type === "warning") return "text-warning";
        return "text-base-content/70";
    }

    function copySyncLog() {
        const text = syncLogs.map((l) => `[${l.time}] ${l.message}`).join("\n");
        navigator.clipboard.writeText(text);
        copyFeedback = true;
        setTimeout(() => (copyFeedback = false), 2000);
    }
</script>

<!-- Unsaved Changes Banner (animated) -->
<div
    class="sticky top-16 z-40 -mx-4 mb-4 overflow-hidden transition-all duration-1000 ease-in-out"
    style="max-height: {isDirty ? '80px' : '0px'}; opacity: {isDirty ? 1 : 0};"
>
    <div class="alert alert-warning shadow-lg rounded-xl py-2 px-4">
        <svg
            xmlns="http://www.w3.org/2000/svg"
            class="h-5 w-5 shrink-0"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
        >
            <circle cx="12" cy="12" r="10" /><line
                x1="12"
                y1="8"
                x2="12"
                y2="12"
            /><line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
        <span class="text-sm font-medium">You have unsaved changes</span>
        <button
            class="btn btn-sm btn-primary gap-1"
            onclick={saveSettings}
            disabled={saving}
        >
            {#if saving}
                <span class="loading loading-spinner loading-xs"></span>
            {/if}
            Save Now
        </button>
    </div>
</div>

<div class="space-y-6">
    <!-- Admin-Only Warning -->
    {#if !$page.data.user?.isAdmin}
        <div class="card bg-error/10 border border-error/30">
            <div class="card-body py-4">
                <div class="flex items-center gap-3">
                    <svg
                        xmlns="http://www.w3.org/2000/svg"
                        class="h-5 w-5 text-error shrink-0"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                    >
                        <rect
                            x="3"
                            y="11"
                            width="18"
                            height="11"
                            rx="2"
                            ry="2"
                        /><path d="M7 11V7a5 5 0 0110 0v4" />
                    </svg>
                    <div>
                        <p class="font-semibold text-sm">
                            Admin access required
                        </p>
                        <p class="text-xs text-base-content/60">
                            These settings can only be modified by an
                            administrator.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    {:else}
        <div class="card bg-warning/5 border border-warning/20">
            <div class="card-body py-4">
                <div class="flex items-center gap-3">
                    <svg
                        xmlns="http://www.w3.org/2000/svg"
                        class="h-5 w-5 text-warning shrink-0"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                    >
                        <path
                            d="M12 9v2m0 4h.01M5.07 19h13.86c1.54 0 2.5-1.67 1.73-3L13.73 4c-.77-1.33-2.69-1.33-3.46 0L3.34 16c-.77 1.33.19 3 1.73 3z"
                        />
                    </svg>
                    <div>
                        <p class="font-semibold text-sm">System Settings</p>
                        <p class="text-xs text-base-content/60">
                            Changes here affect all users on this Mediajam
                            instance.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    {/if}
    <!-- Jellyfin Connection -->
    <div class="card bg-base-200/50 border border-base-300">
        <div class="card-body">
            <h2 class="card-title text-lg">
                <ServiceIcon service="jellyfin" class="text-[#00A4DC]" />
                Jellyfin Server
            </h2>
            <div class="form-control">
                <label class="label" for="settings-jellyfin-url"
                    ><span class="label-text">Server URL</span></label
                >
                <input
                    id="settings-jellyfin-url"
                    type="url"
                    class="input input-bordered"
                    bind:value={jellyfinUrl}
                    placeholder="http://localhost:8096"
                />
            </div>

            <!-- Jellyfin Sync Check Toggle -->
            <div class="divider my-2"></div>
            <div class="form-control">
                <label
                    class="label cursor-pointer justify-start gap-3"
                    for="settings-sync-check"
                >
                    <input
                        id="settings-sync-check"
                        type="checkbox"
                        class="toggle toggle-primary toggle-sm"
                        bind:checked={jellyfinSyncCheck}
                    />
                    <div>
                        <span class="label-text font-medium"
                            >Jellyfin play count sync check</span
                        >
                        <p class="text-xs text-base-content/50 mt-0.5">
                            Compare local play history with Jellyfin and warn
                            when out of sync
                        </p>
                    </div>
                </label>
            </div>
        </div>
    </div>

    <!-- Metadata API Keys -->
    <div class="card bg-base-200/50 border border-base-300">
        <div class="card-body">
            <h2 class="card-title text-lg">
                <svg
                    xmlns="http://www.w3.org/2000/svg"
                    class="h-5 w-5 text-secondary"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                >
                    <path
                        d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 11-7.778 7.778 5.5 5.5 0 017.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"
                    />
                </svg>
                Metadata API Keys
            </h2>

            <!-- TVDB -->
            <div class="form-control">
                <label class="label" for="settings-tvdb"
                    ><span class="label-text flex items-center gap-1.5"
                        ><ServiceIcon
                            service="tvdb"
                            size="w-4 h-4"
                            class="text-[#6CD491]"
                        />TheTVDB API Key</span
                    ></label
                >
                <div class="flex gap-2 items-start">
                    <div class="flex-1">
                        <input
                            id="settings-tvdb"
                            type="text"
                            class="input input-bordered input-sm w-full"
                            bind:value={tvdbApiKey}
                            placeholder={data.settings.hasTvdbKey
                                ? "••••••••"
                                : "Not set"}
                        />
                    </div>
                    {#if validation.tvdb.status !== "idle"}
                        <div class="flex items-center gap-1.5 mt-1.5">
                            {#if validation.tvdb.status === "checking"}
                                <span
                                    class="loading loading-spinner loading-xs text-info"
                                ></span>
                            {:else if validation.tvdb.status === "valid"}
                                <span
                                    class="badge badge-success badge-sm gap-1"
                                >
                                    <svg
                                        xmlns="http://www.w3.org/2000/svg"
                                        class="h-3 w-3"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        stroke-width="3"
                                        ><polyline
                                            points="20 6 9 17 4 12"
                                        /></svg
                                    >
                                    Valid
                                </span>
                            {:else}
                                <span class="badge badge-error badge-sm gap-1">
                                    <svg
                                        xmlns="http://www.w3.org/2000/svg"
                                        class="h-3 w-3"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        stroke-width="3"
                                        ><line
                                            x1="18"
                                            y1="6"
                                            x2="6"
                                            y2="18"
                                        /><line
                                            x1="6"
                                            y1="6"
                                            x2="18"
                                            y2="18"
                                        /></svg
                                    >
                                    Invalid
                                </span>
                            {/if}
                        </div>
                    {/if}
                </div>
                {#if validation.tvdb.status === "invalid"}
                    <p class="text-xs text-error mt-1">
                        {validation.tvdb.message}
                    </p>
                {/if}
                <label class="label" for="settings-tvdb"
                    ><a
                        href="https://thetvdb.com/dashboard/account/apikey"
                        target="_blank"
                        rel="noopener"
                        class="label-text-alt link link-primary"
                        >Get API key →</a
                    ></label
                >
            </div>

            <!-- TMDB -->
            <div class="form-control">
                <label class="label" for="settings-tmdb"
                    ><span class="label-text flex items-center gap-1.5"
                        ><ServiceIcon
                            service="tmdb"
                            size="w-4 h-4"
                            class="text-[#01B4E4]"
                        />TMDB API Key</span
                    ></label
                >
                <div class="flex gap-2 items-start">
                    <div class="flex-1">
                        <input
                            id="settings-tmdb"
                            type="text"
                            class="input input-bordered input-sm w-full"
                            bind:value={tmdbApiKey}
                            placeholder={data.settings.hasTmdbKey
                                ? "••••••••"
                                : "Not set"}
                        />
                    </div>
                    {#if validation.tmdb.status !== "idle"}
                        <div class="flex items-center gap-1.5 mt-1.5">
                            {#if validation.tmdb.status === "checking"}
                                <span
                                    class="loading loading-spinner loading-xs text-info"
                                ></span>
                            {:else if validation.tmdb.status === "valid"}
                                <span
                                    class="badge badge-success badge-sm gap-1"
                                >
                                    <svg
                                        xmlns="http://www.w3.org/2000/svg"
                                        class="h-3 w-3"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        stroke-width="3"
                                        ><polyline
                                            points="20 6 9 17 4 12"
                                        /></svg
                                    >
                                    Valid
                                </span>
                            {:else}
                                <span class="badge badge-error badge-sm gap-1">
                                    <svg
                                        xmlns="http://www.w3.org/2000/svg"
                                        class="h-3 w-3"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        stroke-width="3"
                                        ><line
                                            x1="18"
                                            y1="6"
                                            x2="6"
                                            y2="18"
                                        /><line
                                            x1="6"
                                            y1="6"
                                            x2="18"
                                            y2="18"
                                        /></svg
                                    >
                                    Invalid
                                </span>
                            {/if}
                        </div>
                    {/if}
                </div>
                {#if validation.tmdb.status === "invalid"}
                    <p class="text-xs text-error mt-1">
                        {validation.tmdb.message}
                    </p>
                {/if}
                <label class="label" for="settings-tmdb"
                    ><a
                        href="https://www.themoviedb.org/settings/api"
                        target="_blank"
                        rel="noopener"
                        class="label-text-alt link link-primary"
                        >Get API key →</a
                    ></label
                >
            </div>

            <!-- MusicBrainz -->
            <div class="form-control">
                <label class="label" for="settings-mb"
                    ><span class="label-text flex items-center gap-1.5"
                        ><ServiceIcon
                            service="musicbrainz"
                            size="w-4 h-4"
                            class="text-[#BA478F]"
                        />MusicBrainz</span
                    ></label
                >
                <input
                    id="settings-mb"
                    type="text"
                    class="input input-bordered input-sm"
                    bind:value={musicbrainzApiKey}
                    placeholder={data.settings.hasMusicbrainzKey
                        ? "••••••••"
                        : "Optional"}
                />
                <label class="label" for="settings-mb"
                    ><a
                        href="https://musicbrainz.org/doc/MusicBrainz_API"
                        target="_blank"
                        rel="noopener"
                        class="label-text-alt link link-primary">API docs →</a
                    ></label
                >
            </div>
        </div>
    </div>

    <!-- Tracker App Credentials -->
    <div class="card bg-base-200/50 border border-base-300">
        <div class="card-body">
            <h2 class="card-title text-lg">
                <svg
                    xmlns="http://www.w3.org/2000/svg"
                    class="h-5 w-5 text-accent"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                >
                    <path
                        d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"
                    /><path
                        d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"
                    />
                </svg>
                Tracker App Credentials
            </h2>
            <p class="text-sm text-base-content/60">
                App-level credentials that enable users to link their Trakt and
                Last.fm accounts.
            </p>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2">
                <!-- Trakt -->
                <div class="space-y-2">
                    <div class="flex items-center justify-between">
                        <h3
                            class="text-sm font-semibold text-base-content/80 flex items-center gap-1.5"
                        >
                            <ServiceIcon
                                service="trakt"
                                size="w-4 h-4"
                                class="text-[#ED1C24]"
                            />Trakt
                        </h3>
                        {#if validation.trakt.status !== "idle"}
                            {#if validation.trakt.status === "checking"}
                                <span
                                    class="loading loading-spinner loading-xs text-info"
                                ></span>
                            {:else if validation.trakt.status === "valid"}
                                <span
                                    class="badge badge-success badge-sm gap-1"
                                >
                                    <svg
                                        xmlns="http://www.w3.org/2000/svg"
                                        class="h-3 w-3"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        stroke-width="3"
                                        ><polyline
                                            points="20 6 9 17 4 12"
                                        /></svg
                                    >
                                    Valid
                                </span>
                            {:else}
                                <span class="badge badge-error badge-sm gap-1">
                                    <svg
                                        xmlns="http://www.w3.org/2000/svg"
                                        class="h-3 w-3"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        stroke-width="3"
                                        ><line
                                            x1="18"
                                            y1="6"
                                            x2="6"
                                            y2="18"
                                        /><line
                                            x1="6"
                                            y1="6"
                                            x2="18"
                                            y2="18"
                                        /></svg
                                    >
                                    Invalid
                                </span>
                            {/if}
                        {/if}
                    </div>
                    {#if validation.trakt.status === "invalid"}
                        <p class="text-xs text-error">
                            {validation.trakt.message}
                        </p>
                    {/if}
                    <div class="form-control">
                        <label class="label py-1" for="trakt-client-id"
                            ><span class="label-text text-xs">Client ID</span
                            ></label
                        >
                        <input
                            id="trakt-client-id"
                            type="text"
                            class="input input-bordered input-sm"
                            bind:value={traktClientId}
                            placeholder={data.settings.hasTraktClientId
                                ? "••••••••"
                                : "Not set"}
                        />
                    </div>
                    <div class="form-control">
                        <label class="label py-1" for="trakt-client-secret"
                            ><span class="label-text text-xs"
                                >Client Secret</span
                            ></label
                        >
                        <input
                            id="trakt-client-secret"
                            type="password"
                            class="input input-bordered input-sm"
                            bind:value={traktClientSecret}
                            placeholder={data.settings.hasTraktClientSecret
                                ? "••••••••"
                                : "Not set"}
                        />
                    </div>
                    <a
                        href="https://trakt.tv/oauth/applications"
                        target="_blank"
                        rel="noopener"
                        class="link link-primary text-xs">Create Trakt app →</a
                    >
                    <div class="bg-base-300/50 rounded-lg p-2 mt-1">
                        <p class="text-xs text-base-content/50">
                            <span class="font-medium text-base-content/70"
                                >Redirect URI:</span
                            >
                            <code
                                class="text-[10px] bg-base-300 px-1 py-0.5 rounded select-all"
                                >{typeof window !== "undefined"
                                    ? window.location.origin
                                    : "https://your-mediajam-host"}/api/spokes/trakt/callback</code
                            >
                        </p>
                        <p class="text-[10px] text-base-content/40 mt-1">
                            Only the Client ID is validated — the Client Secret
                            can't be tested without a full OAuth flow.
                        </p>
                    </div>
                </div>

                <!-- Last.fm -->
                <div class="space-y-2">
                    <div class="flex items-center justify-between">
                        <h3
                            class="text-sm font-semibold text-base-content/80 flex items-center gap-1.5"
                        >
                            <ServiceIcon
                                service="lastfm"
                                size="w-4 h-4"
                                class="text-[#D51007]"
                            />Last.fm
                        </h3>
                        {#if validation.lastfm.status !== "idle"}
                            {#if validation.lastfm.status === "checking"}
                                <span
                                    class="loading loading-spinner loading-xs text-info"
                                ></span>
                            {:else if validation.lastfm.status === "valid"}
                                <span
                                    class="badge badge-success badge-sm gap-1"
                                >
                                    <svg
                                        xmlns="http://www.w3.org/2000/svg"
                                        class="h-3 w-3"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        stroke-width="3"
                                        ><polyline
                                            points="20 6 9 17 4 12"
                                        /></svg
                                    >
                                    Valid
                                </span>
                            {:else}
                                <span class="badge badge-error badge-sm gap-1">
                                    <svg
                                        xmlns="http://www.w3.org/2000/svg"
                                        class="h-3 w-3"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        stroke-width="3"
                                        ><line
                                            x1="18"
                                            y1="6"
                                            x2="6"
                                            y2="18"
                                        /><line
                                            x1="6"
                                            y1="6"
                                            x2="18"
                                            y2="18"
                                        /></svg
                                    >
                                    Invalid
                                </span>
                            {/if}
                        {/if}
                    </div>
                    {#if validation.lastfm.status === "invalid"}
                        <p class="text-xs text-error">
                            {validation.lastfm.message}
                        </p>
                    {/if}
                    <div class="form-control">
                        <label class="label py-1" for="lastfm-api-key"
                            ><span class="label-text text-xs">API Key</span
                            ></label
                        >
                        <input
                            id="lastfm-api-key"
                            type="text"
                            class="input input-bordered input-sm"
                            bind:value={lastfmApiKey}
                            placeholder={data.settings.hasLastfmApiKey
                                ? "••••••••"
                                : "Not set"}
                        />
                    </div>
                    <div class="form-control">
                        <label class="label py-1" for="lastfm-shared-secret"
                            ><span class="label-text text-xs"
                                >Shared Secret</span
                            ></label
                        >
                        <input
                            id="lastfm-shared-secret"
                            type="password"
                            class="input input-bordered input-sm"
                            bind:value={lastfmSharedSecret}
                            placeholder={data.settings.hasLastfmSharedSecret
                                ? "••••••••"
                                : "Not set"}
                        />
                    </div>
                    <a
                        href="https://www.last.fm/api/account/create"
                        target="_blank"
                        rel="noopener"
                        class="link link-primary text-xs"
                        >Create Last.fm app →</a
                    >
                    <p class="text-[10px] text-base-content/40 mt-1">
                        Only the API Key is validated — the Shared Secret can't
                        be tested without a full auth flow.
                    </p>
                </div>
            </div>
        </div>
    </div>

    <!-- Jellyfin Playback Reporting -->
    <div class="card bg-base-200/50 border border-base-300">
        <div class="card-body">
            <h2 class="card-title text-lg">
                <ServiceIcon service="jellyfin" class="text-[#00A4DC]" />
                Jellyfin Playback Reporting
            </h2>
            <p class="text-sm text-base-content/60">
                Path to the Playback Reporting plugin database
                (playback_reporting.db). Mount it read-only via Docker to import
                historical data.
            </p>
            <div class="form-control">
                <input
                    type="text"
                    class="input input-bordered input-sm"
                    bind:value={jellyfinPrDbPath}
                    placeholder="/app/data/playback_reporting.db"
                />
            </div>
        </div>
    </div>

    <!-- Data Sync -->
    <div class="card bg-base-200/50 border border-base-300">
        <div class="card-body">
            <h2 class="card-title text-lg">
                <svg
                    xmlns="http://www.w3.org/2000/svg"
                    class="h-5 w-5 text-info"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                >
                    <polyline points="23 4 23 10 17 10" /><polyline
                        points="1 20 1 14 7 14"
                    />
                </svg>
                Data Sync
            </h2>

            {#if syncStatus === "idle"}
                <p class="text-sm text-base-content/60">
                    Last sync: {data.syncState.lastSync
                        ? new Date(data.syncState.lastSync).toLocaleString()
                        : "Never"}
                </p>
                <button
                    class="btn btn-info btn-sm w-fit mt-2"
                    onclick={() => triggerSync()}
                >
                    Sync All Libraries
                </button>
                <button
                    class="btn btn-ghost btn-sm w-fit mt-2"
                    onclick={() => triggerSync(null, null, true)}
                    title="Ignores cached data and re-fetches everything from Jellyfin"
                >
                    Full Re-sync
                </button>
                {#if data.libraries && data.libraries.length > 1}
                    <div class="flex flex-wrap gap-2 mt-2">
                        {#each data.libraries as lib}
                            <button
                                class="btn btn-outline btn-xs"
                                onclick={() =>
                                    triggerSync(lib.jellyfin_id, lib.name)}
                            >
                                {#if lib.media_type === "tvshows"}📺{:else if lib.media_type === "movies"}🎬{:else if lib.media_type === "music"}🎵{:else}📁{/if}
                                Sync {lib.name}
                            </button>
                        {/each}
                    </div>
                {/if}
            {:else}
                <div class="space-y-3 mt-2">
                    <div class="flex justify-between items-center text-sm">
                        <span class="font-medium">
                            {#if syncStatus === "complete"}
                                ✅ Sync complete!
                            {:else if syncStatus === "error"}
                                ❌ Sync error
                            {:else if syncStatus === "paused"}
                                ⏸️ Paused — {syncLibrary}
                            {:else}
                                📚 {syncLibrary || "Starting..."}
                            {/if}
                        </span>
                        <span class="text-xs text-base-content/50">
                            {syncItemsSynced.toLocaleString()} synced · {syncErrors}
                            errors
                        </span>
                    </div>

                    {#if syncProgress > 0}
                        <progress
                            class="progress progress-info w-full"
                            value={syncProgress}
                            max="100"
                        ></progress>
                    {:else}
                        <progress class="progress progress-info w-full"
                        ></progress>
                    {/if}

                    <div class="flex items-center justify-between">
                        <span class="text-xs text-base-content/40"
                            >Sync Log</span
                        >
                        {#if syncLogs.length > 0}
                            <button
                                class="btn btn-xs btn-ghost gap-1"
                                onclick={copySyncLog}
                            >
                                {#if copyFeedback}
                                    ✓ Copied
                                {:else}
                                    <svg
                                        xmlns="http://www.w3.org/2000/svg"
                                        class="h-3 w-3"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        stroke-width="2"
                                        ><rect
                                            x="9"
                                            y="9"
                                            width="13"
                                            height="13"
                                            rx="2"
                                            ry="2"
                                        /><path
                                            d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"
                                        /></svg
                                    >
                                    Copy
                                {/if}
                            </button>
                        {/if}
                    </div>
                    <div
                        bind:this={consoleEl}
                        class="bg-neutral text-neutral-content rounded-lg p-3 h-36 overflow-y-auto text-xs font-mono"
                    >
                        {#each syncLogs as log}
                            <div class={getLogClass(log.type)}>
                                <span class="opacity-50">[{log.time}]</span>
                                {log.message}
                            </div>
                        {/each}
                        {#if syncStatus === "syncing"}
                            <div class="opacity-50 mt-1">
                                <span class="loading loading-dots loading-xs"
                                ></span>
                            </div>
                        {/if}
                    </div>

                    <div class="flex gap-2">
                        {#if syncStatus === "syncing" || syncStatus === "paused"}
                            <button
                                class="btn btn-sm btn-outline"
                                onclick={toggleSyncPause}
                            >
                                {syncStatus === "paused" ? "Resume" : "Pause"}
                            </button>
                        {/if}
                        {#if syncStatus === "complete" || syncStatus === "error"}
                            <button
                                class="btn btn-sm btn-info"
                                onclick={() => {
                                    syncStatus = "idle";
                                }}>Done</button
                            >
                            <button
                                class="btn btn-sm btn-ghost"
                                onclick={() => triggerSync()}>Sync Again</button
                            >
                            <button
                                class="btn btn-sm btn-ghost"
                                onclick={() => triggerSync(null, null, true)}
                                >Full Re-sync</button
                            >
                        {/if}
                    </div>
                </div>
            {/if}
        </div>
    </div>

    <!-- Save Button (always visible) -->
    <div class="flex items-center gap-3">
        <button
            class="btn {isDirty
                ? 'btn-primary btn-lg animate-pulse'
                : 'btn-primary'}"
            onclick={saveSettings}
            disabled={saving}
        >
            {#if saving}
                <span class="loading loading-spinner loading-sm"></span>
            {/if}
            Save Settings
        </button>

        {#if error}
            <span class="text-error text-sm">{error}</span>
        {/if}
    </div>
</div>

<!-- Undo Toast -->
{#if showUndoToast}
    <div class="toast toast-end toast-bottom z-50">
        <div class="alert alert-success shadow-lg">
            <svg
                xmlns="http://www.w3.org/2000/svg"
                class="h-5 w-5 shrink-0"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"><polyline points="20 6 9 17 4 12" /></svg
            >
            <span class="text-sm">Settings saved!</span>
            <button class="btn btn-sm btn-ghost" onclick={undoSave}>Undo</button
            >
            <button
                class="btn btn-sm btn-ghost btn-circle"
                onclick={() => {
                    showUndoToast = false;
                }}>✕</button
            >
        </div>
    </div>
{/if}
