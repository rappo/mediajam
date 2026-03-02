<script>
    /** @type {{ sessions?: any[], jellyfinUrl?: string }} */
    let { sessions = [], jellyfinUrl = '' } = $props();

    let eventSource = $state(null);
    let activeSessions = $state(sessions);

    $effect(() => {
        const es = new EventSource('/api/ingest');

        es.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);

                if (data.type === 'connected' && data.activeSessions) {
                    activeSessions = data.activeSessions;
                } else if (data.type === 'now_playing_start') {
                    // Add or update session
                    activeSessions = [...activeSessions.filter(s => s.id !== data.sessionId), {
                        id: data.sessionId,
                        title: data.title,
                        media_type: data.mediaType,
                        runtime_ticks: data.runtimeTicks,
                        progress_ticks: 0,
                        is_paused: 0
                    }];
                } else if (data.type === 'now_playing_progress') {
                    activeSessions = activeSessions.map(s =>
                        s.id === data.sessionId
                            ? { ...s, progress_ticks: data.progressTicks, is_paused: data.isPaused ? 1 : 0 }
                            : s
                    );
                } else if (data.type === 'now_playing_stop') {
                    activeSessions = activeSessions.filter(s => s.id !== data.sessionId);
                }
            } catch { /* ignore */ }
        };

        eventSource = es;

        return () => {
            es.close();
        };
    });

    function formatTime(ticks) {
        if (!ticks) return '0:00';
        const totalSeconds = Math.floor(ticks / 10000000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        if (minutes >= 60) {
            const hours = Math.floor(minutes / 60);
            const mins = minutes % 60;
            return `${hours}:${String(mins).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
        }
        return `${minutes}:${String(seconds).padStart(2, '0')}`;
    }

    function getMediaIcon(type) {
        if (type === 'episode') return '📺';
        if (type === 'track') return '🎵';
        return '🎬';
    }
</script>

{#if activeSessions.length > 0}
    <div class="space-y-3">
        {#each activeSessions as session (session.id)}
            {@const progressPct = session.runtime_ticks > 0 ? (session.progress_ticks / session.runtime_ticks * 100) : 0}
            <div class="card bg-base-200/30 backdrop-blur-xl border border-primary/20 shadow-lg shadow-primary/5 overflow-hidden relative">
                <!-- Animated gradient border -->
                <div class="absolute inset-0 rounded-2xl bg-gradient-to-r from-primary/20 via-secondary/20 to-accent/20 opacity-50" class:animate-pulse={!session.is_paused}></div>

                <div class="card-body p-4 relative z-10">
                    <div class="flex items-center gap-4">
                        <!-- Media icon with pulse -->
                        <div class="relative">
                            <div class="w-12 h-12 rounded-xl bg-gradient-to-br from-primary/20 to-secondary/20 flex items-center justify-center text-2xl">
                                {getMediaIcon(session.media_type)}
                            </div>
                            {#if !session.is_paused}
                                <div class="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-success animate-pulse"></div>
                            {/if}
                        </div>

                        <!-- Info -->
                        <div class="flex-1 min-w-0">
                            <div class="flex items-center gap-2">
                                <span class="text-xs font-semibold uppercase tracking-wider text-primary/80">
                                    {session.is_paused ? '⏸ Paused' : '▶ Now Playing'}
                                </span>
                            </div>
                            <h3 class="font-bold text-base-content truncate">{session.title || 'Unknown'}</h3>
                            <p class="text-sm text-base-content/60">
                                {formatTime(session.progress_ticks)} / {formatTime(session.runtime_ticks)}
                            </p>
                        </div>

                        <!-- Percentage -->
                        <div class="text-right">
                            <span class="text-2xl font-bold text-primary">{Math.round(progressPct)}%</span>
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
