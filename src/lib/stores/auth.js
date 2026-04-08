import { writable } from 'svelte/store';

/**
 * Client-side flag for Jellyfin auth status.
 * Set to true when the sync engine (or any API call) detects a 401 from Jellyfin.
 * The layout subscribes to this and shows the re-auth banner immediately.
 */
export const jellyfinAuthInvalid = writable(false);
