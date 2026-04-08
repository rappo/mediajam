<script>
    import { page } from "$app/stores";
    import { goto } from "$app/navigation";

    let deletedTitle = $derived($page.url.searchParams.get("deleted"));
    let undoToken = $derived($page.url.searchParams.get("undoToken"));
    let undoId = $derived($page.url.searchParams.get("undoId"));

    let visible = $state(true);
    let undoing = $state(false);
    let undone = $state(false);

    const DURATION = 20; // seconds

    // Auto-dismiss after DURATION seconds
    $effect(() => {
        if (deletedTitle) {
            visible = true;
            undone = false;
            const timer = setTimeout(() => {
                visible = false;
                cleanUrl();
            }, DURATION * 1000);
            return () => clearTimeout(timer);
        }
    });

    function cleanUrl() {
        const url = new URL($page.url);
        url.searchParams.delete("deleted");
        url.searchParams.delete("undoToken");
        url.searchParams.delete("undoId");
        history.replaceState({}, "", url.pathname + url.search);
    }

    async function undo() {
        if (!undoToken || !undoId) return;
        undoing = true;
        try {
            const res = await fetch(`/api/media/${undoId}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ undoToken }),
            });
            const result = await res.json();
            if (result.success) {
                undone = true;
                setTimeout(() => {
                    goto(`/${result.route}/${result.id}`);
                }, 800);
            } else {
                alert(result.error || "Undo failed");
            }
        } catch (e) {
            alert(e instanceof Error ? e.message : "Undo failed");
        }
        undoing = false;
    }

    function dismiss() {
        visible = false;
        cleanUrl();
    }
</script>

{#if deletedTitle && visible}
    <div
        class="delete-toast {undone ? 'toast-success' : 'toast-info'}"
    >
        <div class="toast-content">
            {#if undone}
                <span>✅ <strong>{deletedTitle}</strong> has been restored.</span>
            {:else}
                <span>🗑️ <strong>{deletedTitle}</strong> has been deleted.</span>
            {/if}
        </div>
        <div class="toast-actions">
            {#if !undone && undoToken}
                <button
                    class="btn btn-sm btn-ghost"
                    onclick={undo}
                    disabled={undoing}
                >
                    {#if undoing}
                        <span class="loading loading-spinner loading-xs"
                        ></span>
                    {:else}
                        ↩ Undo
                    {/if}
                </button>
            {/if}
            <div class="timer-ring" class:hidden={undone}>
                <svg viewBox="0 0 24 24" class="timer-svg">
                    <circle class="timer-track" cx="12" cy="12" r="10" />
                    <circle class="timer-progress" cx="12" cy="12" r="10" />
                </svg>
            </div>
            <button
                class="btn btn-sm btn-ghost btn-circle btn-xs"
                onclick={dismiss}
            >
                ✕
            </button>
        </div>
    </div>
{/if}

<style>
    .delete-toast {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.75rem;
        padding: 0.75rem 1rem;
        border-radius: 0.75rem;
        margin-bottom: 1rem;
        animation: slideIn 0.3s ease-out;
        border: 1px solid;
    }

    .toast-info {
        background: oklch(0.25 0.02 250 / 0.8);
        border-color: oklch(0.5 0.1 250 / 0.3);
        color: oklch(0.9 0.02 250);
    }

    .toast-success {
        background: oklch(0.25 0.04 150 / 0.8);
        border-color: oklch(0.5 0.1 150 / 0.3);
        color: oklch(0.9 0.04 150);
    }

    .toast-content {
        flex: 1;
        font-size: 0.875rem;
    }

    .toast-actions {
        display: flex;
        align-items: center;
        gap: 0.5rem;
    }

    .timer-ring {
        width: 22px;
        height: 22px;
        flex-shrink: 0;
    }

    .timer-ring.hidden {
        display: none;
    }

    .timer-svg {
        width: 100%;
        height: 100%;
        transform: rotate(-90deg);
    }

    .timer-track {
        fill: none;
        stroke: oklch(0.5 0 0 / 0.2);
        stroke-width: 2;
    }

    .timer-progress {
        fill: none;
        stroke: oklch(0.7 0.1 250);
        stroke-width: 2;
        stroke-linecap: round;
        stroke-dasharray: 62.83; /* 2 * PI * 10 */
        stroke-dashoffset: 0;
        animation: countdown var(--duration, 20s) linear forwards;
    }

    @keyframes countdown {
        from {
            stroke-dashoffset: 0;
        }
        to {
            stroke-dashoffset: 62.83;
        }
    }

    @keyframes slideIn {
        from {
            opacity: 0;
            transform: translateY(-8px);
        }
        to {
            opacity: 1;
            transform: translateY(0);
        }
    }
</style>
