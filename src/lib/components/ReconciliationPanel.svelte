<script>
    import LogConsole from "$lib/components/LogConsole.svelte";
    import ServiceIcon from "$lib/components/ServiceIcon.svelte";
    /** @type {{ settings?: { radarrUrl?: string, sonarrUrl?: string, lidarrUrl?: string } }} */
    let { settings = {} } = $props();

    // ─── State ───────────────────────────────────────────────────────────────────
    let running = $state(false);
    let stopping = $state(false);
    /** @type {Array<{time: string, message: string, type: string}>} */
    let logs = $state([]);
    let currentPhase = $state("");
    let progress = $state({ done: 0, total: 0 });
    /** @type {any} */
    let stats = $state(null);
    /** @type {any} */
    let diff = $state(null);
    /** @type {any} */
    let latestRun = $state(null);
    let error = $state("");
    let useT3 = $state(false);

    // Rebuild (recovery) state
    let rebuilding = $state(false);
    /** @type {any} */
    let rebuildResult = $state(null);

    // Phase toggles — all enabled by default
    let enabledPhases = $state({
        snapshot: true,
        clearing: true,
        embedding: true,
        matching_lastfm: true,
        matching_trakt: true,
        reclassifying: true,
        arr_sync: true,
        diffing: true,
    });

    // Snapshot, clearing, and diffing are always required
    const requiredPhases = ["snapshot", "clearing", "diffing"];
    let skipPhases = $derived(
        Object.entries(enabledPhases)
            .filter(([_, enabled]) => !enabled)
            .map(([id]) => id),
    );

    // ─── Review state ────────────────────────────────────────────────────────────
    let showDiff = $state(false);
    let diffFilter = $state("all");
    let diffSearchQuery = $state("");
    let diffPage = $state(0);
    const DIFF_PAGE_SIZE = 50;

    // ─── Unmatched items state ───────────────────────────────────────────────────
    /** @type {any} */
    let unmatched = $state(null);
    let unmatchedType = $state("artist");
    let unmatchedPage = $state(1);
    let loadingUnmatched = $state(false);
    let unmatchedSort = $state("plays");
    let unmatchedDir = $state("desc");
    /** @type {Map<number, any[]>} */
    let expandedChildren = $state(new Map());
    /** @type {Set<number>} */
    let loadingChildren = $state(new Set());

    async function toggleExpand(parentId) {
        if (expandedChildren.has(parentId)) {
            expandedChildren.delete(parentId);
            expandedChildren = new Map(expandedChildren);
            return;
        }
        loadingChildren.add(parentId);
        loadingChildren = new Set(loadingChildren);
        try {
            const res = await fetch(`/api/reconcile/unmatched/children?parentId=${parentId}`);
            if (res.ok) {
                const data = await res.json();
                expandedChildren.set(parentId, data.children || []);
                expandedChildren = new Map(expandedChildren);
            }
        } catch { /* */ }
        loadingChildren.delete(parentId);
        loadingChildren = new Set(loadingChildren);
    }

    async function loadUnmatched(
        type = unmatchedType,
        page = unmatchedPage,
        sort = unmatchedSort,
        dir = unmatchedDir,
    ) {
        loadingUnmatched = true;
        try {
            const res = await fetch(
                `/api/reconcile/unmatched?type=${type}&page=${page}&limit=50&sort=${sort}&dir=${dir}`,
            );
            if (res.ok) {
                unmatched = await res.json();
                unmatchedType = type;
                unmatchedPage = page;
                unmatchedSort = sort;
                unmatchedDir = dir;
            }
        } catch {
            /* */
        }
        loadingUnmatched = false;
    }

    function toggleSort(col) {
        if (unmatchedSort === col) {
            unmatchedDir = unmatchedDir === "desc" ? "asc" : "desc";
        } else {
            unmatchedSort = col;
            unmatchedDir = col === "title" ? "asc" : "desc";
        }
        loadUnmatched(unmatchedType, 1, unmatchedSort, unmatchedDir);
    }

    // ─── Enrichment state ──────────────────────────────────────────────────────────
    let enrichRunning = $state(false);
    /** @type {{ time: string, message: string, type: string }[]} */
    let enrichLogs = $state([]);
    /** @type {{ done: number, total: number }} */
    let enrichProgress = $state({ done: 0, total: 0 });

    async function startEnrichment() {
        enrichRunning = true;
        enrichLogs = [];
        enrichProgress = { done: 0, total: 0 };
        try {
            const res = await fetch("/api/reconcile/enrich", {
                method: "POST",
            });
            if (!res.ok || !res.body) {
                enrichRunning = false;
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
                            enrichLogs = [
                                ...enrichLogs,
                                {
                                    time: new Date().toLocaleTimeString(),
                                    message: event.log,
                                    type: event.logType || "info",
                                },
                            ];
                        }
                        if (event.done !== undefined) {
                            enrichProgress = {
                                done: event.done,
                                total: event.total,
                            };
                        }
                        if (
                            event.type === "enrich_complete" ||
                            event.type === "enrich_error"
                        ) {
                            enrichRunning = false;
                            // Refresh unmatched list to show new IDs
                            loadUnmatched();
                        }
                    } catch {
                        /* */
                    }
                }
            }
        } catch {
            /* */
        }
        enrichRunning = false;
    }

    async function stopEnrichment() {
        await fetch("/api/reconcile/enrich", { method: "DELETE" });
    }

    // ─── Load latest run on mount ────────────────────────────────────────────────
    $effect(() => {
        loadLatestRun();
    });

    async function loadLatestRun() {
        try {
            const res = await fetch("/api/reconcile/run/report");
            if (res.ok) {
                latestRun = await res.json();
            }
        } catch {
            /* no run yet */
        }
    }

    // ─── Rebuild Play History ────────────────────────────────────────────────────
    async function rebuildHistory() {
        rebuilding = true;
        rebuildResult = null;
        try {
            const res = await fetch("/api/backfill/rebuild", { method: "POST" });
            rebuildResult = await res.json();
        } catch (/** @type {any} */ e) {
            rebuildResult = { error: e.message || String(e) };
        }
        rebuilding = false;
    }

    // ─── Start Reconciliation ────────────────────────────────────────────────────
    async function startReconciliation() {
        running = true;
        error = "";
        logs = [];
        stats = null;
        diff = null;
        currentPhase = "init";
        progress = { done: 0, total: 0 };

        try {
            const res = await fetch("/api/reconcile/run", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ useT3, skipPhases }),
            });
            if (!res.ok) {
                const errData = await res.json();
                throw new Error(errData.error || `HTTP ${res.status}`);
            }

            const reader = res.body?.getReader();
            const decoder = new TextDecoder();
            let buffer = "";

            while (reader) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split("\n\n");
                buffer = lines.pop() || "";

                for (const line of lines) {
                    if (!line.startsWith("data: ")) continue;
                    try {
                        const evt = JSON.parse(line.slice(6));
                        handleEvent(evt);
                    } catch {
                        /* bad JSON */
                    }
                }
            }
        } catch (/** @type {any} */ e) {
            error = e.message || String(e);
        } finally {
            running = false;
            stopping = false;
            await loadLatestRun();
        }
    }

    /** @param {any} event */
    function handleEvent(event) {
        if (event.log) {
            logs = [
                ...logs,
                {
                    time: new Date().toLocaleTimeString(),
                    message: event.log,
                    type: event.logType || "info",
                },
            ];
        }

        if (event.phase) currentPhase = event.phase;
        if (event.done != null)
            progress = { done: event.done, total: event.total };
        if (event.stats) stats = event.stats;

        if (event.type === "reconcile_diff") {
            diff = event;
            showDiff = true;
        }
        if (event.type === "reconcile_complete") {
            if (event.stats) stats = event.stats;
            if (event.diff) diff = event.diff;
        }
        if (event.type === "reconcile_error") {
            error = event.error;
        }
    }

    async function stopReconciliation() {
        stopping = true;
        await fetch("/api/reconcile/run", { method: "DELETE" });
    }

    // ─── Computed ────────────────────────────────────────────────────────────────
    let phaseLabel = $derived(
        /** @type {Record<string,string>} */ ({
            init: "🔄 Initializing...",
            snapshot: "📸 Snapshotting...",
            clearing: "🗑️ Clearing old data...",
            embedding: "🧠 Building embeddings...",
            matching_lastfm: "🎵 Matching Last.fm...",
            matching_trakt: "🎬 Matching Trakt...",
            reclassifying: "🏷️ Reclassifying...",
            arr_sync: "📥 Syncing *arr...",
            diffing: "📊 Generating diff...",
        })[currentPhase] || currentPhase,
    );

    let progressPct = $derived(
        progress.total > 0
            ? Math.round((progress.done / progress.total) * 100)
            : 0,
    );

    let filteredDetails = $derived.by(() => {
        /** @type {any[]} */
        const source = diff?.details || latestRun?.diff_summary?.details || [];
        let items = source;
        if (diffFilter !== "all") {
            items = items.filter(
                (/** @type {any} */ d) => d.direction === diffFilter,
            );
        }
        if (diffSearchQuery.trim()) {
            const q = diffSearchQuery.trim().toLowerCase();
            items = items.filter(
                (/** @type {any} */ d) =>
                    d.oldParent?.toLowerCase().includes(q) ||
                    d.newParent?.toLowerCase().includes(q) ||
                    d.eventId?.toLowerCase().includes(q),
            );
        }
        return items;
    });

    let totalFilteredPages = $derived(
        Math.ceil(filteredDetails.length / DIFF_PAGE_SIZE),
    );
    let pagedDetails = $derived(
        filteredDetails.slice(
            diffPage * DIFF_PAGE_SIZE,
            (diffPage + 1) * DIFF_PAGE_SIZE,
        ),
    );

    // Reset page when filter/search changes
    $effect(() => {
        diffFilter;
        diffSearchQuery;
        diffPage = 0;
    });
</script>

<div class="space-y-6">
    <!-- Header -->
    <div class="card bg-base-200/50 border border-base-300">
        <div class="card-body">
            <h2 class="card-title text-lg">
                <span class="text-xl">🔄</span>
                Reconciliation
            </h2>
            <p class="text-sm text-base-content/60">
                Re-match all Last.fm and Trakt data to your local library using
                a multi-tier pipeline: external IDs → exact title → normalized
                title → fuzzy album matching.
            </p>
            <p class="text-xs text-base-content/40 mt-1">
                Raw scrobble/history data is preserved untouched. This
                re-processes the mapping between external data and your local
                media.
            </p>

            <div class="card-actions mt-4">
                {#if running}
                    <button
                        class="btn btn-error btn-sm gap-2"
                        onclick={stopReconciliation}
                        disabled={stopping}
                    >
                        {#if stopping}
                            <span class="loading loading-spinner loading-xs"
                            ></span> Stopping...
                        {:else}
                            ⏹️ Stop
                        {/if}
                    </button>
                {:else}
                    <button
                        class="btn btn-primary btn-sm gap-2"
                        onclick={startReconciliation}
                    >
                        🔄 Run Full Reconciliation
                    </button>
                    <label class="label cursor-pointer gap-2">
                        <input
                            type="checkbox"
                            class="toggle toggle-xs toggle-primary"
                            bind:checked={useT3}
                        />
                        <span class="label-text text-xs"
                            >T3 Embedding (experimental, uses Ollama)</span
                        >
                    </label>
                {/if}
            </div>

            <!-- Rebuild Play History (Recovery) -->
            <div class="mt-3 pt-3 border-t border-base-300/50">
                <div class="flex items-center gap-3">
                    <button
                        class="btn btn-warning btn-sm btn-outline gap-2"
                        onclick={rebuildHistory}
                        disabled={rebuilding || running}
                    >
                        {#if rebuilding}
                            <span class="loading loading-spinner loading-xs"></span> Rebuilding...
                        {:else}
                            🔄 Rebuild Play History
                        {/if}
                    </button>
                    <span class="text-xs text-base-content/50">Re-import from raw Trakt/Last.fm data without deleting existing history</span>
                </div>
                {#if rebuildResult}
                    <div class="mt-2 text-xs bg-base-300/30 rounded-lg p-3 space-y-1">
                        {#if rebuildResult.error}
                            <p class="text-error">❌ {rebuildResult.error}</p>
                        {:else}
                            {#if rebuildResult.results?.trakt}
                                <p>🎬 <strong>Trakt:</strong> {rebuildResult.results.trakt.imported} imported, {rebuildResult.results.trakt.external} external, {rebuildResult.results.trakt.skipped} skipped{rebuildResult.results.trakt.consolidated ? `, ${rebuildResult.results.trakt.consolidated} consolidated` : ''}</p>
                            {/if}
                            {#if rebuildResult.results?.lastfm}
                                <p>🎵 <strong>Last.fm:</strong> {rebuildResult.results.lastfm.imported} imported, {rebuildResult.results.lastfm.external} external, {rebuildResult.results.lastfm.skipped} skipped</p>
                            {/if}
                        {/if}
                    </div>
                {/if}
            </div>
        </div>
    </div>

    {#if error}
        <div class="alert alert-error">
            <svg
                xmlns="http://www.w3.org/2000/svg"
                class="stroke-current shrink-0 h-5 w-5"
                fill="none"
                viewBox="0 0 24 24"
            >
                <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"
                />
            </svg>
            <span>{error}</span>
        </div>
    {/if}

    <!-- Pipeline Phases -->
    <div class="card bg-base-200/50 border border-base-300">
        <div class="card-body py-4">
            {#if running || stats}
                {@const phases = [
                    { id: "snapshot", icon: "📸", label: "Snapshot" },
                    { id: "clearing", icon: "🗑️", label: "Clear" },
                    {
                        id: "embedding",
                        icon: useT3 ? "🧠" : "🔗",
                        label: useT3 ? "Embed" : "Match",
                    },
                    { id: "matching_lastfm", icon: "lastfm", label: "Last.fm" },
                    { id: "matching_trakt", icon: "trakt", label: "Trakt" },
                    { id: "reclassifying", icon: "🏷️", label: "Reclassify" },
                    { id: "arr_sync", icon: "📥", label: "*arr" },
                    { id: "diffing", icon: "📊", label: "Diff" },
                ]}
                {@const phaseOrder = phases.map((p) => p.id)}
                {@const currentIdx = phaseOrder.indexOf(currentPhase)}
                <ul class="steps steps-horizontal w-full text-xs">
                    {#each phases as phase, i}
                        <li
                            class="step"
                            class:step-primary={i < currentIdx ||
                                (!running && stats)}
                            class:step-info={i === currentIdx && running}
                            class:opacity-40={skipPhases.includes(phase.id)}
                            data-content={skipPhases.includes(phase.id)
                                ? "—"
                                : i < currentIdx || (!running && stats)
                                  ? "✓"
                                  : i === currentIdx && running
                                    ? "●"
                                    : ""}
                        >
                            <span
                                class="hidden sm:inline-flex items-center gap-1 whitespace-nowrap"
                                >{#if ["lastfm", "trakt", "tmdb", "musicbrainz"].includes(phase.icon)}<ServiceIcon
                                        service={phase.icon}
                                        size="w-4 h-4"
                                    />{:else}{phase.icon}{/if}
                                {phase.label}</span
                            >
                            <span class="sm:hidden"
                                >{#if ["lastfm", "trakt", "tmdb", "musicbrainz"].includes(phase.icon)}<ServiceIcon
                                        service={phase.icon}
                                        size="w-4 h-4"
                                    />{:else}{phase.icon}{/if}</span
                            >
                        </li>
                    {/each}
                </ul>

                <!-- Current phase detail with progress -->
                {#if running}
                    <div class="mt-3 space-y-1.5">
                        <div class="flex items-center justify-between">
                            <span class="text-sm font-semibold"
                                >{phaseLabel}</span
                            >
                            {#if progress.total > 0}
                                <span
                                    class="text-xs text-base-content/60 font-mono"
                                >
                                    {progress.done.toLocaleString()} / {progress.total.toLocaleString()}
                                    ({progressPct}%)
                                </span>
                            {/if}
                        </div>
                        {#if progress.total > 0}
                            <progress
                                class="progress progress-primary w-full"
                                value={progressPct}
                                max="100"
                            ></progress>
                        {:else}
                            <progress class="progress progress-primary w-full"
                            ></progress>
                        {/if}
                    </div>
                {/if}
            {:else}
                <!-- Pre-run: show toggleable phases -->
                <h3 class="font-semibold text-sm mb-3">Pipeline Phases</h3>
                <p class="text-xs text-base-content/50 mb-3">
                    Toggle off any phases you don't want to run.
                </p>
                <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {#each [{ id: "snapshot", icon: "📸", label: "Snapshot" }, { id: "clearing", icon: "🗑️", label: "Clear" }, { id: "embedding", icon: useT3 ? "🧠" : "🔗", label: useT3 ? "Embed" : "Match" }, { id: "matching_lastfm", icon: "lastfm", label: "Last.fm" }, { id: "matching_trakt", icon: "trakt", label: "Trakt" }, { id: "reclassifying", icon: "🏷️", label: "Reclassify" }, { id: "arr_sync", icon: "📥", label: "*arr" }, { id: "diffing", icon: "📊", label: "Diff" }] as phase}
                        <label
                            class="flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors
                                {requiredPhases.includes(phase.id)
                                ? 'border-base-300/30 opacity-50 cursor-not-allowed'
                                : enabledPhases[phase.id]
                                  ? 'border-primary/30 bg-primary/5 cursor-pointer'
                                  : 'border-base-300 bg-base-300/20 opacity-60 cursor-pointer'}"
                        >
                            <input
                                type="checkbox"
                                class="toggle toggle-xs toggle-primary"
                                bind:checked={enabledPhases[phase.id]}
                                disabled={requiredPhases.includes(phase.id)}
                            />
                            <span class="flex items-center gap-1 text-xs">
                                {#if ["lastfm", "trakt", "tmdb", "musicbrainz"].includes(phase.icon)}
                                    <ServiceIcon
                                        service={phase.icon}
                                        size="w-3.5 h-3.5"
                                    />
                                {:else}
                                    {phase.icon}
                                {/if}
                                {phase.label}
                            </span>
                        </label>
                    {/each}
                </div>
            {/if}
        </div>
    </div>

    <!-- Console Log (right below progress for visibility) -->
    <LogConsole {logs} {running} title="Reconciliation Log" height="h-64" />

    <!-- Stats Cards -->
    {#if stats}
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div
                class="stat bg-base-200/50 border border-base-300 rounded-lg p-3"
            >
                <div class="stat-title text-xs flex items-center gap-1">
                    <ServiceIcon service="lastfm" size="w-3.5 h-3.5" /> Last.fm Matched
                </div>
                <div class="stat-value text-lg text-primary">
                    {stats.lastfm?.matched?.toLocaleString() || 0}
                </div>
                <div class="stat-desc text-xs">
                    of {stats.lastfm?.total?.toLocaleString() || 0}
                </div>
            </div>
            <div
                class="stat bg-base-200/50 border border-base-300 rounded-lg p-3"
            >
                <div class="stat-title text-xs flex items-center gap-1">
                    <ServiceIcon service="trakt" size="w-3.5 h-3.5" /> Trakt Matched
                </div>
                <div class="stat-value text-lg text-secondary">
                    {stats.trakt?.matched?.toLocaleString() || 0}
                </div>
                <div class="stat-desc text-xs">
                    of {stats.trakt?.total?.toLocaleString() || 0}
                </div>
            </div>
            <div
                class="stat bg-base-200/50 border border-base-300 rounded-lg p-3"
            >
                <div class="stat-title text-xs">External</div>
                <div class="stat-value text-lg text-warning">
                    {(
                        (stats.lastfm?.external || 0) +
                        (stats.trakt?.external || 0)
                    ).toLocaleString()}
                </div>
                <div class="stat-desc text-xs">watched, not owned</div>
            </div>
            <div
                class="stat bg-base-200/50 border border-base-300 rounded-lg p-3"
            >
                <div class="stat-title text-xs">AI Confirmed</div>
                <div class="stat-value text-lg text-accent">
                    {(
                        (stats.lastfm?.tier3 || 0) + (stats.trakt?.tier3 || 0)
                    ).toLocaleString()}
                </div>
                <div class="stat-desc text-xs">Tier 3 matches</div>
            </div>
        </div>

        <!-- Tier Breakdown -->
        <div class="card bg-base-200/50 border border-base-300">
            <div class="card-body py-3">
                <h3 class="font-semibold text-sm mb-2">Match Tier Breakdown</h3>
                <div class="grid grid-cols-2 gap-4">
                    <div>
                        <h4
                            class="text-xs font-semibold text-primary mb-1 flex items-center gap-1"
                        >
                            <ServiceIcon service="lastfm" size="w-3.5 h-3.5" /> Last.fm
                        </h4>
                        <div class="text-xs space-y-0.5">
                            <div class="flex justify-between">
                                <span>T0 External ID</span><span
                                    class="font-mono"
                                    >{stats.lastfm?.tier0 || 0}</span
                                >
                            </div>
                            <div class="flex justify-between">
                                <span>T1 Exact Title</span><span
                                    class="font-mono"
                                    >{stats.lastfm?.tier1 || 0}</span
                                >
                            </div>
                            <div class="flex justify-between">
                                <span>T2 Normalized</span><span
                                    class="font-mono"
                                    >{stats.lastfm?.tier2 || 0}</span
                                >
                            </div>
                            <div class="flex justify-between">
                                <span>T3 AI/Embedding</span><span
                                    class="font-mono"
                                    >{stats.lastfm?.tier3 || 0}</span
                                >
                            </div>
                        </div>
                    </div>
                    <div>
                        <h4
                            class="text-xs font-semibold text-secondary mb-1 flex items-center gap-1"
                        >
                            <ServiceIcon service="trakt" size="w-3.5 h-3.5" /> Trakt
                        </h4>
                        <div class="text-xs space-y-0.5">
                            <div class="flex justify-between">
                                <span>T0 External ID</span><span
                                    class="font-mono"
                                    >{stats.trakt?.tier0 || 0}</span
                                >
                            </div>
                            <div class="flex justify-between">
                                <span>T1 Exact Title</span><span
                                    class="font-mono"
                                    >{stats.trakt?.tier1 || 0}</span
                                >
                            </div>
                            <div class="flex justify-between">
                                <span>T2 Normalized</span><span
                                    class="font-mono"
                                    >{stats.trakt?.tier2 || 0}</span
                                >
                            </div>
                            <div class="flex justify-between">
                                <span>T3 AI/Embedding</span><span
                                    class="font-mono"
                                    >{stats.trakt?.tier3 || 0}</span
                                >
                            </div>
                            <div
                                class="flex justify-between text-base-content/50"
                            >
                                <span>Consolidated</span><span class="font-mono"
                                    >{stats.trakt?.consolidated || 0}</span
                                >
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    {/if}

    <!-- Unmatched Items -->
    <div class="card bg-base-200/50 border border-base-300">
        <div class="card-body py-3">
            <div class="flex items-center justify-between">
                <h3 class="font-semibold text-sm">📦 Unmatched Items</h3>
                <div class="flex gap-2">
                    {#if !enrichRunning}
                        <button
                            class="btn btn-xs btn-primary"
                            onclick={startEnrichment}
                            disabled={running}
                            ><ServiceIcon
                                service="musicbrainz"
                                size="w-3.5 h-3.5"
                                class="inline-block"
                            /> Enrich with MusicBrainz</button
                        >
                    {:else}
                        <button
                            class="btn btn-xs btn-error"
                            onclick={stopEnrichment}>⏹ Stop</button
                        >
                    {/if}
                    {#if !unmatched}
                        <button
                            class="btn btn-xs btn-ghost"
                            onclick={() => loadUnmatched("artist", 1)}
                            >Load</button
                        >
                    {/if}
                </div>
            </div>

            {#if unmatched}
                <!-- Type tabs -->
                <div role="tablist" class="tabs tabs-boxed tabs-xs mt-2">
                    {#each [{ id: "artist", label: "Music", count: unmatched.counts?.artist || 0, svc: "lastfm" }, { id: "movie", label: "Movies", count: unmatched.counts?.movie || 0, svc: "tmdb" }, { id: "show", label: "Shows", count: unmatched.counts?.show || 0, svc: "tmdb" }] as tab}
                        <button
                            role="tab"
                            class="tab {unmatchedType === tab.id
                                ? 'tab-active'
                                : ''}"
                            onclick={() => loadUnmatched(tab.id, 1)}
                        >
                            <ServiceIcon service={tab.svc} size="w-3.5 h-3.5" />
                            {tab.label} ({tab.count})
                        </button>
                    {/each}
                </div>

                <!-- Items table -->
                {#if loadingUnmatched}
                    <div class="flex justify-center py-4">
                        <span class="loading loading-spinner loading-sm"></span>
                    </div>
                {:else if unmatched.items?.length > 0}
                    <div class="overflow-x-auto mt-2">
                        <table class="table table-xs table-zebra">
                            <thead>
                                <tr>
                                    <th
                                        class="cursor-pointer select-none"
                                        onclick={() => toggleSort("title")}
                                    >
                                        Title {unmatchedSort === "title"
                                            ? unmatchedDir === "asc"
                                                ? "▲"
                                                : "▼"
                                            : ""}
                                    </th>
                                    <th
                                        class="text-right cursor-pointer select-none"
                                        onclick={() => toggleSort("children")}
                                    >
                                        {unmatchedType === "artist"
                                            ? "Albums"
                                            : "Episodes"}
                                        {unmatchedSort === "children"
                                            ? unmatchedDir === "asc"
                                                ? "▲"
                                                : "▼"
                                            : ""}
                                    </th>
                                    <th
                                        class="text-right cursor-pointer select-none"
                                        onclick={() => toggleSort("plays")}
                                    >
                                        Plays {unmatchedSort === "plays"
                                            ? unmatchedDir === "asc"
                                                ? "▲"
                                                : "▼"
                                            : ""}
                                    </th>
                                    <th>External IDs</th>
                                    <th>Links</th>
                                </tr>
                            </thead>
                            <tbody>
                                {#each unmatched.items as item}
                                    <tr
                                        class="cursor-pointer hover:bg-base-300/50 transition-colors"
                                        onclick={() => toggleExpand(item.id)}
                                    >
                                        <td
                                            class="font-medium max-w-[200px] truncate"
                                            title={item.title}
                                        >
                                            <span class="inline-block w-4 text-base-content/40 mr-1 transition-transform {expandedChildren.has(item.id) ? 'rotate-90' : ''}">
                                                ▶
                                            </span>
                                            {item.title}
                                            {#if item.release_year}
                                                <span
                                                    class="text-base-content/40"
                                                    >({item.release_year})</span
                                                >
                                            {/if}
                                        </td>
                                        <td class="text-right font-mono text-xs"
                                            >{item.child_count}</td
                                        >
                                        <td class="text-right font-mono text-xs"
                                            >{item.play_count}</td
                                        >
                                        <td class="text-xs space-x-1" onclick={(e) => e.stopPropagation()}>
                                            {#if item.musicbrainz_id}
                                                <a
                                                    href="https://musicbrainz.org/artist/{item.musicbrainz_id}"
                                                    target="_blank"
                                                    rel="noopener"
                                                    class="badge badge-xs badge-info gap-0.5 hover:brightness-125 transition-all"
                                                    ><ServiceIcon
                                                        service="musicbrainz"
                                                        size="w-3 h-3"
                                                    />MB</a
                                                >
                                            {/if}
                                            {#if item.tmdb_id}
                                                <a
                                                    href="https://www.themoviedb.org/{unmatchedType ===
                                                    'movie'
                                                        ? 'movie'
                                                        : unmatchedType ===
                                                            'show'
                                                          ? 'tv'
                                                          : 'movie'}/{item.tmdb_id}"
                                                    target="_blank"
                                                    rel="noopener"
                                                    class="badge badge-xs badge-success gap-0.5 hover:brightness-125 transition-all"
                                                    ><ServiceIcon
                                                        service="tmdb"
                                                        size="w-3 h-3"
                                                    />TMDB</a
                                                >
                                            {/if}
                                            {#if item.imdb_id}
                                                <a
                                                    href="https://www.imdb.com/title/{item.imdb_id}/"
                                                    target="_blank"
                                                    rel="noopener"
                                                    class="badge badge-xs badge-warning gap-0.5 hover:brightness-125 transition-all"
                                                    ><ServiceIcon
                                                        service="imdb"
                                                        size="w-3 h-3"
                                                    />IMDB</a
                                                >
                                            {/if}
                                            {#if !item.musicbrainz_id && !item.tmdb_id && !item.imdb_id}
                                                <span
                                                    class="text-base-content/30"
                                                    >—</span
                                                >
                                            {/if}
                                        </td>
                                        <td class="text-xs space-x-1" onclick={(e) => e.stopPropagation()}>
                                            <!-- Mediajam stub link -->
                                            <a
                                                href="/{unmatchedType === 'artist' ? 'music' : unmatchedType === 'show' ? 'tv' : 'movies'}/{item.id}"
                                                class="badge badge-xs badge-outline badge-primary gap-0.5 hover:brightness-125 transition-all"
                                                title="View in Mediajam (create stub)"
                                            >
                                                📄 View
                                            </a>
                                            <!-- *arr search link -->
                                            {#if unmatchedType === 'artist'}
                                                <a
                                                    href="{settings?.lidarrUrl || ''}{item.musicbrainz_id ? `/artist/${item.musicbrainz_id}` : `/add/search?term=${encodeURIComponent(item.title)}`}"
                                                    target="_blank"
                                                    rel="noopener"
                                                    class="badge badge-xs badge-outline badge-info gap-0.5 hover:brightness-125 transition-all"
                                                    title="{item.musicbrainz_id ? 'View in Lidarr' : 'Search in Lidarr'}"
                                                >
                                                    <ServiceIcon service="lidarr" size="w-3 h-3" /> Lidarr
                                                </a>
                                            {:else if unmatchedType === 'movie'}
                                                <a
                                                    href="{settings?.radarrUrl || ''}/add/new?term={encodeURIComponent(item.title)}"
                                                    target="_blank"
                                                    rel="noopener"
                                                    class="badge badge-xs badge-outline badge-info gap-0.5 hover:brightness-125 transition-all"
                                                    title="Search in Radarr"
                                                >
                                                    <ServiceIcon service="radarr" size="w-3 h-3" /> Radarr
                                                </a>
                                            {:else if unmatchedType === 'show'}
                                                <a
                                                    href="{settings?.sonarrUrl || ''}/add/new?term={encodeURIComponent(item.title)}"
                                                    target="_blank"
                                                    rel="noopener"
                                                    class="badge badge-xs badge-outline badge-info gap-0.5 hover:brightness-125 transition-all"
                                                    title="Search in Sonarr"
                                                >
                                                    <ServiceIcon service="sonarr" size="w-3 h-3" /> Sonarr
                                                </a>
                                            {/if}
                                        </td>
                                    </tr>
                                    <!-- Expanded children sub-rows -->
                                    {#if loadingChildren.has(item.id)}
                                        <tr>
                                            <td colspan="5" class="py-2 px-8">
                                                <span class="loading loading-spinner loading-xs"></span>
                                                <span class="text-xs text-base-content/50 ml-1">Loading...</span>
                                            </td>
                                        </tr>
                                    {/if}
                                    {#if expandedChildren.has(item.id)}
                                        {@const children = expandedChildren.get(item.id) || []}
                                        {#if children.length === 0}
                                            <tr>
                                                <td colspan="5" class="py-1 px-8 text-xs text-base-content/40 italic">
                                                    No children found
                                                </td>
                                            </tr>
                                        {:else}
                                            {#each children as child}
                                                <tr class="bg-base-300/20">
                                                    <td class="pl-10 text-xs text-base-content/70">
                                                        {#if child.item_number}
                                                            <span class="font-mono text-base-content/40 mr-1">
                                                                {#if child.season_number != null}S{String(child.season_number).padStart(2, '0')}{/if}#{String(child.item_number).padStart(2, '0')}
                                                            </span>
                                                        {/if}
                                                        {child.title || 'Untitled'}
                                                    </td>
                                                    <td class="text-right text-xs">
                                                        {#if child.collection_status === 'collected'}
                                                            <span class="badge badge-xs badge-success">✓</span>
                                                        {:else}
                                                            <span class="badge badge-xs badge-ghost">—</span>
                                                        {/if}
                                                    </td>
                                                    <td class="text-right font-mono text-xs text-base-content/50">
                                                        {child.history_count || 0}
                                                    </td>
                                                    <td colspan="2" class="text-xs text-base-content/40">
                                                        {#if child.watch_status === 'watched'}
                                                            ✅ watched
                                                        {:else if child.watch_status}
                                                            {child.watch_status}
                                                        {/if}
                                                    </td>
                                                </tr>
                                            {/each}
                                        {/if}
                                    {/if}
                                {/each}
                            </tbody>
                        </table>
                    </div>

                    <!-- Pagination -->
                    {#if unmatched.totalPages > 1}
                        <div class="flex justify-center gap-2 mt-2">
                            <button
                                class="btn btn-xs"
                                disabled={unmatchedPage <= 1}
                                onclick={() =>
                                    loadUnmatched(
                                        unmatchedType,
                                        unmatchedPage - 1,
                                    )}>«</button
                            >
                            <span class="text-xs self-center">
                                Page {unmatchedPage} of {unmatched.totalPages}
                            </span>
                            <button
                                class="btn btn-xs"
                                disabled={unmatchedPage >= unmatched.totalPages}
                                onclick={() =>
                                    loadUnmatched(
                                        unmatchedType,
                                        unmatchedPage + 1,
                                    )}>»</button
                            >
                        </div>
                    {/if}
                {:else}
                    <p class="text-xs text-base-content/50 mt-2">
                        No unmatched items of this type.
                    </p>
                {/if}
            {/if}

            <!-- Enrichment Progress -->
            {#if enrichRunning || enrichLogs.length > 0}
                {#if enrichProgress.total > 0}
                    <div class="mt-2">
                        <div class="flex justify-between text-xs mb-1">
                            <span>🔍 Enriching...</span>
                            <span
                                >{enrichProgress.done}/{enrichProgress.total}</span
                            >
                        </div>
                        <progress
                            class="progress progress-primary w-full"
                            value={enrichProgress.done}
                            max={enrichProgress.total}
                        ></progress>
                    </div>
                {/if}
                <LogConsole
                    logs={enrichLogs}
                    running={enrichRunning}
                    title="Enrichment Log"
                    height="h-48"
                />
            {/if}
        </div>
    </div>

    <!-- Diff Report -->
    {#if diff || latestRun?.diff_summary}
        {@const d = diff || latestRun?.diff_summary}
        <div class="card bg-base-200/50 border border-base-300">
            <div class="card-body">
                <div class="flex items-center justify-between">
                    <h3 class="font-semibold text-sm">📊 Diff Report</h3>
                    <button
                        class="btn btn-ghost btn-xs"
                        onclick={() => (showDiff = !showDiff)}
                    >
                        {showDiff ? "Hide" : "Show"} Details
                    </button>
                </div>

                <!-- Summary cards -->
                <div class="grid grid-cols-5 gap-2 text-center text-xs mt-2">
                    <div class="bg-base-300/50 rounded p-2">
                        <div class="font-mono text-lg">{d.changed || 0}</div>
                        <div class="text-base-content/50">Changed</div>
                    </div>
                    <div class="bg-success/10 rounded p-2">
                        <div class="font-mono text-lg text-success">
                            {d.improved || 0}
                        </div>
                        <div class="text-base-content/50">Improved</div>
                    </div>
                    <div class="bg-error/10 rounded p-2">
                        <div class="font-mono text-lg text-error">
                            {d.degraded || 0}
                        </div>
                        <div class="text-base-content/50">Degraded</div>
                    </div>
                    <div class="bg-info/10 rounded p-2">
                        <div class="font-mono text-lg text-info">
                            {d.newMatches || 0}
                        </div>
                        <div class="text-base-content/50">New</div>
                    </div>
                    <div class="bg-base-300/30 rounded p-2">
                        <div class="font-mono text-lg text-base-content/60">
                            {d.consolidatedAway || 0}
                        </div>
                        <div class="text-base-content/50">Consolidated</div>
                    </div>
                </div>

                {#if showDiff}
                    <div class="mt-3 space-y-2">
                        <!-- Filters + Search -->
                        <div class="flex flex-wrap items-center gap-2">
                            <div class="flex gap-1">
                                {#each ["all", "improved", "degraded", "changed"] as filter}
                                    <button
                                        class="btn btn-xs"
                                        class:btn-primary={diffFilter ===
                                            filter}
                                        class:btn-ghost={diffFilter !== filter}
                                        onclick={() => (diffFilter = filter)}
                                    >
                                        {filter}
                                    </button>
                                {/each}
                            </div>
                            <input
                                type="text"
                                class="input input-xs input-bordered flex-1 min-w-[150px]"
                                placeholder="Search by artist/title..."
                                bind:value={diffSearchQuery}
                            />
                            <span class="text-xs text-base-content/50">
                                {filteredDetails.length} results
                            </span>
                        </div>

                        <!-- Table -->
                        {#if pagedDetails.length > 0}
                            <div class="overflow-x-auto">
                                <table class="table table-xs">
                                    <thead>
                                        <tr>
                                            <th class="w-16">Direction</th>
                                            <th>Old Match</th>
                                            <th>New Match</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {#each pagedDetails as item}
                                            <tr>
                                                <td>
                                                    {#if item.direction === "improved"}
                                                        <span
                                                            class="badge badge-success badge-xs"
                                                            >↑ improved</span
                                                        >
                                                    {:else if item.direction === "degraded"}
                                                        <span
                                                            class="badge badge-error badge-xs"
                                                            >↓ degraded</span
                                                        >
                                                    {:else}
                                                        <span
                                                            class="badge badge-warning badge-xs"
                                                            >~ changed</span
                                                        >
                                                    {/if}
                                                </td>
                                                <td class="text-xs"
                                                    >{item.oldParent}</td
                                                >
                                                <td class="text-xs"
                                                    >{item.newParent}</td
                                                >
                                            </tr>
                                        {/each}
                                    </tbody>
                                </table>
                            </div>

                            <!-- Pagination -->
                            {#if totalFilteredPages > 1}
                                <div
                                    class="flex items-center justify-center gap-2 mt-2"
                                >
                                    <button
                                        class="btn btn-xs btn-ghost"
                                        disabled={diffPage === 0}
                                        onclick={() => diffPage--}
                                    >
                                        ← Prev
                                    </button>
                                    <span class="text-xs text-base-content/60">
                                        Page {diffPage + 1} of {totalFilteredPages}
                                    </span>
                                    <button
                                        class="btn btn-xs btn-ghost"
                                        disabled={diffPage >=
                                            totalFilteredPages - 1}
                                        onclick={() => diffPage++}
                                    >
                                        Next →
                                    </button>
                                </div>
                            {/if}
                        {:else}
                            <p
                                class="text-xs text-base-content/40 text-center py-4"
                            >
                                No results match your filter.
                            </p>
                        {/if}
                    </div>
                {/if}
            </div>
        </div>
    {/if}

    <!-- Latest Run Info -->
    {#if latestRun && !running}
        <div class="card bg-base-200/50 border border-base-300">
            <div class="card-body py-3">
                <h3 class="font-semibold text-sm">Last Run</h3>
                <div class="text-xs text-base-content/60 space-y-1">
                    <div>
                        Status: <span
                            class="badge badge-xs"
                            class:badge-success={latestRun.status ===
                                "completed"}
                            class:badge-error={latestRun.status === "failed"}
                            >{latestRun.status}</span
                        >
                    </div>
                    <div>
                        Started: {new Date(
                            latestRun.started_at,
                        ).toLocaleString()}
                    </div>
                    {#if latestRun.finished_at}
                        <div>
                            Finished: {new Date(
                                latestRun.finished_at,
                            ).toLocaleString()}
                        </div>
                    {/if}
                </div>
            </div>
        </div>
    {/if}
</div>
