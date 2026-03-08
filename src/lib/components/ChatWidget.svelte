<script>
    /** @type {{ ollamaConfigured?: boolean }} */
    let { ollamaConfigured = false } = $props();

    /** @typedef {{ role: 'user' | 'assistant', text: string, sql?: string, results?: any[], error?: string, loading?: boolean }} ChatMessage */

    /** @type {ChatMessage[]} */
    let messages = $state([]);
    let input = $state('');
    let isOpen = $state(false);
    let isMinimized = $state(false);
    let sending = $state(false);
    /** @type {Record<string, boolean>} */
    let showSql = $state({});

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

    function toggleOpen() {
        if (isOpen) {
            isOpen = false;
            isMinimized = false;
        } else {
            isOpen = true;
            isMinimized = false;
            requestAnimationFrame(() => {
                inputEl?.focus();
                scrollToBottom();
            });
        }
    }

    function toggleMinimize() {
        isMinimized = !isMinimized;
        if (!isMinimized) {
            requestAnimationFrame(() => {
                inputEl?.focus();
                scrollToBottom();
            });
        }
    }

    function clearChat() {
        messages = [];
        showSql = {};
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

        // Add loading placeholder
        messages = [...messages, { role: 'assistant', text: '', loading: true }];
        scrollToBottom();

        try {
            const res = await fetch('/api/ask', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ question }),
            });

            let data;
            try {
                data = await res.json();
            } catch {
                // Response wasn't valid JSON
                messages = messages.filter(m => !m.loading);
                messages = [...messages, { role: 'assistant', text: `⚠️ Server returned ${res.status} ${res.statusText}`, error: 'Invalid response' }];
                sending = false;
                scrollToBottom();
                return;
            }

            // Remove loading placeholder
            messages = messages.filter(m => !m.loading);

            if (data.error && !data.results) {
                messages = [...messages, { role: 'assistant', text: `⚠️ ${data.error}`, error: data.error, sql: data.sql }];
            } else {
                const summary = data.summary || formatResults(data.results, data.count);
                messages = [...messages, {
                    role: 'assistant',
                    text: summary,
                    sql: data.sql,
                    results: data.results?.slice(0, 10),
                }];
            }
        } catch (e) {
            messages = messages.filter(m => !m.loading);
            messages = [...messages, { role: 'assistant', text: '❌ Could not reach the server.', error: 'Network error' }];
        }

        sending = false;
        scrollToBottom();
    }

    /**
     * Format query results into a readable summary.
     * @param {any[]} results
     * @param {number} count
     * @returns {string}
     */
    function formatResults(results, count) {
        if (!results || results.length === 0) return 'No results found.';
        if (results.length === 1) {
            const row = results[0];
            const keys = Object.keys(row);
            if (keys.length === 1) {
                return `**${keys[0]}**: ${row[keys[0]]}`;
            }
            return keys.map(k => `**${k}**: ${row[k]}`).join('\n');
        }
        const keys = Object.keys(results[0]);
        const header = `Found ${count} result${count !== 1 ? 's' : ''}:`;
        const rows = results.slice(0, 8).map(r => {
            const main = r.title || r.name || r[keys[0]];
            const extra = keys.filter(k => k !== 'title' && k !== 'name' && k !== keys[0])
                .map(k => `${k}: ${r[k]}`)
                .join(', ');
            return `• ${main}${extra ? ` (${extra})` : ''}`;
        }).join('\n');
        const more = count > 8 ? `\n...and ${count - 8} more` : '';
        return `${header}\n${rows}${more}`;
    }

    /** @param {KeyboardEvent} e */
    function handleKeydown(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    }
</script>

<!-- Toggle Button (rendered inline in navbar) -->
{#if !isOpen}
    <button
        class="btn btn-ghost btn-sm btn-circle"
        onclick={toggleOpen}
        title="Chat with your library"
    >
        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
        </svg>
    </button>
{/if}

<!-- Floating Chat Panel -->
{#if isOpen}
    <div
        class="fixed bottom-4 right-4 z-[200] flex flex-col shadow-2xl rounded-2xl border border-base-300 bg-base-100 overflow-hidden transition-all duration-200"
        style="width: 400px; {isMinimized ? 'height: 48px;' : 'height: 520px;'}"
    >
        <!-- Title Bar -->
        <div class="flex items-center justify-between px-4 py-2.5 bg-base-200 border-b border-base-300 shrink-0 cursor-pointer select-none" role="button" tabindex="0" onclick={toggleMinimize} onkeydown={(e) => e.key === 'Enter' && toggleMinimize()}>
            <div class="flex items-center gap-2">
                <span class="text-base">💬</span>
                <span class="font-semibold text-sm">Ask Mediajam</span>
                {#if !ollamaConfigured}
                    <span class="badge badge-warning badge-xs">No LLM</span>
                {/if}
            </div>
            <div class="flex items-center gap-1">
                {#if messages.length > 0 && !isMinimized}
                    <button class="btn btn-ghost btn-xs btn-circle" onclick={(e) => { e.stopPropagation(); clearChat(); }} title="Clear chat">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                    </button>
                {/if}
                <button class="btn btn-ghost btn-xs btn-circle" onclick={(e) => { e.stopPropagation(); toggleMinimize(); }} title={isMinimized ? 'Expand' : 'Minimize'}>
                    {#if isMinimized}
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="17 11 12 6 7 11"/><polyline points="17 18 12 13 7 18"/></svg>
                    {:else}
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"/></svg>
                    {/if}
                </button>
                <button class="btn btn-ghost btn-xs btn-circle" onclick={(e) => { e.stopPropagation(); toggleOpen(); }} title="Close">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
            </div>
        </div>

        <!-- Messages -->
        {#if !isMinimized}
            <div class="flex-1 overflow-y-auto p-3 space-y-3" bind:this={messagesContainer}>
                {#if messages.length === 0}
                    <div class="flex flex-col items-center justify-center h-full text-center text-base-content/40 gap-3 py-8">
                        <span class="text-4xl">💬</span>
                        <div>
                            <p class="font-medium text-sm">Ask about your library</p>
                            <p class="text-xs mt-1 max-w-[250px]">Try "What movies did I watch this month?" or "How many albums do I have?"</p>
                        </div>
                    </div>
                {:else}
                    {#each messages as msg, i}
                        {#if msg.loading}
                            <div class="chat chat-start">
                                <div class="chat-bubble chat-bubble-primary bg-base-200 text-base-content">
                                    <span class="loading loading-dots loading-sm"></span>
                                </div>
                            </div>
                        {:else if msg.role === 'user'}
                            <div class="chat chat-end">
                                <div class="chat-bubble chat-bubble-primary text-sm">{msg.text}</div>
                            </div>
                        {:else}
                            <div class="chat chat-start">
                                <div class="chat-bubble bg-base-200 text-base-content text-sm whitespace-pre-wrap" style="max-width: 95%;">
                                    {msg.text}
                                    {#if msg.sql}
                                        <button class="text-xs text-primary/60 hover:text-primary mt-1 block" onclick={() => toggleSql(String(i))}>
                                            {showSql[String(i)] ? '▾ Hide SQL' : '▸ Show SQL'}
                                        </button>
                                        {#if showSql[String(i)]}
                                            <pre class="text-xs bg-base-300/50 rounded p-2 mt-1 overflow-x-auto font-mono">{msg.sql}</pre>
                                        {/if}
                                    {/if}
                                    {#if msg.results && msg.results.length > 0}
                                        <div class="mt-2 overflow-x-auto">
                                            <table class="table table-xs">
                                                <thead>
                                                    <tr>
                                                        {#each Object.keys(msg.results[0]) as col}
                                                            <th class="text-xs">{col}</th>
                                                        {/each}
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {#each msg.results as row}
                                                        <tr>
                                                            {#each Object.values(row) as val}
                                                                <td class="text-xs max-w-[120px] truncate">{val}</td>
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
            <div class="border-t border-base-300 p-3 shrink-0 bg-base-100">
                <form class="flex gap-2" onsubmit={(e) => { e.preventDefault(); sendMessage(); }}>
                    <input
                        bind:this={inputEl}
                        bind:value={input}
                        type="text"
                        class="input input-sm input-bordered flex-1 text-sm"
                        placeholder={ollamaConfigured ? 'Ask about your library...' : 'Ollama not configured'}
                        disabled={!ollamaConfigured || sending}
                        onkeydown={handleKeydown}
                    />
                    <button
                        type="submit"
                        class="btn btn-sm btn-primary"
                        disabled={!input.trim() || sending || !ollamaConfigured}
                    >
                        {#if sending}
                            <span class="loading loading-spinner loading-xs"></span>
                        {:else}
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                        {/if}
                    </button>
                </form>
            </div>
        {/if}
    </div>
{/if}
