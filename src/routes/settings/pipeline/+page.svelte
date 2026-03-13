<script>
    import LogConsole from "$lib/components/LogConsole.svelte";

    /** Pipeline state */
    let loading = $state(true);
    let pipelineEnabled = $state(false);
    let nightlyTime = $state('02:00');
    let weeklyDay = $state('sunday');
    let weeklyTime = $state('03:00');
    /** @type {Record<string, boolean>} */
    let phaseFlags = $state({});
    /** @type {Array<{id: string, label: string, schedule: string}>} */
    let phases = $state([]);
    let running = $state(false);
    let currentPhase = $state('');

    /** Console state */
    /** @type {Array<{time: string, message: string, type: string}>} */
    let logs = $state([]);
    let runMode = $state('nightly');
    let auditSnapshot = $state(false);

    /** Settings dirty state */
    let saving = $state(false);
    let saveMsg = $state('');

    const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

    /** Fetch current status + settings on mount */
    async function loadStatus() {
        try {
            const res = await fetch('/api/pipeline');
            if (res.ok) {
                const data = await res.json();
                pipelineEnabled = data.pipelineEnabled ?? false;
                nightlyTime = data.nightlyTime || '02:00';
                weeklyDay = data.weeklyDay || 'sunday';
                weeklyTime = data.weeklyTime || '03:00';
                phaseFlags = data.phaseFlags || {};
                phases = data.phases || [];
                running = data.running ?? false;
                currentPhase = data.currentPhase || '';
            }
        } catch { /* ignore */ }
        loading = false;
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
                body: JSON.stringify({ pipelineEnabled, nightlyTime, weeklyDay, weeklyTime, phaseFlags })
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
                body: JSON.stringify({ mode: runMode, audit: auditSnapshot })
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
    }

    /** Stop a running pipeline */
    async function stopPipelineRun() {
        try {
            await fetch('/api/pipeline', { method: 'DELETE' });
            addLog('Pipeline stop requested', 'warning');
        } catch { /* ignore */ }
    }

    /** Handle SSE pipeline events */
    function handleEvent(event) {
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

    function addLog(message, type = 'info') {
        logs = [...logs, { time: now(), message, type }];
    }

    function now() {
        return new Date().toLocaleTimeString();
    }

    function formatDuration(ms) {
        if (!ms) return '0s';
        if (ms < 1000) return `${ms}ms`;
        const s = Math.round(ms / 1000);
        if (s < 60) return `${s}s`;
        return `${Math.floor(s / 60)}m ${s % 60}s`;
    }

    /** Toggle a specific phase */
    function togglePhase(id) {
        phaseFlags = { ...phaseFlags, [id]: !(phaseFlags[id] ?? true) };
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
                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 pl-1">
                        <div class="form-control">
                            <label class="label" for="nightly-time">
                                <span class="label-text">Nightly run time</span>
                            </label>
                            <input id="nightly-time" type="time" class="input input-bordered input-sm w-40" bind:value={nightlyTime} />
                        </div>

                        <div class="form-control">
                            <label class="label" for="weekly-day">
                                <span class="label-text">Weekly run</span>
                            </label>
                            <div class="flex gap-2">
                                <select id="weekly-day" class="select select-bordered select-sm" bind:value={weeklyDay}>
                                    {#each WEEKDAYS as day}
                                        <option value={day}>{day.charAt(0).toUpperCase() + day.slice(1)}</option>
                                    {/each}
                                </select>
                                <input type="time" class="input input-bordered input-sm w-40" bind:value={weeklyTime} />
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
                <p class="text-xs text-base-content/50">Toggle which phases run in the pipeline</p>

                <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {#each phases as phase}
                        <label class="flex items-center gap-2.5 py-1.5 px-2 rounded-lg hover:bg-base-300 cursor-pointer transition-colors">
                            <input
                                type="checkbox"
                                class="checkbox checkbox-sm checkbox-primary"
                                checked={phaseFlags[phase.id] ?? true}
                                onchange={() => togglePhase(phase.id)}
                            />
                            <div class="flex-1 min-w-0">
                                <span class="text-sm font-medium">{phase.label}</span>
                                <span class="badge badge-xs badge-ghost ml-1.5 opacity-60">{phase.schedule}</span>
                            </div>
                        </label>
                    {/each}
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

                    <label class="flex items-center gap-2 cursor-pointer pb-0.5">
                        <input type="checkbox" class="checkbox checkbox-sm" bind:checked={auditSnapshot} disabled={running} />
                        <span class="text-sm">Take audit snapshots</span>
                    </label>

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
    {/if}
</div>
