<script>
    import { page } from '$app/stores';
    import { invalidateAll } from '$app/navigation';
    import LogConsole from '$lib/components/LogConsole.svelte';
    import ServiceIcon from '$lib/components/ServiceIcon.svelte';
    import MdiIcon from '$lib/components/MdiIcon.svelte';
    import { mdiCheckCircle, mdiCloseCircle, mdiKey, mdiLinkVariant, mdiChartBar, mdiPackageVariant, mdiBrain, mdiSync, mdiChevronDown, mdiPartyPopper, mdiHandWave, mdiMagnify, mdiLanConnect, mdiRocketLaunch, mdiCheck } from '@mdi/js';

    /** @type {{ data: import('./$types').PageData }} */
    let { data } = $props();

    // Section completion state (persisted in localStorage)
    const STORAGE_KEY = 'mediajam_welcome_sections';

    function loadCompleted() {
        try {
            return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
        } catch { return {}; }
    }

    let completed = $state(loadCompleted());

    function markComplete(section) {
        completed = { ...completed, [section]: true };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(completed));
    }

    const SECTIONS = ['apiKeys', 'integrations', 'history', 'arr', 'llm', 'finalSync'];
    let allComplete = $derived(SECTIONS.every(s => completed[s]));

    // Track expanded section (only one at a time, auto-open first incomplete)
    let expandedSection = $state(SECTIONS.find(s => !completed[s]) || null);

    // ─── Form State ──────────────────────────────────────────────────────────────
    // Destructure initial settings to avoid state_referenced_locally warnings
    // (these are form fields that intentionally capture initial values)
    // svelte-ignore state_referenced_locally
    const initialSettings = data.settings;

    // API Keys
    let tvdbApiKey = $state(initialSettings.tvdbApiKey || '');
    let tmdbApiKey = $state(initialSettings.tmdbApiKey || '');
    let musicbrainzApiKey = $state(initialSettings.musicbrainzApiKey || '');
    let omdbApiKey = $state(initialSettings.omdbApiKey || '');
    let discogsToken = $state(initialSettings.discogsToken || '');

    // Integrations
    let traktClientId = $state(initialSettings.traktClientId || '');
    let traktClientSecret = $state(initialSettings.traktClientSecret || '');
    let lastfmApiKey = $state(initialSettings.lastfmApiKey || '');
    let lastfmSharedSecret = $state(initialSettings.lastfmSharedSecret || '');

    // *arr
    let radarrUrl = $state(initialSettings.radarrUrl || '');
    let radarrApiKey = $state(initialSettings.radarrApiKey || '');
    let radarrExternalUrl = $state(initialSettings.radarrExternalUrl || '');
    let sonarrUrl = $state(initialSettings.sonarrUrl || '');
    let sonarrApiKey = $state(initialSettings.sonarrApiKey || '');
    let sonarrExternalUrl = $state(initialSettings.sonarrExternalUrl || '');
    let lidarrUrl = $state(initialSettings.lidarrUrl || '');
    let lidarrApiKey = $state(initialSettings.lidarrApiKey || '');
    let lidarrExternalUrl = $state(initialSettings.lidarrExternalUrl || '');

    // LLM
    let ollamaUrl = $state(initialSettings.ollamaUrl || '');
    let ollamaEmbedModel = $state(initialSettings.ollamaEmbedModel || 'nomic-embed-text');
    let ollamaChatModel = $state(initialSettings.ollamaChatModel || 'llama3.2:3b');

    // ─── Inline Validation ──────────────────────────────────────────────────────
    /** @type {Record<string, 'idle'|'checking'|'valid'|'error'>} */
    let validationStatus = $state({
        tmdb: initialSettings.tmdbApiKey ? 'valid' : 'idle',
        tvdb: initialSettings.tvdbApiKey ? 'valid' : 'idle',
        omdb: initialSettings.omdbApiKey ? 'valid' : 'idle',
        discogs: initialSettings.discogsToken ? 'valid' : 'idle',
        musicbrainz: initialSettings.musicbrainzApiKey ? 'valid' : 'idle',
        trakt: (initialSettings.traktClientId && initialSettings.traktClientSecret) ? 'valid' : 'idle',
        lastfm: (initialSettings.lastfmApiKey && initialSettings.lastfmSharedSecret) ? 'valid' : 'idle',
    });
    /** @type {Record<string, string>} */
    let validationMsg = $state({});
    /** @type {Record<string, any>} */
    let validationTimers = {};

    async function validateKey(service, credentials) {
        if (!credentials || Object.values(credentials).some(v => !v)) {
            validationStatus[service] = 'idle';
            return;
        }
        validationStatus[service] = 'checking';
        try {
            const res = await fetch('/api/settings/validate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ service, credentials }),
            });
            const result = await res.json();
            validationStatus[service] = result.valid ? 'valid' : 'error';
            validationMsg[service] = result.message || '';
        } catch {
            validationStatus[service] = 'error';
            validationMsg[service] = 'Connection error';
        }
    }

    function debouncedValidate(service, credentials, delay = 800) {
        if (validationTimers[service]) clearTimeout(validationTimers[service]);
        validationTimers[service] = setTimeout(() => validateKey(service, credentials), delay);
    }

    // MusicBrainz is just an app name, valid if non-empty
    function validateMusicBrainz(value) {
        validationStatus.musicbrainz = value.trim() ? 'valid' : 'idle';
    }

    // Auto-validate paired keys when both filled
    $effect(() => {
        // Read the reactive values
        const id = traktClientId;
        const secret = traktClientSecret;
        // Use untracked write to avoid infinite loop
        if (id && secret) {
            debouncedValidate('trakt', { trakt_client_id: id, trakt_client_secret: secret });
        } else {
            validationStatus.trakt = 'idle';
        }
    });
    $effect(() => {
        const key = lastfmApiKey;
        const secret = lastfmSharedSecret;
        if (key && secret) {
            debouncedValidate('lastfm', { lastfm_api_key: key, lastfm_shared_secret: secret });
        } else {
            validationStatus.lastfm = 'idle';
        }
    });

    // ─── *arr scan/test (reuses settings patterns) ──────────────────────────────
    const ARR_SERVICES = [
        { service: 'radarr', label: 'Radarr (movies)', defaultPort: 7878 },
        { service: 'sonarr', label: 'Sonarr (TV)', defaultPort: 8989 },
        { service: 'lidarr', label: 'Lidarr (music)', defaultPort: 8686 },
    ];
    let arrScanStatus = $state('idle');
    /** @type {Record<string, string>} */
    let arrTestStatus = $state({ radarr: 'idle', sonarr: 'idle', lidarr: 'idle' });
    /** @type {Record<string, string>} */
    let arrTestInfo = $state({ radarr: '', sonarr: '', lidarr: '' });

    async function scanForArr() {
        arrScanStatus = 'scanning';
        try {
            const res = await fetch('/api/arr/scan');
            const d = await res.json();
            if (d.found && d.instances?.length) {
                for (const inst of d.instances) {
                    if (inst.service === 'radarr' && !radarrUrl) radarrUrl = inst.url;
                    if (inst.service === 'sonarr' && !sonarrUrl) sonarrUrl = inst.url;
                    if (inst.service === 'lidarr' && !lidarrUrl) lidarrUrl = inst.url;
                    arrTestInfo[inst.service] = `Found at ${inst.url}${inst.needsAuth ? ' (needs API key)' : ''}`;
                }
            }
            arrScanStatus = 'done';
        } catch { arrScanStatus = 'done'; }
    }

    /** @param {string} service */
    async function testArrConnection(service) {
        arrTestStatus[service] = 'testing';
        arrTestInfo[service] = '';
        const url = service === 'radarr' ? radarrUrl : service === 'sonarr' ? sonarrUrl : lidarrUrl;
        const key = service === 'radarr' ? radarrApiKey : service === 'sonarr' ? sonarrApiKey : lidarrApiKey;
        if (!key) {
            arrTestStatus[service] = 'error';
            arrTestInfo[service] = 'Enter API key first';
            return;
        }
        try {
            const res = await fetch('/api/arr/test', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ service, url, apiKey: key }),
            });
            const result = await res.json();
            if (result.ok) {
                arrTestStatus[service] = 'ok';
                arrTestInfo[service] = `${result.name} v${result.version} — ${result.itemCount} items`;
            } else {
                arrTestStatus[service] = 'error';
                arrTestInfo[service] = 'Connection failed — check URL and API key';
            }
        } catch {
            arrTestStatus[service] = 'error';
            arrTestInfo[service] = 'Connection error';
        }
    }

    // ─── Ollama scan/test/models (reuses settings patterns) ─────────────────────
    let ollamaHealthStatus = $state('idle');
    /** @type {string[]} */
    let ollamaHealthModels = $state([]);
    let ollamaHealthError = $state('');
    let ollamaScanStatus = $state('idle');

    async function testOllamaConnection() {
        ollamaHealthStatus = 'checking';
        ollamaHealthError = '';
        try {
            const res = await fetch(`/api/ollama/health?url=${encodeURIComponent(ollamaUrl)}`);
            const d = await res.json();
            if (d.ok) {
                ollamaHealthStatus = 'ok';
                ollamaHealthModels = d.models || [];
                const embedModels = ollamaHealthModels.filter(m => /embed|minilm|bert/i.test(m));
                const genModels = ollamaHealthModels.filter(m => !/embed|minilm|bert/i.test(m));
                if (embedModels.length && !embedModels.includes(ollamaEmbedModel)) {
                    ollamaEmbedModel = embedModels.find(m => m.includes('nomic-embed')) || embedModels[0];
                }
                if (genModels.length && !genModels.includes(ollamaChatModel)) {
                    ollamaChatModel = genModels.find(m => m.includes('llama3.2')) || genModels[0];
                }
            } else {
                ollamaHealthStatus = 'error';
                ollamaHealthError = d.error || 'Connection failed';
            }
        } catch {
            ollamaHealthStatus = 'error';
            ollamaHealthError = 'Network error';
        }
    }

    async function scanForOllama() {
        ollamaScanStatus = 'scanning';
        try {
            const res = await fetch('/api/ollama/scan');
            const d = await res.json();
            if (d.found && d.instances?.length) {
                ollamaUrl = d.instances[0].url;
                ollamaScanStatus = 'found';
                await testOllamaConnection();
            } else {
                ollamaScanStatus = 'notfound';
            }
        } catch { ollamaScanStatus = 'notfound'; }
    }

    // ─── History Import (reuses account page pattern) ────────────────────────────
    let importState = $state({ active: false, tier: '', status: 'idle', logs: [], progressPercent: 0, totalImported: 0, totalSkipped: 0, eventSource: null });

    // Auto-sync toggle state
    // svelte-ignore state_referenced_locally
    const initialAutoSync = data.autoSync;
    let traktAutoSync = $state(initialAutoSync?.trakt || false);
    let lastfmAutoSync = $state(initialAutoSync?.lastfm || false);

    async function toggleAutoSync(provider, enabled) {
        try {
            await fetch('/api/auto-sync', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ provider, enabled }),
            });
        } catch { /* silent */ }
    }

    function addImportLog(message, type = 'info') {
        importState.logs = [...importState.logs.slice(-500), { time: new Date().toLocaleTimeString(), message, type }];
    }

    function connectImportSSE() {
        if (importState.eventSource) importState.eventSource.close();
        const es = new EventSource('/api/backfill/history');
        importState.eventSource = es;
        es.onmessage = (event) => {
            try {
                const d = JSON.parse(event.data);
                if (d.type === 'backfill_progress') {
                    if (d.progressPercent !== undefined) importState.progressPercent = d.progressPercent;
                    if (d.totalImported !== undefined) importState.totalImported = d.totalImported;
                    if (d.totalSkipped !== undefined) importState.totalSkipped = d.totalSkipped;
                } else if (d.type === 'backfill_complete') {
                    importState.status = 'complete';
                    importState.progressPercent = 100;
                    es.close();
                } else if (d.type === 'backfill_error') {
                    importState.status = 'error';
                    es.close();
                }
                if (d.log) addImportLog(d.log, d.logType || 'info');
            } catch { /* ignore */ }
        };
        es.onerror = () => { es.close(); };
    }

    async function startImport(tier) {
        importState = { active: true, tier, status: 'running', logs: [], progressPercent: 0, totalImported: 0, totalSkipped: 0, eventSource: null };
        addImportLog(`Starting ${tier} import...`, 'info');
        try {
            const res = await fetch('/api/backfill/history', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tier }),
            });
            const result = await res.json();
            if (!result.success) {
                addImportLog(result.error || 'Failed to start import.', 'error');
                importState.status = 'error';
                return;
            }
            connectImportSSE();
        } catch {
            addImportLog('Failed to start import.', 'error');
            importState.status = 'error';
        }
    }

    // ─── Save helpers ────────────────────────────────────────────────────────────
    let saving = $state(false);
    let saveError = $state('');

    async function saveSettings(fields) {
        saving = true;
        saveError = '';
        try {
            const res = await fetch('/api/settings', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(fields),
            });
            const result = await res.json();
            if (!result.success) {
                saveError = result.error || 'Failed to save settings.';
                saving = false;
                return false;
            }
            saving = false;
            return true;
        } catch (e) {
            saveError = e instanceof Error ? e.message : 'Save failed.';
            saving = false;
            return false;
        }
    }

    // ─── Section Actions ─────────────────────────────────────────────────────────

    async function saveApiKeys() {
        const ok = await saveSettings({
            tvdb_api_key: tvdbApiKey,
            tmdb_api_key: tmdbApiKey,
            musicbrainz_api_key: musicbrainzApiKey,
            omdb_api_key: omdbApiKey,
            discogs_token: discogsToken,
        });
        if (ok) {
            markComplete('apiKeys');
            expandedSection = SECTIONS.find(s => !completed[s] && s !== 'apiKeys') || null;
        }
    }

    async function saveIntegrations() {
        const ok = await saveSettings({
            trakt_client_id: traktClientId,
            trakt_client_secret: traktClientSecret,
            lastfm_api_key: lastfmApiKey,
            lastfm_shared_secret: lastfmSharedSecret,
        });
        if (ok) {
            markComplete('integrations');
            expandedSection = SECTIONS.find(s => !completed[s] && s !== 'integrations') || null;
        }
    }

    async function saveArr() {
        const ok = await saveSettings({
            radarr_url: radarrUrl,
            radarr_api_key: radarrApiKey,
            radarr_external_url: radarrExternalUrl,
            sonarr_url: sonarrUrl,
            sonarr_api_key: sonarrApiKey,
            sonarr_external_url: sonarrExternalUrl,
            lidarr_url: lidarrUrl,
            lidarr_api_key: lidarrApiKey,
            lidarr_external_url: lidarrExternalUrl,
        });
        if (ok) {
            markComplete('arr');
            expandedSection = SECTIONS.find(s => !completed[s] && s !== 'arr') || null;
        }
    }

    async function saveLLM() {
        const ok = await saveSettings({
            ollama_url: ollamaUrl,
            ollama_embed_model: ollamaEmbedModel,
            ollama_chat_model: ollamaChatModel,
        });
        if (ok) {
            markComplete('llm');
            expandedSection = SECTIONS.find(s => !completed[s] && s !== 'llm') || null;
        }
    }

    function skip(section) {
        markComplete(section);
        expandedSection = SECTIONS.find(s => !completed[s] && s !== section) || null;
    }

    // ─── Final Sync ──────────────────────────────────────────────────────────────
    let finalSyncStatus = $state('idle'); // idle | syncing | complete | error
    let finalSyncLogs = $state([]);
    let finalSyncStep = $state(''); // Current step description

    function addFinalLog(message, type = 'info') {
        const timestamp = new Date().toLocaleTimeString();
        finalSyncLogs = [...finalSyncLogs, { timestamp, message, type }];
    }

    async function runFinalSync() {
        finalSyncStatus = 'syncing';
        finalSyncLogs = [];

        try {
            // Step 1: Incremental Jellyfin sync
            finalSyncStep = 'Syncing Jellyfin libraries...';
            addFinalLog('Starting incremental Jellyfin sync...');
            const syncRes = await fetch('/api/sync', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'start' }),
            });
            if (syncRes.ok) {
                addFinalLog('Jellyfin sync started. Waiting for completion...');
                // Wait for sync to finish by polling
                await waitForSyncComplete();
                addFinalLog('Jellyfin sync complete.', 'success');
            } else {
                addFinalLog('Jellyfin sync may already be running — continuing.', 'warning');
            }

            // Step 2: People enrichment (if never run and TMDB key exists)
            if (!data.hasPeopleSync && tmdbApiKey) {
                finalSyncStep = 'Enriching people data from TMDB...';
                addFinalLog('Starting people enrichment (first time)...');
                const peopleRes = await fetch('/api/sync/people', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'start' }),
                });
                if (peopleRes.ok) {
                    addFinalLog('People enrichment started. This may take a while...');
                    await waitForPeopleSyncComplete();
                    addFinalLog('People enrichment complete.', 'success');
                } else {
                    addFinalLog('People enrichment skipped (may already be running).', 'warning');
                }
            } else if (data.hasPeopleSync) {
                addFinalLog('People enrichment already done — skipping.', 'info');
            } else {
                addFinalLog('People enrichment skipped — no TMDB API key configured.', 'info');
            }

            // Step 3: MusicBrainz enrichment (if never run)
            if (!data.hasMusicBrainzSync) {
                finalSyncStep = 'Enriching music data from MusicBrainz...';
                addFinalLog('Starting MusicBrainz enrichment (first time)...');
                const mbRes = await fetch('/api/sync/musicbrainz', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'start' }),
                });
                if (mbRes.ok) {
                    addFinalLog('MusicBrainz enrichment started...');
                    await waitForMBSyncComplete();
                    addFinalLog('MusicBrainz enrichment complete.', 'success');
                } else {
                    addFinalLog('MusicBrainz enrichment skipped (may already be running).', 'warning');
                }
            } else {
                addFinalLog('MusicBrainz enrichment already done — skipping.', 'info');
            }

            // Step 4: Reconciliation (always last)
            finalSyncStep = 'Running data reconciliation...';
            addFinalLog('Starting reconciliation...');
            const reconRes = await fetch('/api/reconcile', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'start' }),
            });
            if (reconRes.ok) {
                addFinalLog('Reconciliation started...');
                // Just wait a bit — reconciliation runs in background
                await new Promise(r => setTimeout(r, 2000));
                addFinalLog('Reconciliation is running in the background.', 'success');
            } else {
                addFinalLog('Reconciliation may already be running.', 'warning');
            }

            finalSyncStep = 'All done!';
            finalSyncStatus = 'complete';
            addFinalLog('🎉 All sync steps completed!', 'success');
            markComplete('finalSync');
        } catch (e) {
            finalSyncStatus = 'error';
            addFinalLog('Error: ' + (e instanceof Error ? e.message : String(e)), 'error');
        }
    }

    async function waitForSyncComplete() {
        // Poll sync state for up to 5 minutes
        for (let i = 0; i < 60; i++) {
            await new Promise(r => setTimeout(r, 5000));
            try {
                const res = await fetch('/api/sync/status');
                if (res.ok) {
                    const status = await res.json();
                    if (status.status === 'idle' || status.status === 'complete') return;
                }
            } catch { /* continue polling */ }
        }
    }

    async function waitForPeopleSyncComplete() {
        for (let i = 0; i < 120; i++) {
            await new Promise(r => setTimeout(r, 5000));
            try {
                const res = await fetch('/api/sync/people/status');
                if (res.ok) {
                    const status = await res.json();
                    if (status.status === 'idle' || status.status === 'complete' || status.status === 'error') return;
                }
            } catch { /* continue polling */ }
        }
    }

    async function waitForMBSyncComplete() {
        for (let i = 0; i < 120; i++) {
            await new Promise(r => setTimeout(r, 5000));
            try {
                const res = await fetch('/api/sync/musicbrainz/status');
                if (res.ok) {
                    const status = await res.json();
                    if (status.status === 'idle' || status.status === 'complete' || status.status === 'error') return;
                }
            } catch { /* continue polling */ }
        }
    }

    async function finishWelcome() {
        await saveSettings({ welcome_complete: 1 });
        localStorage.removeItem(STORAGE_KEY);
        window.location.href = '/history';
    }
</script>

<svelte:head>
    <title>Welcome — Mediajam</title>
</svelte:head>

<div class="max-w-3xl mx-auto p-6 py-10">
    {#if allComplete}
        <!-- All done! -->
        <div class="text-center py-16 space-y-6">
            <div class="text-7xl"><MdiIcon icon={mdiPartyPopper} size={72} /></div>
            <h1 class="text-4xl font-extrabold tracking-tight bg-gradient-to-r from-primary via-secondary to-accent bg-clip-text text-transparent">
                You're all set!
            </h1>
            <p class="text-base-content/60 text-lg max-w-md mx-auto">
                Mediajam is configured and your data is syncing. Everything configured here can be changed later in Settings.
            </p>
            <button class="btn btn-primary btn-lg gap-2" onclick={finishWelcome}>
                <MdiIcon icon={mdiCheck} size={20} />
                Go to Mediajam
            </button>
        </div>
    {:else}
        <!-- Header -->
        <div class="mb-8">
            <h1 class="text-3xl font-bold flex items-center gap-3">
                <span class="text-3xl"><MdiIcon icon={mdiHandWave} size={30} /></span>
                Welcome to Mediajam
            </h1>
            <p class="text-base-content/60 text-sm mt-2">
                Your Jellyfin data is syncing in the background. Let's set up the rest — everything here is optional and can be changed later in Settings.
            </p>
            <div class="flex items-center gap-2 mt-4">
                <progress class="progress progress-primary flex-1" value={SECTIONS.filter(s => completed[s]).length} max={SECTIONS.length}></progress>
                <span class="text-xs text-base-content/40">{SECTIONS.filter(s => completed[s]).length}/{SECTIONS.length}</span>
            </div>
        </div>

        <div class="space-y-4">

            <!-- ═══ Section 1: API Keys ═══ -->
            <div class="card bg-base-200/50 border border-base-300 overflow-hidden">
                <button
                    class="w-full flex items-center gap-3 px-5 py-4 hover:bg-base-300/30 transition-colors text-left"
                    onclick={() => expandedSection = expandedSection === 'apiKeys' ? null : 'apiKeys'}
                >
                    {#if completed.apiKeys}
                        <span class="text-lg text-success"><MdiIcon icon={mdiCheckCircle} size={20} /></span>
                    {:else}
                        <span class="text-lg"><MdiIcon icon={mdiKey} size={20} /></span>
                    {/if}
                    <span class="font-medium flex-1">Metadata API Keys</span>
                    <span class="text-xs text-base-content/40">TVDB, TMDB, MusicBrainz, OMDb, Discogs</span>
                    <MdiIcon icon={mdiChevronDown} size={16} class="text-base-content/30 transition-transform {expandedSection === 'apiKeys' ? 'rotate-180' : ''}" />
                </button>

                {#if expandedSection === 'apiKeys'}
                    <div class="px-5 pb-5 space-y-3 border-t border-base-content/5 pt-4">
                        <p class="text-xs text-base-content/50">These keys enrich your media with posters, ratings, and metadata. They're free to obtain from each service's website.</p>

                        <div class="grid gap-3 sm:grid-cols-2">
                            <label class="form-control">
                                <div class="label py-1 flex items-center gap-1.5">
                                    <ServiceIcon service="tmdb" size="w-3.5 h-3.5" class="text-[#01B4E4]" />
                                    <span class="label-text text-xs">TMDB API Key</span>
                                    {#if validationStatus.tmdb === 'checking'}<span class="loading loading-spinner loading-xs text-info"></span>
                                    {:else if validationStatus.tmdb === 'valid'}<span class="text-success text-xs"><MdiIcon icon={mdiCheckCircle} size={14} /></span>
                                    {:else if validationStatus.tmdb === 'error'}<span class="text-error text-xs tooltip tooltip-right" data-tip={validationMsg.tmdb || 'Invalid'}><MdiIcon icon={mdiCloseCircle} size={14} /></span>{/if}
                                </div>
                                <input type="text" class="input input-sm input-bordered font-mono" placeholder="Enter key..." bind:value={tmdbApiKey} onblur={() => debouncedValidate('tmdb', { tmdb_api_key: tmdbApiKey }, 0)} />
                                <a href="https://www.themoviedb.org/settings/api" target="_blank" rel="noopener" class="link link-primary text-xs mt-1 inline-block">Get API key →</a>
                            </label>
                            <label class="form-control">
                                <div class="label py-1 flex items-center gap-1.5">
                                    <ServiceIcon service="tvdb" size="w-3.5 h-3.5" class="text-[#6CD491]" />
                                    <span class="label-text text-xs">TVDB API Key</span>
                                    {#if validationStatus.tvdb === 'checking'}<span class="loading loading-spinner loading-xs text-info"></span>
                                    {:else if validationStatus.tvdb === 'valid'}<span class="text-success text-xs"><MdiIcon icon={mdiCheckCircle} size={14} /></span>
                                    {:else if validationStatus.tvdb === 'error'}<span class="text-error text-xs tooltip tooltip-right" data-tip={validationMsg.tvdb || 'Invalid'}><MdiIcon icon={mdiCloseCircle} size={14} /></span>{/if}
                                </div>
                                <input type="text" class="input input-sm input-bordered font-mono" placeholder="Enter key..." bind:value={tvdbApiKey} onblur={() => debouncedValidate('tvdb', { tvdb_api_key: tvdbApiKey }, 0)} />
                                <a href="https://thetvdb.com/dashboard/account/apikey" target="_blank" rel="noopener" class="link link-primary text-xs mt-1 inline-block">Get API key →</a>
                            </label>
                            <label class="form-control">
                                <div class="label py-1 flex items-center gap-1.5">
                                    <ServiceIcon service="musicbrainz" size="w-3.5 h-3.5" class="text-[#BA478F]" />
                                    <span class="label-text text-xs">MusicBrainz App Name</span>
                                    {#if validationStatus.musicbrainz === 'valid'}<span class="text-success text-xs"><MdiIcon icon={mdiCheckCircle} size={14} /></span>{/if}
                                </div>
                                <input type="text" class="input input-sm input-bordered font-mono" placeholder="MyApp/1.0" bind:value={musicbrainzApiKey} onblur={() => validateMusicBrainz(musicbrainzApiKey)} />
                                <a href="https://musicbrainz.org/doc/MusicBrainz_API" target="_blank" rel="noopener" class="link link-primary text-xs mt-1 inline-block">Learn more →</a>
                            </label>
                            <label class="form-control">
                                <div class="label py-1 flex items-center gap-1.5">
                                    <ServiceIcon service="omdb" size="w-3.5 h-3.5" class="text-[#F5C518]" />
                                    <span class="label-text text-xs">OMDb API Key</span>
                                    {#if validationStatus.omdb === 'checking'}<span class="loading loading-spinner loading-xs text-info"></span>
                                    {:else if validationStatus.omdb === 'valid'}<span class="text-success text-xs"><MdiIcon icon={mdiCheckCircle} size={14} /></span>
                                    {:else if validationStatus.omdb === 'error'}<span class="text-error text-xs tooltip tooltip-right" data-tip={validationMsg.omdb || 'Invalid'}><MdiIcon icon={mdiCloseCircle} size={14} /></span>{/if}
                                </div>
                                <input type="text" class="input input-sm input-bordered font-mono" placeholder="Enter key..." bind:value={omdbApiKey} onblur={() => debouncedValidate('omdb', { omdb_api_key: omdbApiKey }, 0)} />
                                <a href="https://www.omdbapi.com/apikey.aspx" target="_blank" rel="noopener" class="link link-primary text-xs mt-1 inline-block">Get free API key →</a>
                            </label>
                            <label class="form-control sm:col-span-2">
                                <div class="label py-1 flex items-center gap-1.5">
                                    <ServiceIcon service="discogs" size="w-3.5 h-3.5" />
                                    <span class="label-text text-xs">Discogs Token</span>
                                    {#if validationStatus.discogs === 'checking'}<span class="loading loading-spinner loading-xs text-info"></span>
                                    {:else if validationStatus.discogs === 'valid'}<span class="text-success text-xs"><MdiIcon icon={mdiCheckCircle} size={14} /></span>
                                    {:else if validationStatus.discogs === 'error'}<span class="text-error text-xs tooltip tooltip-right" data-tip={validationMsg.discogs || 'Invalid'}><MdiIcon icon={mdiCloseCircle} size={14} /></span>{/if}
                                </div>
                                <input type="text" class="input input-sm input-bordered font-mono" placeholder="Enter token..." bind:value={discogsToken} onblur={() => debouncedValidate('discogs', { discogs_token: discogsToken }, 0)} />
                                <a href="https://www.discogs.com/settings/developers" target="_blank" rel="noopener" class="link link-primary text-xs mt-1 inline-block">Generate personal access token →</a>
                            </label>
                        </div>

                        {#if saveError}<p class="text-xs text-error">{saveError}</p>{/if}

                        <div class="flex gap-2 pt-1">
                            <button class="btn btn-primary btn-sm gap-1" onclick={saveApiKeys} disabled={saving}>
                                {#if saving}<span class="loading loading-spinner loading-xs"></span>{/if}
                                Save & Continue
                            </button>
                            <button class="btn btn-ghost btn-sm" onclick={() => skip('apiKeys')}>Skip for Now</button>
                        </div>
                    </div>
                {/if}
            </div>

            <!-- ═══ Section 2: Integrations ═══ -->
            <div class="card bg-base-200/50 border border-base-300 overflow-hidden">
                <button
                    class="w-full flex items-center gap-3 px-5 py-4 hover:bg-base-300/30 transition-colors text-left"
                    onclick={() => expandedSection = expandedSection === 'integrations' ? null : 'integrations'}
                >
                    {#if completed.integrations}
                        <span class="text-lg text-success"><MdiIcon icon={mdiCheckCircle} size={20} /></span>
                    {:else}
                        <span class="text-lg"><MdiIcon icon={mdiLinkVariant} size={20} /></span>
                    {/if}
                    <span class="font-medium flex-1">Integrations</span>
                    <span class="text-xs text-base-content/40">Trakt, Last.fm</span>
                    <MdiIcon icon={mdiChevronDown} size={16} class="text-base-content/30 transition-transform {expandedSection === 'integrations' ? 'rotate-180' : ''}" />
                </button>

                {#if expandedSection === 'integrations'}
                    <div class="px-5 pb-5 space-y-3 border-t border-base-content/5 pt-4">
                        <p class="text-xs text-base-content/50">Connect Trakt and Last.fm to import your watch & listen history. You can connect the accounts themselves after saving these keys, from Settings → Account.</p>

                        <h4 class="text-xs font-semibold text-base-content/70 pt-1 flex items-center gap-1.5">
                            <ServiceIcon service="trakt" size="w-3.5 h-3.5" class="text-[#ED1C24]" />
                            Trakt
                            {#if validationStatus.trakt === 'checking'}<span class="loading loading-spinner loading-xs text-info"></span>
                            {:else if validationStatus.trakt === 'valid'}<span class="text-success text-xs"><MdiIcon icon={mdiCheckCircle} size={14} /></span>
                            {:else if validationStatus.trakt === 'error'}<span class="text-error text-xs tooltip tooltip-right" data-tip={validationMsg.trakt || 'Invalid'}><MdiIcon icon={mdiCloseCircle} size={14} /></span>{/if}
                        </h4>
                        <div class="grid gap-3 sm:grid-cols-2">
                            <label class="form-control">
                                <div class="label py-1"><span class="label-text text-xs">Client ID</span></div>
                                <input type="text" class="input input-sm input-bordered font-mono" placeholder="Trakt Client ID" bind:value={traktClientId} />
                            </label>
                            <label class="form-control">
                                <div class="label py-1"><span class="label-text text-xs">Client Secret</span></div>
                                <input type="text" class="input input-sm input-bordered font-mono" placeholder="Trakt Client Secret" bind:value={traktClientSecret} />
                            </label>
                        </div>

                        <h4 class="text-xs font-semibold text-base-content/70 pt-1 flex items-center gap-1.5">
                            <ServiceIcon service="lastfm" size="w-3.5 h-3.5" class="text-[#D51007]" />
                            Last.fm
                            {#if validationStatus.lastfm === 'checking'}<span class="loading loading-spinner loading-xs text-info"></span>
                            {:else if validationStatus.lastfm === 'valid'}<span class="text-success text-xs"><MdiIcon icon={mdiCheckCircle} size={14} /></span>
                            {:else if validationStatus.lastfm === 'error'}<span class="text-error text-xs tooltip tooltip-right" data-tip={validationMsg.lastfm || 'Invalid'}><MdiIcon icon={mdiCloseCircle} size={14} /></span>{/if}
                        </h4>
                        <div class="grid gap-3 sm:grid-cols-2">
                            <label class="form-control">
                                <div class="label py-1"><span class="label-text text-xs">API Key</span></div>
                                <input type="text" class="input input-sm input-bordered font-mono" placeholder="Last.fm API Key" bind:value={lastfmApiKey} />
                            </label>
                            <label class="form-control">
                                <div class="label py-1"><span class="label-text text-xs">Shared Secret</span></div>
                                <input type="text" class="input input-sm input-bordered font-mono" placeholder="Last.fm Shared Secret" bind:value={lastfmSharedSecret} />
                            </label>
                        </div>

                        {#if saveError}<p class="text-xs text-error">{saveError}</p>{/if}

                        <div class="flex gap-2 pt-1">
                            <button class="btn btn-primary btn-sm gap-1" onclick={saveIntegrations} disabled={saving}>
                                {#if saving}<span class="loading loading-spinner loading-xs"></span>{/if}
                                Save & Continue
                            </button>
                            <button class="btn btn-ghost btn-sm" onclick={() => skip('integrations')}>Skip for Now</button>
                        </div>
                    </div>
                {/if}
            </div>

            <!-- ═══ Section 3: History Import ═══ -->
            <div class="card bg-base-200/50 border border-base-300 overflow-hidden">
                <button
                    class="w-full flex items-center gap-3 px-5 py-4 hover:bg-base-300/30 transition-colors text-left"
                    onclick={() => expandedSection = expandedSection === 'history' ? null : 'history'}
                >
                    {#if completed.history}
                        <span class="text-lg text-success"><MdiIcon icon={mdiCheckCircle} size={20} /></span>
                    {:else}
                        <span class="text-lg"><MdiIcon icon={mdiChartBar} size={20} /></span>
                    {/if}
                    <span class="font-medium flex-1">History Import</span>
                    <span class="text-xs text-base-content/40">Trakt & Last.fm watch/listen history</span>
                    <MdiIcon icon={mdiChevronDown} size={16} class="text-base-content/30 transition-transform {expandedSection === 'history' ? 'rotate-180' : ''}" />
                </button>

                {#if expandedSection === 'history'}
                    <div class="px-5 pb-5 space-y-3 border-t border-base-content/5 pt-4">
                        <p class="text-xs text-base-content/50">
                            Import your watch and listen history from Trakt and Last.fm.
                        </p>

                        <!-- Trakt -->
                        <div class="p-3 bg-base-300/30 rounded-lg space-y-2">
                            <div class="flex items-center gap-2">
                                <ServiceIcon service="trakt" size="w-4 h-4" class="text-[#ED1C24]" />
                                <span class="text-sm font-medium">Trakt</span>
                                {#if data.connectedServices?.trakt}
                                    <span class="badge badge-success badge-xs">Connected</span>
                                {:else if data.appCredentials?.hasTraktCreds}
                                    <a href="/api/spokes/trakt" target="_blank" class="btn btn-xs btn-primary ml-auto">Connect</a>
                                {:else}
                                    <span class="text-xs text-base-content/40 ml-auto">Save Trakt keys first (Step 2)</span>
                                {/if}
                            </div>
                            {#if data.connectedServices?.trakt}
                                {#if data.importStats?.trakt}
                                    <p class="text-xs text-base-content/50">{data.importStats.trakt.playCount.toLocaleString()} plays imported</p>
                                {/if}
                                <button class="btn btn-xs btn-outline gap-1" onclick={() => startImport('trakt')} disabled={importState.active}>
                                    Import History
                                </button>
                                <label class="flex items-center gap-2 mt-1 cursor-pointer">
                                    <input type="checkbox" class="toggle toggle-xs toggle-primary"
                                        bind:checked={traktAutoSync}
                                        onchange={() => toggleAutoSync('trakt', traktAutoSync)} />
                                    <span class="text-xs text-base-content/60">
                                        {traktAutoSync ? 'Stay in sync with Trakt' : 'One-time import only'}
                                    </span>
                                </label>
                            {/if}
                        </div>

                        <!-- Last.fm -->
                        <div class="p-3 bg-base-300/30 rounded-lg space-y-2">
                            <div class="flex items-center gap-2">
                                <ServiceIcon service="lastfm" size="w-4 h-4" class="text-[#D51007]" />
                                <span class="text-sm font-medium">Last.fm</span>
                                {#if data.connectedServices?.lastfm}
                                    <span class="badge badge-success badge-xs">Connected</span>
                                {:else if data.appCredentials?.hasLastfmCreds}
                                    <a href="/api/spokes/lastfm" target="_blank" class="btn btn-xs btn-primary ml-auto">Connect</a>
                                {:else}
                                    <span class="text-xs text-base-content/40 ml-auto">Save Last.fm keys first (Step 2)</span>
                                {/if}
                            </div>
                            {#if data.connectedServices?.lastfm}
                                {#if data.importStats?.lastfm}
                                    <p class="text-xs text-base-content/50">{data.importStats.lastfm.playCount.toLocaleString()} plays imported</p>
                                {/if}
                                <button class="btn btn-xs btn-outline gap-1" onclick={() => startImport('lastfm')} disabled={importState.active}>
                                    Import History
                                </button>
                                <label class="flex items-center gap-2 mt-1 cursor-pointer">
                                    <input type="checkbox" class="toggle toggle-xs toggle-primary"
                                        bind:checked={lastfmAutoSync}
                                        onchange={() => toggleAutoSync('lastfm', lastfmAutoSync)} />
                                    <span class="text-xs text-base-content/60">
                                        {lastfmAutoSync ? 'Stay in sync with Last.fm' : 'One-time import only'}
                                    </span>
                                </label>
                            {/if}
                        </div>

                        <!-- Import Progress -->
                        {#if importState.active}
                            <div class="space-y-2">
                                <progress class="progress progress-primary w-full" value={importState.progressPercent} max="100"></progress>
                                <p class="text-xs text-base-content/50">
                                    {importState.totalImported} imported · {importState.totalSkipped} skipped · {Math.round(importState.progressPercent)}%
                                </p>
                                <LogConsole logs={importState.logs} height="h-32" />
                            </div>
                        {/if}

                        <div class="flex gap-2 pt-1">
                            <button class="btn btn-ghost btn-sm" onclick={() => skip('history')}>
                                {data.connectedServices?.trakt || data.connectedServices?.lastfm ? 'Continue' : 'Skip for Now'}
                            </button>
                        </div>
                    </div>
                {/if}
            </div>

            <!-- ═══ Section 4: *arr Collection Management ═══ -->
            <div class="card bg-base-200/50 border border-base-300 overflow-hidden">
                <button
                    class="w-full flex items-center gap-3 px-5 py-4 hover:bg-base-300/30 transition-colors text-left"
                    onclick={() => expandedSection = expandedSection === 'arr' ? null : 'arr'}
                >
                    {#if completed.arr}
                        <span class="text-lg text-success"><MdiIcon icon={mdiCheckCircle} size={20} /></span>
                    {:else}
                        <span class="text-lg"><MdiIcon icon={mdiPackageVariant} size={20} /></span>
                    {/if}
                    <span class="font-medium flex-1">Collection Management</span>
                    <span class="text-xs text-base-content/40">Radarr, Sonarr, Lidarr</span>
                    <MdiIcon icon={mdiChevronDown} size={16} class="text-base-content/30 transition-transform {expandedSection === 'arr' ? 'rotate-180' : ''}" />
                </button>

                {#if expandedSection === 'arr'}
                    <div class="px-5 pb-5 space-y-3 border-t border-base-content/5 pt-4">
                        <div class="flex items-center justify-between">
                            <p class="text-xs text-base-content/50">Connect your *arr instances to track collection status and manage requests.</p>
                            <button class="btn btn-xs btn-outline gap-1" onclick={scanForArr} disabled={arrScanStatus === 'scanning'}>
                                {#if arrScanStatus === 'scanning'}<span class="loading loading-spinner loading-xs"></span>{:else}<MdiIcon icon={mdiMagnify} size={14} />{/if}
                                Scan Network
                            </button>
                        </div>

                        {#each ARR_SERVICES as svc}
                            <div class="p-3 bg-base-300/30 rounded-lg space-y-2">
                                <div class="flex items-center gap-2">
                                    <ServiceIcon service={svc.service} size="w-4 h-4" />
                                    <span class="text-sm font-medium">{svc.label}</span>
                                    {#if arrTestStatus[svc.service] === 'ok'}<span class="badge badge-success badge-xs">Connected</span>
                                    {:else if arrTestStatus[svc.service] === 'error'}<span class="badge badge-error badge-xs">Failed</span>{/if}
                                    <button class="btn btn-xs btn-ghost ml-auto" onclick={() => testArrConnection(svc.service)} disabled={arrTestStatus[svc.service] === 'testing'}>
                                        {#if arrTestStatus[svc.service] === 'testing'}<span class="loading loading-spinner loading-xs"></span>{:else}Test{/if}
                                    </button>
                                </div>
                                {#if svc.service === 'radarr'}
                                    {@const linkUrl = radarrExternalUrl || radarrUrl}
                                    <div class="grid gap-2 sm:grid-cols-2">
                                        <input type="text" class="input input-sm input-bordered font-mono" placeholder="http://localhost:7878" bind:value={radarrUrl} />
                                        <input type="text" class="input input-sm input-bordered font-mono" placeholder="API key" bind:value={radarrApiKey} />
                                    </div>
                                    {#if linkUrl}
                                        <p class="text-[10px] text-base-content/40"><a href="{linkUrl}/settings/general" target="_blank" rel="noopener" class="link link-hover link-primary">{linkUrl}/settings/general</a><br/>Settings → General → Security</p>
                                    {/if}
                                    <input type="text" class="input input-sm input-bordered font-mono w-full" placeholder="External URL (optional, for browser links)" bind:value={radarrExternalUrl} />
                                {:else if svc.service === 'sonarr'}
                                    {@const linkUrl = sonarrExternalUrl || sonarrUrl}
                                    <div class="grid gap-2 sm:grid-cols-2">
                                        <input type="text" class="input input-sm input-bordered font-mono" placeholder="http://localhost:8989" bind:value={sonarrUrl} />
                                        <input type="text" class="input input-sm input-bordered font-mono" placeholder="API key" bind:value={sonarrApiKey} />
                                    </div>
                                    {#if linkUrl}
                                        <p class="text-[10px] text-base-content/40"><a href="{linkUrl}/settings/general" target="_blank" rel="noopener" class="link link-hover link-primary">{linkUrl}/settings/general</a><br/>Settings → General → Security</p>
                                    {/if}
                                    <input type="text" class="input input-sm input-bordered font-mono w-full" placeholder="External URL (optional, for browser links)" bind:value={sonarrExternalUrl} />
                                {:else}
                                    {@const linkUrl = lidarrExternalUrl || lidarrUrl}
                                    <div class="grid gap-2 sm:grid-cols-2">
                                        <input type="text" class="input input-sm input-bordered font-mono" placeholder="http://localhost:8686" bind:value={lidarrUrl} />
                                        <input type="text" class="input input-sm input-bordered font-mono" placeholder="API key" bind:value={lidarrApiKey} />
                                    </div>
                                    {#if linkUrl}
                                        <p class="text-[10px] text-base-content/40"><a href="{linkUrl}/settings/general" target="_blank" rel="noopener" class="link link-hover link-primary">{linkUrl}/settings/general</a><br/>Settings → General → Security</p>
                                    {/if}
                                    <input type="text" class="input input-sm input-bordered font-mono w-full" placeholder="External URL (optional, for browser links)" bind:value={lidarrExternalUrl} />
                                {/if}
                                {#if arrTestInfo[svc.service]}
                                    <p class="text-xs {arrTestStatus[svc.service] === 'ok' ? 'text-success' : arrTestStatus[svc.service] === 'error' ? 'text-error' : 'text-info'}">{arrTestInfo[svc.service]}</p>
                                {/if}
                            </div>
                        {/each}

                        {#if saveError}<p class="text-xs text-error">{saveError}</p>{/if}

                        <div class="flex gap-2 pt-1">
                            <button class="btn btn-primary btn-sm gap-1" onclick={saveArr} disabled={saving}>
                                {#if saving}<span class="loading loading-spinner loading-xs"></span>{/if}
                                Save & Continue
                            </button>
                            <button class="btn btn-ghost btn-sm" onclick={() => skip('arr')}>Skip for Now</button>
                        </div>
                    </div>
                {/if}
            </div>

            <!-- ═══ Section 5: AI / LLM ═══ -->
            <div class="card bg-base-200/50 border border-base-300 overflow-hidden">
                <button
                    class="w-full flex items-center gap-3 px-5 py-4 hover:bg-base-300/30 transition-colors text-left"
                    onclick={() => expandedSection = expandedSection === 'llm' ? null : 'llm'}
                >
                    {#if completed.llm}
                        <span class="text-lg text-success"><MdiIcon icon={mdiCheckCircle} size={20} /></span>
                    {:else}
                        <span class="text-lg"><MdiIcon icon={mdiBrain} size={20} /></span>
                    {/if}
                    <span class="font-medium flex-1">AI / Local LLM</span>
                    <span class="text-xs text-base-content/40">Ollama for search & tagging</span>
                    <MdiIcon icon={mdiChevronDown} size={16} class="text-base-content/30 transition-transform {expandedSection === 'llm' ? 'rotate-180' : ''}" />
                </button>

                {#if expandedSection === 'llm'}
                    <div class="px-5 pb-5 space-y-3 border-t border-base-content/5 pt-4">
                        <div class="flex items-center justify-between">
                            <p class="text-xs text-base-content/50">Connect a local Ollama instance for AI-powered search and auto-tagging.</p>
                            <div class="flex gap-1">
                                <button class="btn btn-xs btn-outline gap-1" onclick={scanForOllama} disabled={ollamaScanStatus === 'scanning'}>
                                    {#if ollamaScanStatus === 'scanning'}<span class="loading loading-spinner loading-xs"></span>{:else}<MdiIcon icon={mdiMagnify} size={14} />{/if}
                                    Scan
                                </button>
                                {#if ollamaUrl}
                                    <button class="btn btn-xs btn-outline gap-1" onclick={testOllamaConnection} disabled={ollamaHealthStatus === 'checking'}>
                                        {#if ollamaHealthStatus === 'checking'}<span class="loading loading-spinner loading-xs"></span>{:else}<MdiIcon icon={mdiLanConnect} size={14} />{/if}
                                        Test
                                    </button>
                                {/if}
                            </div>
                        </div>

                        {#if ollamaHealthStatus === 'ok'}<p class="text-xs text-success"><MdiIcon icon={mdiCheckCircle} size={12} /> Connected — {ollamaHealthModels.length} models available</p>
                        {:else if ollamaHealthStatus === 'error'}<p class="text-xs text-error"><MdiIcon icon={mdiCloseCircle} size={12} /> {ollamaHealthError}</p>
                        {:else if ollamaScanStatus === 'notfound'}<p class="text-xs text-warning">No Ollama instances found on the network.</p>{/if}

                        <label class="form-control">
                            <div class="label py-1"><span class="label-text text-xs">Ollama URL</span></div>
                            <input type="text" class="input input-sm input-bordered font-mono" placeholder="http://localhost:11434" bind:value={ollamaUrl} />
                        </label>

                        <div class="grid gap-3 sm:grid-cols-2">
                            <label class="form-control">
                                <div class="label py-1"><span class="label-text text-xs">Embedding Model</span></div>
                                <select bind:value={ollamaEmbedModel} class="select select-bordered select-sm font-mono">
                                    {#if !ollamaHealthModels.length}
                                        <option value={ollamaEmbedModel}>{ollamaEmbedModel}</option>
                                    {:else}
                                        {@const embedModels = ollamaHealthModels.filter(m => /embed|minilm|bert/i.test(m))}
                                        {@const recommended = embedModels.filter(m => m.includes('nomic-embed'))}
                                        {@const others = embedModels.filter(m => !m.includes('nomic-embed'))}
                                        {#each recommended as model}<option value={model}>{model} ★</option>{/each}
                                        {#if recommended.length && others.length}<option disabled>───────────</option>{/if}
                                        {#each others as model}<option value={model}>{model}</option>{/each}
                                    {/if}
                                </select>
                                <p class="text-[10px] text-base-content/40 mt-1">Used for semantic search & album matching</p>
                            </label>
                            <label class="form-control">
                                <div class="label py-1"><span class="label-text text-xs">Generation Model</span></div>
                                <select bind:value={ollamaChatModel} class="select select-bordered select-sm font-mono">
                                    {#if !ollamaHealthModels.length}
                                        <option value={ollamaChatModel}>{ollamaChatModel}</option>
                                    {:else}
                                        {@const genModels = ollamaHealthModels.filter(m => !/embed|minilm|bert/i.test(m))}
                                        {@const recommended = genModels.filter(m => m.includes('llama3.2'))}
                                        {@const others = genModels.filter(m => !m.includes('llama3.2'))}
                                        {#each recommended as model}<option value={model}>{model} ★</option>{/each}
                                        {#if recommended.length && others.length}<option disabled>───────────</option>{/if}
                                        {#each others as model}<option value={model}>{model}</option>{/each}
                                    {/if}
                                </select>
                                <p class="text-[10px] text-base-content/40 mt-1">Used for tagging, natural language queries</p>
                            </label>
                        </div>

                        {#if saveError}<p class="text-xs text-error">{saveError}</p>{/if}

                        <div class="flex gap-2 pt-1">
                            <button class="btn btn-primary btn-sm gap-1" onclick={saveLLM} disabled={saving}>
                                {#if saving}<span class="loading loading-spinner loading-xs"></span>{/if}
                                Save & Continue
                            </button>
                            <button class="btn btn-ghost btn-sm" onclick={() => skip('llm')}>Skip for Now</button>
                        </div>
                    </div>
                {/if}
            </div>

            <!-- ═══ Section 6: Final Sync ═══ -->
            <div class="card bg-base-200/50 border border-primary/20 overflow-hidden">
                <button
                    class="w-full flex items-center gap-3 px-5 py-4 hover:bg-base-300/30 transition-colors text-left"
                    onclick={() => expandedSection = expandedSection === 'finalSync' ? null : 'finalSync'}
                >
                    {#if completed.finalSync}
                        <span class="text-lg text-success"><MdiIcon icon={mdiCheckCircle} size={20} /></span>
                    {:else}
                        <span class="text-lg"><MdiIcon icon={mdiSync} size={20} /></span>
                    {/if}
                    <span class="font-medium flex-1">Finish Setup</span>
                    <span class="text-xs text-base-content/40">Sync, enrich, reconcile</span>
                    <MdiIcon icon={mdiChevronDown} size={16} class="text-base-content/30 transition-transform {expandedSection === 'finalSync' ? 'rotate-180' : ''}" />
                </button>

                {#if expandedSection === 'finalSync'}
                    <div class="px-5 pb-5 space-y-4 border-t border-base-content/5 pt-4">
                        <div class="text-center space-y-3 py-2">
                            <p class="text-3xl"><MdiIcon icon={mdiPartyPopper} size={30} /></p>
                            <p class="text-sm font-medium">You're all set!</p>
                            <p class="text-xs text-base-content/50">
                                Everything is configured. Your Jellyfin library syncs automatically in the background — it's completely safe to start browsing now.
                            </p>
                        </div>

                        {#if finalSyncStatus === 'idle'}
                            <div class="flex flex-col items-center gap-2">
                                <a href="/" class="btn btn-primary gap-2" onclick={() => { markComplete('finalSync'); finishWelcome(); }}>
                                    <MdiIcon icon={mdiRocketLaunch} size={18} /> Start Exploring Mediajam
                                </a>
                                <button class="btn btn-ghost btn-sm gap-2" onclick={runFinalSync}>
                                    <MdiIcon icon={mdiSync} size={14} />
                                    Or run a sync first
                                </button>
                            </div>
                        {:else}
                            <div class="space-y-2">
                                <div class="flex items-center gap-2 text-sm">
                                    {#if finalSyncStatus === 'syncing'}
                                        <span class="loading loading-spinner loading-xs text-primary"></span>
                                    {:else if finalSyncStatus === 'complete'}
                                        <span class="text-success"><MdiIcon icon={mdiCheckCircle} size={16} /></span>
                                    {:else}
                                        <span class="text-error"><MdiIcon icon={mdiCloseCircle} size={16} /></span>
                                    {/if}
                                    <span class="font-medium">{finalSyncStep}</span>
                                </div>
                                <LogConsole logs={finalSyncLogs} running={finalSyncStatus === 'syncing'} title="Sync Log" height="h-48" />
                                {#if finalSyncStatus === 'complete'}
                                    <a href="/" class="btn btn-primary gap-2 mt-2" onclick={finishWelcome}>
                                        <MdiIcon icon={mdiRocketLaunch} size={18} /> Start Exploring Mediajam
                                    </a>
                                {/if}
                            </div>
                        {/if}
                    </div>
                {/if}
            </div>

        </div>

        <!-- Skip all button at the bottom -->
        <div class="text-center mt-8">
            <button class="btn btn-ghost btn-sm text-base-content/40" onclick={finishWelcome}>
                Skip everything & go to Mediajam →
            </button>
        </div>
    {/if}
</div>
