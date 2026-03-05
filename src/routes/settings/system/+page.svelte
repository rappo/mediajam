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

    // LLM Integration
    let ollamaUrl = $state(data.settings.ollamaUrl || "");
    let ollamaEmbedModel = $state(
        data.settings.ollamaEmbedModel || "nomic-embed-text",
    );
    let ollamaChatModel = $state(
        data.settings.ollamaChatModel || "llama3.2:3b",
    );

    // Snapshot initial values for dirty detection and undo
    let initialValues = $state({
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
        ollamaUrl: data.settings.ollamaUrl || "",
        ollamaEmbedModel: data.settings.ollamaEmbedModel || "nomic-embed-text",
        ollamaChatModel: data.settings.ollamaChatModel || "llama3.2:3b",
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
            jellyfinSyncCheck !== initialValues.jellyfinSyncCheck ||
            ollamaUrl !== initialValues.ollamaUrl ||
            ollamaEmbedModel !== initialValues.ollamaEmbedModel ||
            ollamaChatModel !== initialValues.ollamaChatModel,
    );

    // ─── Undo Toast ──────────────────────────────────────────────────────────────
    let showUndoToast = $state(false);
    let undoSnapshot = $state(null);
    let undoTimer = $state(null);

    // ─── Data Management ───────────────────────────────────────────────────────────────
    let exporting = $state(false);
    let exportSensitive = $state(false);
    let exportPasswords = $state(false);
    let exportTokens = $state(false);
    let exportApiKeys = $state(false);

    let importFile = $state(null);
    let importMode = $state("merge");
    let importPrefer = $state("new");
    let importing = $state(false);
    let importResult = $state(null);

    async function exportData() {
        exporting = true;
        try {
            const params = new URLSearchParams();
            if (exportPasswords) params.set("includePasswords", "1");
            if (exportTokens) params.set("includeTokens", "1");
            if (exportApiKeys) params.set("includeApiKeys", "1");
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
            error = e instanceof Error ? e.message : "Export failed";
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
            ollamaUrl,
            ollamaEmbedModel,
            ollamaChatModel,
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
        ollamaUrl = snapshot.ollamaUrl;
        ollamaEmbedModel = snapshot.ollamaEmbedModel;
        ollamaChatModel = snapshot.ollamaChatModel;
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
            payload.ollama_url = ollamaUrl || null;
            payload.ollama_embed_model = ollamaEmbedModel || "nomic-embed-text";
            payload.ollama_chat_model = ollamaChatModel || "llama3.2:3b";

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

    // ─── People Sync ─────────────────────────────────────────────────────────────
    let reconciling = $state(false);
    /** @type {string|null} */
    let expandedSync = $state(null);
    let reconcileResult = $state(null);

    // Reactive local sync history — seeded from server data, updated on completion
    /** @type {Record<string, {status: string, finishedAt: string|null, summary: string|null}>} */
    let syncHistoryLocal = $state({
        ...data.syncHistory,
        // Fallback: if no jellyfin history exists but legacy lastSync does, seed it
        ...(!data.syncHistory?.jellyfin && data.syncState.lastSync
            ? {
                  jellyfin: {
                      status: "success",
                      finishedAt: data.syncState.lastSync,
                      summary: null,
                  },
              }
            : {}),
    });
    let peopleSyncStatus = $state("idle"); // idle | syncing | paused | complete | error
    let peopleSyncProgress = $state(0);
    let peopleSyncSynced = $state(0);
    let peopleSyncErrors = $state(0);
    let peopleSyncLogs = $state([]);
    let peopleSyncResult = $state(null);
    /** @type {EventSource | null} */
    let peopleSyncEventSource = $state(null);
    /** @type {HTMLDivElement | null} */
    let peopleSyncConsoleEl = $state(null);
    let peopleSyncCopyFeedback = $state(false);
    let externalIdsSyncing = $state(false);

    function addPeopleSyncLog(message, type = "info") {
        peopleSyncLogs = [
            ...peopleSyncLogs.slice(-100),
            { time: new Date().toLocaleTimeString(), message, type },
        ];
    }

    function handlePeopleSyncSSE(d) {
        if (d.type === "snapshot") {
            if (d.running) {
                peopleSyncStatus = d.paused ? "paused" : "syncing";
                peopleSyncProgress = d.progress || 0;
                peopleSyncSynced = d.itemsSynced || 0;
                peopleSyncErrors = d.errors || 0;
                if (d.logs?.length) peopleSyncLogs = d.logs;
            }
        } else if (d.type === "progress") {
            if (d.progress !== undefined) peopleSyncProgress = d.progress;
            if (d.itemsSynced !== undefined) peopleSyncSynced = d.itemsSynced;
            if (d.errors !== undefined) peopleSyncErrors = d.errors;
        } else if (d.type === "complete") {
            peopleSyncStatus = "complete";
            peopleSyncProgress = 100;
            if (d.itemsSynced !== undefined) peopleSyncSynced = d.itemsSynced;
            peopleSyncResult = {
                totalPersons: d.totalPersons,
                totalCredits: d.totalCredits,
            };
            peopleSyncEventSource?.close();
            syncHistoryLocal = {
                ...syncHistoryLocal,
                people: {
                    status: "success",
                    finishedAt: new Date().toISOString(),
                    summary: `${d.totalPersons} people, ${d.totalCredits} credits`,
                },
            };
        } else if (d.type === "error") {
            peopleSyncStatus = "error";
            peopleSyncEventSource?.close();
        } else if (d.type === "paused") {
            peopleSyncStatus = "paused";
        } else if (d.type === "resumed") {
            peopleSyncStatus = "syncing";
        } else if (d.type === "stopped") {
            peopleSyncStatus = "idle";
            peopleSyncEventSource?.close();
        }
        if (d.log) addPeopleSyncLog(d.log, d.logType || "info");
    }

    function connectPeopleSyncSSE() {
        if (peopleSyncEventSource) peopleSyncEventSource.close();
        peopleSyncEventSource = new EventSource("/api/people/sync");
        peopleSyncEventSource.onmessage = (event) => {
            try {
                handlePeopleSyncSSE(JSON.parse(event.data));
            } catch {
                /* ignore */
            }
        };
        peopleSyncEventSource.onerror = () => {
            if (peopleSyncStatus === "syncing")
                addPeopleSyncLog("Connection lost.", "warning");
        };
    }

    // Auto-reconnect on mount — poll status endpoint instead of opening 3 SSE connections
    $effect(() => {
        let mounted = true;

        fetch("/api/sync/status")
            .then((r) => (r.ok ? r.json() : null))
            .then((data) => {
                if (!data || !mounted) return;

                // Reconnect to people sync SSE if running
                if (data.people?.running) {
                    peopleSyncStatus = "syncing";
                    peopleSyncProgress = data.people.progress || 0;
                    peopleSyncSynced = data.people.itemsSynced || 0;
                    peopleSyncErrors = data.people.errors || 0;
                    if (mounted) connectPeopleSyncSSE();
                }

                // Reconnect to jellyfin sync SSE if running
                if (data.jellyfin?.running) {
                    syncStatus = "syncing";
                    syncProgress = data.jellyfin.progress || 0;
                    syncItemsSynced = data.jellyfin.itemsSynced || 0;
                    syncErrors = data.jellyfin.errors || 0;
                    syncLibrary = data.jellyfin.libraryName || "";
                    if (mounted) connectSSE();
                }

                // Reconnect to musicbrainz SSE if running
                if (data.musicbrainz?.running) {
                    mbStatus = "syncing";
                    mbProgress = data.musicbrainz.progress || 0;
                    if (mounted) connectMBSSE();
                }
            })
            .catch(() => {});

        // Cleanup: close all SSE connections on unmount/re-render
        return () => {
            mounted = false;
            peopleSyncEventSource?.close();
            peopleSyncEventSource = null;
            syncEventSource?.close();
            syncEventSource = null;
            mbEventSource?.close();
            mbEventSource = null;
        };
    });

    $effect(() => {
        if (syncLogs.length && consoleEl) {
            consoleEl.scrollTop = consoleEl.scrollHeight;
        }
    });

    $effect(() => {
        if (peopleSyncLogs.length && peopleSyncConsoleEl) {
            peopleSyncConsoleEl.scrollTop = peopleSyncConsoleEl.scrollHeight;
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
            syncHistoryLocal = {
                ...syncHistoryLocal,
                jellyfin: {
                    status: "success",
                    finishedAt: new Date().toISOString(),
                    summary: `${syncItemsSynced} items synced, ${syncErrors} errors`,
                },
            };
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

    // Jellyfin sync auto-reconnect handled by the unified mount probe above

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

    async function stopJellyfinSync() {
        await fetch("/api/sync", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "stop" }),
        });
        addSyncLog("Sync stopped.", "warning");
        syncStatus = "idle";
        syncEventSource?.close();
        syncEventSource = null;
    }

    function getLogClass(type) {
        if (type === "success") return "text-success";
        if (type === "error") return "text-error";
        if (type === "warning") return "text-warning";
        return "text-base-content/70";
    }

    async function triggerPeopleSync() {
        peopleSyncStatus = "syncing";
        peopleSyncProgress = 0;
        peopleSyncSynced = 0;
        peopleSyncErrors = 0;
        peopleSyncLogs = [];
        peopleSyncResult = null;

        addPeopleSyncLog("Starting people sync...", "info");

        try {
            const res = await fetch("/api/people/sync", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "start" }),
            });
            const result = await res.json();

            if (!result.success) {
                addPeopleSyncLog(
                    result.error || "Failed to start people sync.",
                    "error",
                );
                peopleSyncStatus = "error";
                return;
            }

            connectPeopleSyncSSE();
        } catch {
            addPeopleSyncLog("Failed to start people sync.", "error");
            peopleSyncStatus = "error";
        }
    }

    async function syncExternalIdsOnly() {
        peopleSyncStatus = "syncing";
        peopleSyncProgress = 0;
        peopleSyncSynced = 0;
        peopleSyncErrors = 0;
        peopleSyncLogs = [];
        peopleSyncResult = null;
        externalIdsSyncing = true;

        addPeopleSyncLog("🔗 Starting external IDs sync...", "info");

        try {
            const res = await fetch("/api/people/sync", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "external-ids" }),
            });
            const result = await res.json();

            if (!result.success) {
                addPeopleSyncLog(
                    result.error || "Failed to start external IDs sync.",
                    "error",
                );
                peopleSyncStatus = "error";
                externalIdsSyncing = false;
                return;
            }

            connectPeopleSyncSSE();
        } catch {
            addPeopleSyncLog("❌ Failed to start external IDs sync.", "error");
            peopleSyncStatus = "error";
        }
        externalIdsSyncing = false;
    }

    async function togglePeopleSyncPause() {
        const action = peopleSyncStatus === "paused" ? "resume" : "pause";
        await fetch("/api/people/sync", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action }),
        });
        peopleSyncStatus = action === "pause" ? "paused" : "syncing";
        addPeopleSyncLog(action === "pause" ? "Paused." : "Resumed.", "info");
    }

    async function stopPeopleSyncAction() {
        await fetch("/api/people/sync", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "stop" }),
        });
        addPeopleSyncLog("People sync stopped.", "warning");
        peopleSyncStatus = "idle";
        peopleSyncEventSource?.close();
        peopleSyncEventSource = null;
    }

    function copyPeopleSyncLog() {
        const text = peopleSyncLogs
            .map((l) => `[${l.time}] ${l.message}`)
            .join("\n");
        navigator.clipboard.writeText(text);
        peopleSyncCopyFeedback = true;
        setTimeout(() => (peopleSyncCopyFeedback = false), 2000);
    }

    // ─── MusicBrainz Enrichment ─────────────────────────────────────────────────
    let mbStatus = $state("idle"); // idle | syncing | paused | complete | error
    let mbProgress = $state(0);
    let mbSynced = $state(0);
    let mbErrors = $state(0);
    let mbLogs = $state([]);
    let mbResult = $state(null);
    /** @type {EventSource | null} */
    let mbEventSource = $state(null);
    /** @type {HTMLDivElement | null} */
    let mbConsoleEl = $state(null);
    let mbCopyFeedback = $state(false);

    function addMBLog(message, type = "info") {
        mbLogs = [
            ...mbLogs.slice(-100),
            { time: new Date().toLocaleTimeString(), message, type },
        ];
    }

    function handleMBSSE(d) {
        // Handle snapshot (initial state dump)
        if (d.type === "snapshot") {
            if (d.running) {
                mbStatus = d.paused ? "paused" : "syncing";
                mbProgress = d.progress || 0;
                mbSynced = d.itemsSynced || 0;
                mbErrors = d.errors || 0;
                if (d.logs?.length) mbLogs = d.logs;
            } else if (d.status === "complete" && d.result) {
                mbStatus = "complete";
                mbResult = d.result;
                if (d.logs?.length) mbLogs = d.logs;
                if (d.progress !== undefined) mbProgress = d.progress;
                if (d.itemsSynced !== undefined) mbSynced = d.itemsSynced;
                if (d.errors !== undefined) mbErrors = d.errors;
            }
            return;
        }
        // Handle engine broadcast events (progress, completion, etc.)
        if (d.status === "complete") {
            mbStatus = "complete";
            mbResult = d.result;
            if (d.result) {
                syncHistoryLocal = {
                    ...syncHistoryLocal,
                    musicbrainz: {
                        status: "success",
                        finishedAt: new Date().toISOString(),
                        summary: `${d.result.totalPersons} persons, ${d.result.totalCredits} credits, ${d.result.totalExternalIds} external IDs`,
                    },
                };
            }
        } else if (d.status === "idle") {
            mbStatus = "idle";
        } else if (d.status === "syncing" || d.status === "paused") {
            mbStatus = d.status;
        }
        if (d.progress !== undefined) mbProgress = d.progress;
        if (d.itemsSynced !== undefined) mbSynced = d.itemsSynced;
        if (d.errors !== undefined) mbErrors = d.errors;
        if (d.logs?.length) mbLogs = d.logs;
    }

    function connectMBSSE() {
        if (mbEventSource) mbEventSource.close();
        mbEventSource = new EventSource("/api/musicbrainz/enrich");
        mbEventSource.onmessage = (e) => {
            try {
                const d = JSON.parse(e.data);
                if (d.type === "connected") return; // skip connected event
                handleMBSSE(d);
            } catch {
                /* parse error */
            }
        };
        mbEventSource.onerror = () => {
            mbEventSource?.close();
            mbEventSource = null;
        };
    }

    async function triggerMBEnrich() {
        mbStatus = "syncing";
        mbProgress = 0;
        mbSynced = 0;
        mbErrors = 0;
        mbLogs = [];
        mbResult = null;
        addMBLog("Starting MusicBrainz enrichment...", "info");

        try {
            const res = await fetch("/api/musicbrainz/enrich", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "start" }),
            });
            const result = await res.json();
            if (result.error) {
                addMBLog(`Error: ${result.error}`, "error");
                mbStatus = "error";
                return;
            }
            connectMBSSE();
        } catch {
            addMBLog("Failed to start enrichment.", "error");
            mbStatus = "error";
        }
    }

    async function toggleMBPause() {
        const action = mbStatus === "paused" ? "resume" : "pause";
        await fetch("/api/musicbrainz/enrich", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action }),
        });
        mbStatus = action === "pause" ? "paused" : "syncing";
        addMBLog(action === "pause" ? "Paused." : "Resumed.", "info");
    }

    async function stopMBEnrich() {
        await fetch("/api/musicbrainz/enrich", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "stop" }),
        });
        addMBLog("Enrichment stopped.", "warning");
        mbStatus = "idle";
        mbEventSource?.close();
        mbEventSource = null;
    }

    function copyMBLog() {
        const text = mbLogs.map((l) => `[${l.time}] ${l.message}`).join("\n");
        navigator.clipboard.writeText(text);
        mbCopyFeedback = true;
        setTimeout(() => (mbCopyFeedback = false), 2000);
    }

    // Auto-scroll MB console
    $effect(() => {
        if (mbLogs.length && mbConsoleEl) {
            mbConsoleEl.scrollTop = mbConsoleEl.scrollHeight;
        }
    });

    // MusicBrainz auto-reconnect handled by the unified mount probe above

    // ─── LLM Integration ────────────────────────────────────────────────────────
    let ollamaHealthStatus = $state("idle"); // idle | checking | ok | error
    let ollamaHealthModels = $state([]);
    let ollamaHealthError = $state("");

    let embeddingStatus = $state("idle"); // idle | running | complete | error
    let embeddingPhase = $state("");
    let embeddingDone = $state(0);
    let embeddingTotal = $state(0);
    /** @type {{ available: boolean, overviewEmbeddings: number, titleEmbeddings: number, totalParentsWithOverview: number, totalChildren: number } | null} */
    let embeddingStats = $state(null);

    let taggingStatus = $state("idle");
    let taggingDone = $state(0);
    let taggingTotal = $state(0);
    let taggingTagged = $state(0);
    let taggingCurrent = $state("");
    /** @type {{ totalTagged: number, totalTags: number, totalWithOverview: number, tagsByType: any[], topTags: any[] } | null} */
    let tagStats = $state(null);

    async function testOllamaConnection() {
        ollamaHealthStatus = "checking";
        ollamaHealthError = "";
        try {
            const res = await fetch(
                `/api/ollama/health?url=${encodeURIComponent(ollamaUrl)}`,
            );
            const data = await res.json();
            if (data.ok) {
                ollamaHealthStatus = "ok";
                ollamaHealthModels = data.models || [];
            } else {
                ollamaHealthStatus = "error";
                ollamaHealthError = data.error || "Connection failed";
            }
        } catch {
            ollamaHealthStatus = "error";
            ollamaHealthError = "Network error";
        }
    }

    async function loadEmbeddingStats() {
        try {
            const res = await fetch("/api/embeddings/generate");
            embeddingStats = await res.json();
        } catch {
            /* ignore */
        }
    }

    async function loadTagStats() {
        try {
            const res = await fetch("/api/tags/generate");
            tagStats = await res.json();
        } catch {
            /* ignore */
        }
    }

    async function generateEmbeddings() {
        embeddingStatus = "running";
        embeddingDone = 0;
        embeddingTotal = 0;
        embeddingPhase = "";
        try {
            const res = await fetch("/api/embeddings/generate", {
                method: "POST",
            });
            if (!res.ok || !res.body) {
                const err = await res.json().catch(() => ({}));
                embeddingStatus = "error";
                ollamaHealthError = err.error || "Failed to start";
                return;
            }
            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buffer = "";
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split("\n");
                buffer = lines.pop() || "";
                for (const line of lines) {
                    if (!line.startsWith("data: ")) continue;
                    try {
                        const d = JSON.parse(line.slice(6));
                        if (d.type === "status") {
                            embeddingPhase = d.phase;
                            embeddingTotal = d.total;
                        }
                        if (d.type === "progress") {
                            embeddingDone = d.done;
                            embeddingTotal = d.total;
                            embeddingPhase = d.phase;
                        }
                        if (d.type === "complete") {
                            embeddingStatus = "complete";
                        }
                        if (d.type === "error") {
                            embeddingStatus = "error";
                            ollamaHealthError = d.message;
                        }
                    } catch {
                        /* ignore */
                    }
                }
            }
            if (embeddingStatus === "running") embeddingStatus = "complete";
            loadEmbeddingStats();
        } catch {
            embeddingStatus = "error";
        }
    }

    async function generateTags() {
        taggingStatus = "running";
        taggingDone = 0;
        taggingTotal = 0;
        taggingTagged = 0;
        taggingCurrent = "";
        try {
            const res = await fetch("/api/tags/generate", { method: "POST" });
            if (!res.ok || !res.body) {
                const err = await res.json().catch(() => ({}));
                taggingStatus = "error";
                ollamaHealthError = err.error || "Failed to start";
                return;
            }
            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buffer = "";
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split("\n");
                buffer = lines.pop() || "";
                for (const line of lines) {
                    if (!line.startsWith("data: ")) continue;
                    try {
                        const d = JSON.parse(line.slice(6));
                        if (d.type === "status") {
                            taggingTotal = d.total;
                        }
                        if (d.type === "progress") {
                            taggingDone = d.done;
                            taggingTotal = d.total;
                            taggingTagged = d.tagged;
                            taggingCurrent = d.current || "";
                        }
                        if (d.type === "complete") {
                            taggingStatus = "complete";
                        }
                        if (d.type === "error") {
                            taggingStatus = "error";
                        }
                    } catch {
                        /* ignore */
                    }
                }
            }
            if (taggingStatus === "running") taggingStatus = "complete";
            loadTagStats();
        } catch {
            taggingStatus = "error";
        }
    }

    // Load stats when Ollama URL is set
    $effect(() => {
        if (data.settings.ollamaUrl) {
            loadEmbeddingStats();
            loadTagStats();
        }
    });

    async function runReconcile() {
        reconciling = true;
        reconcileResult = null;
        try {
            const res = await fetch("/api/sync/reconcile", { method: "POST" });
            reconcileResult = /** @type {any} */ (await res.json());
            const r = /** @type {any} */ (reconcileResult);
            if (!r.error) {
                syncHistoryLocal = {
                    ...syncHistoryLocal,
                    reconcile: {
                        status: "success",
                        finishedAt: new Date().toISOString(),
                        summary: `${r.merged} merged, ${r.deleted} orphans`,
                    },
                };
            } else {
                syncHistoryLocal = {
                    ...syncHistoryLocal,
                    reconcile: {
                        status: "failed",
                        finishedAt: new Date().toISOString(),
                        summary: r.error,
                    },
                };
            }
        } catch {
            reconcileResult = /** @type {any} */ ({ error: "Failed" });
            syncHistoryLocal = {
                ...syncHistoryLocal,
                reconcile: {
                    status: "failed",
                    finishedAt: new Date().toISOString(),
                    summary: "Failed",
                },
            };
        }
        reconciling = false;
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
                        stroke-linecap="round"
                        stroke-linejoin="round"
                    >
                        <path
                            d="M12 2l2.4 3.6L18 6l-1 4 2.5 3H15l-3 5-3-5H4.5L7 10l-1-4 3.6-.4z"
                        />
                    </svg>
                    <div>
                        <p class="font-semibold text-sm">
                            This is an admin-only section
                        </p>
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

    <!-- LLM Integration -->
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
                    ><path
                        d="M12 2a4 4 0 0 0-4 4v2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2h-2V6a4 4 0 0 0-4-4zm-2 4a2 2 0 1 1 4 0v2h-4V6z"
                    /><circle cx="12" cy="15" r="2" /></svg
                >
                LLM Integration
                <span class="badge badge-ghost badge-sm">optional</span>
            </h2>
            <p class="text-sm text-base-content/60">
                Connect to a local Ollama instance for semantic search, smart
                matching, auto-tagging, and natural language queries.
            </p>

            <div class="grid gap-3 mt-4">
                <!-- Ollama URL -->
                <label class="form-control w-full">
                    <div class="label pb-1">
                        <span class="label-text text-xs font-medium"
                            >Ollama URL</span
                        >
                    </div>
                    <div class="flex gap-2">
                        <input
                            type="url"
                            bind:value={ollamaUrl}
                            placeholder="http://localhost:11434"
                            class="input input-bordered input-sm flex-1 font-mono"
                        />
                        <button
                            class="btn btn-sm btn-outline gap-1"
                            disabled={!ollamaUrl ||
                                ollamaHealthStatus === "checking"}
                            onclick={testOllamaConnection}
                        >
                            {#if ollamaHealthStatus === "checking"}
                                <span class="loading loading-spinner loading-xs"
                                ></span>
                            {:else if ollamaHealthStatus === "ok"}
                                <svg
                                    xmlns="http://www.w3.org/2000/svg"
                                    class="h-4 w-4 text-success"
                                    viewBox="0 0 20 20"
                                    fill="currentColor"
                                    ><path
                                        fill-rule="evenodd"
                                        d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                                        clip-rule="evenodd"
                                    /></svg
                                >
                            {:else if ollamaHealthStatus === "error"}
                                <svg
                                    xmlns="http://www.w3.org/2000/svg"
                                    class="h-4 w-4 text-error"
                                    viewBox="0 0 20 20"
                                    fill="currentColor"
                                    ><path
                                        fill-rule="evenodd"
                                        d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                                        clip-rule="evenodd"
                                    /></svg
                                >
                            {/if}
                            Test
                        </button>
                    </div>
                    {#if ollamaHealthStatus === "ok" && ollamaHealthModels.length}
                        <p class="text-[10px] text-success mt-1">
                            Connected — {ollamaHealthModels.length} model{ollamaHealthModels.length ===
                            1
                                ? ""
                                : "s"} available
                        </p>
                    {:else if ollamaHealthStatus === "error"}
                        <p class="text-[10px] text-error mt-1">
                            {ollamaHealthError}
                        </p>
                    {/if}
                </label>

                <!-- Model selectors -->
                <div class="grid grid-cols-2 gap-3">
                    <label class="form-control">
                        <div class="label pb-1">
                            <span class="label-text text-xs font-medium"
                                >Embedding Model</span
                            >
                        </div>
                        <select
                            bind:value={ollamaEmbedModel}
                            class="select select-bordered select-sm font-mono"
                        >
                            {#if !ollamaHealthModels.length}
                                <option value={ollamaEmbedModel}
                                    >{ollamaEmbedModel ||
                                        "nomic-embed-text"}</option
                                >
                            {:else}
                                {@const embedModels = ollamaHealthModels.filter(
                                    (m) => /embed|minilm|bert/i.test(m),
                                )}
                                {@const recommended = embedModels.filter((m) =>
                                    m.includes("nomic-embed"),
                                )}
                                {@const others = embedModels.filter(
                                    (m) => !m.includes("nomic-embed"),
                                )}
                                {#each recommended as model}
                                    <option value={model}
                                        >{model} ★ recommended</option
                                    >
                                {/each}
                                {#if recommended.length && others.length}
                                    <option disabled>───────────</option>
                                {/if}
                                {#each others as model}
                                    <option value={model}>{model}</option>
                                {/each}
                            {/if}
                        </select>
                        <p class="text-[10px] text-base-content/40 mt-1">
                            Used for semantic search & album matching
                        </p>
                    </label>
                    <label class="form-control">
                        <div class="label pb-1">
                            <span class="label-text text-xs font-medium"
                                >Generation Model</span
                            >
                        </div>
                        <select
                            bind:value={ollamaChatModel}
                            class="select select-bordered select-sm font-mono"
                        >
                            {#if !ollamaHealthModels.length}
                                <option value={ollamaChatModel}
                                    >{ollamaChatModel || "llama3.2:3b"}</option
                                >
                            {:else}
                                {@const genModels = ollamaHealthModels.filter(
                                    (m) => !/embed|minilm|bert/i.test(m),
                                )}
                                {@const recommended = genModels.filter((m) =>
                                    m.includes("llama3.2"),
                                )}
                                {@const others = genModels.filter(
                                    (m) => !m.includes("llama3.2"),
                                )}
                                {#each recommended as model}
                                    <option value={model}
                                        >{model} ★ recommended</option
                                    >
                                {/each}
                                {#if recommended.length && others.length}
                                    <option disabled>───────────</option>
                                {/if}
                                {#each others as model}
                                    <option value={model}>{model}</option>
                                {/each}
                            {/if}
                        </select>
                        <p class="text-[10px] text-base-content/40 mt-1">
                            Used for tagging, natural language queries
                        </p>
                    </label>
                </div>

                <!-- Actions -->
                {#if data.settings.ollamaUrl}
                    <div class="divider text-xs text-base-content/40 my-1">
                        Actions
                    </div>

                    <!-- Generate Embeddings -->
                    <div class="flex items-center gap-3">
                        <button
                            class="btn btn-sm btn-outline gap-2"
                            disabled={embeddingStatus === "running"}
                            onclick={generateEmbeddings}
                        >
                            {#if embeddingStatus === "running"}
                                <span class="loading loading-spinner loading-xs"
                                ></span>
                            {:else}
                                <svg
                                    xmlns="http://www.w3.org/2000/svg"
                                    class="h-4 w-4"
                                    viewBox="0 0 20 20"
                                    fill="currentColor"
                                    ><path
                                        d="M5 3a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2V5a2 2 0 00-2-2H5zM5 11a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2v-2a2 2 0 00-2-2H5zM11 5a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V5zM11 13a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z"
                                    /></svg
                                >
                            {/if}
                            Generate Embeddings
                        </button>
                        {#if embeddingStats}
                            <span class="text-xs text-base-content/50">
                                {embeddingStats.overviewEmbeddings}/{embeddingStats.totalParentsWithOverview}
                                overviews,
                                {embeddingStats.titleEmbeddings}/{embeddingStats.totalChildren}
                                titles
                            </span>
                        {/if}
                    </div>
                    {#if embeddingStatus === "running" && embeddingTotal > 0}
                        <div class="flex items-center gap-2">
                            <progress
                                class="progress progress-primary w-full"
                                value={embeddingDone}
                                max={embeddingTotal}
                            ></progress>
                            <span
                                class="text-xs text-base-content/50 whitespace-nowrap"
                                >{embeddingPhase}: {embeddingDone}/{embeddingTotal}</span
                            >
                        </div>
                    {:else if embeddingStatus === "complete"}
                        <p class="text-xs text-success">
                            ✓ Embedding generation complete
                        </p>
                    {/if}

                    <!-- Generate Tags -->
                    <div class="flex items-center gap-3">
                        <button
                            class="btn btn-sm btn-outline gap-2"
                            disabled={taggingStatus === "running"}
                            onclick={generateTags}
                        >
                            {#if taggingStatus === "running"}
                                <span class="loading loading-spinner loading-xs"
                                ></span>
                            {:else}
                                <svg
                                    xmlns="http://www.w3.org/2000/svg"
                                    class="h-4 w-4"
                                    viewBox="0 0 20 20"
                                    fill="currentColor"
                                    ><path
                                        fill-rule="evenodd"
                                        d="M17.707 9.293a1 1 0 010 1.414l-7 7a1 1 0 01-1.414 0l-7-7A.997.997 0 012 10V5a3 3 0 013-3h5c.256 0 .512.098.707.293l7 7zM5 6a1 1 0 100-2 1 1 0 000 2z"
                                        clip-rule="evenodd"
                                    /></svg
                                >
                            {/if}
                            Generate Tags
                        </button>
                        {#if tagStats}
                            <span class="text-xs text-base-content/50">
                                {tagStats.totalTagged}/{tagStats.totalWithOverview}
                                tagged ({tagStats.totalTags} tags)
                            </span>
                        {/if}
                    </div>
                    {#if taggingStatus === "running" && taggingTotal > 0}
                        <div class="flex items-center gap-2">
                            <progress
                                class="progress progress-accent w-full"
                                value={taggingDone}
                                max={taggingTotal}
                            ></progress>
                            <span
                                class="text-xs text-base-content/50 whitespace-nowrap"
                            >
                                {taggingDone}/{taggingTotal}
                                {#if taggingCurrent}
                                    — {taggingCurrent}{/if}
                            </span>
                        </div>
                    {:else if taggingStatus === "complete"}
                        <p class="text-xs text-success">
                            ✓ Tag generation complete — {taggingTagged} items tagged
                        </p>
                    {/if}
                {/if}
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

            <div class="space-y-1 mt-2">
                <!-- Jellyfin Sync Row -->
                <div
                    class="rounded-lg border border-base-content/10 overflow-hidden"
                >
                    <button
                        class="w-full flex items-center gap-3 px-4 py-3 hover:bg-base-300/50 transition-colors text-left"
                        onclick={() =>
                            (expandedSync =
                                expandedSync === "jellyfin"
                                    ? null
                                    : "jellyfin")}
                    >
                        <span class="text-lg">📚</span>
                        <span class="font-medium text-sm flex-1"
                            >Sync Libraries</span
                        >
                        {#if syncStatus === "syncing" || syncStatus === "paused"}
                            <span
                                class="loading loading-spinner loading-xs text-info"
                            ></span>
                            <span class="badge badge-info badge-sm gap-1"
                                >syncing</span
                            >
                        {:else if syncHistoryLocal?.jellyfin}
                            {@const h = syncHistoryLocal.jellyfin}
                            <span
                                class="badge badge-sm gap-1"
                                class:badge-success={h.status === "success"}
                                class:badge-error={h.status === "failed"}
                                class:badge-warning={h.status === "interrupted"}
                            >
                                {h.status}
                            </span>
                            <span class="text-xs text-base-content/40"
                                >{h.finishedAt
                                    ? new Date(h.finishedAt).toLocaleString()
                                    : ""}</span
                            >
                        {:else}
                            <span class="text-xs text-base-content/40"
                                >Never synced</span
                            >
                        {/if}
                        <svg
                            xmlns="http://www.w3.org/2000/svg"
                            class="h-4 w-4 text-base-content/30 transition-transform"
                            class:rotate-180={expandedSync === "jellyfin"}
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                            ><polyline points="6 9 12 15 18 9"></polyline></svg
                        >
                    </button>

                    {#if expandedSync === "jellyfin" || syncStatus !== "idle"}
                        <div
                            class="px-4 pb-4 space-y-3 border-t border-base-content/5 pt-3"
                            class:hidden={expandedSync !== "jellyfin" &&
                                syncStatus === "idle"}
                        >
                            {#if syncStatus === "idle"}
                                <div class="flex flex-wrap gap-2">
                                    <button
                                        class="btn btn-info btn-sm"
                                        onclick={() => triggerSync()}
                                        >Sync All</button
                                    >
                                    <button
                                        class="btn btn-ghost btn-sm"
                                        onclick={() =>
                                            triggerSync(null, null, true)}
                                        title="Ignores cached data and re-fetches everything"
                                        >Full Re-sync</button
                                    >
                                    {#if data.libraries && data.libraries.length > 1}
                                        {#each data.libraries as lib}
                                            <button
                                                class="btn btn-outline btn-xs"
                                                onclick={() =>
                                                    triggerSync(
                                                        lib.jellyfin_id,
                                                        lib.name,
                                                    )}
                                            >
                                                {#if lib.media_type === "tvshows"}📺{:else if lib.media_type === "movies"}🎬{:else if lib.media_type === "music"}🎵{:else}📁{/if}
                                                {lib.name}
                                            </button>
                                        {/each}
                                    {/if}
                                </div>
                                {#if syncHistoryLocal?.jellyfin?.summary}
                                    <p class="text-xs text-base-content/50">
                                        Last result: {syncHistoryLocal.jellyfin
                                            .summary}
                                    </p>
                                {/if}
                            {:else}
                                <p class="text-xs text-base-content/50 italic">
                                    You can safely browse around — sync
                                    continues in the background.
                                </p>
                                <div
                                    class="flex justify-between items-center text-sm"
                                >
                                    <span class="font-medium">
                                        {#if syncStatus === "complete"}✅ Sync
                                            complete!{:else if syncStatus === "error"}❌
                                            Sync error{:else if syncStatus === "paused"}⏸️
                                            Paused — {syncLibrary}{:else}📚 {syncLibrary ||
                                                "Starting..."}{/if}
                                    </span>
                                    <span class="text-xs text-base-content/50"
                                        >{syncItemsSynced.toLocaleString()} synced
                                        · {syncErrors} errors</span
                                    >
                                </div>
                                {#if syncProgress > 0}
                                    <progress
                                        class="progress progress-info w-full"
                                        value={syncProgress}
                                        max="100"
                                    ></progress>
                                {:else}
                                    <progress
                                        class="progress progress-info w-full"
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
                                            {#if copyFeedback}✓ Copied{:else}
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
                                                > Copy
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
                                            <span class="opacity-50"
                                                >[{log.time}]</span
                                            >
                                            {log.message}
                                        </div>
                                    {/each}
                                    {#if syncStatus === "syncing"}<div
                                            class="opacity-50 mt-1"
                                        >
                                            <span
                                                class="loading loading-dots loading-xs"
                                            ></span>
                                        </div>{/if}
                                </div>
                                <div class="flex gap-2">
                                    {#if syncStatus === "syncing" || syncStatus === "paused"}
                                        <button
                                            class="btn btn-sm btn-outline"
                                            onclick={toggleSyncPause}
                                            >{syncStatus === "paused"
                                                ? "Resume"
                                                : "Pause"}</button
                                        >
                                        <button
                                            class="btn btn-sm btn-outline btn-error"
                                            onclick={stopJellyfinSync}
                                            >Stop</button
                                        >
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
                                            onclick={() => triggerSync()}
                                            >Sync Again</button
                                        >
                                        <button
                                            class="btn btn-sm btn-ghost"
                                            onclick={() =>
                                                triggerSync(null, null, true)}
                                            >Full Re-sync</button
                                        >
                                    {/if}
                                </div>
                            {/if}
                        </div>
                    {/if}
                </div>

                <!-- People Sync Row -->
                <div
                    class="rounded-lg border border-base-content/10 overflow-hidden"
                >
                    <button
                        class="w-full flex items-center gap-3 px-4 py-3 hover:bg-base-300/50 transition-colors text-left"
                        onclick={() =>
                            (expandedSync =
                                expandedSync === "people" ? null : "people")}
                    >
                        <span class="text-lg">👥</span>
                        <span class="font-medium text-sm flex-1"
                            >Sync People</span
                        >
                        {#if peopleSyncStatus === "syncing" || peopleSyncStatus === "paused"}
                            <span
                                class="loading loading-spinner loading-xs text-info"
                            ></span>
                            <span class="badge badge-info badge-sm gap-1"
                                >syncing</span
                            >
                        {:else if syncHistoryLocal?.people}
                            {@const h = syncHistoryLocal.people}
                            <span
                                class="badge badge-sm gap-1"
                                class:badge-success={h.status === "success"}
                                class:badge-error={h.status === "failed"}
                                class:badge-warning={h.status === "interrupted"}
                            >
                                {h.status}
                            </span>
                            <span class="text-xs text-base-content/40"
                                >{h.finishedAt
                                    ? new Date(h.finishedAt).toLocaleString()
                                    : ""}</span
                            >
                        {:else}
                            <span class="text-xs text-base-content/40"
                                >Never synced</span
                            >
                        {/if}
                        <svg
                            xmlns="http://www.w3.org/2000/svg"
                            class="h-4 w-4 text-base-content/30 transition-transform"
                            class:rotate-180={expandedSync === "people"}
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                            ><polyline points="6 9 12 15 18 9"></polyline></svg
                        >
                    </button>

                    {#if expandedSync === "people" || (peopleSyncStatus !== "idle" && peopleSyncStatus !== "complete" && peopleSyncStatus !== "error")}
                        <div
                            class="px-4 pb-4 space-y-3 border-t border-base-content/5 pt-3"
                            class:hidden={expandedSync !== "people" &&
                                peopleSyncStatus === "idle"}
                        >
                            {#if peopleSyncStatus === "idle" || peopleSyncStatus === "complete" || peopleSyncStatus === "error"}
                                <div class="flex flex-wrap gap-2">
                                    <button
                                        class="btn btn-info btn-sm"
                                        onclick={triggerPeopleSync}
                                        disabled={peopleSyncStatus ===
                                            "syncing"}>Start Sync</button
                                    >
                                    <button
                                        class="btn btn-sm btn-outline btn-info"
                                        onclick={syncExternalIdsOnly}
                                        disabled={externalIdsSyncing ||
                                            peopleSyncStatus === "syncing"}
                                    >
                                        {#if externalIdsSyncing}
                                            <span
                                                class="loading loading-spinner loading-xs"
                                            ></span>
                                        {/if}
                                        External IDs Only
                                    </button>
                                </div>
                                {#if syncHistoryLocal?.people?.summary}
                                    <p class="text-xs text-base-content/50">
                                        Last result: {syncHistoryLocal.people
                                            .summary}
                                    </p>
                                {/if}
                            {/if}
                            {#if peopleSyncStatus !== "idle"}
                                <p class="text-xs text-base-content/50 italic">
                                    You can safely browse around — people sync
                                    continues in the background.
                                </p>
                                <div
                                    class="flex justify-between items-center text-sm"
                                >
                                    <span class="font-medium">
                                        {#if peopleSyncStatus === "complete"}✅
                                            People sync complete!{:else if peopleSyncStatus === "error"}❌
                                            People sync error{:else if peopleSyncStatus === "paused"}⏸️
                                            People sync paused{:else}👥 People
                                            Sync{/if}
                                    </span>
                                    <span class="text-xs text-base-content/50"
                                        >{peopleSyncSynced.toLocaleString()} synced
                                        · {peopleSyncErrors} errors</span
                                    >
                                </div>
                                {#if peopleSyncProgress > 0}
                                    <progress
                                        class="progress progress-info w-full"
                                        value={peopleSyncProgress}
                                        max="100"
                                    ></progress>
                                {:else}
                                    <progress
                                        class="progress progress-info w-full"
                                    ></progress>
                                {/if}
                                <div class="flex items-center justify-between">
                                    <span class="text-xs text-base-content/40"
                                        >People Sync Log</span
                                    >
                                    {#if peopleSyncLogs.length > 0}
                                        <button
                                            class="btn btn-xs btn-ghost gap-1"
                                            onclick={copyPeopleSyncLog}
                                        >
                                            {#if peopleSyncCopyFeedback}✓ Copied{:else}
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
                                                > Copy
                                            {/if}
                                        </button>
                                    {/if}
                                </div>
                                <div
                                    bind:this={peopleSyncConsoleEl}
                                    class="bg-neutral text-neutral-content rounded-lg p-3 h-36 overflow-y-auto text-xs font-mono"
                                >
                                    {#each peopleSyncLogs as log}
                                        <div class={getLogClass(log.type)}>
                                            <span class="opacity-50"
                                                >[{log.time}]</span
                                            >
                                            {log.message}
                                        </div>
                                    {/each}
                                    {#if peopleSyncStatus === "syncing"}<div
                                            class="opacity-50 mt-1"
                                        >
                                            <span
                                                class="loading loading-dots loading-xs"
                                            ></span>
                                        </div>{/if}
                                </div>
                                <div class="flex gap-2">
                                    {#if peopleSyncStatus === "syncing" || peopleSyncStatus === "paused"}
                                        <button
                                            class="btn btn-sm btn-outline"
                                            onclick={togglePeopleSyncPause}
                                            >{peopleSyncStatus === "paused"
                                                ? "Resume"
                                                : "Pause"}</button
                                        >
                                        <button
                                            class="btn btn-sm btn-outline btn-error"
                                            onclick={stopPeopleSyncAction}
                                            >Stop</button
                                        >
                                    {/if}
                                    {#if peopleSyncStatus === "complete" || peopleSyncStatus === "error"}
                                        <button
                                            class="btn btn-sm btn-info"
                                            onclick={() => {
                                                peopleSyncStatus = "idle";
                                            }}>Done</button
                                        >
                                        <button
                                            class="btn btn-sm btn-ghost"
                                            onclick={triggerPeopleSync}
                                            >Sync Again</button
                                        >
                                    {/if}
                                </div>
                                {#if peopleSyncStatus === "complete" && peopleSyncResult}
                                    <p class="text-xs text-base-content/50">
                                        Result: {peopleSyncResult.totalPersons} people,
                                        {peopleSyncResult.totalCredits} credits
                                    </p>
                                {/if}
                            {/if}
                        </div>
                    {/if}
                </div>

                <!-- MusicBrainz Enrich Row -->
                <div
                    class="rounded-lg border border-base-content/10 overflow-hidden"
                >
                    <button
                        class="w-full flex items-center gap-3 px-4 py-3 hover:bg-base-300/50 transition-colors text-left"
                        onclick={() =>
                            (expandedSync =
                                expandedSync === "musicbrainz"
                                    ? null
                                    : "musicbrainz")}
                    >
                        <span class="text-lg">🎵</span>
                        <span class="font-medium text-sm flex-1"
                            >Enrich Music</span
                        >
                        {#if mbStatus === "syncing" || mbStatus === "paused"}
                            <span
                                class="loading loading-spinner loading-xs text-secondary"
                            ></span>
                            <span class="badge badge-secondary badge-sm gap-1"
                                >{mbStatus === "paused"
                                    ? "paused"
                                    : "enriching"}</span
                            >
                        {:else if syncHistoryLocal?.musicbrainz}
                            {@const h = syncHistoryLocal.musicbrainz}
                            <span
                                class="badge badge-sm gap-1"
                                class:badge-success={h.status === "success"}
                                class:badge-error={h.status === "failed"}
                                class:badge-warning={h.status === "interrupted"}
                            >
                                {h.status}
                            </span>
                            <span class="text-xs text-base-content/40"
                                >{h.finishedAt
                                    ? new Date(h.finishedAt).toLocaleString()
                                    : ""}</span
                            >
                        {:else}
                            <span class="text-xs text-base-content/40"
                                >Never run</span
                            >
                        {/if}
                        <svg
                            xmlns="http://www.w3.org/2000/svg"
                            class="h-4 w-4 text-base-content/30 transition-transform"
                            class:rotate-180={expandedSync === "musicbrainz"}
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                            ><polyline points="6 9 12 15 18 9"></polyline></svg
                        >
                    </button>

                    {#if expandedSync === "musicbrainz" || (mbStatus !== "idle" && mbStatus !== "complete" && mbStatus !== "error")}
                        <div
                            class="px-4 pb-4 space-y-3 border-t border-base-content/5 pt-3"
                            class:hidden={expandedSync !== "musicbrainz" &&
                                mbStatus === "idle"}
                        >
                            {#if mbStatus === "idle" || mbStatus === "complete" || mbStatus === "error"}
                                <div class="flex flex-wrap gap-2">
                                    <button
                                        class="btn btn-secondary btn-sm"
                                        onclick={triggerMBEnrich}
                                        disabled={mbStatus === "syncing"}
                                        >Start Enrichment</button
                                    >
                                </div>
                                <p class="text-xs text-base-content/50">
                                    Extract band members, instruments, and
                                    external links from MusicBrainz.
                                </p>
                                {#if syncHistoryLocal?.musicbrainz?.summary}
                                    <p class="text-xs text-base-content/50">
                                        Last result: {syncHistoryLocal
                                            .musicbrainz.summary}
                                    </p>
                                {/if}
                            {/if}
                            {#if mbStatus !== "idle"}
                                <div
                                    class="flex justify-between items-center text-sm"
                                >
                                    <span class="font-medium">
                                        {#if mbStatus === "complete"}✅
                                            MusicBrainz enrichment complete!{:else if mbStatus === "error"}❌
                                            Enrichment error{:else if mbStatus === "paused"}⏸️
                                            Paused{:else}🎵 Enriching music
                                            people...{/if}
                                    </span>
                                    <span class="text-xs text-base-content/50"
                                        >{mbSynced} artists • {mbErrors} errors</span
                                    >
                                </div>
                                {#if mbProgress > 0}
                                    <progress
                                        class="progress progress-secondary w-full"
                                        value={mbProgress}
                                        max="100"
                                    ></progress>
                                {:else}
                                    <progress
                                        class="progress progress-secondary w-full"
                                    ></progress>
                                {/if}
                                <div class="flex items-center justify-between">
                                    <span class="text-xs text-base-content/40"
                                        >MusicBrainz Log</span
                                    >
                                    {#if mbLogs.length > 0}
                                        <button
                                            class="btn btn-xs btn-ghost gap-1"
                                            onclick={copyMBLog}
                                        >
                                            {#if mbCopyFeedback}✓ Copied{:else}
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
                                                > Copy
                                            {/if}
                                        </button>
                                    {/if}
                                </div>
                                <div
                                    bind:this={mbConsoleEl}
                                    class="bg-neutral text-neutral-content rounded-lg p-3 h-36 overflow-y-auto text-xs font-mono"
                                >
                                    {#each mbLogs as log}
                                        <div class={getLogClass(log.type)}>
                                            <span class="opacity-50"
                                                >[{log.time}]</span
                                            >
                                            {log.message}
                                        </div>
                                    {/each}
                                    {#if mbStatus === "syncing"}<div
                                            class="opacity-50 mt-1"
                                        >
                                            <span
                                                class="loading loading-dots loading-xs"
                                            ></span>
                                        </div>{/if}
                                </div>
                                <div class="flex gap-2">
                                    {#if mbStatus === "syncing" || mbStatus === "paused"}
                                        <button
                                            class="btn btn-sm btn-outline"
                                            onclick={toggleMBPause}
                                            >{mbStatus === "paused"
                                                ? "Resume"
                                                : "Pause"}</button
                                        >
                                        <button
                                            class="btn btn-sm btn-outline btn-error"
                                            onclick={stopMBEnrich}>Stop</button
                                        >
                                    {/if}
                                    {#if mbStatus === "complete" || mbStatus === "error"}
                                        <button
                                            class="btn btn-sm btn-info"
                                            onclick={() => {
                                                mbStatus = "idle";
                                            }}>Done</button
                                        >
                                        <button
                                            class="btn btn-sm btn-ghost"
                                            onclick={triggerMBEnrich}
                                            >Enrich Again</button
                                        >
                                    {/if}
                                </div>
                                {#if mbStatus === "complete" && mbResult}
                                    <p class="text-xs text-base-content/50">
                                        Result: {mbResult.totalPersons} persons,
                                        {mbResult.totalCredits} credits, {mbResult.totalExternalIds}
                                        external IDs, {mbResult.mergedPersons} cross-linked
                                    </p>
                                {/if}
                            {/if}
                        </div>
                    {/if}
                </div>

                <!-- Reconcile Row -->
                <div
                    class="rounded-lg border border-base-content/10 overflow-hidden"
                >
                    <button
                        class="w-full flex items-center gap-3 px-4 py-3 hover:bg-base-300/50 transition-colors text-left"
                        onclick={() =>
                            (expandedSync =
                                expandedSync === "reconcile"
                                    ? null
                                    : "reconcile")}
                    >
                        <span class="text-lg">🔗</span>
                        <span class="font-medium text-sm flex-1">Reconcile</span
                        >
                        {#if reconciling}
                            <span
                                class="loading loading-spinner loading-xs text-info"
                            ></span>
                            <span class="badge badge-info badge-sm gap-1"
                                >running</span
                            >
                        {:else if syncHistoryLocal?.reconcile}
                            {@const h = syncHistoryLocal.reconcile}
                            <span
                                class="badge badge-sm gap-1"
                                class:badge-success={h.status === "success"}
                                class:badge-error={h.status === "failed"}
                            >
                                {h.status}
                            </span>
                            <span class="text-xs text-base-content/40"
                                >{h.finishedAt
                                    ? new Date(h.finishedAt).toLocaleString()
                                    : ""}</span
                            >
                        {:else}
                            <span class="text-xs text-base-content/40"
                                >Never run</span
                            >
                        {/if}
                        <svg
                            xmlns="http://www.w3.org/2000/svg"
                            class="h-4 w-4 text-base-content/30 transition-transform"
                            class:rotate-180={expandedSync === "reconcile"}
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                            ><polyline points="6 9 12 15 18 9"></polyline></svg
                        >
                    </button>

                    {#if expandedSync === "reconcile"}
                        <div
                            class="px-4 pb-4 space-y-3 border-t border-base-content/5 pt-3"
                        >
                            <p class="text-xs text-base-content/50">
                                Merge orphaned Last.fm/Trakt media entries into
                                Jellyfin-synced items.
                            </p>
                            <div class="flex flex-wrap gap-2">
                                <button
                                    class="btn btn-info btn-sm"
                                    disabled={reconciling}
                                    onclick={runReconcile}
                                >
                                    {#if reconciling}<span
                                            class="loading loading-spinner loading-xs"
                                        ></span>{/if}
                                    Run Reconcile
                                </button>
                            </div>
                            {#if reconcileResult}
                                <p class="text-xs text-base-content/50">
                                    {#if reconcileResult.error}❌ {reconcileResult.error}{:else}✅
                                        {reconcileResult.merged} plays migrated,
                                        {reconcileResult.deleted} orphans removed{/if}
                                </p>
                            {/if}
                            {#if syncHistoryLocal?.reconcile?.summary}
                                <p class="text-xs text-base-content/50">
                                    Last result: {syncHistoryLocal.reconcile
                                        .summary}
                                </p>
                            {/if}
                        </div>
                    {/if}
                </div>
            </div>
        </div>
    </div>

    <!-- Data Management -->
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
                    stroke-linecap="round"
                    stroke-linejoin="round"
                >
                    <path
                        d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"
                    /><polyline points="7 10 12 15 17 10" /><line
                        x1="12"
                        y1="15"
                        x2="12"
                        y2="3"
                    />
                </svg>
                Data Management
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
                            <span class="font-semibold text-warning"
                                >Include encrypted data.</span
                            > I understand including passwords/keys is risky. Include:
                        </span>
                    </label>

                    {#if exportSensitive}
                        <div class="ml-7 space-y-1.5">
                            <label
                                class="flex items-center gap-2 cursor-pointer"
                            >
                                <input
                                    type="checkbox"
                                    class="checkbox checkbox-xs"
                                    bind:checked={exportPasswords}
                                />
                                <span class="text-xs"
                                    >Password hashes <span
                                        class="text-base-content/40"
                                        >(all accounts)</span
                                    ></span
                                >
                            </label>
                            <label
                                class="flex items-center gap-2 cursor-pointer"
                            >
                                <input
                                    type="checkbox"
                                    class="checkbox checkbox-xs"
                                    bind:checked={exportTokens}
                                />
                                <span class="text-xs"
                                    >Access tokens <span
                                        class="text-base-content/40"
                                        >(Trakt, Last.fm, Jellyfin)</span
                                    ></span
                                >
                            </label>
                            <label
                                class="flex items-center gap-2 cursor-pointer"
                            >
                                <input
                                    type="checkbox"
                                    class="checkbox checkbox-xs"
                                    bind:checked={exportApiKeys}
                                />
                                <span class="text-xs"
                                    >API keys <span class="text-base-content/40"
                                        >(TheTVDB, TMDB, MusicBrainz, Trakt,
                                        Last.fm)</span
                                    ></span
                                >
                            </label>
                        </div>
                    {/if}
                </div>

                <button
                    class="btn btn-sm btn-info gap-2"
                    onclick={exportData}
                    disabled={exporting}
                >
                    {#if exporting}
                        <span class="loading loading-spinner loading-xs"></span>
                    {:else}
                        <svg
                            xmlns="http://www.w3.org/2000/svg"
                            class="w-4 h-4"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            ><path
                                d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"
                            /><polyline points="7 10 12 15 17 10" /><line
                                x1="12"
                                y1="15"
                                x2="12"
                                y2="3"
                            /></svg
                        >
                    {/if}
                    Download Backup
                </button>
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
                            <select
                                class="select select-sm select-bordered"
                                bind:value={importMode}
                            >
                                <option value="overwrite">Overwrite all</option>
                                <option value="merge">Merge data</option>
                            </select>
                        </div>

                        {#if importMode === "merge"}
                            <div class="form-control">
                                <label class="label py-0">
                                    <span class="label-text text-xs"
                                        >Prefer</span
                                    >
                                </label>
                                <select
                                    class="select select-sm select-bordered"
                                    bind:value={importPrefer}
                                >
                                    <option value="new">New data wins</option>
                                    <option value="old"
                                        >Existing data wins</option
                                    >
                                </select>
                            </div>
                        {/if}

                        <button
                            class="btn btn-sm btn-warning gap-2 self-end"
                            onclick={importData}
                            disabled={importing}
                        >
                            {#if importing}
                                <span class="loading loading-spinner loading-xs"
                                ></span>
                            {/if}
                            Import
                        </button>
                    </div>

                    {#if importMode === "overwrite"}
                        <div class="alert alert-warning alert-sm">
                            <svg
                                xmlns="http://www.w3.org/2000/svg"
                                class="h-4 w-4 shrink-0"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                stroke-width="2"
                                ><path
                                    d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
                                /><line x1="12" y1="9" x2="12" y2="13" /><line
                                    x1="12"
                                    y1="17"
                                    x2="12.01"
                                    y2="17"
                                /></svg
                            >
                            <span class="text-xs"
                                >This will delete all existing data and replace
                                it with the backup.</span
                            >
                        </div>
                    {/if}
                {/if}

                {#if importResult}
                    <div
                        class="rounded-xl p-4 border {importResult.success
                            ? 'bg-success/5 border-success/20 text-base-content'
                            : 'bg-error/5 border-error/20 text-base-content'}"
                    >
                        <div class="w-full">
                            {#if importResult.success}
                                <p class="text-sm font-medium">
                                    Import complete ({importResult.mode})
                                </p>
                                <div
                                    class="text-xs mt-1 grid grid-cols-2 gap-x-4 gap-y-0.5"
                                >
                                    {#each Object.entries(importResult.results?.imported || {}) as [table, count]}
                                        <span class="text-base-content/60"
                                            >{table}:</span
                                        >
                                        <span>{count}</span>
                                    {/each}
                                </div>
                                {#if importResult.results?.errors?.length > 0}
                                    <p class="text-xs text-error mt-1">
                                        {importResult.results.errors.join(", ")}
                                    </p>
                                {/if}
                            {:else}
                                <p class="text-sm">
                                    {importResult.error || "Import failed"}
                                </p>
                            {/if}
                        </div>
                    </div>
                {/if}
            </div>
        </div>
    </div>

    <!-- Save Button (always visible) -->
    <div class="flex items-center gap-3">
        <button
            class="btn {isDirty
                ? 'btn-primary btn-lg animate-pulse'
                : 'btn-primary'}"
            onclick={saveSettings}
            disabled={saving || !isDirty}
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
