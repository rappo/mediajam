/**
 * Shared PKCE store for OpenAI Codex OAuth flow.
 * Stores verifiers keyed by state parameter.
 * @type {Map<string, { verifier: string, userId: number, createdAt: number }>}
 */
export const pkceStore = new Map();

/**
 * Clean up PKCE entries older than 10 minutes.
 */
export function cleanupPkceStore() {
    const tenMinAgo = Date.now() - 600_000;
    for (const [key, val] of pkceStore) {
        if (val.createdAt < tenMinAgo) pkceStore.delete(key);
    }
}
