<script>
    import MdiIcon from '$lib/components/MdiIcon.svelte';
    import { mdiTelevision, mdiMusic, mdiMovieOpen, mdiPause, mdiPlay, mdiSkipPrevious, mdiSkipNext, mdiStop, mdiChevronUp, mdiChevronDown } from '@mdi/js';
    /**
     * Global Now Playing bar — fixed bottom, shows on all pages when media is playing.
     * @type {{ remoteControlEnabled?: boolean }}
     */
    let { remoteControlEnabled = false } = $props();

    /** @type {any[]} */
    let activeSessions = $state([]);
    let minimized = $state(false);
    let sendingCommand = $state("");

    $effect(() => {
        // Don't open SSE connections when remote control is disabled (or unauthenticated)
        if (!remoteControlEnabled) return;

        const es = new EventSource("/api/ingest");

        es.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (data.type === "connected" && data.activeSessions) {
                    activeSessions = data.activeSessions;
                } else if (data.type === "now_playing_start") {
                    minimized = false; // Auto-expand when something starts playing
                    activeSessions = [
                        ...activeSessions.filter(
                            (/** @type {any} */ s) => s.id !== data.sessionId,
                        ),
                        {
                            id: data.sessionId,
                            title: data.title,
                            media_type: data.mediaType,
                            runtime_ticks: data.runtimeTicks,
                            progress_ticks: 0,
                            is_paused: 0,
                        },
                    ];
                } else if (data.type === "now_playing_progress") {
                    activeSessions = activeSessions.map(
                        (/** @type {any} */ s) =>
                            s.id === data.sessionId
                                ? {
                                      ...s,
                                      progress_ticks: data.progressTicks,
                                      is_paused: data.isPaused ? 1 : 0,
                                  }
                                : s,
                    );
                } else if (data.type === "now_playing_stop") {
                    activeSessions = activeSessions.filter(
                        (/** @type {any} */ s) => s.id !== data.sessionId,
                    );
                }
            } catch {
                /* ignore */
            }
        };

        return () => es.close();
    });

    /** @param {number} ticks */
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

    /** @param {string} type */
    function getMediaIcon(type) {
        if (type === "episode") return mdiTelevision;
        if (type === "track") return mdiMusic;
        return mdiMovieOpen;
    }

    /**
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
    <div
        class="fixed bottom-0 left-0 right-0 z-50 transition-transform duration-300"
        class:translate-y-[calc(100%-2.5rem)]={minimized}
    >
        <!-- Minimize/expand handle -->
        <div class="flex justify-center">
            <button
                class="btn btn-xs btn-ghost bg-base-200/90 backdrop-blur border border-base-300 rounded-b-none px-4 -mb-px"
                onclick={() => (minimized = !minimized)}
                title={minimized ? "Expand player" : "Minimize player"}
            >
                {#if minimized}
                    <MdiIcon icon={mdiChevronUp} size={12} />
                    <span class="text-xs ml-1">Now Playing</span>
                {:else}
                    <MdiIcon icon={mdiChevronDown} size={12} />
                {/if}
            </button>
        </div>

        <!-- Bar content -->
        <div
            class="bg-base-200/95 backdrop-blur-xl border-t border-base-300 shadow-2xl"
        >
            {#each activeSessions as session (session.id)}
                {@const progressPct =
                    session.runtime_ticks > 0
                        ? (session.progress_ticks / session.runtime_ticks) * 100
                        : 0}
                <!-- Progress bar along the top -->
                <div class="w-full h-1 bg-base-300/50">
                    <div
                        class="h-1 transition-all duration-1000 ease-out"
                        class:bg-primary={!session.is_paused}
                        class:bg-warning={session.is_paused}
                        style="width: {Math.min(progressPct, 100)}%"
                    ></div>
                </div>

                <div
                    class="flex items-center gap-3 px-4 py-2 max-w-5xl mx-auto"
                >
                    <!-- Media icon -->
                    <div class="relative flex-shrink-0">
                        <div
                            class="w-10 h-10 rounded-lg bg-gradient-to-br from-primary/20 to-secondary/20 flex items-center justify-center text-xl"
                        >
                            <MdiIcon icon={getMediaIcon(session.media_type)} size={22} />
                        </div>
                        {#if !session.is_paused}
                            <div
                                class="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-success animate-pulse"
                            ></div>
                        {/if}
                    </div>

                    <!-- Info -->
                    <div class="flex-1 min-w-0">
                        <p class="text-sm font-bold truncate">
                            {session.title || "Unknown"}
                        </p>
                        <p class="text-xs text-base-content/50">
                            <MdiIcon icon={session.is_paused ? mdiPause : mdiPlay} size={12} /> {session.is_paused ? "Paused" : "Playing"} · {formatTime(
                                session.progress_ticks,
                            )} / {formatTime(session.runtime_ticks)}
                        </p>
                    </div>

                    <!-- Controls -->
                    {#if remoteControlEnabled}
                        <div class="flex items-center gap-0.5 flex-shrink-0">
                            <button
                                class="btn btn-ghost btn-sm btn-square"
                                title="Previous"
                                onclick={() => sendCommand(session.id, "prev")}
                            >
                                <MdiIcon icon={mdiSkipPrevious} size={16} />
                            </button>
                            {#if session.is_paused}
                                <button
                                    class="btn btn-primary btn-sm btn-circle"
                                    title="Resume"
                                    onclick={() =>
                                        sendCommand(session.id, "unpause")}
                                >
                                    <MdiIcon icon={mdiPlay} size={16} />
                                </button>
                            {:else}
                                <button
                                    class="btn btn-primary btn-sm btn-circle"
                                    title="Pause"
                                    onclick={() =>
                                        sendCommand(session.id, "pause")}
                                >
                                    <MdiIcon icon={mdiPause} size={16} />
                                </button>
                            {/if}
                            <button
                                class="btn btn-ghost btn-sm btn-square"
                                title="Next"
                                onclick={() => sendCommand(session.id, "next")}
                            >
                                <MdiIcon icon={mdiSkipNext} size={16} />
                            </button>
                            <button
                                class="btn btn-ghost btn-sm btn-square text-error/60 hover:text-error"
                                title="Stop"
                                onclick={() => sendCommand(session.id, "stop")}
                            >
                                <MdiIcon icon={mdiStop} size={16} />
                            </button>
                        </div>
                    {/if}

                    <!-- Percentage -->
                    <span class="text-lg font-bold text-primary flex-shrink-0"
                        >{Math.round(progressPct)}%</span
                    >
                </div>
            {/each}
        </div>
    </div>
{/if}
