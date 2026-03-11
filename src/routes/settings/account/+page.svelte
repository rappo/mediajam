<script>
    import ServiceIcon from "$lib/components/ServiceIcon.svelte";
    import LogConsole from "$lib/components/LogConsole.svelte";
    import { page } from "$app/stores";
    import { invalidateAll } from "$app/navigation";

    /** @type {{ data: import('./$types').PageData }} */
    let { data } = $props();

    // ─── Avatar State ─────────────────────────────────────────────────────────────
    let showAvatarPicker = $state(false);
    let avatarUrl = $state(data.user?.avatarUrl || null);
    let avatarSaving = $state(false);

    const iconOptions = [
        "🤩",
        "😎",
        "🎮",
        "🎬",
        "🎵",
        "🎧",
        "📺",
        "🍿",
        "🎭",
        "🌟",
        "🔥",
        "💜",
        "🎯",
        "🦊",
        "🐱",
        "🐶",
        "🤖",
        "👾",
        "🎪",
        "🌈",
        "🚀",
        "⚡",
        "🎸",
        "🎻",
    ];

    async function selectIcon(icon) {
        avatarSaving = true;
        try {
            const res = await fetch("/api/avatar", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ avatarUrl: `icon:${icon}` }),
            });
            if (res.ok) {
                avatarUrl = `icon:${icon}`;
                showAvatarPicker = false;
                await invalidateAll();
            }
        } finally {
            avatarSaving = false;
        }
    }

    async function uploadAvatar(event) {
        const file = event.target?.files?.[0];
        if (!file) return;
        avatarSaving = true;
        try {
            const formData = new FormData();
            formData.append("avatar", file);
            const res = await fetch("/api/avatar", {
                method: "POST",
                body: formData,
            });
            if (res.ok) {
                const result = await res.json();
                avatarUrl = result.avatarUrl;
                showAvatarPicker = false;
                await invalidateAll();
            }
        } finally {
            avatarSaving = false;
        }
    }

    async function resetAvatar() {
        avatarSaving = true;
        try {
            const res = await fetch("/api/avatar", { method: "DELETE" });
            if (res.ok) {
                avatarUrl = null;
                showAvatarPicker = false;
                await invalidateAll();
            }
        } finally {
            avatarSaving = false;
        }
    }

    // ─── Import State ────────────────────────────────────────────────────────────
    let importSseRetries = $state(0);
    let importState = $state({
        active: false,
        tier: "",
        totalItems: 0,
        totalPages: 0,
        currentPage: 0,
        progressPercent: 0,
        totalImported: 0,
        totalSkipped: 0,
        logs: [],
        status: "idle", // 'idle' | 'running' | 'complete' | 'error'
        eventSource: null,
    });

    function addLog(message, type = "info") {
        importState.logs = [
            ...importState.logs.slice(-5000),
            { time: new Date().toLocaleTimeString(), message, type },
        ];
    }

    function getLogClass(type) {
        if (type === "success") return "text-success";
        if (type === "error") return "text-error";
        if (type === "warning") return "text-warning";
        return "text-base-content/70";
    }

    // ─── Auto-sync state ─────────────────────────────────────────────────────
    let autoSyncTrakt = $state(data.connectedServices.trakt?.auto_sync === 1);
    let autoSyncLastfm = $state(data.connectedServices.lastfm?.auto_sync === 1);
    let autoSyncJellyfin = $state(
        data.connectedServices.jellyfin?.auto_sync === 1,
    );

    async function toggleAutoSync(provider, enabled) {
        try {
            const res = await fetch("/api/auto-sync", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ provider, enabled }),
            });
            if (!res.ok) throw new Error("Failed to update");
        } catch (e) {
            // Revert on error
            if (provider === "trakt") autoSyncTrakt = !enabled;
            if (provider === "lastfm") autoSyncLastfm = !enabled;
            if (provider === "jellyfin") autoSyncJellyfin = !enabled;
        }
    }

    function connectImportSSE() {
        if (importState.eventSource) importState.eventSource.close();
        const es = new EventSource("/api/backfill/history");
        importState.eventSource = es;

        es.onmessage = (event) => {
            try {
                importSseRetries = 0;
                const d = JSON.parse(event.data);

                if (d.type === "backfill_totals") {
                    importState.totalItems = d.totalItems || 0;
                    importState.totalPages = d.totalPages || 0;
                } else if (d.type === "backfill_progress") {
                    if (d.currentPage !== undefined)
                        importState.currentPage = d.currentPage;
                    if (d.totalPages !== undefined)
                        importState.totalPages = d.totalPages;
                    if (d.progressPercent !== undefined)
                        importState.progressPercent = d.progressPercent;
                    if (d.totalImported !== undefined)
                        importState.totalImported = d.totalImported;
                    if (d.totalSkipped !== undefined)
                        importState.totalSkipped = d.totalSkipped;
                } else if (d.type === "backfill_complete") {
                    importState.status = "complete";
                    importState.progressPercent = 100;
                    if (d.totalImported !== undefined)
                        importState.totalImported = d.totalImported;
                    if (d.totalSkipped !== undefined)
                        importState.totalSkipped = d.totalSkipped;
                    es.close();
                } else if (d.type === "backfill_error") {
                    importState.status = "error";
                    es.close();
                }

                if (d.log) addLog(d.log, d.logType || "info");
            } catch {
                /* ignore parse errors */
            }
        };

        es.onerror = () => {
            if (importState.status === "running" && importSseRetries < 5) {
                importSseRetries++;
                addLog(
                    `Connection interrupted, reconnecting (attempt ${importSseRetries})...`,
                    "warning",
                );
                es.close();
                setTimeout(() => {
                    if (importState.status === "running") connectImportSSE();
                }, 1000 * importSseRetries);
            } else if (importState.status === "running") {
                addLog(
                    "Connection lost after multiple retries. Import continues in the background.",
                    "warning",
                );
                es.close();
            }
        };
    }

    async function startImport(tier) {
        importSseRetries = 0;
        importState = {
            active: true,
            tier,
            status: "running",
            totalItems: 0,
            totalPages: 0,
            currentPage: 0,
            progressPercent: 0,
            totalImported: 0,
            totalSkipped: 0,
            logs: [],
            eventSource: null,
        };

        addLog(`Starting ${tier} import...`, "info");

        try {
            // Start the backfill
            const res = await fetch("/api/backfill/history", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ tier }),
            });
            const result = await res.json();

            if (!result.success) {
                addLog(result.error || "Failed to start import.", "error");
                importState.status = "error";
                return;
            }

            connectImportSSE();
        } catch {
            addLog("Failed to start import.", "error");
            importState.status = "error";
        }
    }

    function stopImport() {
        fetch("/api/backfill/history", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ tier: "stop" }),
        });
        importState.eventSource?.close();
        importState.status = "complete";
        addLog("Import stopped by user.", "warning");
    }

    function dismissImport() {
        importState.eventSource?.close();
        importState = {
            active: false,
            tier: "",
            status: "idle",
            totalItems: 0,
            totalPages: 0,
            currentPage: 0,
            progressPercent: 0,
            totalImported: 0,
            totalSkipped: 0,
            logs: [],
            eventSource: null,
        };
    }
    let followLogs = $state(true);
    let showOnlyErrors = $state(false);
    let logEl = $state(null);

    const filteredLogs = $derived(
        showOnlyErrors
            ? importState.logs.filter((l) => l.type === "error")
            : importState.logs,
    );

    $effect(() => {
        if (followLogs && filteredLogs.length && logEl) {
            logEl.scrollTop = logEl.scrollHeight;
        }
    });

    // ─── Remote Playback ─────────────────────────────────────────────────────────
    /** @type {any[]} */
    let remotePlayers = $state([]);
    let remoteEnabled = $state($page.data.remoteControlEnabled || false);
    /** @type {any[]} */
    let savedPlayers = $state($page.data.userPreferences?.savedPlayers || []);
    let defaultPlayerId = $state(
        $page.data.userPreferences?.defaultPlayerId || "",
    );

    async function fetchRemotePlayers() {
        try {
            const res = await fetch("/api/jellyfin/sessions");
            const d = await res.json();
            remotePlayers = d.sessions || [];
        } catch {
            remotePlayers = [];
        }
    }

    async function toggleRemoteControl(/** @type {boolean} */ enabled) {
        remoteEnabled = enabled;
        await fetch("/api/user/preferences", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ remoteControlEnabled: enabled }),
        });
        await invalidateAll();
        if (enabled) fetchRemotePlayers();
    }

    /** @param {any} player */
    function isPlayerSaved(player) {
        return savedPlayers.some(
            (/** @type {any} */ sp) =>
                sp.deviceName === player.deviceName &&
                sp.client === player.client,
        );
    }

    /** @param {any} player */
    async function addPlayer(player) {
        const entry = {
            deviceId: player.deviceId,
            deviceName: player.deviceName,
            client: player.client,
        };
        const updated = [...savedPlayers, entry];
        savedPlayers = updated;
        await fetch("/api/user/preferences", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ savedPlayers: updated }),
        });
        await invalidateAll();
    }

    /** @param {string} deviceId */
    async function removePlayer(deviceId) {
        const updated = savedPlayers.filter(
            (/** @type {any} */ p) => p.deviceId !== deviceId,
        );
        savedPlayers = updated;
        // If we removed the default, clear it
        const prefs = { savedPlayers: updated };
        if (defaultPlayerId === deviceId) {
            defaultPlayerId = "";
            /** @type {any} */ (prefs).defaultPlayerId = "";
        }
        await fetch("/api/user/preferences", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(prefs),
        });
        await invalidateAll();
    }

    /** @param {string} deviceId */
    async function setDefaultPlayer(deviceId) {
        defaultPlayerId = deviceId;
        await fetch("/api/user/preferences", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ defaultPlayerId: deviceId }),
        });
        await invalidateAll();
    }

    // Merge saved players with live status info
    let displayPlayerList = $derived.by(() => {
        // Enrich saved players with live status — match by deviceName+client (deviceIds are unstable)
        const enrichedSaved = savedPlayers.map((/** @type {any} */ sp) => {
            const live = remotePlayers.find(
                (/** @type {any} */ rp) =>
                    rp.deviceName === sp.deviceName && rp.client === sp.client,
            );
            /** @type {'online'|'incompatible'|'offline'} */
            let status = "offline";
            if (live && live.supportsMediaControl) status = "online";
            else if (live) status = "incompatible";
            return {
                ...sp,
                // Update deviceId from live session if available (in case it changed)
                deviceId: live?.deviceId || sp.deviceId,
                id: live?.id || sp.id,
                status,
                online: status === "online",
                supportsMediaControl: !!live?.supportsMediaControl,
                nowPlaying: live?.nowPlaying || null,
            };
        });
        // Unsaved live sessions — match by deviceName+client
        const unsaved = remotePlayers.filter(
            (/** @type {any} */ rp) =>
                !savedPlayers.some(
                    (/** @type {any} */ sp) =>
                        sp.deviceName === rp.deviceName &&
                        sp.client === rp.client,
                ),
        );
        return { saved: enrichedSaved, unsaved };
    });
</script>

<div class="space-y-6">
    <!-- Profile -->
    <div class="card bg-base-200/50 border border-base-300">
        <div class="card-body">
            <h2 class="card-title text-lg">
                <svg
                    xmlns="http://www.w3.org/2000/svg"
                    class="h-5 w-5 text-primary"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                >
                    <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" /><circle
                        cx="12"
                        cy="7"
                        r="4"
                    />
                </svg>
                Profile
            </h2>

            {#if data.user}
                <div class="flex items-center gap-4 mt-2">
                    <div class="relative group">
                        <!-- Current Avatar -->
                        <div class="avatar placeholder">
                            {#if avatarUrl?.startsWith("/api/")}
                                <img
                                    src={avatarUrl}
                                    alt=""
                                    class="w-16 h-16 rounded-full object-cover"
                                />
                            {:else}
                                <div
                                    class="bg-primary text-primary-content w-16 h-16 rounded-full flex items-center justify-center"
                                >
                                    {#if avatarUrl?.startsWith("icon:")}
                                        <span class="text-3xl"
                                            >{avatarUrl.split(":")[1]}</span
                                        >
                                    {:else}
                                        <span class="text-3xl">🤩</span>
                                    {/if}
                                </div>
                            {/if}
                        </div>
                        <!-- Edit overlay -->
                        <button
                            class="absolute inset-0 bg-black/50 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                            onclick={() =>
                                (showAvatarPicker = !showAvatarPicker)}
                        >
                            <svg
                                xmlns="http://www.w3.org/2000/svg"
                                class="w-5 h-5 text-white"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                stroke-width="2"
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                ><path
                                    d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"
                                /><path
                                    d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"
                                /></svg
                            >
                        </button>
                    </div>
                    <div>
                        <p class="text-lg font-semibold">
                            {data.user.username}
                        </p>
                        <p class="text-sm text-base-content/50">
                            {data.user.isAdmin ? "Administrator" : "User"}
                            · Joined {data.user.createdAt
                                ? new Date(
                                      data.user.createdAt,
                                  ).toLocaleDateString()
                                : "Unknown"}
                        </p>
                    </div>
                </div>

                <!-- Avatar Picker -->
                {#if showAvatarPicker}
                    <div
                        class="mt-4 p-4 bg-base-300/50 rounded-xl border border-base-300 space-y-3"
                    >
                        <p class="text-sm font-medium text-base-content/70">
                            Choose an icon
                        </p>
                        <div class="flex flex-wrap gap-2">
                            {#each iconOptions as icon}
                                <button
                                    class="btn btn-sm btn-ghost text-xl w-10 h-10 p-0"
                                    class:btn-active={avatarUrl ===
                                        `icon:${icon}`}
                                    onclick={() => selectIcon(icon)}
                                    disabled={avatarSaving}
                                >
                                    {icon}
                                </button>
                            {/each}
                        </div>
                        <div class="divider text-xs text-base-content/40">
                            or upload
                        </div>
                        <div class="flex items-center gap-3">
                            <label class="btn btn-sm btn-outline gap-2">
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
                                    /><polyline points="17 8 12 3 7 8" /><line
                                        x1="12"
                                        y1="3"
                                        x2="12"
                                        y2="15"
                                    /></svg
                                >
                                Upload Image
                                <input
                                    type="file"
                                    accept="image/*"
                                    class="hidden"
                                    onchange={uploadAvatar}
                                />
                            </label>
                            {#if avatarUrl}
                                <button
                                    class="btn btn-sm btn-ghost text-error"
                                    onclick={resetAvatar}
                                    disabled={avatarSaving}
                                    >Reset to default</button
                                >
                            {/if}
                        </div>
                        <p class="text-xs text-base-content/40">
                            Max 2MB · JPEG, PNG, GIF, or WebP
                        </p>
                    </div>
                {/if}
            {:else}
                <p class="text-sm text-base-content/60">
                    No user account found.
                </p>
            {/if}
        </div>
    </div>

    <!-- Connected Services -->
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
                        d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"
                    /><path
                        d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"
                    />
                </svg>
                Connected Services
            </h2>
            <p class="text-sm text-base-content/60">
                Link external accounts to import your watch and listening
                history.
            </p>

            <div class="space-y-3 mt-3">
                <!-- Trakt -->
                <div class="p-4 bg-base-300/30 rounded-xl space-y-3">
                    <div class="flex items-center justify-between">
                        <div class="flex items-center gap-3">
                            <div
                                class="w-10 h-10 rounded-lg bg-[#ED1C24]/10 flex items-center justify-center"
                            >
                                <ServiceIcon
                                    service="trakt"
                                    size="w-5 h-5"
                                    class="text-[#ED1C24]"
                                />
                            </div>
                            <div>
                                <p class="font-medium">Trakt</p>
                                {#if data.connectedServices.trakt}
                                    <p class="text-xs text-success">
                                        Connected · {data.connectedServices
                                            .trakt.provider_uid}
                                    </p>
                                {:else}
                                    <p class="text-xs text-base-content/50">
                                        Track movies & TV shows
                                    </p>
                                {/if}
                            </div>
                        </div>
                        {#if !data.connectedServices.trakt}
                            {#if data.appCredentials.hasTraktCreds}
                                <a
                                    href="/api/spokes/trakt"
                                    class="btn btn-sm btn-primary">Connect</a
                                >
                            {:else}
                                <span class="badge badge-ghost badge-sm"
                                    >Configure in System Settings</span
                                >
                            {/if}
                        {/if}
                    </div>

                    {#if data.connectedServices.trakt}
                        <!-- Import Stats -->
                        {#if data.importStats?.trakt}
                            <div
                                class="flex flex-wrap gap-x-6 gap-y-1 text-xs text-base-content/60 pl-13"
                            >
                                <span
                                    ><strong class="text-base-content/80"
                                        >{data.importStats.trakt.playCount.toLocaleString()}</strong
                                    > plays imported</span
                                >
                                <span
                                    >Earliest: <strong
                                        class="text-base-content/80"
                                        >{new Date(
                                            data.importStats.trakt.earliest,
                                        ).toLocaleDateString()}</strong
                                    ></span
                                >
                                <span
                                    >Latest: <strong
                                        class="text-base-content/80"
                                        >{new Date(
                                            data.importStats.trakt.latest,
                                        ).toLocaleDateString()}</strong
                                    ></span
                                >
                            </div>
                        {:else}
                            <p class="text-xs text-warning/80 pl-13">
                                No history imported yet. Click "Import History"
                                to backfill your Trakt watch history.
                            </p>
                        {/if}

                        <!-- Actions Row -->
                        <div class="flex items-center gap-3 pl-13">
                            <button
                                class="btn btn-sm btn-outline gap-1.5"
                                disabled={importState.active}
                                onclick={() => startImport("trakt")}
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
                                    ><path
                                        d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"
                                    /><polyline
                                        points="7 10 12 15 17 10"
                                    /><line
                                        x1="12"
                                        y1="15"
                                        x2="12"
                                        y2="3"
                                    /></svg
                                >
                                Import History
                            </button>

                            <div class="divider divider-horizontal mx-0"></div>

                            <label
                                class="flex items-center gap-2 cursor-pointer group"
                            >
                                <input
                                    type="checkbox"
                                    class="toggle toggle-xs toggle-info"
                                    bind:checked={autoSyncTrakt}
                                    onchange={() =>
                                        toggleAutoSync("trakt", autoSyncTrakt)}
                                />
                                <span class="text-xs text-base-content/50"
                                    >Auto-sync</span
                                >
                                <div
                                    class="tooltip tooltip-right"
                                    data-tip="When enabled, MediaJam automatically checks Trakt for new watch history every few hours and imports any new plays."
                                >
                                    <svg
                                        xmlns="http://www.w3.org/2000/svg"
                                        class="w-3.5 h-3.5 text-base-content/30 group-hover:text-info transition-colors"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        stroke-width="2"
                                        stroke-linecap="round"
                                        stroke-linejoin="round"
                                        ><circle cx="12" cy="12" r="10" /><path
                                            d="M12 16v-4"
                                        /><path d="M12 8h.01" /></svg
                                    >
                                </div>
                            </label>

                            {#if data.connectedServices.trakt.last_auto_sync_at}
                                <span class="text-xs text-base-content/40"
                                    >Last auto-sync: {new Date(
                                        data.connectedServices.trakt.last_auto_sync_at,
                                    ).toLocaleString()}</span
                                >
                            {/if}
                        </div>
                    {/if}
                </div>

                <!-- Last.fm -->
                <div class="p-4 bg-base-300/30 rounded-xl space-y-3">
                    <div class="flex items-center justify-between">
                        <div class="flex items-center gap-3">
                            <div
                                class="w-10 h-10 rounded-lg bg-[#D51007]/10 flex items-center justify-center"
                            >
                                <ServiceIcon
                                    service="lastfm"
                                    size="w-5 h-5"
                                    class="text-[#D51007]"
                                />
                            </div>
                            <div>
                                <p class="font-medium">Last.fm</p>
                                {#if data.connectedServices.lastfm}
                                    <p class="text-xs text-success">
                                        Connected · {data.connectedServices
                                            .lastfm.provider_uid}
                                    </p>
                                {:else}
                                    <p class="text-xs text-base-content/50">
                                        Track music listening
                                    </p>
                                {/if}
                            </div>
                        </div>
                        {#if !data.connectedServices.lastfm}
                            {#if data.appCredentials.hasLastfmCreds}
                                <a
                                    href="/api/spokes/lastfm"
                                    class="btn btn-sm btn-primary">Connect</a
                                >
                            {:else}
                                <span class="badge badge-ghost badge-sm"
                                    >Configure in System Settings</span
                                >
                            {/if}
                        {/if}
                    </div>

                    {#if data.connectedServices.lastfm}
                        <!-- Import Stats -->
                        {#if data.importStats?.lastfm}
                            <div
                                class="flex flex-wrap gap-x-6 gap-y-1 text-xs text-base-content/60 pl-13"
                            >
                                <span
                                    ><strong class="text-base-content/80"
                                        >{data.importStats.lastfm.playCount.toLocaleString()}</strong
                                    > scrobbles imported</span
                                >
                                <span
                                    >Earliest: <strong
                                        class="text-base-content/80"
                                        >{new Date(
                                            data.importStats.lastfm.earliest,
                                        ).toLocaleDateString()}</strong
                                    ></span
                                >
                                <span
                                    >Latest: <strong
                                        class="text-base-content/80"
                                        >{new Date(
                                            data.importStats.lastfm.latest,
                                        ).toLocaleDateString()}</strong
                                    ></span
                                >
                            </div>
                        {:else}
                            <p class="text-xs text-warning/80 pl-13">
                                No scrobbles imported yet. Click "Import
                                History" to backfill your Last.fm listening
                                history.
                            </p>
                        {/if}

                        <!-- Actions Row -->
                        <div class="flex items-center gap-3 pl-13">
                            <button
                                class="btn btn-sm btn-outline gap-1.5"
                                disabled={importState.active}
                                onclick={() => startImport("lastfm")}
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
                                    ><path
                                        d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"
                                    /><polyline
                                        points="7 10 12 15 17 10"
                                    /><line
                                        x1="12"
                                        y1="15"
                                        x2="12"
                                        y2="3"
                                    /></svg
                                >
                                Import History
                            </button>

                            <div class="divider divider-horizontal mx-0"></div>

                            <label
                                class="flex items-center gap-2 cursor-pointer group"
                            >
                                <input
                                    type="checkbox"
                                    class="toggle toggle-xs toggle-info"
                                    bind:checked={autoSyncLastfm}
                                    onchange={() =>
                                        toggleAutoSync(
                                            "lastfm",
                                            autoSyncLastfm,
                                        )}
                                />
                                <span class="text-xs text-base-content/50"
                                    >Auto-sync</span
                                >
                                <div
                                    class="tooltip tooltip-right"
                                    data-tip="When enabled, MediaJam automatically checks Last.fm for new scrobbles every few hours and imports any new plays."
                                >
                                    <svg
                                        xmlns="http://www.w3.org/2000/svg"
                                        class="w-3.5 h-3.5 text-base-content/30 group-hover:text-info transition-colors"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        stroke-width="2"
                                        stroke-linecap="round"
                                        stroke-linejoin="round"
                                        ><circle cx="12" cy="12" r="10" /><path
                                            d="M12 16v-4"
                                        /><path d="M12 8h.01" /></svg
                                    >
                                </div>
                            </label>

                            {#if data.connectedServices.lastfm.last_auto_sync_at}
                                <span class="text-xs text-base-content/40"
                                    >Last auto-sync: {new Date(
                                        data.connectedServices.lastfm.last_auto_sync_at,
                                    ).toLocaleString()}</span
                                >
                            {/if}
                        </div>
                    {/if}
                </div>

                <!-- Jellyfin -->
                <div class="p-4 bg-base-300/30 rounded-xl space-y-3">
                    <div class="flex items-center justify-between">
                        <div class="flex items-center gap-3">
                            <div
                                class="w-10 h-10 rounded-lg bg-[#00A4DC]/10 flex items-center justify-center"
                            >
                                <ServiceIcon
                                    service="jellyfin"
                                    size="w-5 h-5"
                                    class="text-[#00A4DC]"
                                />
                            </div>
                            <div>
                                <p class="font-medium">Jellyfin</p>
                                {#if data.connectedServices.jellyfin}
                                    <div
                                        class="tooltip tooltip-right"
                                        data-tip="jellyfin_user_id: {data.connectedServices.jellyfin.provider_uid}"
                                    >
                                        <p class="text-xs text-success cursor-help">
                                            Connected as {data.user?.username || 'Unknown'}
                                        </p>
                                    </div>
                                {:else}
                                    <p class="text-xs text-success">
                                        Connected via setup
                                    </p>
                                {/if}
                            </div>
                        </div>
                        <span class="badge badge-success badge-sm gap-1">
                            <svg
                                xmlns="http://www.w3.org/2000/svg"
                                class="h-3 w-3"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                stroke-width="2"
                                ><polyline points="20 6 9 17 4 12" /></svg
                            >
                            Active
                        </span>
                    </div>

                    {#if data.connectedServices.jellyfin}
                        <div class="flex items-center gap-3 pl-13">
                            <p class="text-xs text-base-content/50">
                                Jellyfin is your primary media server. Library
                                sync is managed in <a
                                    href="/settings/admin"
                                    class="link link-info">System Settings</a
                                >.
                            </p>

                            <div class="divider divider-horizontal mx-0"></div>

                            <label
                                class="flex items-center gap-2 cursor-pointer group"
                            >
                                <input
                                    type="checkbox"
                                    class="toggle toggle-xs toggle-info"
                                    bind:checked={autoSyncJellyfin}
                                    onchange={() =>
                                        toggleAutoSync(
                                            "jellyfin",
                                            autoSyncJellyfin,
                                        )}
                                />
                                <span class="text-xs text-base-content/50"
                                    >Auto-sync</span
                                >
                                <div
                                    class="tooltip tooltip-right"
                                    data-tip="When enabled, MediaJam automatically runs a Jellyfin library sync on a schedule to keep your collection and watch status up-to-date."
                                >
                                    <svg
                                        xmlns="http://www.w3.org/2000/svg"
                                        class="w-3.5 h-3.5 text-base-content/30 group-hover:text-info transition-colors"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        stroke-width="2"
                                        stroke-linecap="round"
                                        stroke-linejoin="round"
                                        ><circle cx="12" cy="12" r="10" /><path
                                            d="M12 16v-4"
                                        /><path d="M12 8h.01" /></svg
                                    >
                                </div>
                            </label>
                        </div>
                    {/if}
                </div>
            </div>
        </div>
    </div>

    <!-- Remote Playback -->
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
                    <rect
                        x="2"
                        y="7"
                        width="20"
                        height="15"
                        rx="2"
                        ry="2"
                    /><polyline points="17 2 12 7 7 2" />
                </svg>
                Remote Playback
            </h2>
            <p class="text-xs text-base-content/50 -mt-1">
                Control Jellyfin players from Mediajam. Send movies and shows to
                your TV, desktop, or phone.
            </p>
            <div class="form-control">
                <label class="label cursor-pointer justify-start gap-3">
                    <input
                        type="checkbox"
                        class="toggle toggle-primary toggle-sm"
                        checked={remoteEnabled}
                        onchange={(e) =>
                            toggleRemoteControl(
                                /** @type {HTMLInputElement} */ (e.target)
                                    .checked,
                            )}
                    />
                    <div>
                        <span class="label-text font-medium"
                            >Enable Remote Control</span
                        >
                        <p class="text-xs text-base-content/40">
                            Show play buttons on media detail pages
                        </p>
                    </div>
                </label>
            </div>

            {#if remoteEnabled}
                <div class="space-y-4 mt-2">
                    <!-- Saved Players -->
                    <div>
                        <div class="flex items-center gap-2 mb-2">
                            <span class="text-sm font-medium">My Players</span>
                            <button
                                class="btn btn-ghost btn-xs gap-1"
                                onclick={fetchRemotePlayers}>🔄 Refresh</button
                            >
                        </div>
                        {#if displayPlayerList.saved.length === 0}
                            <p class="text-xs text-base-content/40">
                                No players saved yet. Discover players below and
                                add them.
                            </p>
                        {:else}
                            <div class="space-y-1">
                                {#each displayPlayerList.saved as player}
                                    <div
                                        class="flex items-center gap-2 px-3 py-2 rounded-lg bg-base-300/30 text-sm"
                                        class:opacity-50={player.status ===
                                            "offline"}
                                        class:opacity-70={player.status ===
                                            "incompatible"}
                                    >
                                        {#if player.client?.includes("TV")}📺
                                        {:else if player.client?.includes("Web")}💻
                                        {:else if player.client?.includes("Android") || player.client?.includes("iOS")}📱
                                        {:else if player.client?.includes("Desktop")}🖥
                                        {:else if player.client?.includes("Home Assistant")}🏠
                                        {:else}🖥{/if}
                                        <span class="font-medium"
                                            >{player.deviceName}</span
                                        >
                                        <span
                                            class="text-xs text-base-content/40"
                                            >{player.client}</span
                                        >
                                        {#if player.nowPlaying}
                                            <span
                                                class="badge badge-info badge-xs gap-1"
                                                >▶ {player.nowPlaying
                                                    .name}</span
                                            >
                                        {:else if player.status === "online"}
                                            <span
                                                class="badge badge-success badge-xs"
                                                >online</span
                                            >
                                        {:else if player.status === "incompatible"}
                                            <span
                                                class="badge badge-warning badge-xs"
                                                title="Player is online but doesn't support remote control"
                                                >no remote</span
                                            >
                                        {:else}
                                            <span
                                                class="badge badge-ghost badge-xs"
                                                >offline</span
                                            >
                                        {/if}
                                        <div
                                            class="ml-auto flex items-center gap-1"
                                        >
                                            {#if defaultPlayerId === player.deviceId}
                                                <span
                                                    class="badge badge-warning badge-xs gap-1"
                                                    >⭐ default</span
                                                >
                                            {:else if displayPlayerList.saved.length > 1}
                                                <button
                                                    class="btn btn-ghost btn-xs text-xs"
                                                    onclick={() =>
                                                        setDefaultPlayer(
                                                            player.deviceId,
                                                        )}>Set default</button
                                                >
                                            {/if}
                                            <button
                                                class="btn btn-ghost btn-xs text-error"
                                                onclick={() =>
                                                    removePlayer(
                                                        player.deviceId,
                                                    )}
                                                title="Remove player">✕</button
                                            >
                                        </div>
                                    </div>
                                {/each}
                            </div>
                        {/if}
                    </div>

                    <!-- Available (unsaved) players -->
                    {#if displayPlayerList.unsaved.length > 0}
                        <div>
                            <span
                                class="text-sm font-medium text-base-content/60"
                                >Available Players</span
                            >
                            <div class="space-y-1 mt-1">
                                {#each displayPlayerList.unsaved as player}
                                    <div
                                        class="flex items-center gap-2 px-3 py-2 rounded-lg bg-base-300/20 text-sm border border-dashed border-base-300"
                                    >
                                        {#if player.client?.includes("TV")}📺
                                        {:else if player.client?.includes("Web")}💻
                                        {:else if player.client?.includes("Android") || player.client?.includes("iOS")}📱
                                        {:else if player.client?.includes("Desktop")}🖥
                                        {:else if player.client?.includes("Home Assistant")}🏠
                                        {:else}🖥{/if}
                                        <span class="font-medium"
                                            >{player.deviceName}</span
                                        >
                                        <span
                                            class="text-xs text-base-content/40"
                                            >{player.client}</span
                                        >
                                        {#if player.supportsMediaControl}
                                            <span
                                                class="badge badge-success badge-xs"
                                                >online</span
                                            >
                                        {:else}
                                            <span
                                                class="badge badge-warning badge-xs"
                                                >no remote</span
                                            >
                                        {/if}
                                        <button
                                            class="btn btn-ghost btn-xs btn-primary ml-auto"
                                            onclick={() => addPlayer(player)}
                                            >+ Add</button
                                        >
                                    </div>
                                {/each}
                            </div>
                        </div>
                    {:else if remotePlayers.length === 0}
                        <p class="text-xs text-base-content/40">
                            Click "Refresh" to discover Jellyfin players on your
                            network.
                        </p>
                    {/if}
                </div>
            {/if}
        </div>
    </div>

    <!-- Import Progress Panel -->
    {#if importState.active}
        <div id="sync-backfill" class="card bg-base-200/50 border border-base-300">
            <div class="card-body">
                <div class="flex items-center justify-between">
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
                        {importState.tier === "trakt" ? "Trakt" : "Last.fm"} Import
                    </h2>
                    {#if importState.status === "running"}
                        <button
                            class="btn btn-sm btn-error btn-outline gap-1"
                            onclick={stopImport}
                        >
                            <svg
                                xmlns="http://www.w3.org/2000/svg"
                                class="h-3.5 w-3.5"
                                viewBox="0 0 24 24"
                                fill="currentColor"
                                ><rect
                                    x="6"
                                    y="6"
                                    width="12"
                                    height="12"
                                    rx="1"
                                /></svg
                            >
                            Stop
                        </button>
                    {:else}
                        <button
                            class="btn btn-sm btn-primary"
                            onclick={dismissImport}>Done</button
                        >
                    {/if}
                </div>

                <!-- Stats Row -->
                <div class="flex flex-wrap gap-4 text-sm mt-1">
                    {#if importState.totalItems > 0}
                        <div class="flex items-center gap-1.5">
                            <span class="text-base-content/50">Total:</span>
                            <span class="font-medium"
                                >{importState.totalItems.toLocaleString()} items</span
                            >
                        </div>
                    {/if}
                    {#if importState.totalPages > 0}
                        <div class="flex items-center gap-1.5">
                            <span class="text-base-content/50">Page:</span>
                            <span class="font-medium"
                                >{importState.currentPage}/{importState.totalPages}</span
                            >
                        </div>
                    {/if}
                    <div class="flex items-center gap-1.5">
                        <span class="text-base-content/50">Imported:</span>
                        <span class="font-medium text-success"
                            >{importState.totalImported.toLocaleString()}</span
                        >
                    </div>
                    <div class="flex items-center gap-1.5">
                        <span class="text-base-content/50">Skipped:</span>
                        <span class="font-medium text-base-content/60"
                            >{importState.totalSkipped.toLocaleString()}</span
                        >
                    </div>
                </div>

                <!-- Progress Bar -->
                <div class="mt-2">
                    {#if importState.status === "complete"}
                        <progress
                            class="progress progress-success w-full"
                            value="100"
                            max="100"
                        ></progress>
                    {:else if importState.progressPercent > 0}
                        <progress
                            class="progress progress-info w-full"
                            value={importState.progressPercent}
                            max="100"
                        ></progress>
                    {:else}
                        <progress class="progress progress-info w-full"
                        ></progress>
                    {/if}
                    <div
                        class="flex justify-between text-xs text-base-content/40 mt-1"
                    >
                        <span>
                            {#if importState.status === "complete"}
                                ✅ Complete
                            {:else if importState.status === "error"}
                                ❌ Error
                            {:else}
                                {importState.progressPercent}%
                            {/if}
                        </span>
                        {#if importState.tier === "trakt"}
                            <span
                                >~{importState.totalPages > 0
                                    ? Math.round(
                                          (importState.totalPages -
                                              importState.currentPage) *
                                              1.1,
                                      )
                                    : "?"}s remaining</span
                            >
                        {/if}
                    </div>
                </div>

                <!-- Log Controls -->
                <LogConsole
                    logs={importState.logs}
                    running={importState.status === "running"}
                    title="Import Log"
                    height="h-40"
                />
            </div>
        </div>
    {/if}
</div>
