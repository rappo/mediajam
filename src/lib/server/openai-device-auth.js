/**
 * Shared state and constants for ChatGPT device code auth flow.
 * Extracted from +server.js because SvelteKit only allows HTTP method exports
 * (GET, POST, etc.) from route files.
 */

export const OPENAI_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
export const OPENAI_ISSUER = 'https://auth.openai.com';

// Server-side store for active device auth sessions (keyed by user_code)
/** @type {Map<string, {device_auth_id: string, user_code: string, interval: number, started: number}>} */
export const activeSessions = new Map();

// Clean up stale sessions older than 20 minutes
export function cleanupStaleSessions() {
    const now = Date.now();
    for (const [key, session] of activeSessions) {
        if (now - session.started > 20 * 60 * 1000) {
            activeSessions.delete(key);
        }
    }
}
