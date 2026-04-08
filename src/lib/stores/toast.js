/**
 * Global toast store for error/info notifications.
 * Usage:
 *   import { addToast } from '$lib/stores/toast.js';
 *   addToast({ type: 'error', message: 'Something failed', detail: 'Full error text' });
 */

/** @type {import('svelte/store').Writable<Array<{id: number, type: string, message: string, detail?: string}>>} */
import { writable } from 'svelte/store';

export const toasts = writable(/** @type {Array<{id: number, type: string, message: string, detail?: string}>} */([]));

let nextId = 0;

/**
 * Add a toast notification.
 * @param {{ type?: 'error' | 'info' | 'success' | 'warning', message: string, detail?: string, duration?: number }} toast
 */
export function addToast({ type = 'info', message, detail, duration = 8000 }) {
    const id = nextId++;
    toasts.update(t => [...t, { id, type, message, detail }]);
    if (duration > 0) {
        setTimeout(() => removeToast(id), duration);
    }
}

/**
 * Remove a toast by id.
 * @param {number} id
 */
export function removeToast(id) {
    toasts.update(t => t.filter(toast => toast.id !== id));
}
