/**
 * Player status store — shared state for the default remote player.
 * Polls /api/player/status at a configurable interval, but only
 * when the tab is visible and deduplicates across multiple tabs
 * via the server-side cache (15s TTL).
 */
import { writable, get } from 'svelte/store';
import { browser } from '$app/environment';

/** @typedef {{ status: 'idle'|'online'|'busy'|'playing'|'offline'|'unknown', deviceName: string, currentApp?: string, nowPlaying?: { name: string, type: string, seriesName?: string, seasonName?: string, id?: string }, sessionId?: string, canLaunch: boolean, playState?: { isPaused: boolean, positionTicks?: number } }} PlayerStatus */

/** @type {import('svelte/store').Writable<PlayerStatus|null>} */
export const playerStatus = writable(null);

/** @type {import('svelte/store').Writable<boolean>} */
export const playerLoading = writable(false);

let pollTimer = 0;
let subscriberCount = 0;

const POLL_INTERVAL = 30_000; // 30 seconds

async function fetchStatus() {
    if (!browser) return;
    // Only fetch when tab is visible
    if (document.visibilityState === 'hidden') return;

    try {
        playerLoading.set(true);
        const res = await fetch('/api/player/status');
        if (res.ok) {
            const data = await res.json();
            playerStatus.set(data);
        } else {
            playerStatus.set(null);
        }
    } catch {
        playerStatus.set(null);
    } finally {
        playerLoading.set(false);
    }
}

/** Start polling — call from component onMount. Returns a cleanup function. */
export function startPolling() {
    subscriberCount++;
    if (subscriberCount === 1 && browser) {
        // Initial fetch
        fetchStatus();
        // Start interval
        pollTimer = window.setInterval(fetchStatus, POLL_INTERVAL);
        // Pause when tab hidden, resume when visible
        document.addEventListener('visibilitychange', onVisibilityChange);
    }
    return () => {
        subscriberCount--;
        if (subscriberCount <= 0) {
            subscriberCount = 0;
            if (pollTimer) {
                clearInterval(pollTimer);
                pollTimer = 0;
            }
            document.removeEventListener('visibilitychange', onVisibilityChange);
        }
    };
}

function onVisibilityChange() {
    if (document.visibilityState === 'visible') {
        // Immediately fetch on re-focus, then restart interval
        fetchStatus();
        if (pollTimer) clearInterval(pollTimer);
        pollTimer = window.setInterval(fetchStatus, POLL_INTERVAL);
    } else {
        // Pause polling when hidden
        if (pollTimer) {
            clearInterval(pollTimer);
            pollTimer = 0;
        }
    }
}

/** Force an immediate status refresh */
export function refreshPlayerStatus() {
    return fetchStatus();
}

/**
 * Send a play command to the default player.
 * @param {string} jellyfinId — The Jellyfin item ID to play
 * @param {'play'|'queue'} [action='play']
 * @returns {Promise<{ success?: boolean, error?: string }>}
 */
export async function quickPlay(jellyfinId, action = 'play') {
    try {
        const res = await fetch('/api/player/play', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jellyfinId, action }),
        });
        const data = await res.json();
        // Refresh status after play command
        setTimeout(fetchStatus, 2000);
        return data;
    } catch (err) {
        return { error: err instanceof Error ? err.message : 'Network error' };
    }
}

/**
 * Launch Jellyfin on the default player's device.
 * @returns {Promise<{ status?: string, error?: string }>}
 */
export async function launchJellyfin() {
    try {
        const res = await fetch('/api/player/launch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        });
        const data = await res.json();
        // Refresh status after launch
        setTimeout(fetchStatus, 3000);
        return data;
    } catch (err) {
        return { error: err instanceof Error ? err.message : 'Network error' };
    }
}
