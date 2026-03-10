<script>
    /** @type {{ ollamaConfigured?: boolean }} */
    let { ollamaConfigured = false } = $props();

    /** @typedef {{ role: 'user' | 'assistant', text: string, sql?: string, results?: any[], error?: string, loading?: boolean, type?: string }} ChatMessage */

    /** @type {ChatMessage[]} */
    let messages = $state([]);
    let input = $state('');
    /** @type {'closed' | 'bubble' | 'floating' | 'docked'} */
    let mode = $state('closed');
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
            const res = await fetch('/api/ask', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ question }),
            });

            let data;
            try {
                data = await res.json();
            } catch {
                messages = messages.filter(m => !m.loading);
                messages = [...messages, { role: 'assistant', text: `⚠️ Server returned ${res.status}`, error: 'Invalid response' }];
                sending = false;
                scrollToBottom();
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
                    type: data.type,
                }];
            }
        } catch {
            messages = messages.filter(m => !m.loading);
            messages = [...messages, { role: 'assistant', text: '❌ Could not reach the server.', error: 'Network error' }];
        }

        sending = false;
        scrollToBottom();
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

    let copied = $state(false);
    function copyDebug() {
        const lines = [`=== Mediajam Chat Debug ===`, `Time: ${new Date().toISOString()}`, ''];
        for (const msg of messages) {
            if (msg.loading) continue;
            if (msg.role === 'user') {
                lines.push(`USER: ${msg.text}`);
            } else {
                lines.push(`ASSISTANT: ${msg.text}`);
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
        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
        </svg>
    </button>
{/if}

<!-- Minimized Bubble -->
{#if mode === 'bubble'}
    <button
        class="fixed bottom-6 right-6 z-[200] w-14 h-14 rounded-full bg-primary text-primary-content shadow-xl flex items-center justify-center hover:scale-110 transition-transform duration-150 active:scale-95"
        onclick={open}
        title="Open chat"
    >
        <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
        </svg>
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
    <div class="fixed top-0 right-0 z-[200] flex flex-col h-full border-l border-base-300 bg-base-100 shadow-2xl" style="width: 380px;">
        {@render chatContent()}
    </div>
{/if}

{#snippet chatContent()}
    <!-- Title Bar -->
    <div class="flex items-center justify-between px-3 py-2 bg-gradient-to-r from-primary/10 to-secondary/10 border-b border-base-300 shrink-0 select-none">
        <div class="flex items-center gap-2">
            <div class="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
                </svg>
            </div>
            <div>
                <span class="font-semibold text-sm">Ask Mediajam</span>
                {#if !ollamaConfigured}
                    <span class="badge badge-warning badge-xs ml-1">No LLM</span>
                {/if}
            </div>
        </div>
        <div class="flex items-center gap-0.5">
            {#if messages.length > 0}
                <button class="btn btn-ghost btn-xs btn-square opacity-50 hover:opacity-100" onclick={copyDebug} title="Copy debug info">
                    {#if copied}
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5 text-success" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
                    {:else}
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
                    {/if}
                </button>
                <button class="btn btn-ghost btn-xs btn-square opacity-50 hover:opacity-100" onclick={clearChat} title="Clear chat">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                </button>
            {/if}
            <!-- Minimize -->
            <button class="btn btn-ghost btn-xs btn-square opacity-50 hover:opacity-100" onclick={minimize} title="Minimize">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"/></svg>
            </button>
            <!-- Dock / Undock -->
            {#if mode === 'floating'}
                <button class="btn btn-ghost btn-xs btn-square opacity-50 hover:opacity-100" onclick={dock} title="Dock to sidebar">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="15" y1="3" x2="15" y2="21"/></svg>
                </button>
            {:else}
                <button class="btn btn-ghost btn-xs btn-square opacity-50 hover:opacity-100" onclick={undock} title="Float">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="6" width="13" height="13" rx="2"/><path d="M9 3h10a2 2 0 012 2v10"/></svg>
                </button>
            {/if}
            <!-- Close -->
            <button class="btn btn-ghost btn-xs btn-square opacity-50 hover:opacity-100" onclick={close} title="Close">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
        </div>
    </div>

    <!-- Messages -->
    <div class="flex-1 overflow-y-auto p-3 space-y-3" bind:this={messagesContainer}>
        {#if messages.length === 0}
            <div class="flex flex-col items-center justify-center h-full text-center text-base-content/40 gap-4 py-8">
                <div class="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 text-primary/50" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
                    </svg>
                </div>
                <div>
                    <p class="font-medium text-sm text-base-content/60">Ask about your library</p>
                    <div class="text-xs mt-2 space-y-1 max-w-[260px]">
                        <button class="block w-full text-left px-2 py-1 rounded hover:bg-base-200 transition-colors" onclick={() => { input = "What movies did I watch this month?"; sendMessage(); }}>
                            💬 "What movies did I watch this month?"
                        </button>
                        <button class="block w-full text-left px-2 py-1 rounded hover:bg-base-200 transition-colors" onclick={() => { input = "How many albums do I have?"; sendMessage(); }}>
                            💬 "How many albums do I have?"
                        </button>
                        <button class="block w-full text-left px-2 py-1 rounded hover:bg-base-200 transition-colors" onclick={() => { input = "Who are my favorite actors?"; sendMessage(); }}>
                            💬 "Who are my favorite actors?"
                        </button>
                    </div>
                </div>
            </div>
        {:else}
            {#each messages as msg, i}
                {#if msg.loading}
                    <div class="flex gap-2 items-start">
                        <div class="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center shrink-0 mt-0.5">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
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
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
                        </div>
                        <div class="bg-base-200 rounded-2xl rounded-tl-sm px-3 py-2 text-sm max-w-[90%] whitespace-pre-wrap">
                            {msg.text}
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
                placeholder={ollamaConfigured ? 'Ask anything...' : 'Ollama not configured'}
                disabled={!ollamaConfigured || sending}
                onkeydown={handleKeydown}
            />
            <button
                type="submit"
                class="btn btn-sm btn-primary btn-circle"
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
{/snippet}
