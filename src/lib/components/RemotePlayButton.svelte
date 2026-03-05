<script>
    /**
     * RemotePlayButton — "Play on [device]" with dropdown for Play Now / Play Next / Queue
     * Shows saved players from preferences, with a "Show All" to fetch live sessions.
     *
     * @type {{ jellyfinId: string, enabled?: boolean, savedPlayers?: any[], defaultPlayerId?: string }}
     */
    let {
        jellyfinId,
        enabled = false,
        savedPlayers = [],
        defaultPlayerId = "",
    } = $props();

    /** @type {any[]} */
    let liveSessions = $state([]);
    /** @type {any} */
    let selectedSession = $state(null);
    let sending = $state(false);
    let feedback = $state(""); // 'success' | 'error' | ''
    let showDropdown = $state(false);
    let showingAll = $state(false);
    let loadingAll = $state(false);
    /** @type {HTMLButtonElement|null} */
    let chevronRef = $state(null);
    let dropdownPos = $state({ top: 0, left: 0 });

    // Merge saved players with live status
    /** @type {any[]} */
    let displayPlayers = $derived.by(() => {
        if (showingAll && liveSessions.length > 0) {
            return liveSessions;
        }
        // Show saved players, enriched with live status if available
        // Match by deviceName+client (deviceIds are unstable)
        return savedPlayers.map((sp) => {
            const live = liveSessions.find(
                (/** @type {any} */ ls) =>
                    ls.deviceName === sp.deviceName && ls.client === sp.client,
            );
            /** @type {'online'|'incompatible'|'offline'} */
            let status = "offline";
            if (live && live.supportsMediaControl) status = "online";
            else if (live) status = "incompatible";
            return live
                ? { ...sp, ...live, saved: true, status }
                : {
                      ...sp,
                      supportsMediaControl: false,
                      online: false,
                      saved: true,
                      status,
                  };
        });
    });

    $effect(() => {
        if (enabled && savedPlayers.length > 0) {
            // Auto-fetch live status for saved players
            fetchLiveSessions();
        }
    });

    $effect(() => {
        // Pick default player
        if (!selectedSession && displayPlayers.length > 0) {
            const def = displayPlayers.find(
                (/** @type {any} */ p) => p.deviceId === defaultPlayerId,
            );
            selectedSession =
                def ||
                displayPlayers.find(
                    (/** @type {any} */ p) => p.supportsMediaControl,
                ) ||
                displayPlayers[0];
        }
    });

    async function fetchLiveSessions() {
        try {
            const res = await fetch("/api/jellyfin/sessions");
            const data = await res.json();
            liveSessions = data.sessions || [];
            // Update selected session with live data (match by deviceName+client)
            if (selectedSession) {
                const live = liveSessions.find(
                    (/** @type {any} */ s) =>
                        s.deviceName === selectedSession.deviceName &&
                        s.client === selectedSession.client,
                );
                if (live) selectedSession = { ...selectedSession, ...live };
            }
        } catch {
            /* ignore */
        }
    }

    async function showAll() {
        showingAll = true;
        loadingAll = true;
        await fetchLiveSessions();
        loadingAll = false;
    }

    /** @param {any} player */
    function selectPlayer(player) {
        selectedSession = player;
        showDropdown = false;
    }

    function toggleDropdown() {
        if (!showDropdown && chevronRef) {
            const rect = chevronRef.getBoundingClientRect();
            dropdownPos = {
                top: rect.bottom + 8,
                left: Math.max(8, rect.right - 224),
            };
        }
        showDropdown = !showDropdown;
    }

    /** @param {string} action */
    async function sendCommand(action) {
        if (!selectedSession || !jellyfinId) return;
        // TODO: Remove this bypass if it causes issues — we're sending commands
        // even to players that don't advertise SupportsMediaControl, since the
        // Jellyfin server API doesn't actually enforce the flag.
        // if (!selectedSession.supportsMediaControl) return;
        sending = true;
        feedback = "";
        showDropdown = false;
        try {
            const res = await fetch("/api/jellyfin/remote", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    sessionId: selectedSession.id,
                    action,
                    itemIds: [jellyfinId],
                }),
            });
            const result = await res.json();
            feedback = result.success ? "success" : "error";
        } catch {
            feedback = "error";
        }
        sending = false;
        setTimeout(() => (feedback = ""), 3000);
    }

    /** @param {any} player */
    function getPlayerIcon(player) {
        const c = player.client || "";
        if (c.includes("TV")) return "📺";
        if (c.includes("Web")) return "💻";
        if (c.includes("Android") || c.includes("iOS")) return "📱";
        if (c.includes("Desktop")) return "🖥";
        if (c.includes("Home Assistant")) return "🏠";
        return "🖥";
    }
</script>

{#if enabled && jellyfinId}
    <div class="flex items-center gap-1 relative">
        {#if savedPlayers.length === 0 && liveSessions.length === 0}
            <span class="text-xs text-base-content/40"
                >No saved players — add them in <a
                    href="/settings/account"
                    class="link link-primary">Account Settings</a
                ></span
            >
        {:else}
            <!-- Main play button -->
            <button
                class="btn btn-sm btn-primary gap-2"
                class:btn-success={feedback === "success"}
                class:btn-error={feedback === "error"}
                class:btn-disabled={!selectedSession}
                disabled={sending || !selectedSession}
                onclick={() => sendCommand("play")}
                title={selectedSession?.status === "incompatible"
                    ? "Player may not support remote control"
                    : !selectedSession
                      ? "No player selected"
                      : ""}
            >
                {#if sending}
                    <span class="loading loading-spinner loading-xs"></span>
                {:else if feedback === "success"}
                    ✓
                {:else if feedback === "error"}
                    ✕
                {:else}
                    <svg
                        xmlns="http://www.w3.org/2000/svg"
                        class="h-4 w-4"
                        viewBox="0 0 24 24"
                        fill="currentColor"
                    >
                        <polygon points="5 3 19 12 5 21 5 3" />
                    </svg>
                {/if}
                Play on {selectedSession?.deviceName || "Player"}
                {#if selectedSession && !selectedSession.supportsMediaControl}
                    <span class="text-xs opacity-60"
                        >({selectedSession.status === "incompatible"
                            ? "no remote"
                            : "offline"})</span
                    >
                {/if}
            </button>

            <!-- Dropdown chevron -->
            <button
                bind:this={chevronRef}
                class="btn btn-sm btn-primary btn-square"
                aria-label="Playback options"
                onclick={toggleDropdown}
            >
                <svg
                    xmlns="http://www.w3.org/2000/svg"
                    class="h-3 w-3"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2.5"
                >
                    <polyline points="6 9 12 15 18 9" />
                </svg>
            </button>
            {#if showDropdown}
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <div
                    class="fixed inset-0 z-[90]"
                    onclick={() => (showDropdown = false)}
                ></div>
                <ul
                    class="fixed menu bg-base-200 rounded-box z-[100] w-56 p-2 shadow-xl border border-base-300"
                    style="top: {dropdownPos.top}px; left: {dropdownPos.left}px"
                >
                    <li class="menu-title text-xs">Actions</li>
                    <li>
                        <button
                            onclick={() => sendCommand("play")}
                            disabled={!selectedSession?.supportsMediaControl}
                            >▶ Play Now</button
                        >
                    </li>
                    <li>
                        <button
                            onclick={() => sendCommand("play_next")}
                            disabled={!selectedSession?.supportsMediaControl}
                            >⏭ Play Next</button
                        >
                    </li>
                    <li>
                        <button
                            onclick={() => sendCommand("queue")}
                            disabled={!selectedSession?.supportsMediaControl}
                            >📋 Add to Queue</button
                        >
                    </li>

                    <li class="menu-title text-xs mt-2">Players</li>
                    {#each displayPlayers as player}
                        <li>
                            <button
                                class:active={selectedSession?.deviceId ===
                                    player.deviceId}
                                onclick={() => selectPlayer(player)}
                            >
                                {getPlayerIcon(player)}
                                <span class="flex-1">{player.deviceName}</span>
                                {#if player.supportsMediaControl}
                                    <span class="badge badge-success badge-xs"
                                        >online</span
                                    >
                                {:else if player.status === "incompatible" || liveSessions.find((s) => s.deviceName === player.deviceName && s.client === player.client)}
                                    <span class="badge badge-warning badge-xs"
                                        >no remote</span
                                    >
                                {:else}
                                    <span class="badge badge-ghost badge-xs"
                                        >offline</span
                                    >
                                {/if}
                            </button>
                        </li>
                    {/each}

                    {#if !showingAll}
                        <li>
                            <button class="text-info text-xs" onclick={showAll}>
                                {#if loadingAll}
                                    <span
                                        class="loading loading-spinner loading-xs"
                                    ></span>
                                {/if}
                                🔍 Show all players
                            </button>
                        </li>
                    {/if}
                </ul>
            {/if}
        {/if}
    </div>
{/if}
