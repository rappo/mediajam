import { writable } from 'svelte/store';

/** Global notification unread count — updated by ActivityLog polling */
export const notificationCount = writable(0);
