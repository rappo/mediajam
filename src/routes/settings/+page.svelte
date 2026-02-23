<script>
    import ThemeSwitcher from "$lib/components/ThemeSwitcher.svelte";

    /** @type {{ data: import('./$types').PageData }} */
    let { data } = $props();

    const DAISY_THEMES = [
        "light",
        "dark",
        "cupcake",
        "bumblebee",
        "emerald",
        "corporate",
        "synthwave",
        "retro",
        "cyberpunk",
        "valentine",
        "halloween",
        "garden",
        "forest",
        "aqua",
        "lofi",
        "pastel",
        "fantasy",
        "wireframe",
        "black",
        "luxury",
        "dracula",
        "cmyk",
        "autumn",
        "business",
        "acid",
        "lemonade",
        "night",
        "coffee",
        "winter",
        "dim",
        "nord",
        "sunset",
    ];

    // Track initial values for dirty detection
    const initialValues = {
        jellyfinUrl: data.settings.jellyfinUrl || "",
        includeSpecials: data.settings.includeSpecials || false,
    };

    let jellyfinUrl = $state(data.settings.jellyfinUrl || "");
    let tvdbApiKey = $state("");
    let tmdbApiKey = $state("");
    let musicbrainzApiKey = $state("");
    let includeSpecials = $state(data.settings.includeSpecials || false);
    let currentTheme = $state(data.settings.theme || "dark");
    let saving = $state(false);
    let saveSuccess = $state(false);
    let error = $state("");

    // Sync state
    let syncStatus = $state("idle"); // idle | syncing | paused | complete | error
    let syncProgress = $state(0);
    let syncLibrary = $state("");
    let syncItemsSynced = $state(0);
    let syncErrors = $state(0);
    let syncLogs = $state([]);

    // Check if settings have been modified
    function isDirty() {
        return (
            jellyfinUrl !== initialValues.jellyfinUrl ||
            includeSpecials !== initialValues.includeSpecials ||
            tvdbApiKey !== "" ||
            tmdbApiKey !== "" ||
            musicbrainzApiKey !== ""
        );
    }

    function handleClose() {
        if (isDirty()) {
            const save = confirm(
                "You have unsaved changes. Click OK to leave without saving, or Cancel to go back.",
            );
            if (!save) return;
        }
        history.back();
    }

    function handleKeydown(e) {
        if (e.key === "Escape") {
            handleClose();
        }
    }

    function copySyncLog() {
        const text = syncLogs.map((l) => `[${l.time}] ${l.message}`).join("\n");
        navigator.clipboard.writeText(text);
        copyFeedback = true;
        setTimeout(() => (copyFeedback = false), 2000);
    }

    let copyFeedback = $state(false);
    let syncEventSource = $state(null);

    async function setTheme(theme) {
        currentTheme = theme;
        document.documentElement.setAttribute("data-theme", theme);
        await fetch("/api/settings", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ theme }),
        });
    }

    async function saveSettings() {
        saving = true;
        error = "";
        saveSuccess = false;

        try {
            const payload = {
                jellyfin_url: jellyfinUrl,
                include_specials: includeSpecials ? 1 : 0,
            };

            if (tvdbApiKey && tvdbApiKey !== "••••••••")
                payload.tvdb_api_key = tvdbApiKey;
            if (tmdbApiKey && tmdbApiKey !== "••••••••")
                payload.tmdb_api_key = tmdbApiKey;
            if (musicbrainzApiKey && musicbrainzApiKey !== "••••••••")
                payload.musicbrainz_api_key = musicbrainzApiKey;

            const res = await fetch("/api/settings", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });
            const result = await res.json();

            if (result.success) {
                saveSuccess = true;
                setTimeout(() => {
                    saveSuccess = false;
                }, 3000);
            } else {
                error = result.error || "Failed to save settings.";
            }
        } catch (e) {
            error = "An error occurred.";
        }

        saving = false;
    }

    function addSyncLog(message, type = "info") {
        syncLogs = [
            ...syncLogs.slice(-100),
            { time: new Date().toLocaleTimeString(), message, type },
        ];
    }

    async function triggerSync(libraryId = null, libraryName = null) {
        syncStatus = "syncing";
        syncProgress = 0;
        syncItemsSynced = 0;
        syncErrors = 0;
        syncLogs = [];

        const label = libraryName
            ? `Syncing ${libraryName}...`
            : "Starting re-sync...";
        addSyncLog(label, "info");

        try {
            const res = await fetch("/api/sync", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "start", libraryId }),
            });
            const result = await res.json();

            if (!result.success) {
                addSyncLog(result.error || "Failed to start sync.", "error");
                syncStatus = "error";
                return;
            }

            // Connect SSE for progress
            syncEventSource = new EventSource("/api/sync");

            syncEventSource.onmessage = (event) => {
                try {
                    const d = JSON.parse(event.data);

                    if (d.type === "library_start") {
                        syncLibrary = d.libraryName;
                    } else if (d.type === "progress") {
                        if (d.libProgress !== undefined)
                            syncProgress = d.libProgress;
                        if (d.totalSynced !== undefined)
                            syncItemsSynced = d.totalSynced;
                        if (d.errors !== undefined) syncErrors = d.errors;
                        if (d.libraryName) syncLibrary = d.libraryName;
                    } else if (d.type === "library_complete") {
                        if (d.totalSynced !== undefined)
                            syncItemsSynced = d.totalSynced;
                        if (d.totalErrors !== undefined)
                            syncErrors = d.totalErrors;
                    } else if (d.type === "complete") {
                        syncStatus = "complete";
                        syncProgress = 100;
                        if (d.totalSynced !== undefined)
                            syncItemsSynced = d.totalSynced;
                        syncEventSource?.close();
                    } else if (d.type === "error") {
                        syncErrors++;
                    }

                    if (d.log) addSyncLog(d.log, d.logType || "info");
                } catch {
                    /* ignore */
                }
            };

            syncEventSource.onerror = () => {
                if (syncStatus === "syncing") {
                    addSyncLog("Connection lost.", "warning");
                }
            };
        } catch (e) {
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

    let consoleEl = $state(null);
    $effect(() => {
        if (syncLogs.length && consoleEl) {
            consoleEl.scrollTop = consoleEl.scrollHeight;
        }
    });
</script>

<svelte:head>
    <title>Settings — Mediajam</title>
</svelte:head>

<svelte:window onkeydown={handleKeydown} />

<div class="max-w-3xl mx-auto p-6 py-10">
    <div class="flex items-center justify-between mb-8">
        <h1 class="text-3xl font-bold">Settings</h1>
        <button class="btn btn-ghost btn-sm gap-1" onclick={handleClose}>
            <svg
                xmlns="http://www.w3.org/2000/svg"
                class="h-5 w-5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                ><line x1="18" y1="6" x2="6" y2="18" /><line
                    x1="6"
                    y1="6"
                    x2="18"
                    y2="18"
                /></svg
            >
            Close
        </button>
    </div>

    <div class="space-y-8">
        <!-- Jellyfin Connection -->
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
                        <rect
                            x="2"
                            y="2"
                            width="20"
                            height="8"
                            rx="2"
                            ry="2"
                        /><rect
                            x="2"
                            y="14"
                            width="20"
                            height="8"
                            rx="2"
                            ry="2"
                        />
                    </svg>
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
                <div class="form-control">
                    <label class="label cursor-pointer justify-start gap-3">
                        <input
                            type="checkbox"
                            class="toggle toggle-primary toggle-sm"
                            bind:checked={includeSpecials}
                        />
                        <span class="label-text"
                            >Include Specials (Season 0) in statistics</span
                        >
                    </label>
                </div>
            </div>
        </div>

        <!-- API Keys -->
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
                    API Keys
                </h2>

                <div class="form-control">
                    <label class="label" for="settings-tvdb"
                        ><span class="label-text">TheTVDB API Key</span></label
                    >
                    <input
                        id="settings-tvdb"
                        type="text"
                        class="input input-bordered input-sm"
                        bind:value={tvdbApiKey}
                        placeholder={data.settings.hasTvdbKey
                            ? "••••••••"
                            : "Not set"}
                    />
                    <label class="label" for="settings-tvdb">
                        <a
                            href="https://thetvdb.com/dashboard/account/apikey"
                            target="_blank"
                            rel="noopener"
                            class="label-text-alt link link-primary"
                            >Get API key →</a
                        >
                    </label>
                </div>

                <div class="form-control">
                    <label class="label" for="settings-tmdb"
                        ><span class="label-text">TMDB API Key</span></label
                    >
                    <input
                        id="settings-tmdb"
                        type="text"
                        class="input input-bordered input-sm"
                        bind:value={tmdbApiKey}
                        placeholder={data.settings.hasTmdbKey
                            ? "••••••••"
                            : "Not set"}
                    />
                    <label class="label" for="settings-tmdb">
                        <a
                            href="https://www.themoviedb.org/settings/api"
                            target="_blank"
                            rel="noopener"
                            class="label-text-alt link link-primary"
                            >Get API key →</a
                        >
                    </label>
                </div>

                <div class="form-control">
                    <label class="label" for="settings-mb"
                        ><span class="label-text">MusicBrainz</span></label
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
                    <label class="label" for="settings-mb">
                        <a
                            href="https://musicbrainz.org/doc/MusicBrainz_API"
                            target="_blank"
                            rel="noopener"
                            class="label-text-alt link link-primary"
                            >API docs →</a
                        >
                    </label>
                </div>
            </div>
        </div>

        <!-- Theme -->
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
                        <circle cx="13.5" cy="6.5" r="2.5" /><path
                            d="M19 3v2m0 0v2M5 21a5 5 0 0110 0"
                        />
                    </svg>
                    Appearance
                </h2>
                <p class="text-sm text-base-content/60 mb-3">
                    Choose your preferred theme. Changes are saved
                    automatically.
                </p>
                <div class="grid grid-cols-4 sm:grid-cols-6 gap-2">
                    {#each DAISY_THEMES as theme}
                        <button
                            class="btn btn-sm capitalize rounded-lg"
                            class:btn-primary={currentTheme === theme}
                            class:btn-ghost={currentTheme !== theme}
                            onclick={() => setTheme(theme)}
                            data-theme={theme}
                        >
                            <div
                                class="flex gap-0.5 rounded overflow-hidden h-3 mr-1"
                            >
                                <span class="w-1.5 bg-primary"></span>
                                <span class="w-1.5 bg-secondary"></span>
                                <span class="w-1.5 bg-accent"></span>
                            </div>
                            <span class="text-[10px] truncate">{theme}</span>
                        </button>
                    {/each}
                </div>
            </div>
        </div>

        <!-- Sync -->
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
                        Re-sync All Libraries
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
                    <!-- Progress -->
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
                                    <span
                                        class="loading loading-dots loading-xs"
                                    ></span>
                                </div>
                            {/if}
                        </div>

                        <!-- Controls -->
                        <div class="flex gap-2">
                            {#if syncStatus === "syncing" || syncStatus === "paused"}
                                <button
                                    class="btn btn-sm btn-outline"
                                    onclick={toggleSyncPause}
                                >
                                    {syncStatus === "paused"
                                        ? "Resume"
                                        : "Pause"}
                                </button>
                            {/if}
                            {#if syncStatus === "complete" || syncStatus === "error"}
                                <button
                                    class="btn btn-sm btn-info"
                                    onclick={() => {
                                        syncStatus = "idle";
                                    }}
                                >
                                    Done
                                </button>
                                <button
                                    class="btn btn-sm btn-ghost"
                                    onclick={() => triggerSync()}
                                >
                                    Sync Again
                                </button>
                            {/if}
                        </div>
                    </div>
                {/if}
            </div>
        </div>

        <!-- Save Button -->
        <div class="flex items-center gap-3">
            <button
                class="btn btn-primary"
                onclick={saveSettings}
                disabled={saving}
            >
                {#if saving}
                    <span class="loading loading-spinner loading-sm"></span>
                {/if}
                Save Settings
            </button>

            {#if saveSuccess}
                <span class="text-success text-sm flex items-center gap-1">
                    <svg
                        xmlns="http://www.w3.org/2000/svg"
                        class="h-4 w-4"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                    >
                        <polyline points="20 6 9 17 4 12" />
                    </svg>
                    Settings saved!
                </span>
            {/if}

            {#if error}
                <span class="text-error text-sm">{error}</span>
            {/if}
        </div>
    </div>
</div>
