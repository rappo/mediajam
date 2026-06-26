<script>
    import MdiIcon from '$lib/components/MdiIcon.svelte';
    import { mdiTelevision, mdiMusic, mdiMovieOpen, mdiPause, mdiPlay, mdiSkipPrevious, mdiSkipNext, mdiStop } from '@mdi/js';
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
        if (type === "episode") return mdiTelevision;
        if (type === "track") return mdiMusic;
        return mdiMovieOpen;
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
                                <MdiIcon icon={getMediaIcon(session.media_type)} size={28} />
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
                                    <MdiIcon icon={session.is_paused ? mdiPause : mdiPlay} size={14} /> {session.is_paused ? "Paused" : "Now Playing"}
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
                                    <MdiIcon icon={mdiSkipPrevious} size={16} />
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
                                        <MdiIcon icon={mdiPlay} size={20} />
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
                                        <MdiIcon icon={mdiPause} size={20} />
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
                                    <MdiIcon icon={mdiSkipNext} size={16} />
                                </button>
                                <button
                                    class="btn btn-ghost btn-sm btn-square text-error/60 hover:text-error"
                                    title="Stop"
                                    onclick={() =>
                                        sendCommand(session.id, "stop")}
                                    disabled={sendingCommand ===
                                        `${session.id}:stop`}
                                >
                                    <MdiIcon icon={mdiStop} size={16} />
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
