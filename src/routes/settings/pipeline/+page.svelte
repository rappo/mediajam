<script>
    import LogConsole from "$lib/components/LogConsole.svelte";

    /** Pipeline state */
    let loading = $state(true);
    let pipelineEnabled = $state(false);
    let nightlyTime = $state('02:00');
    let nightlyDays = $state(['monday','tuesday','wednesday','thursday','friday','saturday','sunday']);
    let weeklyDay = $state('sunday');
    let weeklyTime = $state('03:00');
    /** @type {Record<string, {nightly: boolean, weekly: boolean}>} */
    let phaseFlags = $state({});
    /** @type {Array<{id: string, label: string, schedule: string}>} */
    let phases = $state([]);
    let running = $state(false);
    let currentPhase = $state('');

    /** Console state */
    /** @type {Array<{time: string, message: string, type: string}>} */
    let logs = $state([]);
    let runMode = $state('nightly');

    /** Settings dirty state */
    let saving = $state(false);
    let saveMsg = $state('');

    /** Run history */
    /** @type {any[]} */
    let history = $state([]);
    let historyLoading = $state(false);
    /** @type {number|null} */
    let expandedRunId = $state(null);
    /** @type {any|null} */
    let expandedRunDetail = $state(null);
    let detailLoading = $state(false);

    const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const DAY_LABELS = [
        { id: 'sunday',    short: 'S' },
        { id: 'monday',    short: 'M' },
        { id: 'tuesday',   short: 'T' },
        { id: 'wednesday', short: 'W' },
        { id: 'thursday',  short: 'T' },
        { id: 'friday',    short: 'F' },
        { id: 'saturday',  short: 'S' },
    ];

    /** Fetch current status + settings on mount */
    async function loadStatus() {
        try {
            const res = await fetch('/api/pipeline');
            if (res.ok) {
                const data = await res.json();
                pipelineEnabled = data.pipelineEnabled ?? false;
                nightlyTime = data.nightlyTime || '02:00';
                nightlyDays = data.nightlyDays || ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
                weeklyDay = data.weeklyDay || 'sunday';
                weeklyTime = data.weeklyTime || '03:00';
                phases = data.phases || [];
                running = data.running ?? false;
                currentPhase = data.currentPhase || '';

                // Normalise phaseFlags: migrate legacy boolean format to {nightly, weekly}
                const rawFlags = data.phaseFlags || {};
                /** @type {Record<string, {nightly: boolean, weekly: boolean}>} */
                const normalised = {};
                for (const phase of phases) {
                    const flag = rawFlags[phase.id];
                    if (flag !== undefined && typeof flag === 'object' && flag !== null) {
                        normalised[phase.id] = { nightly: !!flag.nightly, weekly: !!flag.weekly };
                    } else if (flag === false) {
                        // Legacy disabled — off for both
                        normalised[phase.id] = { nightly: false, weekly: false };
                    } else {
                        // Legacy true or undefined — use defaults
                        // Default: nightly phases → nightly on, weekly phases → weekly on
                        // Per user request: weekly column ALL checked by default
                        normalised[phase.id] = {
                            nightly: phase.schedule === 'nightly',
                            weekly: true,
                        };
                    }
                }
                phaseFlags = normalised;
            }
        } catch { /* ignore */ }
        loading = false;
        loadHistory();
    }

    /** Fetch run history */
    async function loadHistory() {
        historyLoading = true;
        try {
            const res = await fetch('/api/pipeline/history');
            if (res.ok) {
                const data = await res.json();
                history = data.history || [];
            }
        } catch { /* ignore */ }
        historyLoading = false;
    }

    /** Load run detail (phase results) */
    async function toggleRunDetail(/** @type {number} */ id) {
        if (expandedRunId === id) {
            expandedRunId = null;
            expandedRunDetail = null;
            return;
        }
        expandedRunId = id;
        expandedRunDetail = null;
        detailLoading = true;
        try {
            const res = await fetch(`/api/pipeline/history/${id}`);
            if (res.ok) {
                expandedRunDetail = await res.json();
            }
        } catch { /* ignore */ }
        detailLoading = false;
    }

    // Initialize on mount
    $effect(() => { loadStatus(); });

    /** Save settings */
    async function saveSettings() {
        saving = true;
        saveMsg = '';
        try {
            const res = await fetch('/api/pipeline', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pipelineEnabled, nightlyTime, nightlyDays, weeklyDay, weeklyTime, phaseFlags })
            });
            const data = await res.json();
            if (res.ok) {
                saveMsg = 'Settings saved';
                setTimeout(() => saveMsg = '', 3000);
            } else {
                saveMsg = data.error || 'Save failed';
            }
        } catch {
            saveMsg = 'Network error';
        }
        saving = false;
    }

    /** Run pipeline with SSE streaming */
    async function runPipeline() {
        if (running) return;
        running = true;
        logs = [{ time: now(), message: `Starting ${runMode} pipeline...`, type: 'info' }];

        try {
            const res = await fetch('/api/pipeline', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mode: runMode })
            });

            if (!res.ok) {
                const err = await res.json();
                addLog(err.error || 'Failed to start pipeline', 'error');
                running = false;
                return;
            }

            const reader = res.body?.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (reader) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });

                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (!line.startsWith('data: ')) continue;
                    try {
                        const event = JSON.parse(line.slice(6));
                        handleEvent(event);
                    } catch { /* skip malformed */ }
                }
            }
        } catch (e) {
            addLog(`Connection error: ${e instanceof Error ? e.message : String(e)}`, 'error');
        }

        running = false;
        currentPhase = '';
        // Refresh history after run completes
        loadHistory();
    }

    /** Stop a running pipeline */
    async function stopPipelineRun() {
        try {
            await fetch('/api/pipeline', { method: 'DELETE' });
            addLog('Pipeline stop requested', 'warning');
        } catch { /* ignore */ }
    }

    /** Handle SSE pipeline events */
    function handleEvent(/** @type {any} */ event) {
        switch (event.type) {
            case 'pipeline_start':
                addLog(`Pipeline started (${event.mode}, ${event.totalPhases} phases)`, 'info');
                break;
            case 'phase_start':
                currentPhase = event.message || event.phase;
                addLog(`▶ Phase ${(event.phaseIndex ?? 0) + 1}/${event.totalPhases}: ${event.message}`, 'info');
                break;
            case 'phase_end':
                addLog(`✓ ${event.message} (${formatDuration(event.duration)})`, 'success');
                break;
            case 'phase_skip':
                addLog(`⊘ ${event.phase}: ${event.message}`, 'warning');
                break;
            case 'phase_error':
                addLog(`✗ ${event.phase}: ${event.error} (${formatDuration(event.duration)})`, 'error');
                break;
            case 'phase_progress':
                addLog(`  ↳ ${event.message}`, 'info');
                break;
            case 'pipeline_end':
                addLog(`✓ Pipeline complete — ${event.message}`, 'success');
                break;
            case 'result':
                if (event.results) {
                    for (const r of event.results) {
                        if (r.status === 'done') {
                            addLog(`  ${r.phase}: ${r.message} (${formatDuration(r.durationMs)})`, 'info');
                        }
                    }
                }
                break;
            case 'error':
                addLog(`Pipeline error: ${event.error}`, 'error');
                break;
        }
    }

    function addLog(/** @type {string} */message, /** @type {string} */type = 'info') {
        logs = [...logs, { time: now(), message, type }];
    }

    function now() {
        return new Date().toLocaleTimeString();
    }

    /**
     * @param {number|null|undefined} ms
     * @returns {string}
     */
    function formatDuration(ms) {
        if (!ms) return '0s';
        if (ms < 1000) return `${ms}ms`;
        const s = Math.round(ms / 1000);
        if (s < 60) return `${s}s`;
        const m = Math.floor(s / 60);
        if (m < 60) return `${m}m ${s % 60}s`;
        const h = Math.floor(m / 60);
        return `${h}h ${m % 60}m`;
    }

    /**
     * @param {string|null|undefined} dateStr
     * @returns {string}
     */
    function formatDate(dateStr) {
        if (!dateStr) return '—';
        const d = new Date(dateStr.endsWith('Z') || dateStr.includes('+') ? dateStr : dateStr + 'Z');
        if (isNaN(d.getTime())) return '—';
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
            ' ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    }

    /**
     * @param {string|null|undefined} dateStr
     * @returns {string}
     */
    function timeAgo(dateStr) {
        if (!dateStr) return '';
        const d = new Date(dateStr.endsWith('Z') || dateStr.includes('+') ? dateStr : dateStr + 'Z');
        if (isNaN(d.getTime())) return '';
        const now = new Date();
        const diffMs = now.getTime() - d.getTime();
        const diffMin = Math.floor(diffMs / 60000);
        if (diffMin < 1) return 'just now';
        if (diffMin < 60) return `${diffMin}m ago`;
        const diffHr = Math.floor(diffMin / 60);
        if (diffHr < 24) return `${diffHr}h ago`;
        const diffDay = Math.floor(diffHr / 24);
        if (diffDay < 7) return `${diffDay}d ago`;
        return `${Math.floor(diffDay / 7)}w ago`;
    }

    /** Toggle nightly day */
    function toggleNightlyDay(/** @type {string} */ day) {
        if (nightlyDays.includes(day)) {
            nightlyDays = nightlyDays.filter(d => d !== day);
        } else {
            nightlyDays = [...nightlyDays, day];
        }
    }

    /** Toggle a specific phase nightly/weekly flag */
    function togglePhaseFlag(/** @type {string} */ id, /** @type {'nightly'|'weekly'} */ mode) {
        const current = phaseFlags[id] || { nightly: false, weekly: false };
        phaseFlags = { ...phaseFlags, [id]: { ...current, [mode]: !current[mode] } };
    }

    /** Check if a phase is completely disabled */
    function isPhaseDisabled(/** @type {string} */ id) {
        const f = phaseFlags[id];
        return f && !f.nightly && !f.weekly;
    }

    /** Status badge styling */
    function statusBadge(/** @type {string} */ status) {
        switch (status) {
            case 'completed': return { class: 'badge-success', label: '✓ Completed' };
            case 'completed_with_errors': return { class: 'badge-warning', label: '⚠ Errors' };
            case 'running': return { class: 'badge-info', label: '⟳ Running' };
            default: return { class: 'badge-ghost', label: status };
        }
    }

    /** Phase result icon */
    function phaseIcon(/** @type {string} */ status) {
        switch (status) {
            case 'done': return { icon: '✓', class: 'text-success' };
            case 'error': return { icon: '✗', class: 'text-error' };
            case 'skipped': return { icon: '⊘', class: 'text-warning' };
            default: return { icon: '?', class: 'text-base-content/40' };
        }
    }
</script>

<svelte:head>
    <title>Pipeline — Mediajam</title>
</svelte:head>

<div class="space-y-6">
    <div>
        <h2 class="text-2xl font-bold">Pipeline</h2>
        <p class="text-sm text-base-content/60 mt-1">Configure and run the nightly/weekly data pipeline</p>
    </div>

    {#if loading}
        <div class="flex justify-center p-8">
            <span class="loading loading-spinner loading-lg"></span>
        </div>
    {:else}
        <!-- ── Schedule Settings ──────────────────────────────────── -->
        <div class="card bg-base-200 shadow-sm">
            <div class="card-body gap-4">
                <h3 class="card-title text-lg">Schedule</h3>

                <label class="flex items-center gap-3 cursor-pointer">
                    <input type="checkbox" class="toggle toggle-primary" bind:checked={pipelineEnabled} />
                    <span class="font-medium">Enable automatic pipeline</span>
                </label>

                {#if pipelineEnabled}
                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-6 pl-1">
                        <!-- Nightly -->
                        <div class="space-y-3">
                            <div class="flex items-center gap-2">
                                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-info" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>
                                <span class="font-medium text-sm">Nightly</span>
                            </div>
                            <div class="form-control">
                                <label class="label py-0" for="nightly-time">
                                    <span class="label-text text-xs text-base-content/50">Run time</span>
                                </label>
                                <input id="nightly-time" type="time" class="input input-bordered input-sm w-32" bind:value={nightlyTime} />
                            </div>
                            <div>
                                <span class="label-text text-xs text-base-content/50">Active days</span>
                                <div class="flex gap-1.5 mt-1">
                                    {#each DAY_LABELS as day}
                                        <button
                                            class="w-8 h-8 rounded-full text-xs font-semibold transition-all
                                                {nightlyDays.includes(day.id) ? 'bg-primary text-primary-content' : 'bg-base-300 text-base-content/40 hover:bg-base-300/80'}"
                                            onclick={() => toggleNightlyDay(day.id)}
                                        >{day.short}</button>
                                    {/each}
                                </div>
                            </div>
                        </div>

                        <!-- Weekly -->
                        <div class="space-y-3">
                            <div class="flex items-center gap-2">
                                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-secondary" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                                <span class="font-medium text-sm">Weekly</span>
                            </div>
                            <div class="form-control">
                                <label class="label py-0" for="weekly-day">
                                    <span class="label-text text-xs text-base-content/50">Day & time</span>
                                </label>
                                <div class="flex gap-2">
                                    <select id="weekly-day" class="select select-bordered select-sm" bind:value={weeklyDay}>
                                        {#each WEEKDAYS as day}
                                            <option value={day}>{day.charAt(0).toUpperCase() + day.slice(1)}</option>
                                        {/each}
                                    </select>
                                    <input type="time" class="input input-bordered input-sm w-32" bind:value={weeklyTime} />
                                </div>
                            </div>
                        </div>
                    </div>
                {/if}

                <div class="flex items-center gap-2 mt-2">
                    <button class="btn btn-primary btn-sm" onclick={saveSettings} disabled={saving}>
                        {#if saving}
                            <span class="loading loading-spinner loading-xs"></span>
                        {:else}
                            Save Schedule
                        {/if}
                    </button>
                    {#if saveMsg}
                        <span class="text-sm text-success">{saveMsg}</span>
                    {/if}
                </div>
            </div>
        </div>

        <!-- ── Phases ─────────────────────────────────────────────── -->
        <div class="card bg-base-200 shadow-sm">
            <div class="card-body gap-3">
                <h3 class="card-title text-lg">Phases</h3>
                <p class="text-xs text-base-content/50">Choose which phases run on each schedule. Uncheck both to disable.</p>

                <div class="overflow-x-auto">
                    <table class="table table-sm w-full">
                        <thead>
                            <tr class="text-base-content/60">
                                <th class="font-medium">Phase</th>
                                <th class="text-center w-24 font-medium">
                                    <div class="flex items-center justify-center gap-1.5">
                                        <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5 text-info" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>
                                        Nightly
                                    </div>
                                </th>
                                <th class="text-center w-24 font-medium">
                                    <div class="flex items-center justify-center gap-1.5">
                                        <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5 text-secondary" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                                        Weekly
                                    </div>
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            {#each phases as phase}
                                {@const flags = phaseFlags[phase.id] || { nightly: false, weekly: false }}
                                {@const disabled = !flags.nightly && !flags.weekly}
                                <tr class={disabled ? 'opacity-40' : ''}>
                                    <td>
                                        <span class="text-sm font-medium">{phase.label}</span>
                                    </td>
                                    <td class="text-center">
                                        <input
                                            type="checkbox"
                                            class="checkbox checkbox-sm checkbox-info"
                                            checked={flags.nightly}
                                            onchange={() => togglePhaseFlag(phase.id, 'nightly')}
                                        />
                                    </td>
                                    <td class="text-center">
                                        <input
                                            type="checkbox"
                                            class="checkbox checkbox-sm checkbox-secondary"
                                            checked={flags.weekly}
                                            onchange={() => togglePhaseFlag(phase.id, 'weekly')}
                                        />
                                    </td>
                                </tr>
                            {/each}
                        </tbody>
                    </table>
                </div>

                <button class="btn btn-primary btn-sm w-fit mt-1" onclick={saveSettings} disabled={saving}>
                    Save Phases
                </button>
            </div>
        </div>

        <!-- ── Run Pipeline ───────────────────────────────────────── -->
        <div class="card bg-base-200 shadow-sm">
            <div class="card-body gap-4">
                <h3 class="card-title text-lg">Run Pipeline</h3>

                <div class="flex flex-wrap items-end gap-4">
                    <div class="form-control">
                        <label class="label" for="run-mode">
                            <span class="label-text">Mode</span>
                        </label>
                        <select id="run-mode" class="select select-bordered select-sm" bind:value={runMode} disabled={running}>
                            <option value="nightly">Nightly (fast phases)</option>
                            <option value="weekly">Weekly (all phases)</option>
                        </select>
                    </div>


                    <div class="flex gap-2">
                        {#if running}
                            <button class="btn btn-error btn-sm" onclick={stopPipelineRun}>
                                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="1"/></svg>
                                Stop
                            </button>
                        {:else}
                            <button class="btn btn-primary btn-sm" onclick={runPipeline}>
                                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                                Run Now
                            </button>
                        {/if}
                    </div>
                </div>

                {#if running && currentPhase}
                    <div class="flex items-center gap-2 text-sm text-base-content/70">
                        <span class="loading loading-spinner loading-xs"></span>
                        <span>Running: <strong>{currentPhase}</strong></span>
                    </div>
                {/if}

                <!-- Console -->
                <LogConsole {logs} {running} title="Pipeline Console" height="h-80" />
            </div>
        </div>

        <!-- ── Run History ────────────────────────────────────────── -->
        <div class="card bg-base-200 shadow-sm">
            <div class="card-body gap-4">
                <div class="flex items-center justify-between">
                    <h3 class="card-title text-lg">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-info" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                        </svg>
                        Run History
                    </h3>
                    <button class="btn btn-ghost btn-xs" onclick={loadHistory} disabled={historyLoading}>
                        {#if historyLoading}
                            <span class="loading loading-spinner loading-xs"></span>
                        {:else}
                            Refresh
                        {/if}
                    </button>
                </div>

                {#if history.length === 0}
                    <div class="text-center py-6 text-base-content/40">
                        <p class="text-sm">No pipeline runs yet</p>
                        <p class="text-xs mt-1">Run the pipeline above to see results here</p>
                    </div>
                {:else}
                    <div class="space-y-2">
                        {#each history as run}
                            {@const badge = statusBadge(run.status)}
                            <div class="bg-base-300/40 rounded-lg overflow-hidden">
                                <!-- Run header (clickable) -->
                                <button
                                    class="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-base-300/60 transition-colors"
                                    onclick={() => toggleRunDetail(run.id)}
                                >
                                    <svg
                                        xmlns="http://www.w3.org/2000/svg"
                                        class="h-3.5 w-3.5 text-base-content/40 transition-transform shrink-0 {expandedRunId === run.id ? 'rotate-90' : ''}"
                                        viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                                    >
                                        <polyline points="9 18 15 12 9 6"/>
                                    </svg>

                                    <div class="flex-1 min-w-0 flex items-center gap-3 flex-wrap">
                                        <span class="badge badge-xs {badge.class}">{badge.label}</span>
                                        <span class="badge badge-xs badge-outline">{run.mode}</span>
                                        <span class="text-sm">{formatDate(run.started_at)}</span>
                                        <span class="text-xs text-base-content/40">{timeAgo(run.started_at)}</span>
                                    </div>

                                    <div class="flex items-center gap-3 text-xs text-base-content/50 shrink-0">
                                        {#if run.duration_ms}
                                            <span>{formatDuration(run.duration_ms)}</span>
                                        {/if}
                                        {#if run.summary}
                                            <span class="hidden sm:inline">{run.summary}</span>
                                        {/if}
                                    </div>
                                </button>

                                <!-- Expanded detail -->
                                {#if expandedRunId === run.id}
                                    <div class="px-4 pb-4 border-t border-base-300/60">
                                        {#if detailLoading}
                                            <div class="flex justify-center py-4">
                                                <span class="loading loading-spinner loading-sm"></span>
                                            </div>
                                        {:else if expandedRunDetail?.phase_results}
                                            <div class="mt-3 space-y-1.5">
                                                {#each expandedRunDetail.phase_results as result}
                                                    {@const icon = phaseIcon(result.status)}
                                                    <div class="flex items-start gap-2 px-2 py-1.5 rounded {result.status === 'error' ? 'bg-error/5' : ''}">
                                                        <span class="text-sm {icon.class} shrink-0 mt-0.5">{icon.icon}</span>
                                                        <div class="flex-1 min-w-0">
                                                            <span class="text-sm font-medium">{result.phase}</span>
                                                            <span class="text-xs text-base-content/50 ml-2">{formatDuration(result.durationMs)}</span>
                                                            <div class="text-xs text-base-content/60 mt-0.5 break-words">{result.message}</div>
                                                        </div>
                                                    </div>
                                                {/each}
                                            </div>
                                        {:else}
                                            <p class="text-sm text-base-content/40 py-3">No detail available for this run</p>
                                        {/if}
                                    </div>
                                {/if}
                            </div>
                        {/each}
                    </div>
                {/if}
            </div>
        </div>
    {/if}
</div>
