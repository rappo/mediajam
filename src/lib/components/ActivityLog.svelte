<script>
    /**
     * ActivityLog — dropdown in the navbar that shows recent activities with
     * a badge for unread count. Clicking items can trigger actions (e.g. open
     * conflict dialog, navigate to settings).
     *
     * @component
     */
    import { invalidateAll } from "$app/navigation";

    /** @type {{ initialUnread?: number, conflictDialog?: any }} */
    let { initialUnread = 0, conflictDialog } = $props();

    let open = $state(false);
    let unreadCount = $state(initialUnread);
    /** @type {any[]} */
    let activities = $state([]);
    let loading = $state(false);
    let pollInterval = $state(/** @type {any} */ (null));

    // Start polling for unread count when mounted
    $effect(() => {
        pollUnread();
        pollInterval = setInterval(pollUnread, 30000); // Every 30s
        return () => clearInterval(pollInterval);
    });

    async function pollUnread() {
        try {
            const res = await fetch("/api/activity?limit=1");
            const data = await res.json();
            unreadCount = data.unreadCount;
        } catch { /* silent */ }
    }

    async function toggle() {
        open = !open;
        if (open) {
            await fetchActivities();
        }
    }

    function close() {
        open = false;
    }

    async function fetchActivities() {
        loading = true;
        try {
            const res = await fetch("/api/activity?limit=50");
            const data = await res.json();
            activities = data.activities || [];
            unreadCount = data.unreadCount;
        } catch { /* silent */ }
        loading = false;
    }

    async function markAllRead() {
        await fetch("/api/activity", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: "all" }),
        });
        unreadCount = 0;
        activities = activities.map((a) => ({ ...a, read: 1 }));
    }

    async function clearReadEntries() {
        const res = await fetch("/api/activity", { method: "DELETE" });
        const data = await res.json();
        activities = data.activities || [];
        unreadCount = data.unreadCount || 0;
    }

    /** @param {any} activity */
    async function handleClick(activity) {
        // Mark this one as read
        if (!activity.read) {
            await fetch("/api/activity", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id: activity.id }),
            });
            activity.read = 1;
            unreadCount = Math.max(0, unreadCount - 1);
        }

        // Handle actions
        if (activity.actionable && activity.action_type) {
            switch (activity.action_type) {
                case "open_conflict":
                    close();
                    conflictDialog?.show();
                    break;
                case "navigate": {
                    let actionData = activity.action_data;
                    if (typeof actionData === "string") {
                        try { actionData = JSON.parse(actionData); } catch { /* ignore */ }
                    }
                    if (actionData?.href) {
                        close();
                        window.location.href = actionData.href;
                    }
                    break;
                }
                default:
                    break;
            }
        }
    }

    /**
     * Format a detail string for display.
     * If it's JSON, extract a human-readable summary.
     * @param {string} detail
     * @returns {string}
     */
    function formatDetail(detail) {
        if (!detail) return "";
        if (typeof detail === "string" && detail.startsWith("{")) {
            try {
                const d = JSON.parse(detail);
                // Known keys — produce readable text
                if (d.summary) return d.summary;
                if (d.error) return d.error;
                // Generic: join key-value pairs as readable text
                return Object.entries(d)
                    .map(([k, v]) => `${k.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').trim()}: ${v}`)
                    .join(' · ');
            } catch {
                return detail;
            }
        }
        return detail;
    }

    /**
     * Human-readable relative time
     * @param {string} iso
     */
    function timeAgo(iso) {
        const diff = Date.now() - new Date(iso).getTime();
        const mins = Math.floor(diff / 60000);
        if (mins < 1) return "just now";
        if (mins < 60) return `${mins}m ago`;
        const hrs = Math.floor(mins / 60);
        if (hrs < 24) return `${hrs}h ago`;
        const days = Math.floor(hrs / 24);
        return `${days}d ago`;
    }
</script>

<div class="relative">
    <button
        class="btn btn-ghost btn-sm btn-circle indicator"
        onclick={toggle}
        title="Activity Log"
    >
        {#if unreadCount > 0}
            <span class="indicator-item badge badge-primary badge-xs"
                >{unreadCount > 99 ? "99+" : unreadCount}</span
            >
        {/if}
        <svg
            xmlns="http://www.w3.org/2000/svg"
            class="h-5 w-5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
        >
            <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 01-3.46 0" />
        </svg>
    </button>

    {#if open}
        <!-- Backdrop -->
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="fixed inset-0 z-[90]" onclick={close}></div>

        <!-- Dropdown panel -->
        <div
            class="absolute right-0 top-full mt-2 w-96 max-h-[80vh] bg-base-200 border border-base-300 rounded-xl shadow-2xl z-[100] flex flex-col overflow-hidden"
        >
            <!-- Header -->
                <div class="flex items-center justify-between px-4 py-3 border-b border-base-300">
                <h3 class="font-semibold text-sm">Activity</h3>
                <div class="flex gap-1">
                    {#if activities.some(a => a.read)}
                        <button
                            class="btn btn-ghost btn-xs text-base-content/50"
                            onclick={clearReadEntries}>Clear read</button
                        >
                    {/if}
                    {#if unreadCount > 0}
                        <button
                            class="btn btn-ghost btn-xs text-primary"
                            onclick={markAllRead}>Mark all read</button
                        >
                    {/if}
                </div>
            </div>

            <!-- Body -->
            <div class="overflow-y-auto flex-1">
                {#if loading}
                    <div class="flex justify-center py-8">
                        <span class="loading loading-spinner loading-sm"
                        ></span>
                    </div>
                {:else if activities.length === 0}
                    <div
                        class="text-center py-10 text-base-content/40 text-sm"
                    >
                        No recent activity
                    </div>
                {:else}
                    {#each activities as activity}
                        <!-- svelte-ignore a11y_click_events_have_key_events -->
                        <!-- svelte-ignore a11y_no_static_element_interactions -->
                        <div
                            class="flex items-start gap-3 px-4 py-3 border-b border-base-content/5 transition-colors {activity.read
                                ? 'opacity-60'
                                : 'bg-primary/5'} {activity.actionable
                                ? 'cursor-pointer hover:bg-base-300/50'
                                : ''}"
                            onclick={() => handleClick(activity)}
                        >
                            <!-- Icon -->
                            <span class="text-base mt-0.5 shrink-0"
                                >{activity.icon || "📋"}</span
                            >

                            <!-- Content -->
                            <div class="flex-1 min-w-0">
                                <div
                                    class="text-sm {activity.read
                                        ? ''
                                        : 'font-medium'}"
                                >
                                    {activity.title}
                                </div>
                                {#if activity.detail}
                                    <div
                                        class="text-xs text-base-content/50 mt-0.5 truncate"
                                    >
                                        {formatDetail(activity.detail)}
                                    </div>
                                {/if}
                                {#if activity.actionable}
                                    <div class="text-xs text-primary/60 mt-0.5">
                                        Click to view →
                                    </div>
                                {/if}
                            </div>

                            <!-- Time + status -->
                            <div class="text-right shrink-0">
                                <div class="text-xs text-base-content/40">
                                    {timeAgo(activity.created_at)}
                                </div>
                                {#if activity.status !== "info"}
                                    <span
                                        class="badge badge-xs mt-0.5 {activity.status ===
                                        'success'
                                            ? 'badge-success'
                                            : activity.status === 'error'
                                              ? 'badge-error'
                                              : activity.status === 'warning'
                                                ? 'badge-warning'
                                                : ''}"
                                    >
                                        {activity.status}
                                    </span>
                                {/if}
                            </div>

                            <!-- Unread dot -->
                            {#if !activity.read}
                                <span
                                    class="w-2 h-2 rounded-full bg-primary shrink-0 mt-2"
                                ></span>
                            {/if}
                        </div>
                    {/each}
                {/if}
            </div>
        </div>
    {/if}
</div>
