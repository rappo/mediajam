<script>
    /** @type {{ llmConfigured?: boolean }} */
    let { llmConfigured = false } = $props();

    import MdiIcon from '$lib/components/MdiIcon.svelte';
    import { mdiMessageText, mdiCog, mdiCheck, mdiContentCopy, mdiDelete, mdiMinus, mdiDockRight, mdiWindowRestore, mdiClose, mdiSend } from '@mdi/js';

    /** @typedef {{ role: 'user' | 'assistant', text: string, sql?: string, results?: any[], sources?: any[], error?: string, loading?: boolean, type?: string }} ChatMessage */

    /** @type {ChatMessage[]} */
    let messages = $state([]);
    let input = $state('');
    /** @type {'closed' | 'bubble' | 'floating' | 'docked'} */
    let mode = $state('closed');
    let sending = $state(false);
    /** @type {Record<string, boolean>} */
    let showSql = $state({});
    let showStatus = $state(false);
    /** @type {{ provider?: string, providerLabel?: string, providerConnected?: boolean, providerError?: string, authSource?: string, chatModelId?: string, ollamaConnected?: boolean, ollamaUrl?: string, ollamaError?: string, chatModel?: string, embeddingModel?: string, embedTest?: string, ragAvailable?: boolean, embeddingsTotal?: number, overviewsTotal?: number, embeddingsPct?: number } | null} */
    let statusData = $state(null);
    let statusLoading = $state(false);

    /** @type {HTMLDivElement | undefined} */
    let messagesContainer = $state();
    /** @type {HTMLInputElement | undefined} */
    let inputEl = $state();

    function scrollToBottom() {
        if (messagesContainer) {
            requestAnimationFrame(() => {
                messagesContainer?.scrollTo({ top: messagesContainer.scrollHeight, behavior: 'smooth' });
            });
        }
    }

    function open() {
        mode = 'floating';
        requestAnimationFrame(() => { inputEl?.focus(); scrollToBottom(); });
    }

    function minimize() {
        mode = 'bubble';
    }

    function dock() {
        mode = 'docked';
        requestAnimationFrame(() => { inputEl?.focus(); scrollToBottom(); });
    }

    function undock() {
        mode = 'floating';
        requestAnimationFrame(() => { inputEl?.focus(); scrollToBottom(); });
    }

    function close() {
        mode = 'closed';
    }

    function clearChat() {
        messages = [];
        showSql = {};
    }

    async function fetchStatus() {
        if (statusLoading) return;
        showStatus = !showStatus;
        if (!showStatus) return;
        statusLoading = true;
        try {
            const res = await fetch('/api/ask/status');
            if (res.ok) statusData = await res.json();
        } catch { /* ignore */ }
        statusLoading = false;
    }

    /** @param {string} idx */
    function toggleSql(idx) {
        showSql = { ...showSql, [idx]: !showSql[idx] };
    }

    async function sendMessage() {
        const question = input.trim();
        if (!question || sending) return;

        input = '';
        messages = [...messages, { role: 'user', text: question }];
        sending = true;
        scrollToBottom();

        messages = [...messages, { role: 'assistant', text: '', loading: true }];
        scrollToBottom();

        try {
            // Send last 10 turns of conversation for context
            const history = messages
                .filter(m => !m.loading && m.text)
                .slice(-10)
                .map(m => ({ role: m.role, text: m.text }));

            const res = await fetch('/api/ask', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ question, history }),
            });

            let data;
            try {
                data = await res.json();
            } catch {
                messages = messages.filter(m => !m.loading);
                messages = [...messages, { role: 'assistant', text: `⚠️ Server returned ${res.status}`, error: 'Invalid response' }];
                sending = false;
                scrollToBottom();
                requestAnimationFrame(() => inputEl?.focus());
                return;
            }

            messages = messages.filter(m => !m.loading);

            if (data.error && !data.summary) {
                messages = [...messages, { role: 'assistant', text: `⚠️ ${data.error}`, error: data.error, sql: data.sql }];
            } else {
                const summary = data.summary || formatResults(data.results, data.count);
                messages = [...messages, {
                    role: 'assistant',
                    text: summary,
                    sql: data.sql,
                    results: data.type === 'data' ? data.results?.slice(0, 10) : undefined,
                    sources: data.sources,
                    type: data.type,
                }];
            }
        } catch {
            messages = messages.filter(m => !m.loading);
            messages = [...messages, { role: 'assistant', text: '❌ Could not reach the server.', error: 'Network error' }];
        }

        sending = false;
        scrollToBottom();
        requestAnimationFrame(() => inputEl?.focus());
    }

    /**
     * @param {any[]} results
     * @param {number} count
     * @returns {string}
     */
    function formatResults(results, count) {
        if (!results || results.length === 0) return 'No results found.';
        if (results.length === 1) {
            const row = results[0];
            const keys = Object.keys(row);
            if (keys.length === 1) return `${keys[0]}: ${row[keys[0]]}`;
            return keys.map(k => `**${k}**: ${row[k]}`).join('\n');
        }
        const keys = Object.keys(results[0]);
        const rows = results.slice(0, 8).map(r => {
            const main = r.title || r.name || r[keys[0]];
            return `• ${main}`;
        }).join('\n');
        const more = count > 8 ? `\n...and ${count - 8} more` : '';
        return `Found ${count} result${count !== 1 ? 's' : ''}:\n${rows}${more}`;
    }

    /** @param {KeyboardEvent} e */
    function handleKeydown(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    }

    import { copyToClipboard } from '$lib/utils.js';

    /**
     * Escape HTML entities for safe {@html} rendering.
     * @param {string} str
     * @returns {string}
     */
    function escapeHtml(str) {
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    /**
     * Convert media type to URL prefix.
     * @param {string} type
     * @returns {string}
     */
    function mediaTypeToPath(type) {
        switch (type) {
            case 'movie': return '/movies';
            case 'show': return '/shows';
            case 'artist': return '/music';
            default: return '/movies';
        }
    }

    /**
     * Linkify title mentions in text using sources array.
     * Returns HTML string safe for {@html}.
     * @param {string} text
     * @param {any[]} [sources]
     * @returns {string}
     */
    function linkifyTitles(text, sources) {
        let html = escapeHtml(text);
        if (!sources || sources.length === 0) return html;

        // Sort sources by title length descending to match longer titles first
        const sorted = [...sources].sort((a, b) => (b.title?.length || 0) - (a.title?.length || 0));

        for (const src of sorted) {
            if (!src.title || !src.id) continue;
            const path = mediaTypeToPath(src.type);
            const url = `${path}/${src.id}`;
            // Escape the title for use in regex (escape special regex chars)
            const escapedTitle = escapeHtml(src.title).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            // Match the title as a whole word, case-insensitive, but only replace first occurrence
            const regex = new RegExp(`("?)${escapedTitle}("?)`, 'i');
            html = html.replace(regex, `$1<a href="${url}" class="link link-primary font-medium" data-sveltekit-preload-data>${escapeHtml(src.title)}</a>$2`);
        }

        return html;
    }

    let copied = $state(false);
    function copyDebug() {
        const lines = [`=== Mediajam Chat Debug ===`, `Time: ${new Date().toISOString()}`, ''];
        // Include status info if available
        if (statusData) {
            const label = statusData.providerLabel || statusData.provider || 'LLM';
            lines.push(`Provider: ${label} ${statusData.providerConnected ? '✓ connected' : '✗ disconnected'}`);
            if (statusData.authSource) lines.push(`Auth: ${statusData.authSource}`);
            if (statusData.chatModelId) lines.push(`Model: ${statusData.chatModelId}`);
            if (statusData.providerError) lines.push(`Error: ${statusData.providerError}`);
            lines.push(`Chat model: ${statusData.chatModel || 'none'}`);
            lines.push(`Embedding model: ${statusData.embeddingModel || 'none'}`);
            lines.push(`RAG: ${statusData.ragAvailable ? '✓ available' : '✗ unavailable'}`);
            lines.push(`Embeddings: ${statusData.embeddingsTotal}/${statusData.overviewsTotal} (${statusData.embeddingsPct}%)`);
            if (statusData.embedTest) lines.push(`Embed test: ${statusData.embedTest}`);
            lines.push('');
        }
        for (const msg of messages) {
            if (msg.loading) continue;
            if (msg.role === 'user') {
                lines.push(`USER: ${msg.text}`);
            } else {
                lines.push(`A: ${msg.text}`);
                if (msg.sql) lines.push(`SQL: ${msg.sql}`);
                if (msg.type) lines.push(`Type: ${msg.type}`);
                if (msg.error) lines.push(`Error: ${msg.error}`);
                if (msg.results) lines.push(`Results (${msg.results.length}): ${JSON.stringify(msg.results, null, 2)}`);
            }
            lines.push('');
        }
        copyToClipboard(lines.join('\n'));
        copied = true;
        setTimeout(() => { copied = false; }, 2000);
    }
</script>

<!-- Closed state: Fixed bottom-right button -->
{#if mode === 'closed'}
    <button
        class="fixed bottom-6 right-6 z-[200] w-12 h-12 rounded-full bg-primary text-primary-content shadow-lg flex items-center justify-center hover:scale-110 transition-transform duration-150 active:scale-95"
        onclick={open}
        title="Chat with your library"
    >
        <MdiIcon icon={mdiMessageText} size={20} />
    </button>
{/if}

<!-- Minimized Bubble -->
{#if mode === 'bubble'}
    <button
        class="fixed bottom-6 right-6 z-[200] w-14 h-14 rounded-full bg-primary text-primary-content shadow-xl flex items-center justify-center hover:scale-110 transition-transform duration-150 active:scale-95"
        onclick={open}
        title="Open chat"
    >
        <MdiIcon icon={mdiMessageText} size={24} />
        {#if messages.length > 0}
            <span class="absolute -top-1 -right-1 bg-accent text-accent-content text-xs w-5 h-5 rounded-full flex items-center justify-center font-bold">{messages.filter(m => m.role === 'assistant' && !m.loading).length}</span>
        {/if}
    </button>
{/if}

<!-- Floating Chat Panel -->
{#if mode === 'floating'}
    <div
        class="fixed bottom-4 right-4 z-[200] flex flex-col shadow-2xl rounded-2xl border border-base-300 bg-base-100 overflow-hidden"
        style="width: 380px; height: 500px;"
    >
        {@render chatContent()}
    </div>
{/if}

<!-- Docked Sidebar -->
{#if mode === 'docked'}
    <div class="fixed top-16 right-0 z-[200] flex flex-col border-l border-base-300 bg-base-100 shadow-2xl" style="width: 380px; height: calc(100vh - 4rem);">
        {@render chatContent()}
    </div>
{/if}

{#snippet chatContent()}
    <!-- Title Bar -->
    <div class="flex items-center justify-between px-3 py-2 bg-gradient-to-r from-primary/10 to-secondary/10 border-b border-base-300 shrink-0 select-none">
        <div class="flex items-center gap-2">
            <div class="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center">
                <MdiIcon icon={mdiMessageText} size={14} class="text-primary" />
            </div>
            <div>
                <span class="font-semibold text-sm">Ask Mediajam</span>
                {#if !llmConfigured}
                    <span class="badge badge-warning badge-xs ml-1">No LLM</span>
                {/if}
            </div>
        </div>
        <div class="flex items-center gap-0.5">
            <!-- Status -->
            <button class="btn btn-ghost btn-xs btn-square opacity-50 hover:opacity-100" onclick={fetchStatus} title="System status" class:text-primary={showStatus}>
                <MdiIcon icon={mdiCog} size={14} />
            </button>
            {#if messages.length > 0}
                <button class="btn btn-ghost btn-xs btn-square opacity-50 hover:opacity-100" onclick={copyDebug} title="Copy debug info">
                    {#if copied}
                        <MdiIcon icon={mdiCheck} size={14} class="text-success" />
                    {:else}
                        <MdiIcon icon={mdiContentCopy} size={14} />
                    {/if}
                </button>
                <button class="btn btn-ghost btn-xs btn-square opacity-50 hover:opacity-100" onclick={clearChat} title="Clear chat">
                    <MdiIcon icon={mdiDelete} size={14} />
                </button>
            {/if}
            <!-- Minimize -->
            <button class="btn btn-ghost btn-xs btn-square opacity-50 hover:opacity-100" onclick={minimize} title="Minimize">
                <MdiIcon icon={mdiMinus} size={14} />
            </button>
            <!-- Dock / Undock -->
            {#if mode === 'floating'}
                <button class="btn btn-ghost btn-xs btn-square opacity-50 hover:opacity-100" onclick={dock} title="Dock to sidebar">
                    <MdiIcon icon={mdiDockRight} size={14} />
                </button>
            {:else}
                <button class="btn btn-ghost btn-xs btn-square opacity-50 hover:opacity-100" onclick={undock} title="Float">
                    <MdiIcon icon={mdiWindowRestore} size={14} />
                </button>
            {/if}
            <!-- Close -->
            <button class="btn btn-ghost btn-xs btn-square opacity-50 hover:opacity-100" onclick={close} title="Close">
                <MdiIcon icon={mdiClose} size={14} />
            </button>
        </div>
    </div>

    <!-- Status Panel -->
    {#if showStatus}
        <div class="px-3 py-2 bg-base-200/50 border-b border-base-300 text-xs space-y-1 shrink-0">
            {#if statusLoading}
                <div class="text-base-content/40">Loading...</div>
            {:else if statusData}
                <div class="flex items-center gap-2">
                    <span class="w-2 h-2 rounded-full {statusData.providerConnected ? 'bg-success' : 'bg-error'}"></span>
                    {statusData.providerLabel || statusData.provider || 'LLM'}: {statusData.providerConnected ? 'connected' : 'disconnected'}
                    {#if statusData.provider === 'ollama' && statusData.ollamaUrl}
                        <span class="text-base-content/40">({statusData.ollamaUrl})</span>
                    {/if}
                </div>
                {#if statusData.providerError}
                    <div class="text-error/70 pl-4">{statusData.providerError}</div>
                {/if}
                <div class="text-base-content/60 pl-4">
                    Chat: {statusData.chatModel || '—'} · Embed: {statusData.embeddingModel || '—'}
                </div>
                <div class="flex items-center gap-2">
                    <span class="w-2 h-2 rounded-full {statusData.ragAvailable ? 'bg-success' : 'bg-warning'}"></span>
                    RAG: {statusData.ragAvailable ? 'available' : 'unavailable'}
                </div>
                <div class="text-base-content/60 pl-4">
                    Embeddings: {statusData.embeddingsTotal}/{statusData.overviewsTotal} ({statusData.embeddingsPct}%)
                </div>
                {#if statusData.embedTest}
                    <div class="flex items-center gap-2">
                        <span class="w-2 h-2 rounded-full {statusData.embedTest.startsWith('ok') ? 'bg-success' : 'bg-error'}"></span>
                        Embed test: {statusData.embedTest}
                    </div>
                {/if}
            {:else}
                <div class="text-base-content/40">Could not fetch status</div>
            {/if}
        </div>
    {/if}

    <!-- Messages -->
    <div class="flex-1 overflow-y-auto p-3 space-y-3" bind:this={messagesContainer}>
        {#if messages.length === 0}
            <div class="flex flex-col items-center justify-center h-full text-center text-base-content/40 gap-4 py-8">
                <div class="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                    <MdiIcon icon={mdiMessageText} size={24} class="text-primary/50" />
                </div>
                <div>
                    <p class="font-medium text-sm text-base-content/60">Ask about your library</p>
                    <div class="text-xs mt-2 space-y-1 max-w-[260px]">
                        <button class="block w-full text-left px-2 py-1 rounded hover:bg-base-200 transition-colors" onclick={() => { input = "What movies did I watch this month?"; sendMessage(); }}>
                            <MdiIcon icon={mdiMessageText} size={14} class="mr-1" /> "What movies did I watch this month?"
                        </button>
                        <button class="block w-full text-left px-2 py-1 rounded hover:bg-base-200 transition-colors" onclick={() => { input = "How many albums do I have?"; sendMessage(); }}>
                            <MdiIcon icon={mdiMessageText} size={14} class="mr-1" /> "How many albums do I have?"
                        </button>
                        <button class="block w-full text-left px-2 py-1 rounded hover:bg-base-200 transition-colors" onclick={() => { input = "Who are my favorite actors?"; sendMessage(); }}>
                            <MdiIcon icon={mdiMessageText} size={14} class="mr-1" /> "Who are my favorite actors?"
                        </button>
                    </div>
                </div>
            </div>
        {:else}
            {#each messages as msg, i}
                {#if msg.loading}
                    <div class="flex gap-2 items-start">
                        <div class="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center shrink-0 mt-0.5">
                            <MdiIcon icon={mdiMessageText} size={12} class="text-primary" />
                        </div>
                        <div class="bg-base-200 rounded-2xl rounded-tl-sm px-3 py-2">
                            <span class="loading loading-dots loading-sm"></span>
                        </div>
                    </div>
                {:else if msg.role === 'user'}
                    <div class="flex justify-end">
                        <div class="bg-primary text-primary-content rounded-2xl rounded-tr-sm px-3 py-2 text-sm max-w-[85%]">{msg.text}</div>
                    </div>
                {:else}
                    <div class="flex gap-2 items-start">
                        <div class="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center shrink-0 mt-0.5">
                            <MdiIcon icon={mdiMessageText} size={12} class="text-primary" />
                        </div>
                        <div class="bg-base-200 rounded-2xl rounded-tl-sm px-3 py-2 text-sm max-w-[90%] whitespace-pre-wrap">
                            {#if msg.sources && msg.sources.length > 0}
                                {@html linkifyTitles(msg.text, msg.sources)}
                            {:else}
                                {msg.text}
                            {/if}
                            {#if msg.sql}
                                <button class="text-[11px] text-primary/50 hover:text-primary mt-1 block" onclick={() => toggleSql(String(i))}>
                                    {showSql[String(i)] ? '▾ Hide query' : '▸ Show query'}
                                </button>
                                {#if showSql[String(i)]}
                                    <pre class="text-[11px] bg-base-300/50 rounded-lg p-2 mt-1 overflow-x-auto font-mono leading-relaxed">{msg.sql}</pre>
                                {/if}
                            {/if}
                            {#if msg.results && msg.results.length > 0}
                                <div class="mt-2 overflow-x-auto -mx-1">
                                    <table class="table table-xs">
                                        <thead>
                                            <tr>
                                                {#each Object.keys(msg.results[0]) as col}
                                                    <th class="text-[11px] font-semibold">{col}</th>
                                                {/each}
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {#each msg.results as row}
                                                <tr>
                                                    {#each Object.values(row) as val}
                                                        <td class="text-[11px] max-w-[120px] truncate">{val}</td>
                                                    {/each}
                                                </tr>
                                            {/each}
                                        </tbody>
                                    </table>
                                </div>
                            {/if}
                        </div>
                    </div>
                {/if}
            {/each}
        {/if}
    </div>

    <!-- Input -->
    <div class="border-t border-base-300 p-3 shrink-0 bg-base-100/80 backdrop-blur-sm">
        <form class="flex gap-2" onsubmit={(e) => { e.preventDefault(); sendMessage(); }}>
            <input
                bind:this={inputEl}
                bind:value={input}
                type="text"
                class="input input-sm input-bordered flex-1 text-sm rounded-full"
                placeholder={llmConfigured ? 'Ask anything...' : 'No LLM configured'}
                disabled={!llmConfigured || sending}
                onkeydown={handleKeydown}
            />
            <button
                type="submit"
                class="btn btn-sm btn-primary btn-circle"
                disabled={!input.trim() || sending || !llmConfigured}
            >
                {#if sending}
                    <span class="loading loading-spinner loading-xs"></span>
                {:else}
                    <MdiIcon icon={mdiSend} size={16} />
                {/if}
            </button>
        </form>
    </div>
{/snippet}
