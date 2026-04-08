<script>
    /** @type {{ sessions?: any[], jellyfinUrl?: string, remoteControlEnabled?: boolean }} */
    let {
        sessions = [],
        jellyfinUrl = "",
        remoteControlEnabled = false,
    } = $props();

    // Use sessions prop directly — NowPlayingBar in the layout handles the SSE connection
    let activeSessions = $derived(sessions);
    let sendingCommand = $state("");

    /**
     * @param {number} ticks
     */
    function formatTime(ticks) {
        if (!ticks) return "0:00";
        const totalSeconds = Math.floor(ticks / 10000000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        if (minutes >= 60) {
            const hours = Math.floor(minutes / 60);
            const mins = minutes % 60;
            return `${hours}:${String(mins).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
        }
        return `${minutes}:${String(seconds).padStart(2, "0")}`;
    }

    /**
     * @param {string} type
     */
    function getMediaIcon(type) {
        if (type === "episode") return "📺";
        if (type === "track") return "🎵";
        return "🎬";
    }

    /**
     * Send a remote command to the session
     * @param {string} sessionId
     * @param {string} action
     */
    async function sendCommand(sessionId, action) {
        sendingCommand = `${sessionId}:${action}`;
        try {
            await fetch("/api/jellyfin/remote", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ sessionId, action }),
            });
        } catch {
            /* ignore */
        }
        setTimeout(() => {
            sendingCommand = "";
        }, 500);
    }
</script>

{#if activeSessions.length > 0}
    <div class="space-y-3">
        {#each activeSessions as session (session.id)}
            {@const progressPct =
                session.runtime_ticks > 0
                    ? (session.progress_ticks / session.runtime_ticks) * 100
                    : 0}
            <div
                class="card bg-base-200/30 backdrop-blur-xl border border-primary/20 shadow-lg shadow-primary/5 overflow-hidden relative"
            >
                <!-- Animated gradient border -->
                <div
                    class="absolute inset-0 rounded-2xl bg-gradient-to-r from-primary/20 via-secondary/20 to-accent/20 opacity-50"
                    class:animate-pulse={!session.is_paused}
                ></div>

                <div class="card-body p-4 relative z-10">
                    <div class="flex items-center gap-4">
                        <!-- Media icon with pulse -->
                        <div class="relative">
                            <div
                                class="w-12 h-12 rounded-xl bg-gradient-to-br from-primary/20 to-secondary/20 flex items-center justify-center text-2xl"
                            >
                                {getMediaIcon(session.media_type)}
                            </div>
                            {#if !session.is_paused}
                                <div
                                    class="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-success animate-pulse"
                                ></div>
                            {/if}
                        </div>

                        <!-- Info -->
                        <div class="flex-1 min-w-0">
                            <div class="flex items-center gap-2">
                                <span
                                    class="text-xs font-semibold uppercase tracking-wider text-primary/80"
                                >
                                    {session.is_paused
                                        ? "⏸ Paused"
                                        : "▶ Now Playing"}
                                </span>
                            </div>
                            <h3 class="font-bold text-base-content truncate">
                                {session.title || "Unknown"}
                            </h3>
                            <p class="text-sm text-base-content/60">
                                {formatTime(session.progress_ticks)} / {formatTime(
                                    session.runtime_ticks,
                                )}
                            </p>
                        </div>

                        <!-- Controls -->
                        {#if remoteControlEnabled}
                            <div class="flex items-center gap-1">
                                <button
                                    class="btn btn-ghost btn-sm btn-square"
                                    title="Previous"
                                    onclick={() =>
                                        sendCommand(session.id, "prev")}
                                    disabled={sendingCommand ===
                                        `${session.id}:prev`}
                                >
                                    <svg
                                        xmlns="http://www.w3.org/2000/svg"
                                        class="h-4 w-4"
                                        viewBox="0 0 24 24"
                                        fill="currentColor"
                                    >
                                        <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" />
                                    </svg>
                                </button>
                                {#if session.is_paused}
                                    <button
                                        class="btn btn-primary btn-sm btn-circle"
                                        title="Resume"
                                        onclick={() =>
                                            sendCommand(session.id, "unpause")}
                                        disabled={sendingCommand ===
                                            `${session.id}:unpause`}
                                    >
                                        <svg
                                            xmlns="http://www.w3.org/2000/svg"
                                            class="h-5 w-5"
                                            viewBox="0 0 24 24"
                                            fill="currentColor"
                                        >
                                            <polygon
                                                points="5 3 19 12 5 21 5 3"
                                            />
                                        </svg>
                                    </button>
                                {:else}
                                    <button
                                        class="btn btn-primary btn-sm btn-circle"
                                        title="Pause"
                                        onclick={() =>
                                            sendCommand(session.id, "pause")}
                                        disabled={sendingCommand ===
                                            `${session.id}:pause`}
                                    >
                                        <svg
                                            xmlns="http://www.w3.org/2000/svg"
                                            class="h-5 w-5"
                                            viewBox="0 0 24 24"
                                            fill="currentColor"
                                        >
                                            <rect
                                                x="6"
                                                y="4"
                                                width="4"
                                                height="16"
                                            /><rect
                                                x="14"
                                                y="4"
                                                width="4"
                                                height="16"
                                            />
                                        </svg>
                                    </button>
                                {/if}
                                <button
                                    class="btn btn-ghost btn-sm btn-square"
                                    title="Next"
                                    onclick={() =>
                                        sendCommand(session.id, "next")}
                                    disabled={sendingCommand ===
                                        `${session.id}:next`}
                                >
                                    <svg
                                        xmlns="http://www.w3.org/2000/svg"
                                        class="h-4 w-4"
                                        viewBox="0 0 24 24"
                                        fill="currentColor"
                                    >
                                        <path
                                            d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"
                                        />
                                    </svg>
                                </button>
                                <button
                                    class="btn btn-ghost btn-sm btn-square text-error/60 hover:text-error"
                                    title="Stop"
                                    onclick={() =>
                                        sendCommand(session.id, "stop")}
                                    disabled={sendingCommand ===
                                        `${session.id}:stop`}
                                >
                                    <svg
                                        xmlns="http://www.w3.org/2000/svg"
                                        class="h-4 w-4"
                                        viewBox="0 0 24 24"
                                        fill="currentColor"
                                    >
                                        <rect
                                            x="6"
                                            y="6"
                                            width="12"
                                            height="12"
                                            rx="1"
                                        />
                                    </svg>
                                </button>
                            </div>
                        {/if}

                        <!-- Percentage -->
                        <div class="text-right">
                            <span class="text-2xl font-bold text-primary"
                                >{Math.round(progressPct)}%</span
                            >
                        </div>
                    </div>

                    <!-- Progress bar -->
                    <div class="w-full bg-base-300/50 rounded-full h-1.5 mt-2">
                        <div
                            class="h-1.5 rounded-full transition-all duration-1000 ease-out"
                            class:bg-primary={!session.is_paused}
                            class:bg-warning={session.is_paused}
                            style="width: {Math.min(progressPct, 100)}%"
                        ></div>
                    </div>
                </div>
            </div>
        {/each}
    </div>
{/if}
