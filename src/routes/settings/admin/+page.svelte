<script>
    import ServiceIcon from "$lib/components/ServiceIcon.svelte";
    import LogConsole from "$lib/components/LogConsole.svelte";
    import ReconciliationPanel from "$lib/components/ReconciliationPanel.svelte";
    import { copyToClipboard } from "$lib/utils.js";
    import { page } from "$app/stores";
    import { goto } from "$app/navigation";
    import { jellyfinAuthInvalid } from "$lib/stores/auth.js";

    /** Format a date string as relative time, e.g. "2 hours ago" */
    function timeAgo(dateStr) {
        if (!dateStr) return '';
        const d = new Date(dateStr);
        const now = new Date();
        const diffMs = now.getTime() - d.getTime();
        const diffSec = Math.floor(diffMs / 1000);
        if (diffSec < 60) return 'just now';
        const diffMin = Math.floor(diffSec / 60);
        if (diffMin < 60) return `${diffMin}m ago`;
        const diffHr = Math.floor(diffMin / 60);
        if (diffHr < 24) return `${diffHr}h ago`;
        const diffDay = Math.floor(diffHr / 24);
        if (diffDay < 7) return `${diffDay}d ago`;
        if (diffDay < 30) return `${Math.floor(diffDay / 7)}w ago`;
        return `${Math.floor(diffDay / 30)}mo ago`;
    }

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
    let jellyfinPrDbPath = $state(data.settings.jellyfinPrDbPath || "/app/jellyfin/playback_reporting.db");
    let jellyfinSyncCheck = $state(!!data.settings.jellyfinSyncCheck);

    // Jellyfin PR DB Validation
    /** @type {'idle' | 'checking' | 'valid' | 'error'} */
    let prDbStatus = $state('idle');
    let prDbMessage = $state('');
    let prDbRows = $state(0);

    async function validatePrDb() {
        if (!jellyfinPrDbPath.trim()) {
            prDbStatus = 'idle';
            prDbMessage = '';
            return;
        }
        prDbStatus = 'checking';
        prDbMessage = '';
        try {
            const res = await fetch('/api/settings/validate-pr-db', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ dbPath: jellyfinPrDbPath.trim() })
            });
            const result = await res.json();
            if (result.valid) {
                prDbStatus = 'valid';
                prDbMessage = result.message;
                prDbRows = result.rows;
            } else {
                prDbStatus = 'error';
                prDbMessage = result.error;
            }
        } catch (e) {
            prDbStatus = 'error';
            prDbMessage = 'Failed to validate path';
        }
    }

    // Auto-validate on mount if path is set
    $effect(() => {
        if (jellyfinPrDbPath) validatePrDb();
    });

    // External Ratings
    let omdbApiKey = $state("");
    let discogsToken = $state("");
    // Fanart.tv
    let fanartApiKey = $state("");
    // Database backups
    let dbBackupCount = $state(data.settings.dbBackupCount ?? 2);

    // LLM Integration
    let ollamaUrl = $state(data.settings.ollamaUrl || "");
    let ollamaEmbedModel = $state(
        data.settings.ollamaEmbedModel || "nomic-embed-text",
    );
    let ollamaChatModel = $state(
        data.settings.ollamaChatModel || "llama3.2:3b",
    );
    // Multi-provider LLM
    let llmProvider = $state(data.settings.llmProvider || 'ollama');
    let llmApiKey = $state(data.settings.llmApiKey || '');
    let llmApiUrl = $state(data.settings.llmApiUrl || '');
    let llmChatModel = $state(data.settings.llmChatModel || '');
    let llmEmbedProvider = $state(data.settings.llmEmbedProvider || 'ollama');
    let llmEmbedModel = $state(data.settings.llmEmbedModel || '');

    // *arr Integration
    /** @type {Array<{service: string, label: string, defaultPort: number}>} */
    const ARR_SERVICES = [
        { service: "radarr", label: "Radarr (movies)", defaultPort: 7878 },
        { service: "sonarr", label: "Sonarr (TV)", defaultPort: 8989 },
        { service: "lidarr", label: "Lidarr (music)", defaultPort: 8686 },
    ];
    let radarrUrl = $state(data.settings.radarrUrl || "");
    let radarrApiKey = $state("");
    let radarrExternalUrl = $state(data.settings.radarrExternalUrl || "");
    let sonarrUrl = $state(data.settings.sonarrUrl || "");
    let sonarrApiKey = $state("");
    let sonarrExternalUrl = $state(data.settings.sonarrExternalUrl || "");
    let lidarrUrl = $state(data.settings.lidarrUrl || "");
    let lidarrApiKey = $state("");
    let lidarrExternalUrl = $state(data.settings.lidarrExternalUrl || "");
    /** @type {Record<string, string>} */
    let arrTestStatus = $state({
        radarr: "idle",
        sonarr: "idle",
        lidarr: "idle",
    });
    /** @type {Record<string, string>} */
    let arrTestInfo = $state({ radarr: "", sonarr: "", lidarr: "" });
    let arrScanStatus = $state("idle"); // idle | scanning | done
    let arrSyncRunning = $state(false);
    /** @type {{ time: string, message: string, type: string }[]} */
    let arrSyncLogs = $state([]);

    // ─── Tab Navigation ─────────────────────────────────────────────────────────
    const VALID_TABS = /** @type {const} */ (['server', 'credentials', 'sync', 'cleanup', 'import-export', 'api-keys']);
    /** @type {'server' | 'credentials' | 'sync' | 'cleanup' | 'import-export' | 'api-keys'} */
    let activeTab = $state(
        VALID_TABS.includes(/** @type {any} */ ($page.url.searchParams.get('tab')))
            ? /** @type {typeof VALID_TABS[number]} */ ($page.url.searchParams.get('tab'))
            : 'server'
    );

    // Keep activeTab in sync with URL search params (for sidebar links)
    $effect(() => {
        const urlTab = $page.url.searchParams.get('tab');
        if (urlTab && VALID_TABS.includes(/** @type {any} */ (urlTab)) && urlTab !== activeTab) {
            activeTab = /** @type {typeof activeTab} */ (urlTab);
        }
    });

    /** @param {string} tabId */
    function switchTab(tabId) {
        activeTab = tabId;
        goto(`/settings/admin?tab=${tabId}`, { replaceState: true, noScroll: true });
    }

    // Load conflicts when sync tab is shown
    $effect(() => {
        if (activeTab === 'sync') {
            loadConflicts();
        }
    });
    const TABS = [
        { id: 'server', label: 'Server', icon: 'M5 12H3l9-9 9 9h-2M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7' },
        { id: 'credentials', label: 'Credentials', icon: 'M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z' },
        { id: 'sync', label: 'Data Sync', icon: 'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15' },
        { id: 'cleanup', label: 'Data Clean-up', icon: 'M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.414 3.414H4.828c-1.78 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z' },
        { id: 'import-export', label: 'Import / Export', icon: 'M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12' },
        { id: 'api-keys', label: 'API Keys', icon: 'M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z' },
    ];

    // ─── API Keys State ──────────────────────────────────────────────────────────
    let apiKeysList = $state(data.apiKeys || []);
    let newKeyName = $state('');
    let newKeyPermissions = $state({ 'read:media': true, 'write:media': false, 'read:sync': true, 'write:sync': false, 'admin': false });
    let newKeyExpiry = $state('');
    let creatingKey = $state(false);
    /** @type {string|null} */
    let newlyCreatedKey = $state(null);
    let keyCopied = $state(false);

    const PERMISSION_GROUPS = [
        { label: 'Media', scopes: [
            { id: 'read:media', label: 'Read', desc: 'View media, history, stats' },
            { id: 'write:media', label: 'Write', desc: 'Modify play history, ratings, delete entries' },
        ]},
        { label: 'Sync', scopes: [
            { id: 'read:sync', label: 'Read', desc: 'View sync status and logs' },
            { id: 'write:sync', label: 'Write', desc: 'Trigger syncs, backfills, reconciliations' },
        ]},
        { label: 'Admin', scopes: [
            { id: 'admin', label: 'Full Access', desc: 'All endpoints, equivalent to admin user' },
        ]},
    ];

    async function createApiKey() {
        if (!newKeyName.trim()) return;
        creatingKey = true;
        const permissions = Object.entries(newKeyPermissions)
            .filter(([, v]) => v)
            .map(([k]) => k);
        try {
            const res = await fetch('/api/api-keys', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: newKeyName.trim(),
                    permissions,
                    expiresAt: newKeyExpiry || null
                })
            });
            const result = await res.json();
            if (res.ok) {
                newlyCreatedKey = result.key;
                keyCopied = false;
                // Add to local list
                apiKeysList = [{
                    id: result.id,
                    name: result.name,
                    key_prefix: result.keyPrefix,
                    permissions: result.permissions,
                    last_used_at: null,
                    created_at: result.createdAt,
                    expires_at: result.expiresAt,
                    owner: 'you'
                }, ...apiKeysList];
                // Reset form
                newKeyName = '';
                newKeyPermissions = { 'read:media': true, 'write:media': false, 'read:sync': true, 'write:sync': false, 'admin': false };
                newKeyExpiry = '';
            }
        } catch { /* ignore */ }
        creatingKey = false;
    }

    async function deleteApiKey(id) {
        if (!confirm('Revoke this API key? Any integrations using it will stop working.')) return;
        try {
            const res = await fetch(`/api/api-keys/${id}`, { method: 'DELETE' });
            if (res.ok) {
                apiKeysList = apiKeysList.filter(k => k.id !== id);
            }
        } catch { /* ignore */ }
    }

    function copyApiKey(text) {
        copyToClipboard(text);
        keyCopied = true;
        setTimeout(() => keyCopied = false, 3000);
    }

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
        jellyfinPrDbPath: data.settings.jellyfinPrDbPath || "/app/jellyfin/playback_reporting.db",
        jellyfinSyncCheck: !!data.settings.jellyfinSyncCheck,
        ollamaUrl: data.settings.ollamaUrl || "",
        ollamaEmbedModel: data.settings.ollamaEmbedModel || "nomic-embed-text",
        ollamaChatModel: data.settings.ollamaChatModel || "llama3.2:3b",
        llmProvider: data.settings.llmProvider || 'ollama',
        llmApiKey: data.settings.llmApiKey || '',
        llmApiUrl: data.settings.llmApiUrl || '',
        llmChatModel: data.settings.llmChatModel || '',
        llmEmbedProvider: data.settings.llmEmbedProvider || 'ollama',
        llmEmbedModel: data.settings.llmEmbedModel || '',
        omdbApiKey: "",
        discogsToken: "",
        fanartApiKey: "",
    });

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
            ollamaChatModel !== initialValues.ollamaChatModel ||
            llmProvider !== initialValues.llmProvider ||
            llmApiKey !== initialValues.llmApiKey ||
            llmApiUrl !== initialValues.llmApiUrl ||
            llmChatModel !== initialValues.llmChatModel ||
            llmEmbedProvider !== initialValues.llmEmbedProvider ||
            llmEmbedModel !== initialValues.llmEmbedModel ||
            omdbApiKey !== initialValues.omdbApiKey ||
            discogsToken !== initialValues.discogsToken ||
            fanartApiKey !== initialValues.fanartApiKey,
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
    let exportImages = $state(false);

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

    // ─── Factory Reset ──────────────────────────────────────────────────────────
    let resetExpanded = $state(false);
    let resetConfirmation = $state('');
    let resetting = $state(false);
    let resetError = $state('');

    async function factoryReset() {
        if (resetConfirmation !== 'goodbye') return;
        resetting = true;
        resetError = '';
        try {
            const res = await fetch('/api/factory-reset', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ confirmation: 'goodbye' })
            });
            const data = await res.json();
            if (!res.ok) {
                resetError = data.error || 'Factory reset failed.';
                resetting = false;
                return;
            }
            // Wait for server to exit and restart before redirecting
            await new Promise(r => setTimeout(r, 3000));
            window.location.href = '/';
        } catch (e) {
            resetError = e instanceof Error ? e.message : 'Factory reset failed.';
            resetting = false;
        }
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
            omdbApiKey,
            discogsToken,
            fanartApiKey,
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
        omdbApiKey = snapshot.omdbApiKey;
        discogsToken = snapshot.discogsToken;
        fanartApiKey = snapshot.fanartApiKey;
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
            payload.llm_provider = llmProvider;
            if (llmApiKey && llmApiKey !== '••••••••') payload.llm_api_key = llmApiKey;
            payload.llm_api_url = llmApiUrl || null;
            payload.llm_chat_model = llmChatModel || null;
            payload.llm_embed_provider = llmEmbedProvider;
            payload.llm_embed_model = llmEmbedModel || null;
            if (omdbApiKey && omdbApiKey !== "••••••••")
                payload.omdb_api_key = omdbApiKey;
            if (discogsToken && discogsToken !== "••••••••")
                payload.discogs_token = discogsToken;
            if (fanartApiKey && fanartApiKey !== "••••••••")
                payload.fanart_api_key = fanartApiKey;
            payload.db_backup_count = dbBackupCount;

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
    let forceResync = $state(false);
    let syncLogs = $state([]);
    /** @type {AbortController | null} */
    let syncAbortController = $state(null);
    let syncSseRetries = $state(0);
    let copyFeedback = $state(false);
    /** @type {HTMLDivElement | null} */

    // ─── Sync Conflicts ──────────────────────────────────────────────────────────
    let syncConflicts = $state([]);
    let conflictsLoading = $state(false);

    async function loadConflicts() {
        conflictsLoading = true;
        try {
            const res = await fetch("/api/conflicts");
            if (res.ok) {
                const data = await res.json();
                syncConflicts = data.conflicts || [];
            }
        } catch {
            /* ignore */
        }
        conflictsLoading = false;
    }

    async function dismissConflict(id) {
        try {
            await fetch("/api/conflicts", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    conflictId: id,
                    resolution: "dismissed",
                }),
            });
            syncConflicts = syncConflicts.filter((c) => c.id !== id);
        } catch {
            /* ignore */
        }
    }


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
    let peopleSseRetries = $state(0);
    /** @type {HTMLDivElement | null} */
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
                peopleSseRetries = 0;
                handlePeopleSyncSSE(JSON.parse(event.data));
            } catch {
                /* ignore */
            }
        };
        peopleSyncEventSource.onerror = () => {
            if (peopleSyncStatus === "syncing" && peopleSseRetries < 5) {
                peopleSseRetries++;
                addPeopleSyncLog(
                    `Connection interrupted, reconnecting (attempt ${peopleSseRetries})...`,
                    "warning",
                );
                peopleSyncEventSource?.close();
                setTimeout(() => {
                    if (peopleSyncStatus === "syncing") connectPeopleSyncSSE();
                }, 1000 * peopleSseRetries);
            } else if (peopleSyncStatus === "syncing") {
                addPeopleSyncLog(
                    "Connection lost after multiple retries. Sync continues in the background.",
                    "warning",
                );
                peopleSyncEventSource?.close();
            }
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
            syncAbortController?.abort();
            syncAbortController = null;
            mbEventSource?.close();
            mbEventSource = null;
        };
    });



    function addSyncLog(message, type = "info") {
        syncLogs = [
            ...syncLogs.slice(-5000),
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
            syncAbortController?.abort();
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
        } else if (d.type === "auth_error") {
            syncStatus = "error";
            syncAbortController?.abort();
            jellyfinAuthInvalid.set(true);
        }
        if (d.log) addSyncLog(d.log, d.logType || "info");
    }

    /** Connect to sync SSE stream using fetch + ReadableStream reader */
    async function connectSSE() {
        // Abort any existing connection
        if (syncAbortController) syncAbortController.abort();
        syncAbortController = new AbortController();

        try {
            const response = await fetch("/api/sync", {
                signal: syncAbortController.signal,
                headers: { Accept: "text/event-stream" },
            });

            if (!response.ok) {
                addSyncLog(
                    `Sync stream returned HTTP ${response.status}`,
                    "error",
                );
                return;
            }

            if (!response.body) {
                addSyncLog("Sync stream has no body", "error");
                return;
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = "";

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });

                // SSE format: "data: {...}\n\n"
                const messages = buffer.split("\n\n");
                buffer = messages.pop() || ""; // keep incomplete message in buffer

                for (const msg of messages) {
                    const line = msg.trim();
                    if (!line || line.startsWith(":")) continue; // skip keepalive comments
                    const dataPrefix = "data: ";
                    if (line.startsWith(dataPrefix)) {
                        try {
                            syncSseRetries = 0;
                            handleSSEMessage(
                                JSON.parse(line.slice(dataPrefix.length)),
                            );
                        } catch {
                            /* ignore malformed */
                        }
                    }
                }
            }
        } catch (e) {
            // AbortError is expected when we cancel the connection
            if (e instanceof DOMException && e.name === "AbortError") return;

            if (syncStatus === "syncing" && syncSseRetries < 5) {
                syncSseRetries++;
                addSyncLog(
                    `Stream connection failed: ${e instanceof Error ? e.message : String(e)}. Reconnecting (${syncSseRetries}/5)...`,
                    "warning",
                );
                setTimeout(() => {
                    if (syncStatus === "syncing") connectSSE();
                }, 1000 * syncSseRetries);
            } else if (syncStatus === "syncing") {
                addSyncLog(
                    "Connection lost after multiple retries. Sync continues in the background.",
                    "warning",
                );
            }
        }
    }

    // Jellyfin sync auto-reconnect handled by the unified mount probe above

    async function triggerSync(
        libraryId = null,
        libraryName = null,
        force = false,
    ) {
        syncSseRetries = 0;
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
        syncAbortController?.abort();
        syncAbortController = null;
    }

    function getLogClass(type) {
        if (type === "success") return "text-success";
        if (type === "error") return "text-error";
        if (type === "warning") return "text-warning";
        return "text-base-content/70";
    }

    async function triggerPeopleSync() {
        peopleSyncStatus = "syncing";
        peopleSseRetries = 0;
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

    async function syncEnrichOnly() {
        peopleSyncStatus = "syncing";
        peopleSyncProgress = 0;
        peopleSyncSynced = 0;
        peopleSyncErrors = 0;
        peopleSyncLogs = [];
        peopleSyncResult = null;

        addPeopleSyncLog("📝 Starting people enrich sync (TMDB profiles)...", "info");

        try {
            const res = await fetch("/api/people/sync", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "enrich" }),
            });
            const result = await res.json();

            if (!result.success) {
                addPeopleSyncLog(
                    result.error || "Failed to start enrich sync.",
                    "error",
                );
                peopleSyncStatus = "error";
                return;
            }

            connectPeopleSyncSSE();
        } catch {
            addPeopleSyncLog("❌ Failed to start enrich sync.", "error");
            peopleSyncStatus = "error";
        }
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
        copyToClipboard(text);
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
        copyToClipboard(text);
        mbCopyFeedback = true;
        setTimeout(() => (mbCopyFeedback = false), 2000);
    }

    // ─── Wikipedia Backfill ──────────────────────────────────────────────────────
    let wikiStatus = $state("idle"); // idle | syncing | complete | error
    let wikiTotal = $state(0);
    let wikiDone = $state(0);
    let wikiFound = $state(0);
    let wikiLogs = $state([]);

    function addWikiLog(message, type = "info") {
        wikiLogs = [...wikiLogs.slice(-100), { time: new Date().toLocaleTimeString(), message, type }];
    }

    async function triggerWikipedia() {
        wikiStatus = "syncing";
        wikiLogs = [];
        wikiTotal = 0;
        wikiDone = 0;
        wikiFound = 0;
        addWikiLog("Starting Wikipedia backfill...", "info");

        try {
            const res = await fetch("/api/backfill/wikipedia", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "start" })
            });
            if (!res.ok) {
                const err = await res.json();
                addWikiLog(err.error || "Failed to start", "error");
                wikiStatus = "error";
                return;
            }
        } catch {
            addWikiLog("Failed to start Wikipedia backfill", "error");
            wikiStatus = "error";
            return;
        }

        // Connect SSE
        const sseRes = await fetch("/api/backfill/wikipedia");
        const reader = sseRes.body?.getReader();
        if (!reader) return;
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
                    if (d.log) addWikiLog(d.log, d.logType || "info");
                    if (d.total !== undefined) wikiTotal = d.total;
                    if (d.done !== undefined) wikiDone = d.done;
                    if (d.found !== undefined) wikiFound = d.found;
                    if (d.type === "complete") {
                        wikiStatus = "complete";
                        syncHistoryLocal = {
                            ...syncHistoryLocal,
                            wikipedia: {
                                status: "success",
                                finishedAt: new Date().toISOString(),
                                summary: `${wikiFound} summaries found`,
                            },
                        };
                        reader.cancel();
                        return;
                    }
                    if (d.type === "error" && !d.phase) {
                        wikiStatus = "error";
                        syncHistoryLocal = {
                            ...syncHistoryLocal,
                            wikipedia: {
                                status: "failed",
                                finishedAt: new Date().toISOString(),
                                summary: "Backfill failed",
                            },
                        };
                        reader.cancel();
                        return;
                    }
                    if (d.type === "stopped") {
                        wikiStatus = "idle";
                        reader.cancel();
                        return;
                    }
                } catch { /* skip malformed */ }
            }
        }
    }

    async function stopWikipedia() {
        await fetch("/api/backfill/wikipedia", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "stop" })
        });
    }

    // ─── Backdrop Enrichment ──────────────────────────────────────────────────────
    let backdropStatus = $state("idle"); // idle | syncing | complete | error
    let backdropDone = $state(0);
    let backdropTotal = $state(0);
    let backdropEnriched = $state(0);
    /** @type {Array<{time: string, message: string, type: string}>} */
    let backdropLogs = $state([]);

    /** @param {string} msg @param {string} [type] */
    function addBackdropLog(msg, type = "info") {
        const time = new Date().toLocaleTimeString();
        backdropLogs = [...backdropLogs, { time, message: msg, type }];
    }

    async function triggerBackdropEnrich() {
        backdropStatus = "syncing";
        backdropDone = 0;
        backdropTotal = 0;
        backdropEnriched = 0;
        backdropLogs = [];
        addBackdropLog("Starting backdrop enrichment...");

        try {
            const res = await fetch("/api/backfill/backdrops", { method: "POST" });
            const reader = res.body?.getReader();
            if (!reader) throw new Error("No stream");

            const decoder = new TextDecoder();
            let buffer = "";

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });

                const lines = buffer.split("\n\n");
                buffer = lines.pop() || "";

                for (const line of lines) {
                    const dataLine = line.replace(/^data: /, "").trim();
                    if (!dataLine) continue;
                    try {
                        const evt = JSON.parse(dataLine);
                        if (evt.type === "start") {
                            backdropTotal = evt.total;
                            addBackdropLog(`Found ${evt.total} items without backdrops`);
                        } else if (evt.type === "progress") {
                            backdropDone = evt.index;
                            backdropEnriched = evt.enriched;
                            if (evt.status === "ok") {
                                addBackdropLog(`✓ ${evt.title}`, "success");
                            } else if (evt.status === "error") {
                                addBackdropLog(`✗ ${evt.title}: ${evt.error}`, "error");
                            }
                        } else if (evt.type === "complete") {
                            addBackdropLog(`Done! ${evt.enriched}/${evt.total} backdrops found`, "success");
                            backdropStatus = "complete";
                        } else if (evt.type === "error") {
                            addBackdropLog(evt.message, "error");
                            backdropStatus = "error";
                        }
                    } catch { /* skip bad JSON */ }
                }
            }
        } catch (e) {
            addBackdropLog(`Error: ${e instanceof Error ? e.message : String(e)}`, "error");
            backdropStatus = "error";
        }

        if (backdropStatus === "syncing") backdropStatus = "complete";
    }

    // ─── Run All Pipeline ────────────────────────────────────────────────────────
    let runAllActive = $state(false);
    let runAllStep = $state(0); // 0=not started, 1=jellyfin, 2=people, 3=musicbrainz, 4=reconcile, 5=done
    let runAllLogs = $state([]);
    const RUN_ALL_STEPS = [
        { num: 1, label: "Jellyfin Sync", emoji: "📚" },
        { num: 2, label: "People Sync", emoji: "👥" },
        { num: 3, label: "MusicBrainz Enrich", emoji: "🎵" },
        { num: 4, label: "Reconciliation", emoji: "🔄" },
    ];

    function addRunAllLog(message, type = "info") {
        runAllLogs = [
            ...runAllLogs,
            { time: new Date().toLocaleTimeString(), message, type },
        ];
    }

    /** Wait for a condition to be true, polling every interval ms */
    function waitFor(conditionFn, interval = 1000, timeout = 600000) {
        return new Promise((resolve, reject) => {
            const start = Date.now();
            const check = () => {
                if (conditionFn()) return resolve(undefined);
                if (Date.now() - start > timeout) return reject(new Error("Timeout"));
                setTimeout(check, interval);
            };
            check();
        });
    }

    async function runAllSyncs() {
        if (runAllActive) return;
        runAllActive = true;
        runAllStep = 0;
        runAllLogs = [];
        expandedSync = "jellyfin";

        addRunAllLog("🚀 Starting full sync pipeline — this may take 10–30 minutes depending on library size.", "info");

        try {
            // Step 1: Jellyfin Sync
            runAllStep = 1;
            addRunAllLog("── Step 1/4: Jellyfin Sync ──", "info");
            await triggerSync(null, null, forceResync);
            await waitFor(() => syncStatus === "complete" || syncStatus === "error");
            if (syncStatus === "error") {
                addRunAllLog("❌ Jellyfin Sync failed — stopping pipeline.", "error");
                runAllActive = false;
                return;
            }
            addRunAllLog(`✅ Jellyfin Sync complete — ${syncItemsSynced} items, ${syncErrors} errors`, "success");
            syncStatus = "idle";

            // Step 2: People Sync
            runAllStep = 2;
            expandedSync = "people";
            addRunAllLog("── Step 2/4: People Sync ──", "info");
            await triggerPeopleSync();
            await waitFor(() => peopleSyncStatus === "complete" || peopleSyncStatus === "error");
            if (peopleSyncStatus === "error") {
                addRunAllLog("⚠ People Sync had errors — continuing.", "warning");
            } else {
                addRunAllLog(`✅ People Sync complete — ${peopleSyncSynced} synced, ${peopleSyncErrors} errors`, "success");
            }
            peopleSyncStatus = "idle";

            // Step 3: MusicBrainz Enrich
            runAllStep = 3;
            expandedSync = "musicbrainz";
            addRunAllLog("── Step 3/4: MusicBrainz Enrich ──", "info");
            await triggerMBEnrich();
            await waitFor(() => mbStatus === "complete" || mbStatus === "error");
            if (mbStatus === "error") {
                addRunAllLog("⚠ MusicBrainz Enrich had errors — continuing.", "warning");
            } else {
                addRunAllLog(`✅ MusicBrainz Enrich complete — ${mbSynced} enriched, ${mbErrors} errors`, "success");
            }
            mbStatus = "idle";

            // Step 4: Reconciliation
            runAllStep = 4;
            addRunAllLog("── Step 4/4: Reconciliation ──", "info");
            addRunAllLog("Running reconciliation — this cleans up duplicates and matches external data...", "info");
            const reconcileRes = await fetch("/api/sync/reconcile", { method: "POST" });
            const reconcileResult = await reconcileRes.json();
            if (reconcileResult.success) {
                addRunAllLog(`✅ Reconciliation complete`, "success");
            } else {
                addRunAllLog(`⚠ Reconciliation: ${reconcileResult.error || "unknown error"}`, "warning");
            }

            runAllStep = 5;
            addRunAllLog("🎉 Full sync pipeline complete!", "success");
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            addRunAllLog(`❌ Pipeline error: ${msg}`, "error");
        } finally {
            runAllActive = false;
        }
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
    let ollamaScanStatus = $state("idle"); // idle | scanning | found | notfound

    let embeddingStatus = $state("idle"); // idle | running | complete | error
    let embeddingPhase = $state("");
    let embeddingDone = $state(0);
    let embeddingTotal = $state(0);
    let embeddingError = $state("");
    /** @type {{ available: boolean, overviewEmbeddings: number, titleEmbeddings: number, totalParentsWithOverview: number, totalChildren: number } | null} */
    let embeddingStats = $state(null);

    let taggingStatus = $state("idle");
    let taggingDone = $state(0);
    let taggingTotal = $state(0);
    let taggingTagged = $state(0);
    let taggingCurrent = $state("");
    let taggingError = $state("");
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

                // Auto-select recommended models if current selection isn't in the list
                const embedModels = ollamaHealthModels.filter((m) =>
                    /embed|minilm|bert/i.test(m),
                );
                const genModels = ollamaHealthModels.filter(
                    (m) => !/embed|minilm|bert/i.test(m),
                );

                if (
                    embedModels.length &&
                    !embedModels.includes(ollamaEmbedModel)
                ) {
                    ollamaEmbedModel =
                        embedModels.find((m) => m.includes("nomic-embed")) ||
                        embedModels[0];
                }
                if (genModels.length && !genModels.includes(ollamaChatModel)) {
                    ollamaChatModel =
                        genModels.find((m) => m.includes("llama3.2")) ||
                        genModels[0];
                }
            } else {
                ollamaHealthStatus = "error";
                ollamaHealthError = data.error || "Connection failed";
            }
        } catch {
            ollamaHealthStatus = "error";
            ollamaHealthError = "Network error";
        }
    }

    async function scanForOllama() {
        ollamaScanStatus = "scanning";
        try {
            const res = await fetch("/api/ollama/scan");
            const data = await res.json();
            if (data.found && data.instances?.length) {
                ollamaUrl = data.instances[0].url;
                ollamaScanStatus = "found";
                // Auto-test the found instance
                await testOllamaConnection();
            } else {
                ollamaScanStatus = "notfound";
            }
        } catch {
            ollamaScanStatus = "notfound";
        }
    }

    // ─── *arr Sync ──────────────────────────────────────────────────────────────
    /** @param {string} [service] */
    async function startArrSync(service) {
        arrSyncRunning = true;
        arrSyncLogs = [];
        const qs = service ? `?service=${service}` : "";
        try {
            const res = await fetch(`/api/arr/sync${qs}`, { method: "POST" });
            if (!res.ok || !res.body) {
                arrSyncLogs = [
                    ...arrSyncLogs,
                    {
                        time: new Date().toLocaleTimeString(),
                        message: `Failed: ${res.statusText}`,
                        type: "error",
                    },
                ];
                arrSyncRunning = false;
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
                        const event = JSON.parse(line.slice(6));
                        if (event.log) {
                            arrSyncLogs = [
                                ...arrSyncLogs,
                                {
                                    time: new Date().toLocaleTimeString(),
                                    message: event.log,
                                    type: event.type || "info",
                                },
                            ];
                        }
                    } catch {
                        /* bad JSON */
                    }
                }
            }
        } catch (/** @type {any} */ e) {
            arrSyncLogs = [
                ...arrSyncLogs,
                {
                    time: new Date().toLocaleTimeString(),
                    message: `Error: ${e.message}`,
                    type: "error",
                },
            ];
        }
        // Record history for badge display
        const hasErrors = arrSyncLogs.some((l) => l.type === "error");
        const synced = arrSyncLogs.filter((l) => l.message?.includes("synced")).length;
        syncHistoryLocal = {
            ...syncHistoryLocal,
            arr: {
                status: hasErrors ? "failed" : "success",
                finishedAt: new Date().toISOString(),
                summary: hasErrors ? `Completed with errors` : `${synced} services synced`,
            },
        };
        arrSyncRunning = false;
    }

    // ─── *arr Integration Functions ─────────────────────────────────────────────
    async function scanForArr() {
        arrScanStatus = "scanning";
        try {
            const res = await fetch("/api/arr/scan");
            const data = await res.json();
            if (data.found && data.instances?.length) {
                for (const inst of data.instances) {
                    if (inst.service === "radarr" && !radarrUrl)
                        radarrUrl = inst.url;
                    if (inst.service === "sonarr" && !sonarrUrl)
                        sonarrUrl = inst.url;
                    if (inst.service === "lidarr" && !lidarrUrl)
                        lidarrUrl = inst.url;
                    arrTestInfo[inst.service] =
                        `Found at ${inst.url}${inst.needsAuth ? " (needs API key)" : ""}`;
                }
            }
            arrScanStatus = "done";
        } catch {
            arrScanStatus = "done";
        }
    }

    /**
     * @param {string} service
     */
    async function testArrConnection(service) {
        arrTestStatus[service] = "testing";
        arrTestInfo[service] = "";
        const url =
            service === "radarr"
                ? radarrUrl
                : service === "sonarr"
                  ? sonarrUrl
                  : lidarrUrl;
        const key =
            service === "radarr"
                ? radarrApiKey
                : service === "sonarr"
                  ? sonarrApiKey
                  : lidarrApiKey;
        // If user hasn't entered a new key, we need to tell them
        if (!key) {
            arrTestStatus[service] = "error";
            arrTestInfo[service] = "Enter API key first";
            return;
        }
        try {
            const res = await fetch("/api/arr/test", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ service, url, apiKey: key }),
            });
            const result = await res.json();
            if (result.ok) {
                arrTestStatus[service] = "ok";
                arrTestInfo[service] =
                    `${result.name} v${result.version} — ${result.itemCount} items`;
            } else {
                arrTestStatus[service] = "error";
                arrTestInfo[service] =
                    "Connection failed — check URL and API key";
            }
        } catch {
            arrTestStatus[service] = "error";
            arrTestInfo[service] = "Connection error";
        }
    }

    /**
     * @param {string} service
     */
    async function saveArrSettings(service) {
        const url =
            service === "radarr"
                ? radarrUrl
                : service === "sonarr"
                  ? sonarrUrl
                  : lidarrUrl;
        const key =
            service === "radarr"
                ? radarrApiKey
                : service === "sonarr"
                  ? sonarrApiKey
                  : lidarrApiKey;
        const extUrl =
            service === "radarr"
                ? radarrExternalUrl
                : service === "sonarr"
                  ? sonarrExternalUrl
                  : lidarrExternalUrl;
        /** @type {Record<string, string>} */
        const body = { [`${service}_url`]: url, [`${service}_external_url`]: extUrl };
        if (key) body[`${service}_api_key`] = key;
        try {
            await fetch("/api/settings", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
            arrTestInfo[service] = "Settings saved ✓";
        } catch {
            arrTestInfo[service] = "Save failed";
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
        if (isDirty) await saveSettings();
        embeddingStatus = "running";
        embeddingDone = 0;
        embeddingTotal = 0;
        embeddingPhase = "";
        embeddingError = "";
        try {
            const res = await fetch("/api/embeddings/generate", {
                method: "POST",
            });
            if (!res.ok || !res.body) {
                const err = await res.json().catch(() => ({}));
                embeddingStatus = "error";
                embeddingError = err.error || `HTTP ${res.status}`;
                console.error("[embeddings] Error:", embeddingError);
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
                            embeddingError = d.message;
                        }
                    } catch {
                        /* ignore */
                    }
                }
            }
            if (embeddingStatus === "running") embeddingStatus = "complete";
            loadEmbeddingStats();
        } catch (e) {
            embeddingStatus = "error";
            embeddingError = e instanceof Error ? e.message : "Unknown error";
            console.error("[embeddings] Error:", e);
        }
    }

    async function generateTags() {
        if (isDirty) await saveSettings();
        taggingStatus = "running";
        taggingDone = 0;
        taggingTotal = 0;
        taggingTagged = 0;
        taggingCurrent = "";
        taggingError = "";
        try {
            const res = await fetch("/api/tags/generate", { method: "POST" });
            if (!res.ok || !res.body) {
                const err = await res.json().catch(() => ({}));
                taggingStatus = "error";
                taggingError = err.error || `HTTP ${res.status}`;
                console.error("[tags] Error:", taggingError);
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
        } catch (e) {
            taggingStatus = "error";
            taggingError = e instanceof Error ? e.message : "Unknown error";
            console.error("[tags] Error:", e);
        }
    }

    // Load stats when Ollama URL is set
    $effect(() => {
        if (ollamaUrl) {
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
        copyToClipboard(text);
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

    <!-- Tab Navigation -->
    <div class="tabs tabs-boxed bg-base-200/50 border border-base-300 p-1 gap-1">
        {#each TABS as tab}
            <button
                class="tab {activeTab === tab.id ? 'tab-active !bg-primary !text-primary-content' : 'hover:bg-base-300/50'} gap-1.5 transition-all"
                onclick={() => switchTab(/** @type {typeof activeTab} */ (tab.id))}
            >
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d={tab.icon} /></svg>
                {tab.label}
            </button>
        {/each}
    </div>

    <!-- ═══════════════════════ TAB: SERVER ═══════════════════════ -->
    {#if activeTab === 'server'}
    <!-- Jellyfin Connection -->
    <div
        id="jellyfin"
        class="card bg-base-200/50 border border-base-300 scroll-mt-20"
    >
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

            <!-- Jellyfin Playback Reporting DB -->
            <div class="divider my-2"></div>
            <div class="form-control">
                <label class="label" for="settings-pr-db-path">
                    <span class="label-text font-medium">Playback Reporting Database</span>
                </label>
                <p class="text-xs text-base-content/50 mb-2">
                    Path to the <a href="https://github.com/jellyfin/jellyfin-plugin-playback-reporting" target="_blank" rel="noopener" class="link link-info">Playback Reporting plugin</a>'s database file (playback_reporting.db). Mount it read-only via Docker to import historical watch data.
                </p>
                <div class="flex gap-2">
                    <input
                        id="settings-pr-db-path"
                        type="text"
                        class="input input-bordered input-sm flex-1 {prDbStatus === 'valid' ? 'input-success' : prDbStatus === 'error' ? 'input-error' : ''}"
                        bind:value={jellyfinPrDbPath}
                        placeholder="/app/data/playback_reporting.db"
                    />
                    <button
                        class="btn btn-sm btn-ghost gap-1"
                        onclick={validatePrDb}
                        disabled={prDbStatus === 'checking' || !jellyfinPrDbPath.trim()}
                    >
                        {#if prDbStatus === 'checking'}
                            <span class="loading loading-spinner loading-xs"></span>
                        {:else}
                            🔍 Test
                        {/if}
                    </button>
                </div>
                {#if prDbStatus === 'valid'}
                    <div class="flex items-center gap-2 mt-2">
                        <span class="badge badge-success badge-sm gap-1">✓ Connected</span>
                        <span class="text-xs text-success">{prDbMessage}</span>
                    </div>
                {:else if prDbStatus === 'error'}
                    <div class="mt-2 text-xs text-error flex items-start gap-1.5">
                        <span>⚠️</span>
                        <div>
                            <p>{prDbMessage}</p>
                            <p class="text-base-content/40 mt-1">
                                Ensure the file is mounted in Docker: <code class="text-xs">-v /path/to/playback_reporting.db:/app/jellyfin/playback_reporting.db:ro</code>
                            </p>
                        </div>
                    </div>
                {/if}
            </div>
        </div>
    </div>

    {/if}

    <!-- ═══════════════════════ TAB: CREDENTIALS ═══════════════════════ -->
    {#if activeTab === 'credentials'}
    <p class="text-sm text-base-content/50 -mb-2">External service credentials for metadata, ratings, and tracking.</p>
    <!-- Metadata API Keys -->
    <div
        id="api-keys"
        class="card bg-base-200/50 border border-base-300 scroll-mt-20"
    >
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
                Metadata & Ratings
            </h2>
            <p class="text-xs text-base-content/50">API keys for fetching metadata, artwork, IMDb/RT/Metacritic scores, and Discogs community ratings.</p>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2">
                <!-- TVDB -->
                <div class="bg-base-300/30 rounded-lg p-4 border border-base-300/50">
                    <div class="flex items-center gap-2 mb-2">
                        <ServiceIcon service="tvdb" size="w-4 h-4" class="text-[#6CD491]" />
                        <span class="font-bold text-sm">TheTVDB</span>
                        <span class="text-xs text-base-content/40">TV metadata & artwork</span>
                        {#if validation.tvdb.status === "checking"}
                            <span class="loading loading-spinner loading-xs text-info"></span>
                        {:else if validation.tvdb.status === "valid"}
                            <span class="badge badge-success badge-xs">✓</span>
                        {:else if validation.tvdb.status === "invalid"}
                            <span class="badge badge-error badge-xs">✗</span>
                        {/if}
                    </div>
                    <div class="form-control">
                        <input
                            id="settings-tvdb"
                            type="text"
                            class="input input-bordered input-sm"
                            bind:value={tvdbApiKey}
                            placeholder={data.settings.hasTvdbKey ? "••••••••" : "Not set"}
                        />
                    </div>
                    {#if validation.tvdb.status === "invalid"}
                        <p class="text-xs text-error mt-1">{validation.tvdb.message}</p>
                    {/if}
                    <a href="https://thetvdb.com/dashboard/account/apikey" target="_blank" rel="noopener" class="link link-primary text-xs mt-1 inline-block">Get API key →</a>
                </div>

                <!-- TMDB -->
                <div class="bg-base-300/30 rounded-lg p-4 border border-base-300/50">
                    <div class="flex items-center gap-2 mb-2">
                        <ServiceIcon service="tmdb" size="w-4 h-4" class="text-[#01B4E4]" />
                        <span class="font-bold text-sm">TMDB</span>
                        <span class="text-xs text-base-content/40">Movie & TV metadata</span>
                        {#if validation.tmdb.status === "checking"}
                            <span class="loading loading-spinner loading-xs text-info"></span>
                        {:else if validation.tmdb.status === "valid"}
                            <span class="badge badge-success badge-xs">✓</span>
                        {:else if validation.tmdb.status === "invalid"}
                            <span class="badge badge-error badge-xs">✗</span>
                        {/if}
                    </div>
                    <div class="form-control">
                        <input
                            id="settings-tmdb"
                            type="text"
                            class="input input-bordered input-sm"
                            bind:value={tmdbApiKey}
                            placeholder={data.settings.hasTmdbKey ? "••••••••" : "Not set"}
                        />
                    </div>
                    {#if validation.tmdb.status === "invalid"}
                        <p class="text-xs text-error mt-1">{validation.tmdb.message}</p>
                    {/if}
                    <a href="https://www.themoviedb.org/settings/api" target="_blank" rel="noopener" class="link link-primary text-xs mt-1 inline-block">Get API key →</a>
                </div>

                <!-- MusicBrainz -->
                <div class="bg-base-300/30 rounded-lg p-4 border border-base-300/50">
                    <div class="flex items-center gap-2 mb-2">
                        <ServiceIcon service="musicbrainz" size="w-4 h-4" class="text-[#BA478F]" />
                        <span class="font-bold text-sm">MusicBrainz</span>
                        <span class="text-xs text-base-content/40">Music metadata</span>
                    </div>
                    <div class="form-control">
                        <input
                            id="settings-mb"
                            type="text"
                            class="input input-bordered input-sm"
                            bind:value={musicbrainzApiKey}
                            placeholder={data.settings.hasMusicbrainzKey ? "••••••••" : "Optional"}
                        />
                    </div>
                    <a href="https://musicbrainz.org/doc/MusicBrainz_API" target="_blank" rel="noopener" class="link link-primary text-xs mt-1 inline-block">Learn more →</a>
                </div>

                <!-- OMDb -->
                <div class="bg-base-300/30 rounded-lg p-4 border border-base-300/50">
                    <div class="flex items-center gap-2 mb-2">
                        <span class="text-[#F5C518] font-bold text-sm">OMDb</span>
                        <span class="text-xs text-base-content/40">IMDb · RT · Metacritic</span>
                    </div>
                    <div class="form-control">
                        <input
                            id="settings-omdb"
                            type="password"
                            class="input input-bordered input-sm"
                            bind:value={omdbApiKey}
                            placeholder={data.settings.omdbApiKey ? "••••••••" : "Not set"}
                        />
                    </div>
                    <a href="https://www.omdbapi.com/apikey.aspx" target="_blank" rel="noopener" class="link link-primary text-xs mt-1 inline-block">Get free API key →</a>
                </div>

                <!-- Discogs -->
                <div class="bg-base-300/30 rounded-lg p-4 border border-base-300/50">
                    <div class="flex items-center gap-2 mb-2">
                        <ServiceIcon service="discogs" size="w-4 h-4" />
                        <span class="font-bold text-sm">Discogs</span>
                        <span class="text-xs text-base-content/40">Album community ratings</span>
                    </div>
                    <div class="form-control">
                        <input
                            id="settings-discogs"
                            type="password"
                            class="input input-bordered input-sm"
                            bind:value={discogsToken}
                            placeholder={data.settings.discogsToken ? "••••••••" : "Not set"}
                        />
                    </div>
                    <a href="https://www.discogs.com/settings/developers" target="_blank" rel="noopener" class="link link-primary text-xs mt-1 inline-block">Generate personal access token →</a>
                </div>

                <!-- Fanart.tv -->
                <div class="bg-base-300/30 rounded-lg p-4 border border-base-300/50">
                    <div class="flex items-center gap-2 mb-2">
                        <ServiceIcon service="fanart" size="w-4 h-4" />
                        <span class="font-bold text-sm">Fanart.tv</span>
                        <span class="text-xs text-base-content/40">Artist backdrops & logos</span>
                    </div>
                    <div class="form-control">
                        <input
                            id="settings-fanart"
                            type="password"
                            class="input input-bordered input-sm"
                            bind:value={fanartApiKey}
                            placeholder={data.settings.fanartApiKey ? "••••••••" : "Not set"}
                        />
                    </div>
                    <a href="https://fanart.tv/get-an-api-key/" target="_blank" rel="noopener" class="link link-primary text-xs mt-1 inline-block">Get a free API key →</a>
                </div>
            </div>
        </div>
    </div>

    <!-- Tracker App Credentials -->
    <div
        id="trackers"
        class="card bg-base-200/50 border border-base-300 scroll-mt-20"
    >
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



    {/if}

    <!-- ═══════════════════════ TAB: SERVER (continued) ═══════════════════════ -->
    {#if activeTab === 'server'}
    <!-- *arr Media Management -->
    <div
        id="arr"
        class="card bg-base-200/50 border border-base-300 scroll-mt-20"
    >
        <div class="card-body">
            <h2 class="card-title text-lg">
                <svg
                    xmlns="http://www.w3.org/2000/svg"
                    class="h-5 w-5 text-info"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                >
                    <path
                        d="M4 3a2 2 0 100 4h12a2 2 0 100-4H4zM3 8h14v7a2 2 0 01-2 2H5a2 2 0 01-2-2V8z"
                    />
                </svg>
                Media Management
            </h2>
            <p class="text-sm text-base-content/60">
                Connect Radarr, Sonarr, and Lidarr to see download status,
                request missing media, and track upcoming releases.
            </p>

            <!-- Scan all button -->
            <div class="flex items-center gap-2 mt-2">
                <button
                    class="btn btn-xs btn-outline gap-1"
                    disabled={arrScanStatus === "scanning"}
                    onclick={scanForArr}
                >
                    {#if arrScanStatus === "scanning"}
                        <span class="loading loading-spinner loading-xs"></span>
                        Scanning...
                    {:else}
                        🔍 Scan Network
                    {/if}
                </button>
                <span class="text-xs text-base-content/50"
                    >Scan local network for *arr instances</span
                >
            </div>


            <!-- Service cards -->
            <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                {#each ARR_SERVICES as svc}
                    {@const url =
                        svc.service === "radarr"
                            ? radarrUrl
                            : svc.service === "sonarr"
                              ? sonarrUrl
                              : lidarrUrl}
                    {@const apiKey =
                        svc.service === "radarr"
                            ? radarrApiKey
                            : svc.service === "sonarr"
                              ? sonarrApiKey
                              : lidarrApiKey}
                    {@const extUrl =
                        svc.service === "radarr"
                            ? radarrExternalUrl
                            : svc.service === "sonarr"
                              ? sonarrExternalUrl
                              : lidarrExternalUrl}
                    {@const linkUrl = extUrl || url}
                    {@const testStatus = arrTestStatus[svc.service]}
                    {@const testInfo = arrTestInfo[svc.service]}
                    <div
                        class="card bg-base-300/50 border border-base-300 p-4 space-y-3"
                    >
                        <div class="flex items-center gap-2">
                            <ServiceIcon service={svc.service} size="w-5 h-5" />
                            <span class="font-semibold text-sm"
                                >{svc.label}</span
                            >
                            {#if testStatus === "ok"}
                                <span class="badge badge-xs badge-success"
                                    >Connected</span
                                >
                            {:else if testStatus === "error"}
                                <span class="badge badge-xs badge-error"
                                    >Failed</span
                                >
                            {/if}
                        </div>

                        <!-- URL -->
                        <label class="form-control">
                            <span class="label-text text-xs">URL</span>
                            <input
                                type="text"
                                class="input input-xs input-bordered w-full font-mono"
                                placeholder="http://localhost:{svc.defaultPort}"
                                value={url}
                                oninput={(e) => {
                                    if (svc.service === "radarr")
                                        radarrUrl = e.target.value;
                                    else if (svc.service === "sonarr")
                                        sonarrUrl = e.target.value;
                                    else lidarrUrl = e.target.value;
                                }}
                            />
                        </label>

                        <!-- API Key -->
                        <label class="form-control">
                            <span class="label-text text-xs">API Key</span>
                            <input
                                type="password"
                                class="input input-xs input-bordered w-full font-mono"
                                placeholder={data.settings[
                                    `${svc.service}ApiKey`
                                ]
                                    ? "••••••••"
                                    : "Paste API key"}
                                value={apiKey}
                                oninput={(e) => {
                                    if (svc.service === "radarr")
                                        radarrApiKey = e.target.value;
                                    else if (svc.service === "sonarr")
                                        sonarrApiKey = e.target.value;
                                    else lidarrApiKey = e.target.value;
                                }}
                            />
                            <div class="label py-0.5">
                                <span
                                    class="label-text-alt text-[10px] text-base-content/40"
                                >
                                    {#if linkUrl}
                                        <a
                                            href="{linkUrl}/settings/general"
                                            target="_blank"
                                            rel="noopener"
                                            class="link link-hover link-primary"
                                            >{linkUrl}/settings/general</a
                                        >
                                        <br />
                                    {/if}
                                    Settings → General → Security
                                </span>
                            </div>
                        </label>

                        <!-- External URL (browser-facing) -->
                        <label class="form-control">
                            <span class="label-text text-xs">External URL <span class="text-base-content/40">(for links)</span></span>
                            <input
                                type="text"
                                class="input input-xs input-bordered w-full font-mono"
                                placeholder="http://192.168.1.50:{svc.defaultPort}"
                                value={svc.service === 'radarr' ? radarrExternalUrl : svc.service === 'sonarr' ? sonarrExternalUrl : lidarrExternalUrl}
                                oninput={(e) => {
                                    if (svc.service === 'radarr') radarrExternalUrl = e.target.value;
                                    else if (svc.service === 'sonarr') sonarrExternalUrl = e.target.value;
                                    else lidarrExternalUrl = e.target.value;
                                }}
                            />
                            <div class="label py-0.5">
                                <span class="label-text-alt text-[10px] text-base-content/40">
                                    Browser-reachable address (if different from API URL)
                                </span>
                            </div>
                        </label>

                        <!-- Actions -->
                        <div class="flex gap-2">
                            <button
                                class="btn btn-xs btn-primary flex-1"
                                disabled={!url || testStatus === "testing"}
                                onclick={() => testArrConnection(svc.service)}
                            >
                                {#if testStatus === "testing"}
                                    <span
                                        class="loading loading-spinner loading-xs"
                                    ></span>
                                {:else}
                                    🔌 Test
                                {/if}
                            </button>
                            <button
                                class="btn btn-xs btn-outline flex-1"
                                disabled={!url ||
                                    (!apiKey &&
                                        !data.settings[`${svc.service}ApiKey`])}
                                onclick={() => saveArrSettings(svc.service)}
                            >
                                💾 Save
                            </button>
                        </div>

                        <!-- Status info -->
                        {#if testInfo}
                            <p class="text-xs text-base-content/60">
                                {testInfo}
                            </p>
                        {/if}
                    </div>
                {/each}
            </div>
        </div>
    </div>

    <!-- LLM Integration -->
    <div
        id="llm"
        class="card bg-base-200/50 border border-base-300 scroll-mt-20"
    >
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
                <!-- LLM Provider Selector -->
                <label class="form-control w-full">
                    <div class="label pb-1">
                        <span class="label-text text-xs font-medium">Chat Provider</span>
                    </div>
                    <div class="grid grid-cols-5 gap-1.5">
                        {#each [
                            { value: 'ollama', icon: 'ollama', label: 'Ollama', sub: 'local' },
                            { value: 'openai', icon: 'openai', label: 'OpenAI', sub: '' },
                            { value: 'gemini', icon: 'gemini', label: 'Gemini', sub: '' },
                            { value: 'claude', icon: 'claude', label: 'Claude', sub: '' },
                            { value: 'kimi', icon: 'kimi', label: 'Kimi', sub: '' },
                        ] as provider}
                            <button
                                type="button"
                                class="flex flex-col items-center gap-1 p-2 rounded-lg border transition-all duration-150 cursor-pointer text-center
                                    {llmProvider === provider.value
                                        ? 'border-primary bg-primary/10 ring-1 ring-primary/30 shadow-sm'
                                        : 'border-base-300 hover:border-base-content/20 hover:bg-base-200/50'}"
                                onclick={() => { llmProvider = provider.value; }}
                            >
                                <ServiceIcon service={provider.icon} size="w-5 h-5" />
                                <span class="text-[11px] font-medium leading-tight {llmProvider === provider.value ? 'text-primary' : 'text-base-content/70'}">{provider.label}</span>
                                {#if provider.sub}
                                    <span class="text-[9px] text-base-content/40 -mt-0.5">{provider.sub}</span>
                                {/if}
                            </button>
                        {/each}
                    </div>
                </label>

                <!-- Cloud Provider Config (OpenAI / Gemini / Claude / Kimi) -->
                {#if llmProvider !== 'ollama'}
                    <div class="p-3 rounded-lg border border-base-300 bg-base-200/30 space-y-3">
                        <!-- API Key -->
                        <label class="form-control w-full">
                            <div class="label pb-1">
                                <span class="label-text text-xs font-medium">API Key</span>
                            </div>
                            <div class="flex gap-2">
                                <input
                                    type="password"
                                    bind:value={llmApiKey}
                                    placeholder="sk-... or API key"
                                    class="input input-bordered input-sm flex-1 font-mono"
                                />
                                {#if llmProvider === 'openai' && data.settings.hasOpenaiClientId}
                                    <a href="/api/llm/openai/auth" class="btn btn-sm btn-outline gap-1">
                                        🔑 Sign in with OpenAI
                                    </a>
                                {/if}
                                {#if llmProvider === 'gemini' && data.settings.hasGeminiClientId}
                                    <a href="/api/llm/gemini/auth" class="btn btn-sm btn-outline gap-1">
                                        🔑 Sign in with Google
                                    </a>
                                {/if}
                            </div>
                            <p class="text-[10px] text-base-content/40 mt-1">
                                {#if llmProvider === 'openai'}
                                    Get your key at <a href="https://platform.openai.com/api-keys" target="_blank" class="link">platform.openai.com</a>
                                {:else if llmProvider === 'gemini'}
                                    Get your key at <a href="https://aistudio.google.com/apikey" target="_blank" class="link">aistudio.google.com</a>
                                {:else if llmProvider === 'claude'}
                                    Get your key at <a href="https://console.anthropic.com/" target="_blank" class="link">console.anthropic.com</a>
                                {:else if llmProvider === 'kimi'}
                                    Get your key at <a href="https://platform.moonshot.cn/" target="_blank" class="link">platform.moonshot.cn</a>
                                {/if}
                            </p>
                        </label>

                        <!-- Custom API URL (for Kimi or self-hosted) -->
                        {#if llmProvider === 'kimi' || llmProvider === 'openai'}
                            <label class="form-control w-full">
                                <div class="label pb-1">
                                    <span class="label-text text-xs font-medium">API Base URL <span class="text-base-content/40">(optional)</span></span>
                                </div>
                                <input
                                    type="url"
                                    bind:value={llmApiUrl}
                                    placeholder={llmProvider === 'kimi' ? 'https://api.moonshot.cn' : 'https://api.openai.com'}
                                    class="input input-bordered input-sm font-mono"
                                />
                            </label>
                        {/if}

                        <!-- Chat Model -->
                        <label class="form-control w-full">
                            <div class="label pb-1">
                                <span class="label-text text-xs font-medium">Chat Model</span>
                            </div>
                            <input
                                type="text"
                                bind:value={llmChatModel}
                                placeholder={llmProvider === 'openai' ? 'gpt-4o-mini' : llmProvider === 'gemini' ? 'gemini-2.5-flash' : llmProvider === 'claude' ? 'claude-sonnet-4-5-20250514' : 'kimi-k2-0711-preview'}
                                class="input input-bordered input-sm font-mono"
                            />
                        </label>

                        <!-- Embed Provider -->
                        <label class="form-control w-full">
                            <div class="label pb-1">
                                <span class="label-text text-xs font-medium">Embedding Provider</span>
                            </div>
                            <select
                                bind:value={llmEmbedProvider}
                                class="select select-bordered select-sm"
                            >
                                <option value="ollama">Ollama (local) — keep existing embeddings</option>
                                {#if llmProvider === 'openai'}
                                    <option value="openai">OpenAI (text-embedding-3-small)</option>
                                {/if}
                                {#if llmProvider === 'gemini'}
                                    <option value="gemini">Google Gemini (768d — matches Ollama)</option>
                                {/if}
                            </select>
                            {#if llmEmbedProvider !== 'ollama'}
                                <p class="text-[10px] text-warning mt-1">
                                    ⚠️ Switching embed providers requires re-embedding all items
                                </p>
                            {/if}
                        </label>

                        {#if llmProvider === 'claude'}
                            <div class="alert alert-warning alert-sm">
                                <span class="text-xs">Claude has no embedding API — embeddings will use the embedding provider above (default: Ollama)</span>
                            </div>
                        {/if}
                    </div>
                {/if}

                <!-- Ollama URL (shown when provider is Ollama, OR always for embed config) -->
                {#if llmProvider === 'ollama' || llmEmbedProvider === 'ollama'}
                <label class="form-control w-full">
                    <div class="label pb-1">
                        <span class="label-text text-xs font-medium"
                            >Ollama URL {#if llmProvider !== 'ollama'}<span class="text-base-content/40">(for embeddings)</span>{/if}</span
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
                        <button
                            class="btn btn-sm btn-ghost gap-1"
                            disabled={ollamaScanStatus === "scanning"}
                            onclick={scanForOllama}
                            title="Scan local network for Ollama"
                        >
                            {#if ollamaScanStatus === "scanning"}
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
                                        d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z"
                                        clip-rule="evenodd"
                                    /></svg
                                >
                            {/if}
                            Scan
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
                {/if}

                <!-- Actions -->
                {#if ollamaUrl}
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
                    {:else if embeddingStatus === "error"}
                        <p class="text-xs text-error">
                            ✗ {embeddingError || "Embedding generation failed"}
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
                    {:else if taggingStatus === "error"}
                        <p class="text-xs text-error">
                            ✗ {taggingError || "Tag generation failed"}
                        </p>
                    {/if}
                {/if}
            </div>
        </div>
    </div>


    {/if}


    <!-- ═══════════════════════ TAB: DATA SYNC ═══════════════════════ -->
    {#if activeTab === 'sync'}

    
    <div
        id="data-sync"
        class="card bg-base-200/50 border border-base-300 scroll-mt-20"
    >
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
            <p class="text-sm text-base-content/50 mt-1">
                Syncs pull data from external services into Mediajam. Run these after connecting a new service, changing credentials, or if your library has changed significantly. They update your local media catalog, play history, metadata, and people credits.
            </p>

            <!-- Run All Pipeline -->
            <div class="mt-3 mb-2">
                <div class="flex flex-wrap items-center gap-3">
                    <button
                        class="btn btn-sm btn-accent gap-1.5"
                        disabled={runAllActive || syncStatus !== "idle" || peopleSyncStatus === "syncing" || mbStatus === "syncing"}
                        onclick={runAllSyncs}
                    >
                        {#if runAllActive}
                            <span class="loading loading-spinner loading-xs"></span>
                            Running Pipeline...
                        {:else}
                            🚀 Run All
                        {/if}
                    </button>
                    <span class="text-xs text-base-content/40">Chains: Jellyfin → People → MusicBrainz → Reconciliation (10–30 min)</span>
                </div>

                {#if runAllActive || runAllStep === 5}
                    <!-- Step indicator -->
                    <div class="flex gap-1 mt-2 mb-1">
                        {#each RUN_ALL_STEPS as step}
                            <div class="flex items-center gap-1 text-xs px-2 py-1 rounded-full border {
                                runAllStep > step.num ? 'border-success/30 bg-success/10 text-success' :
                                runAllStep === step.num ? 'border-info/50 bg-info/10 text-info' :
                                'border-base-content/10 text-base-content/30'
                            }">
                                {#if runAllStep > step.num}✅{:else if runAllStep === step.num}<span class="loading loading-spinner loading-xs"></span>{:else}{step.emoji}{/if}
                                {step.label}
                            </div>
                        {/each}
                    </div>

                    <!-- Pipeline console -->
                    <LogConsole
                        logs={runAllLogs}
                        running={runAllStep > 0 && runAllStep < 5}
                        title="Pipeline Log"
                        height="h-32"
                    />

                    {#if runAllStep === 5}
                        <button class="btn btn-xs btn-ghost mt-1" onclick={() => { runAllStep = 0; runAllLogs = []; }}>Dismiss</button>
                    {/if}
                {/if}
            </div>

            <div class="space-y-1 mt-2">
                <!-- Jellyfin Sync Row -->
                <div
                    id="sync-jellyfin"
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
                        <div class="flex-1 min-w-0">
                            <span class="font-medium text-sm">Jellyfin Sync</span>
                            <span class="text-xs text-base-content/40 block">Jellyfin → catalog, play counts, people</span>
                        </div>
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
                            <span class="text-xs text-base-content/40" title={h.finishedAt ? new Date(h.finishedAt).toLocaleString() : ''}
                                >{h.finishedAt ? timeAgo(h.finishedAt) : ''}</span
                            >
                        {:else}
                            <span class="text-xs text-base-content/40"
                                >Never synced</span
                            >
                        {/if}
                        {#if data.syncPending?.jellyfin > 0}
                            <span class="badge badge-warning badge-xs">{data.syncPending.jellyfin} new</span>
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
                        <p class="text-xs text-base-content/50 px-4 pt-2 pb-1">Pulls your full media catalog from <strong>Jellyfin</strong> — movies, TV series + episodes, music artists + albums + tracks, along with play counts and people credits. Use the individual library buttons to sync just one type. Check <strong>Re-fetch all data</strong> to ignore cached data and pull everything fresh.</p>
                        <div
                            class="px-4 pb-4 space-y-3 border-t border-base-content/5 pt-3"
                            class:hidden={expandedSync !== "jellyfin" &&
                                syncStatus === "idle"}
                        >
                            {#if syncStatus === "idle"}
                                <div class="flex flex-wrap items-center gap-2">
                                    <button
                                        class="btn btn-info btn-sm"
                                        onclick={() => triggerSync(null, null, forceResync)}
                                        >Sync All</button
                                    >
                                    {#if data.libraries && data.libraries.length > 1}
                                        {#each data.libraries as lib}
                                            <button
                                                class="btn btn-info btn-sm"
                                                onclick={() =>
                                                    triggerSync(
                                                        lib.jellyfin_id,
                                                        lib.name,
                                                        forceResync,
                                                    )}
                                            >
                                                {#if lib.media_type === "tvshows"}📺{:else if lib.media_type === "movies"}🎬{:else if lib.media_type === "music"}🎵{:else}📁{/if}
                                                {lib.name}
                                            </button>
                                        {/each}
                                    {/if}
                                    <label class="flex items-center gap-1.5 ml-2 cursor-pointer">
                                        <input type="checkbox" class="checkbox checkbox-xs checkbox-info" bind:checked={forceResync} />
                                        <span class="text-xs text-base-content/60">Re-fetch all data</span>
                                    </label>
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
                                <LogConsole
                                    logs={syncLogs}
                                    running={syncStatus === "syncing"}
                                    title="Sync Log"
                                    height="h-36"
                                />
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
                                            onclick={() => triggerSync(null, null, forceResync)}
                                            >Sync Again</button
                                        >
                                    {/if}
                                </div>
                            {/if}
                        </div>
                    {/if}
                </div>

                <!-- Metadata Conflicts -->
                {#if syncConflicts.length > 0}
                    <div class="rounded-lg border border-warning/30 bg-warning/5 overflow-hidden">
                        <div class="px-4 py-3 flex items-center gap-2">
                            <span class="text-lg">⚠️</span>
                            <span class="font-medium text-sm flex-1">Metadata Conflicts</span>
                            <span class="badge badge-warning badge-sm">{syncConflicts.length}</span>
                        </div>
                        <div class="px-4 pb-3 space-y-2">
                            <p class="text-xs text-base-content/60 mb-2">These items share the same external ID in Jellyfin. Fix the metadata in Jellyfin, then re-sync.</p>
                            {#each syncConflicts as conflict}
                                <div class="bg-base-200/50 rounded-lg p-3 text-sm">
                                    <div class="flex items-start justify-between gap-2">
                                        <div class="flex-1 min-w-0">
                                            <span class="badge badge-xs badge-outline mb-1">{conflict.conflict_label}</span>
                                            <div class="font-medium">
                                                "{conflict.primary_title}"
                                                {#if conflict.primary_year}<span class="text-base-content/40">({conflict.primary_year})</span>{/if}
                                                <span class="text-warning">⇔</span>
                                                "{conflict.secondary_title}"
                                                {#if conflict.secondary_year}<span class="text-base-content/40">({conflict.secondary_year})</span>{/if}
                                            </div>
                                            <div class="text-xs text-base-content/50 mt-1 flex flex-wrap gap-2">
                                                <span>Shared: <code class="bg-base-300 px-1 rounded">{conflict.external_id}</code></span>
                                                {#if conflict.external_url}
                                                    <a href={conflict.external_url} target="_blank" rel="noopener" class="link link-info">View on {conflict.conflict_type.includes('tmdb') ? 'TMDb' : conflict.conflict_type.includes('imdb') ? 'IMDb' : 'MusicBrainz'} ↗</a>
                                                {/if}
                                            </div>
                                            <div class="text-xs mt-1 flex flex-wrap gap-2">
                                                {#if conflict.primary_jellyfin_url}
                                                    <a href={conflict.primary_jellyfin_url} target="_blank" rel="noopener" class="link link-primary">Fix "{conflict.primary_title}" in Jellyfin ↗</a>
                                                {/if}
                                                {#if conflict.secondary_jellyfin_url}
                                                    <a href={conflict.secondary_jellyfin_url} target="_blank" rel="noopener" class="link link-primary">Fix "{conflict.secondary_title}" in Jellyfin ↗</a>
                                                {/if}
                                            </div>
                                        </div>
                                        <button class="btn btn-ghost btn-xs" onclick={() => dismissConflict(conflict.id)} title="Dismiss">✕</button>
                                    </div>
                                </div>
                            {/each}
                        </div>
                    </div>
                {/if}

                <!-- People Sync Row -->
                <div
                    id="sync-people"
                    class="rounded-lg border border-base-content/10 overflow-hidden"
                >
                    <button
                        class="w-full flex items-center gap-3 px-4 py-3 hover:bg-base-300/50 transition-colors text-left"
                        onclick={() =>
                            (expandedSync =
                                expandedSync === "people" ? null : "people")}
                    >
                        <span class="text-lg">👥</span>
                        <div class="flex-1 min-w-0">
                            <span class="font-medium text-sm">Sync People</span>
                            <span class="text-xs text-base-content/40 block">TMDB → cast, crew, photos</span>
                        </div>
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
                            <span class="text-xs text-base-content/40" title={h.finishedAt ? new Date(h.finishedAt).toLocaleString() : ''}
                                >{h.finishedAt ? timeAgo(h.finishedAt) : ''}</span
                            >
                        {:else}
                            <span class="text-xs text-base-content/40"
                                >Never synced</span
                            >
                        {/if}
                        {#if data.syncPending?.people > 0}
                            <span class="badge badge-warning badge-xs">{data.syncPending.people} pending</span>
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
                        <div class="text-xs text-base-content/50 px-4 pt-2 pb-1 space-y-1">
                            <ul class="list-disc list-inside space-y-0.5">
                                <li><strong>Full Sync</strong> — Fetches cast & crew for all movies and TV shows from TMDB, including photos, bios, and external IDs</li>
                                <li><strong>Enrich All</strong> — Updates existing people with TMDB profile data (biographies, profile photos, birth/death dates). Skips cast/crew mapping</li>
                                <li><strong>External IDs Only</strong> — Lighter pass that links existing people to their external profiles (IMDb, Instagram, Twitter, etc.) without fetching bios or photos</li>
                            </ul>
                        </div>
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
                                            "syncing"}>Full Sync</button
                                    >
                                    <button
                                        class="btn btn-sm btn-outline btn-info"
                                        onclick={syncEnrichOnly}
                                        disabled={peopleSyncStatus === "syncing"}
                                    >
                                        Enrich All
                                    </button>
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
                                <LogConsole
                                    logs={peopleSyncLogs}
                                    running={peopleSyncStatus === "syncing"}
                                    title="People Sync Log"
                                    height="h-36"
                                />
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
                    id="sync-musicbrainz"
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
                        <div class="flex-1 min-w-0">
                            <span class="font-medium text-sm">Enrich Music</span>
                            <span class="text-xs text-base-content/40 block">MusicBrainz → metadata, links</span>
                        </div>
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
                            <span class="text-xs text-base-content/40" title={h.finishedAt ? new Date(h.finishedAt).toLocaleString() : ''}
                                >{h.finishedAt ? timeAgo(h.finishedAt) : ''}</span
                            >
                        {:else}
                            <span class="text-xs text-base-content/40"
                                >Never run</span
                            >
                        {/if}
                        {#if data.syncPending?.musicbrainz > 0}
                            <span class="badge badge-warning badge-xs">{data.syncPending.musicbrainz} pending</span>
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
                        <p class="text-xs text-base-content/50 px-4 pt-2 pb-1">Looks up music artists in <strong>MusicBrainz</strong> to enrich them with metadata, genres, external links (Wikipedia, Discogs, AllMusic), and canonical MusicBrainz IDs for better matching.</p>
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
                                <LogConsole
                                    logs={mbLogs}
                                    running={mbStatus === "syncing"}
                                    title="MusicBrainz Log"
                                    height="h-36"
                                />
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


                <!-- *arr Sync Row -->
                <div
                    class="rounded-lg border border-base-content/10 overflow-hidden"
                >
                    <button
                        class="w-full flex items-center gap-3 px-4 py-3 hover:bg-base-300/50 transition-colors text-left"
                        onclick={() =>
                            (expandedSync =
                                expandedSync === "arr"
                                    ? null
                                    : "arr")}
                    >
                        <span class="text-lg">📡</span>
                        <div class="flex-1 min-w-0">
                            <span class="font-medium text-sm">*arr Sync</span>
                            <span class="text-xs text-base-content/40 block">Radarr, Sonarr, Lidarr → wanted items, download status</span>
                        </div>
                        {#if arrSyncRunning}
                            <span
                                class="loading loading-spinner loading-xs text-info"
                            ></span>
                            <span class="badge badge-info badge-sm gap-1"
                                >syncing</span
                            >
                        {:else if syncHistoryLocal?.arr}
                            {@const h = syncHistoryLocal.arr}
                            <span
                                class="badge badge-sm gap-1"
                                class:badge-success={h.status === "success"}
                                class:badge-error={h.status === "failed"}
                            >
                                {h.status}
                            </span>
                            <span class="text-xs text-base-content/40" title={h.finishedAt ? new Date(h.finishedAt).toLocaleString() : ''}
                                >{h.finishedAt ? timeAgo(h.finishedAt) : ''}</span
                            >
                        {/if}
                        <svg
                            xmlns="http://www.w3.org/2000/svg"
                            class="h-4 w-4 text-base-content/30 transition-transform"
                            class:rotate-180={expandedSync === "arr"}
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                            ><polyline points="6 9 12 15 18 9"></polyline></svg
                        >
                    </button>

                    {#if expandedSync === "arr" || arrSyncRunning}
                        <p class="text-xs text-base-content/50 px-4 pt-2 pb-1">Syncs your <strong>Radarr</strong> (movies), <strong>Sonarr</strong> (TV), and <strong>Lidarr</strong> (music) libraries into Mediajam — imports wanted items, download status, quality profiles, and upcoming releases. Configure connections on the <strong>Server</strong> tab.</p>
                        <div
                            class="px-4 pb-4 space-y-3 border-t border-base-content/5 pt-3"
                        >
                            <div class="flex flex-wrap items-center gap-2">
                                <button
                                    class="btn btn-sm btn-primary gap-1"
                                    disabled={arrSyncRunning}
                                    onclick={() => startArrSync()}
                                >
                                    {#if arrSyncRunning}
                                        <span class="loading loading-spinner loading-xs"></span>
                                        Syncing...
                                    {:else}
                                        📥 Sync All
                                    {/if}
                                </button>
                                {#each ARR_SERVICES as svc}
                                    {@const url =
                                        svc.service === "radarr"
                                            ? radarrUrl
                                            : svc.service === "sonarr"
                                              ? sonarrUrl
                                              : lidarrUrl}
                                    {@const apiKey =
                                        svc.service === "radarr"
                                            ? radarrApiKey
                                            : svc.service === "sonarr"
                                              ? sonarrApiKey
                                              : lidarrApiKey}
                                    {#if url && (apiKey || data.settings[`${svc.service}ApiKey`])}
                                        <button
                                            class="btn btn-sm btn-outline gap-1"
                                            disabled={arrSyncRunning}
                                            onclick={() => startArrSync(svc.service)}
                                        >
                                            <ServiceIcon service={svc.service} size="w-4 h-4" />
                                            {svc.label}
                                        </button>
                                    {/if}
                                {/each}
                            </div>

                            <LogConsole
                                logs={arrSyncLogs}
                                running={arrSyncRunning}
                                title="*arr Sync Log"
                                height="h-48"
                            />
                        </div>
                    {/if}
                </div>

                <!-- Wikipedia Summaries Row -->
                <div
                    class="rounded-lg border border-base-content/10 overflow-hidden"
                >
                    <button
                        class="w-full flex items-center gap-3 px-4 py-3 hover:bg-base-300/50 transition-colors text-left"
                        onclick={() =>
                            (expandedSync =
                                expandedSync === "wikipedia"
                                    ? null
                                    : "wikipedia")}
                    >
                        <span class="text-lg">📚</span>
                        <div class="flex-1 min-w-0">
                            <span class="font-medium text-sm">Wikipedia Summaries</span>
                            <span class="text-xs text-base-content/40 block">TMDb → Wikidata → Wikipedia summaries</span>
                        </div>
                        {#if wikiStatus === "syncing"}
                            <span
                                class="loading loading-spinner loading-xs text-secondary"
                            ></span>
                            <span class="badge badge-secondary badge-sm gap-1"
                                >syncing</span
                            >
                        {:else if syncHistoryLocal?.wikipedia}
                            {@const h = syncHistoryLocal.wikipedia}
                            <span
                                class="badge badge-sm gap-1"
                                class:badge-success={h.status === "success"}
                                class:badge-error={h.status === "failed"}
                            >
                                {h.status}
                            </span>
                            <span class="text-xs text-base-content/40" title={h.finishedAt ? new Date(h.finishedAt).toLocaleString() : ''}
                                >{h.finishedAt ? timeAgo(h.finishedAt) : ''}</span
                            >
                        {/if}
                        {#if data.syncPending?.wikipedia > 0}
                            <span class="badge badge-warning badge-xs">{data.syncPending.wikipedia} pending</span>
                        {/if}
                        <svg
                            xmlns="http://www.w3.org/2000/svg"
                            class="h-4 w-4 text-base-content/30 transition-transform"
                            class:rotate-180={expandedSync === "wikipedia"}
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                            ><polyline points="6 9 12 15 18 9"></polyline></svg
                        >
                    </button>

                    {#if expandedSync === "wikipedia"}
                        <p class="text-xs text-base-content/50 px-4 pt-2 pb-1">Fetches Wikipedia summaries for movies, TV shows, music artists, and people via <strong>TMDb → Wikidata → Wikipedia</strong>. Stores alongside existing overviews.</p>
                        <div
                            class="px-4 pb-4 space-y-3 border-t border-base-content/5 pt-3"
                        >
                            {#if wikiStatus === "idle" || wikiStatus === "complete" || wikiStatus === "error"}
                                <div class="flex flex-wrap gap-2">
                                    <button class="btn btn-secondary btn-sm" onclick={triggerWikipedia} disabled={wikiStatus === 'syncing'}>Start Backfill</button>
                                </div>
                            {:else}
                                <div class="flex items-center gap-3">
                                    <progress class="progress progress-secondary w-full" value={wikiDone} max={wikiTotal || 1}></progress>
                                    <span class="text-xs text-base-content/60 whitespace-nowrap">{wikiDone}/{wikiTotal} ({wikiFound} found)</span>
                                    <button class="btn btn-ghost btn-xs" onclick={stopWikipedia}>Stop</button>
                                </div>
                            {/if}
                            <LogConsole
                                logs={wikiLogs}
                                running={wikiStatus === 'syncing'}
                                title="Wikipedia Log"
                                height="h-36"
                            />
                        </div>
                    {/if}
                </div>

                <!-- Enrich Backdrops Row -->
                <div
                    class="rounded-lg border border-base-content/10 overflow-hidden"
                >
                    <button
                        class="w-full flex items-center gap-3 px-4 py-3 hover:bg-base-300/50 transition-colors text-left"
                        onclick={() =>
                            (expandedSync =
                                expandedSync === "backdrops"
                                    ? null
                                    : "backdrops")}
                    >
                        <span class="text-lg">🖼️</span>
                        <div class="flex-1 min-w-0">
                            <span class="font-medium text-sm">Enrich Backdrops</span>
                            <span class="text-xs text-base-content/40 block">TMDB textless backdrops (movies/TV) &middot; Fanart.tv artist backgrounds (music)</span>
                        </div>
                        {#if backdropStatus === "syncing"}
                            <span
                                class="loading loading-spinner loading-xs text-secondary"
                            ></span>
                            <span class="badge badge-secondary badge-sm gap-1"
                                >syncing</span
                            >
                        {/if}
                        {#if data.syncPending?.backdrops > 0}
                            <span class="badge badge-warning badge-xs">{data.syncPending.backdrops} pending</span>
                        {/if}
                        <svg
                            xmlns="http://www.w3.org/2000/svg"
                            class="h-4 w-4 text-base-content/30 transition-transform"
                            class:rotate-180={expandedSync === "backdrops"}
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                            ><polyline points="6 9 12 15 18 9"></polyline></svg
                        >
                    </button>

                    {#if expandedSync === "backdrops" || (backdropStatus !== "idle" && backdropStatus !== "complete" && backdropStatus !== "error")}
                        <p class="text-xs text-base-content/50 px-4 pt-2 pb-1">Fetches high-quality, textless backdrop images from <strong>TMDB</strong> (movies & TV) and <strong>Fanart.tv</strong> (music artists). Cached locally after first fetch.</p>
                        <div
                            class="px-4 pb-4 space-y-3 border-t border-base-content/5 pt-3"
                            class:hidden={expandedSync !== "backdrops" &&
                                backdropStatus === "idle"}
                        >
                            {#if backdropStatus === "idle" || backdropStatus === "complete" || backdropStatus === "error"}
                                <div class="flex flex-wrap gap-2">
                                    <button
                                        class="btn btn-secondary btn-sm"
                                        onclick={triggerBackdropEnrich}
                                        disabled={backdropStatus === "syncing"}
                                        >Start Enrichment</button
                                    >
                                </div>
                            {/if}
                            {#if backdropStatus !== "idle"}
                                <div
                                    class="flex justify-between items-center text-sm"
                                >
                                    <span class="font-medium">
                                        {#if backdropStatus === "complete"}✅
                                            Backdrop enrichment complete!{:else if backdropStatus === "error"}❌
                                            Enrichment error{:else}🖼️ Enriching backdrops...{/if}
                                    </span>
                                    <span class="text-xs text-base-content/50"
                                        >{backdropEnriched} found • {backdropDone}/{backdropTotal}</span
                                    >
                                </div>
                                {#if backdropTotal > 0}
                                    <progress
                                        class="progress progress-secondary w-full"
                                        value={backdropDone}
                                        max={backdropTotal}
                                    ></progress>
                                {:else}
                                    <progress
                                        class="progress progress-secondary w-full"
                                    ></progress>
                                {/if}
                                <LogConsole
                                    logs={backdropLogs}
                                    running={backdropStatus === "syncing"}
                                    title="Backdrop Enrichment Log"
                                    height="h-36"
                                />
                                <div class="flex gap-2">
                                    {#if backdropStatus === "complete" || backdropStatus === "error"}
                                        <button
                                            class="btn btn-sm btn-info"
                                            onclick={() => {
                                                backdropStatus = "idle";
                                            }}>Done</button
                                        >
                                        <button
                                            class="btn btn-sm btn-ghost"
                                            onclick={triggerBackdropEnrich}
                                            >Enrich Again</button
                                        >
                                    {/if}
                                </div>
                            {/if}
                        </div>
                    {/if}
                </div>

            </div>
        </div>
    </div>


    {/if}

    <!-- ═══════════════════════ TAB: IMPORT / EXPORT ═══════════════════════ -->
    {#if activeTab === 'import-export'}
    <!-- Data Management -->
    <div
        id="data-management"
        class="card bg-base-200/50 border border-base-300 scroll-mt-20"
    >
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
                                        >(TVDB, TMDB, MusicBrainz, OMDb, Discogs,
                                        Trakt, Last.fm, Radarr, Sonarr, Lidarr)</span
                                    ></span
                                >
                            </label>
                        </div>
                    {/if}
                </div>

                <!-- Cached images opt-in -->
                <div class="bg-base-300/30 rounded-lg p-3">
                    <label class="flex items-start gap-2 cursor-pointer">
                        <input
                            type="checkbox"
                            class="checkbox checkbox-sm mt-0.5"
                            bind:checked={exportImages}
                        />
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

    <!-- Database Backups -->
    <div class="card bg-base-200/50 border border-base-300 mt-6">
        <div class="card-body">
            <h2 class="card-title text-lg">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-info" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M21 12a9 9 0 11-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
                    <polyline points="21 3 21 8 16 8" />
                </svg>
                Database Backups
            </h2>
            <p class="text-xs text-base-content/50">
                Automatically back up the database on each server boot, before any migrations run.
                Backups are stored alongside the database file.
            </p>
            <div class="flex items-center gap-3 mt-2">
                <label class="text-sm" for="db-backup-count">Keep</label>
                <input
                    id="db-backup-count"
                    type="number"
                    min="0"
                    max="50"
                    class="input input-bordered input-sm w-20 text-center"
                    bind:value={dbBackupCount}
                />
                <span class="text-sm text-base-content/60">backups <span class="text-xs">(0 = disabled)</span></span>
            </div>
            {#if dbBackupCount === 0}
                <div class="text-xs text-warning/70 mt-1">⚠ Automatic backups are disabled. The database will not be backed up on boot.</div>
            {/if}
        </div>
    </div>

    <!-- Factory Reset (Danger Zone) -->
    <div class="card bg-base-200/50 border border-error/20 mt-6">
        <div class="card-body">
            <button
                class="flex items-center gap-3 w-full text-left"
                onclick={() => { resetExpanded = !resetExpanded; resetConfirmation = ''; resetError = ''; }}
            >
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-error/60" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                    <line x1="12" y1="9" x2="12" y2="13" />
                    <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
                <span class="text-sm font-medium text-error/70">Danger Zone</span>
                <svg
                    xmlns="http://www.w3.org/2000/svg"
                    class="h-4 w-4 text-base-content/30 transition-transform ml-auto"
                    class:rotate-180={resetExpanded}
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                ><polyline points="6 9 12 15 18 9"></polyline></svg>
            </button>

            {#if resetExpanded}
                <div class="mt-4 space-y-4 border-t border-error/10 pt-4">
                    <div>
                        <h3 class="text-sm font-semibold text-error">Factory Reset</h3>
                        <p class="text-xs text-base-content/50 mt-1">
                            This will permanently delete <strong>all data</strong> — your entire library, watch history,
                            scrobbles, user accounts, settings, and linked services. The app will restart as if freshly installed.
                        </p>
                    </div>

                    <div class="alert alert-error">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                            <line x1="12" y1="9" x2="12" y2="13" />
                            <line x1="12" y1="17" x2="12.01" y2="17" />
                        </svg>
                        <span class="text-sm">This action is <strong>irreversible</strong>. Consider exporting a backup first.</span>
                    </div>

                    <div class="space-y-2">
                        <label class="text-xs text-base-content/60" for="reset-confirm">
                            Type <code class="bg-base-300 px-1.5 py-0.5 rounded font-mono text-error">goodbye</code> to confirm:
                        </label>
                        <input
                            id="reset-confirm"
                            type="text"
                            class="input input-sm input-bordered w-full max-w-xs font-mono"
                            placeholder="Type goodbye..."
                            autocomplete="off"
                            bind:value={resetConfirmation}
                        />
                    </div>

                    {#if resetError}
                        <p class="text-xs text-error">{resetError}</p>
                    {/if}

                    <button
                        class="btn btn-error btn-sm gap-2"
                        disabled={resetConfirmation !== 'goodbye' || resetting}
                        onclick={factoryReset}
                    >
                        {#if resetting}
                            <span class="loading loading-spinner loading-xs"></span>
                            Resetting...
                        {:else}
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <polyline points="3 6 5 6 21 6" />
                                <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                            </svg>
                            Factory Reset
                        {/if}
                    </button>
                </div>
            {/if}
        </div>
    </div>
    {/if}

    <!-- Save Button (visible on server + credentials tabs) -->
    {#if activeTab === 'server' || activeTab === 'credentials'}
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
    {/if}

    <!-- ═══════════════════════ TAB: DATA CLEAN-UP ═══════════════════════ -->
    {#if activeTab === 'cleanup'}
    <ReconciliationPanel settings={{ radarrUrl: (data.settings.radarrExternalUrl || data.settings.radarrUrl || '').replace(/\/+$/, ''), sonarrUrl: (data.settings.sonarrExternalUrl || data.settings.sonarrUrl || '').replace(/\/+$/, ''), lidarrUrl: (data.settings.lidarrExternalUrl || data.settings.lidarrUrl || '').replace(/\/+$/, '') }} />
    {/if}

    <!-- ═══════════════════════ TAB: API KEYS ═══════════════════════ -->
    {#if activeTab === 'api-keys'}
    <div class="space-y-6">
        <!-- Create New Key -->
        <div class="card bg-base-200/50 border border-base-300">
            <div class="card-body">
                <h3 class="card-title text-base">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M12 4v16m8-8H4" />
                    </svg>
                    Create New API Key
                </h3>
                <p class="text-sm text-base-content/50 mb-2">API keys allow external tools to access Mediajam's API using Bearer token authentication.</p>

                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <!-- Name -->
                    <div class="form-control">
                        <label class="label" for="api-key-name">
                            <span class="label-text text-sm font-medium">Key Name</span>
                        </label>
                        <input
                            id="api-key-name"
                            type="text"
                            placeholder="e.g. CLI Access, Home Assistant..."
                            class="input input-sm input-bordered w-full"
                            bind:value={newKeyName}
                        />
                    </div>

                    <!-- Expiry -->
                    <div class="form-control">
                        <label class="label" for="api-key-expiry">
                            <span class="label-text text-sm font-medium">Expires (optional)</span>
                        </label>
                        <input
                            id="api-key-expiry"
                            type="date"
                            class="input input-sm input-bordered w-full"
                            bind:value={newKeyExpiry}
                        />
                    </div>
                </div>

                <!-- Permissions -->
                <div class="mt-3">
                    <span class="text-sm font-medium">Permissions</span>
                    <div class="grid grid-cols-1 md:grid-cols-3 gap-3 mt-2">
                        {#each PERMISSION_GROUPS as group}
                            <div class="bg-base-300/30 rounded-lg p-3">
                                <span class="text-xs font-semibold uppercase tracking-wider text-base-content/60">{group.label}</span>
                                {#each group.scopes as scope}
                                    <label class="flex items-start gap-2 mt-2 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            class="checkbox checkbox-sm checkbox-primary mt-0.5"
                                            bind:checked={newKeyPermissions[scope.id]}
                                        />
                                        <div>
                                            <span class="text-sm font-medium">{scope.label}</span>
                                            <p class="text-xs text-base-content/40">{scope.desc}</p>
                                        </div>
                                    </label>
                                {/each}
                            </div>
                        {/each}
                    </div>
                </div>

                <div class="card-actions justify-end mt-3">
                    <button
                        class="btn btn-primary btn-sm"
                        disabled={!newKeyName.trim() || creatingKey}
                        onclick={createApiKey}
                    >
                        {#if creatingKey}
                            <span class="loading loading-spinner loading-xs"></span>
                        {/if}
                        Generate Key
                    </button>
                </div>
            </div>
        </div>

        <!-- Newly Created Key Display -->
        {#if newlyCreatedKey}
            <div class="card bg-base-200 border border-warning/30 shadow-lg shadow-warning/5">
                <div class="card-body py-4 px-5 gap-3">
                    <div class="flex items-start justify-between">
                        <div class="flex items-center gap-2">
                            <span class="text-warning text-lg">⚠️</span>
                            <h4 class="font-bold text-sm text-base-content">Copy your API key now — it won't be shown again!</h4>
                        </div>
                        <button class="btn btn-ghost btn-xs btn-circle text-base-content/40 hover:text-base-content" onclick={() => newlyCreatedKey = null}>✕</button>
                    </div>
                    <div class="flex items-center gap-2">
                        <code class="flex-1 bg-base-300 border border-base-content/10 px-3 py-2 rounded-lg text-xs font-mono select-all break-all text-base-content/90">{newlyCreatedKey}</code>
                        <button
                            class="btn btn-sm {keyCopied ? 'btn-success' : 'btn-primary'} gap-1 shrink-0"
                            onclick={() => copyApiKey(newlyCreatedKey)}
                        >
                            {#if keyCopied}
                                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12" /></svg>
                                Copied
                            {:else}
                                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" /></svg>
                                Copy
                            {/if}
                        </button>
                    </div>
                    <p class="text-xs text-base-content/40">Usage: <code class="text-base-content/60 bg-base-300/50 px-1.5 py-0.5 rounded text-[11px]">curl -H "Authorization: Bearer {newlyCreatedKey.substring(0, 16)}..." http://your-server/api/...</code></p>
                </div>
            </div>
        {/if}

        <!-- Existing Keys -->
        <div class="card bg-base-200/50 border border-base-300">
            <div class="card-body">
                <h3 class="card-title text-base">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-secondary" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                    Active Keys
                    <span class="badge badge-ghost badge-sm">{apiKeysList.length}</span>
                </h3>

                {#if apiKeysList.length === 0}
                    <div class="text-center py-8">
                        <div class="text-4xl mb-2">🔑</div>
                        <p class="text-base-content/50 text-sm">No API keys yet. Create one above to get started.</p>
                    </div>
                {:else}
                    <div class="overflow-x-auto">
                        <table class="table table-sm">
                            <thead>
                                <tr class="text-xs text-base-content/50">
                                    <th>Key</th>
                                    <th>Name</th>
                                    <th>Permissions</th>
                                    <th>Last Used</th>
                                    <th>Created</th>
                                    <th></th>
                                </tr>
                            </thead>
                            <tbody>
                                {#each apiKeysList as key}
                                    <tr class="hover:bg-base-300/20">
                                        <td>
                                            <code class="text-xs bg-base-300/50 px-1.5 py-0.5 rounded font-mono">{key.key_prefix}...</code>
                                        </td>
                                        <td>
                                            <span class="font-medium text-sm">{key.name}</span>
                                            {#if key.owner && key.owner !== 'you'}
                                                <span class="text-xs text-base-content/40 ml-1">({key.owner})</span>
                                            {/if}
                                        </td>
                                        <td>
                                            <div class="flex flex-wrap gap-1">
                                                {#each key.permissions as perm}
                                                    <span class="badge badge-xs {perm === 'admin' ? 'badge-error' : perm.startsWith('write') ? 'badge-warning' : 'badge-info'}">{perm}</span>
                                                {/each}
                                            </div>
                                        </td>
                                        <td class="text-xs text-base-content/50">
                                            {key.last_used_at ? timeAgo(key.last_used_at) : 'Never'}
                                        </td>
                                        <td class="text-xs text-base-content/50">
                                            {timeAgo(key.created_at)}
                                            {#if key.expires_at}
                                                <br/><span class="text-warning text-[10px]">expires {new Date(key.expires_at).toLocaleDateString()}</span>
                                            {/if}
                                        </td>
                                        <td>
                                            <button
                                                class="btn btn-ghost btn-xs btn-circle text-base-content/30 hover:text-error"
                                                title="Revoke this key"
                                                onclick={() => deleteApiKey(key.id)}
                                            >
                                                <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
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
    </div>
    {/if}
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
