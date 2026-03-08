<script>
    import { addToast } from "$lib/stores/toast.js";

    /**
     * FavoriteButton: Heart icon that toggles favorite status.
     * Bidirectional: updates local DB and pushes to Jellyfin.
     *
     * @type {{ type: 'media' | 'person', id: number, isFavorite: boolean, size?: string }}
     */
    let { type, id, isFavorite = false, size = "1.4rem" } = $props();

    let favorite = $state(isFavorite);
    let loading = $state(false);
    let prevIsFavorite = isFavorite;

    // Sync from prop ONLY when the prop itself changes (not when loading changes)
    $effect(() => {
        const current = isFavorite; // track only this
        if (current !== prevIsFavorite) {
            prevIsFavorite = current;
            favorite = current;
        }
    });

    /** @param {Event} event */
    async function toggle(event) {
        event.stopPropagation();
        event.preventDefault();
        if (loading) return;
        loading = true;
        const newVal = !favorite;
        favorite = newVal; // Optimistic update

        try {
            const res = await fetch("/api/favorite", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ type, id, isFavorite: newVal }),
            });
            if (!res.ok) {
                const errBody = await res.text();
                favorite = !newVal; // Revert on error
                addToast({
                    type: "error",
                    message: `Failed to update favorite (${res.status})`,
                    detail: errBody,
                });
            }
        } catch (/** @type {any} */ err) {
            favorite = !newVal; // Revert on error
            addToast({
                type: "error",
                message: "Failed to update favorite",
                detail: err?.message || String(err),
            });
        } finally {
            loading = false;
        }
    }
</script>

<button
    class="favorite-btn"
    class:active={favorite}
    onclick={toggle}
    title={favorite ? "Remove from favorites" : "Add to favorites"}
    aria-label={favorite ? "Remove from favorites" : "Add to favorites"}
>
    {#if loading}
        <span class="spinner" style="width:{size};height:{size}"></span>
    {:else}
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            width={size}
            height={size}
            fill={favorite ? "currentColor" : "none"}
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
        >
            <path
                d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"
            />
        </svg>
    {/if}
</button>

<style>
    .favorite-btn {
        background: none;
        border: none;
        cursor: pointer;
        padding: 0.35rem;
        border-radius: 50%;
        color: var(--text-secondary, #888);
        transition: all 0.2s ease;
        display: inline-flex;
        align-items: center;
        justify-content: center;
    }
    .favorite-btn:hover {
        color: #e74c3c;
        background: rgba(231, 76, 60, 0.1);
        transform: scale(1.1);
    }
    .favorite-btn.active {
        color: #e74c3c;
    }
    .favorite-btn.active:hover {
        color: #c0392b;
    }
    .favorite-btn svg {
        transition: transform 0.15s ease;
    }
    .favorite-btn.active svg {
        animation: heartPop 0.3s ease;
    }
    .spinner {
        display: inline-block;
        border: 2px solid rgba(231, 76, 60, 0.2);
        border-top-color: #e74c3c;
        border-radius: 50%;
        animation: spin 0.6s linear infinite;
    }
    @keyframes heartPop {
        0% {
            transform: scale(1);
        }
        50% {
            transform: scale(1.3);
        }
        100% {
            transform: scale(1);
        }
    }
    @keyframes spin {
        to {
            transform: rotate(360deg);
        }
    }
</style>
