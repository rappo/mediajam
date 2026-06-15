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

                    // Show toast for the event
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
