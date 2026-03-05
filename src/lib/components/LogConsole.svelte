<script>
    /**
     * Unified log console component for SSE/streaming operations.
     * Features: auto-scroll, follow toggle, copy all, error filter, loading indicator.
     *
     * @component
     * @example
     * <LogConsole logs={myLogs} running={isRunning} title="Sync Log" />
     */

    /**
     * @typedef {{ time?: string, timestamp?: string, message: string, type: string }} LogEntry
     */

    /** @type {{ logs: LogEntry[], running?: boolean, title?: string, height?: string }} */
    let {
        logs = [],
        running = false,
        title = "Console",
        height = "h-48",
    } = $props();

    let consoleEl = $state(/** @type {HTMLElement|null} */ (null));
    let followLogs = $state(true);
    let showOnlyErrors = $state(false);
    let copyFeedback = $state(false);

    let filteredLogs = $derived.by(() => {
        if (!showOnlyErrors) return logs;
        return logs.filter((l) => l.type === "error" || l.type === "warning");
    });

    // Auto-scroll when following
    $effect(() => {
        if (followLogs && filteredLogs.length && consoleEl) {
            consoleEl.scrollTop = consoleEl.scrollHeight;
        }
    });

    /** @param {string} type */
    function getLogClass(type) {
        if (type === "success") return "text-success";
        if (type === "error") return "text-error";
        if (type === "warning" || type === "warn") return "text-warning";
        return "text-base-content/70";
    }

    /** @param {LogEntry} l */
    function getTime(l) {
        return l.time || l.timestamp || "";
    }

    function copyAll() {
        const text = logs.map((l) => `[${getTime(l)}] ${l.message}`).join("\n");
        navigator.clipboard.writeText(text).then(() => {
            copyFeedback = true;
            setTimeout(() => (copyFeedback = false), 2000);
        });
    }
</script>

{#if logs.length > 0}
    <div class="space-y-1.5">
        <!-- Controls bar -->
        <div class="flex items-center justify-between">
            <span class="text-xs text-base-content/40">{title}</span>
            <div class="flex items-center gap-3">
                <!-- Error filter -->
                <label class="flex items-center gap-1.5 cursor-pointer">
                    <input
                        type="checkbox"
                        class="toggle toggle-xs"
                        bind:checked={showOnlyErrors}
                    />
                    <span class="text-xs text-base-content/50">Errors only</span
                    >
                </label>
                <!-- Follow toggle -->
                <label class="flex items-center gap-1.5 cursor-pointer">
                    <input
                        type="checkbox"
                        class="toggle toggle-xs toggle-info"
                        bind:checked={followLogs}
                    />
                    <span class="text-xs text-base-content/50">Follow</span>
                </label>
                <!-- Copy button -->
                <button class="btn btn-xs btn-ghost gap-1" onclick={copyAll}>
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
                        >
                            <rect
                                x="9"
                                y="9"
                                width="13"
                                height="13"
                                rx="2"
                                ry="2"
                            />
                            <path
                                d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"
                            />
                        </svg>
                        Copy
                    {/if}
                </button>
            </div>
        </div>

        <!-- Log area -->
        <div
            bind:this={consoleEl}
            class="bg-neutral text-neutral-content rounded-lg p-3 {height} overflow-y-auto text-xs font-mono"
        >
            {#each filteredLogs as log}
                <div class={getLogClass(log.type)}>
                    <span class="opacity-50">[{getTime(log)}]</span>
                    {log.message}
                </div>
            {/each}
            {#if running}
                <div class="opacity-50 mt-1">
                    <span class="loading loading-dots loading-xs"></span>
                </div>
            {/if}
        </div>
    </div>
{/if}
