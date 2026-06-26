<script>
    /**
     * ArrEventListener — invisible component that subscribes to *arr webhook
     * events via SSE and shows toast notifications for downloads, imports, etc.
     *
     * Mount once in the root layout (alongside SyncFooter / ToastContainer).
     * @component
     */
    import { onMount } from 'svelte';
    import { addToast } from '$lib/stores/toast.js';

    /** Map event types to toast types */
    const TOAST_TYPE_MAP = /** @type {Record<string, 'info' | 'success' | 'warning' | 'error'>} */ ({
        Grab: 'info',
        Download: 'success',
        MovieAdded: 'info',
        SeriesAdd: 'info',
        AlbumAdded: 'info',
        MovieDelete: 'warning',
        SeriesDelete: 'warning',
        ArtistDelete: 'warning',
        MovieFileDelete: 'warning',
        EpisodeFileDelete: 'warning',
        Rename: 'info',
        Health: 'warning',
        Test: 'info',
    });

    function formatDetail(detail) {
        if (!detail) return undefined;
        if (typeof detail === 'string' && detail.startsWith('{')) {
            try {
                const d = JSON.parse(detail);
                if (d.summary) return d.summary;
                if (d.error) return d.error;
                return Object.entries(d)
                    .map(([k, v]) => `${k.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').trim()}: ${v}`)
                    .join(' · ');
            } catch {
                return detail;
            }
        }
        return detail;
    }

    onMount(() => {
        /** @type {EventSource | null} */
        let es = null;
        /** @type {ReturnType<typeof setTimeout> | null} */
        let reconnectTimer = null;
        let destroyed = false;

        function connect() {
            if (destroyed) return;
            es = new EventSource('/api/arr/webhook');

            es.onmessage = (e) => {
                try {
                    const data = JSON.parse(e.data);

                    // Skip the initial connected message
                    if (data.type === 'connected') return;

                    // Handle general activities (non-sync)
                    if (data.type === 'activity_log') {
                        if (data.category === 'sync') return;
                        addToast({
                            type: data.status || 'info',
                            message: data.title,
                            detail: formatDetail(data.detail),
                            duration: data.status === 'success' ? 8000 : 6000,
                        });
                        return;
                    }

                    // Show toast for webhook events
                    const toastType = TOAST_TYPE_MAP[data.eventType] || 'info';
                    addToast({
                        type: toastType,
                        message: data.title || 'Download event',
                        detail: data.detail || undefined,
                        duration: toastType === 'success' ? 10000 : 8000,
                    });
                } catch {
                    // ignore parse errors
                }
            };

            es.onerror = () => {
                if (es) es.close();
                // Reconnect after 30 seconds
                if (!destroyed) {
                    reconnectTimer = setTimeout(connect, 30000);
                }
            };
        }

        connect();

        return () => {
            destroyed = true;
            if (es) es.close();
            if (reconnectTimer) clearTimeout(reconnectTimer);
        };
    });
</script>
