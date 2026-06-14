<script>
    import { toasts, removeToast } from "$lib/stores/toast.js";
    import { copyToClipboard } from "$lib/utils.js";
    import MdiIcon from '$lib/components/MdiIcon.svelte';
    import { mdiCloseCircle, mdiAlert, mdiCheckCircle, mdiInformation, mdiContentCopy, mdiCheck, mdiClose } from '@mdi/js';

    let copyFeedback = $state(/** @type {number | null} */ (null));

    /**
     * @param {string} text
     * @param {number} id
     */
    async function copyText(text, id) {
        await copyToClipboard(text);
        copyFeedback = id;
        setTimeout(() => {
            if (copyFeedback === id) copyFeedback = null;
        }, 2000);
    }
</script>

{#if $toasts.length > 0}
    <div class="toast-container">
        {#each $toasts as toast (toast.id)}
            <div class="toast-item toast-{toast.type}" role="alert">
                <div class="toast-content">
                    <span class="toast-icon">
                        {#if toast.type === "error"}<MdiIcon icon={mdiCloseCircle} size={16} />
                        {:else if toast.type === "warning"}<MdiIcon icon={mdiAlert} size={16} />
                        {:else if toast.type === "success"}<MdiIcon icon={mdiCheckCircle} size={16} />
                        {:else}<MdiIcon icon={mdiInformation} size={16} />
                        {/if}
                    </span>
                    <div class="toast-text">
                        <p class="toast-message">{toast.message}</p>
                        {#if toast.detail}
                            <p class="toast-detail">{toast.detail}</p>
                        {/if}
                    </div>
                    <div class="toast-actions">
                        {#if toast.detail}
                            <button
                                class="toast-btn"
                                title="Copy error to clipboard"
                                onclick={() =>
                                    copyText(
                                        `${toast.message}\n${toast.detail}`,
                                        toast.id,
                                    )}
                            >
                                {#if copyFeedback === toast.id}
                                    <MdiIcon icon={mdiCheck} size={14} />
                                {:else}
                                    <MdiIcon icon={mdiContentCopy} size={14} />
                                {/if}
                            </button>
                        {/if}
                        <button
                            class="toast-btn toast-close"
                            title="Dismiss"
                            onclick={() => removeToast(toast.id)}
                        >
                            <MdiIcon icon={mdiClose} size={14} />
                        </button>
                    </div>
                </div>
            </div>
        {/each}
    </div>
{/if}

<style>
    .toast-container {
        position: fixed;
        bottom: 1.5rem;
        right: 1.5rem;
        z-index: 10000;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        max-width: 28rem;
        pointer-events: none;
    }
    .toast-item {
        pointer-events: auto;
        border-radius: 0.75rem;
        padding: 0.75rem 1rem;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
        animation: toast-in 0.25s ease-out;
        backdrop-filter: blur(12px);
    }
    .toast-error {
        background: rgba(220, 38, 38, 0.15);
        border: 1px solid rgba(220, 38, 38, 0.4);
        color: #fca5a5;
    }
    .toast-warning {
        background: rgba(234, 179, 8, 0.15);
        border: 1px solid rgba(234, 179, 8, 0.4);
        color: #fde68a;
    }
    .toast-success {
        background: rgba(34, 197, 94, 0.15);
        border: 1px solid rgba(34, 197, 94, 0.4);
        color: #86efac;
    }
    .toast-info {
        background: rgba(59, 130, 246, 0.15);
        border: 1px solid rgba(59, 130, 246, 0.4);
        color: #93c5fd;
    }
    .toast-content {
        display: flex;
        align-items: flex-start;
        gap: 0.5rem;
    }
    .toast-icon {
        font-size: 1rem;
        flex-shrink: 0;
        margin-top: 0.1rem;
    }
    .toast-text {
        flex: 1;
        min-width: 0;
    }
    .toast-message {
        font-size: 0.85rem;
        font-weight: 500;
        margin: 0;
        line-height: 1.4;
    }
    .toast-detail {
        font-size: 0.75rem;
        opacity: 0.7;
        margin: 0.25rem 0 0;
        line-height: 1.3;
        word-break: break-all;
        max-height: 4rem;
        overflow: hidden;
    }
    .toast-actions {
        display: flex;
        gap: 0.25rem;
        flex-shrink: 0;
    }
    .toast-btn {
        background: none;
        border: none;
        cursor: pointer;
        padding: 0.2rem 0.35rem;
        border-radius: 0.25rem;
        font-size: 0.8rem;
        opacity: 0.6;
        transition: opacity 0.15s;
        color: inherit;
    }
    .toast-btn:hover {
        opacity: 1;
        background: rgba(255, 255, 255, 0.1);
    }
    @keyframes toast-in {
        from {
            opacity: 0;
            transform: translateY(8px) scale(0.95);
        }
        to {
            opacity: 1;
            transform: translateY(0) scale(1);
        }
    }
</style>
