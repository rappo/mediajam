import { fork } from 'child_process';
import { resolve } from 'path';
import { randomBytes, createHash } from 'crypto';
import db from '$lib/server/db.js';

let mcpProcess = null;
let mcpPort = null;

/**
 * Ensure a dedicated MCP API key exists in the api_keys table.
 * Returns the raw key string (mj_...).
 */
function ensureMcpApiKey() {
    // Check if an MCP key already exists
    const existing = /** @type {any} */ (db.prepare(
        "SELECT id, key_hash FROM api_keys WHERE name = 'MCP Server'"
    ).get());
    if (existing) {
        // We can't recover the raw key from the hash, so we need to store it.
        // If the key exists but we don't have the raw key, regenerate it.
        // Store raw key in app_settings for internal use only.
        const settings = /** @type {any} */ (db.prepare(
            'SELECT mcp_api_key FROM app_settings WHERE id = 1'
        ).get());
        if (settings?.mcp_api_key) {
            return settings.mcp_api_key;
        }
        // Key record exists but raw key is lost — delete and recreate
        db.prepare("DELETE FROM api_keys WHERE name = 'MCP Server'").run();
    }

    // Find the first admin user to own the key
    const admin = /** @type {any} */ (db.prepare(
        'SELECT id FROM users WHERE is_admin = 1 ORDER BY id LIMIT 1'
    ).get());
    if (!admin) {
        console.warn('[mcp-manager] No admin user found, cannot create MCP API key');
        return null;
    }

    // Generate key
    const rawKey = randomBytes(48).toString('base64url');
    const fullKey = `mj_${rawKey}`;
    const keyHash = createHash('sha256').update(fullKey).digest('hex');
    const keyPrefix = `mj_${rawKey.substring(0, 8)}`;

    db.prepare(`
        INSERT INTO api_keys (user_id, name, key_hash, key_prefix, permissions, expires_at)
        VALUES (?, 'MCP Server', ?, ?, '["admin"]', NULL)
    `).run(admin.id, keyHash, keyPrefix);

    // Store raw key in app_settings for internal retrieval
    db.prepare('UPDATE app_settings SET mcp_api_key = ? WHERE id = 1').run(fullKey);

    console.log('[mcp-manager] Created dedicated MCP API key');
    return fullKey;
}

/**
 * Start the MCP server as a child process if enabled in settings.
 */
export function startMcpServer() {
    if (mcpProcess) return; // Already running

    const settings = /** @type {any} */ (db.prepare(
        'SELECT mcp_enabled, mcp_port FROM app_settings WHERE id = 1'
    ).get());

    if (!settings?.mcp_enabled) {
        return;
    }

    const port = settings.mcp_port || 7332;
    const apiKey = ensureMcpApiKey();
    if (!apiKey) {
        console.error('[mcp-manager] Cannot start MCP server: no API key');
        return;
    }

    const appPort = process.env.PORT || '3000';
    const serverPath = resolve(process.cwd(), 'src/mcp/server.js');

    try {
        mcpProcess = fork(serverPath, ['--sse', '--port', String(port)], {
            env: {
                ...process.env,
                MEDIAJAM_URL: `http://localhost:${appPort}`,
                MEDIAJAM_API_KEY: apiKey,
            },
            stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
        });

        mcpPort = port;

        mcpProcess.stdout?.on('data', (data) => {
            const msg = data.toString().trim();
            if (msg) console.log(`[mcp-server] ${msg}`);
        });

        mcpProcess.stderr?.on('data', (data) => {
            const msg = data.toString().trim();
            if (msg) console.log(`[mcp-server] ${msg}`);
        });

        mcpProcess.on('exit', (code, signal) => {
            console.log(`[mcp-manager] MCP server exited (code=${code}, signal=${signal})`);
            mcpProcess = null;
            mcpPort = null;
        });

        mcpProcess.on('error', (err) => {
            console.error('[mcp-manager] MCP server error:', err.message);
            mcpProcess = null;
            mcpPort = null;
        });

        console.log(`[mcp-manager] MCP server started on port ${port} (pid=${mcpProcess.pid})`);
    } catch (err) {
        console.error('[mcp-manager] Failed to start MCP server:', err instanceof Error ? err.message : err);
        mcpProcess = null;
        mcpPort = null;
    }
}

/**
 * Stop the MCP server child process gracefully.
 */
export function stopMcpServer() {
    if (!mcpProcess) return;

    try {
        mcpProcess.kill('SIGTERM');
        console.log('[mcp-manager] MCP server stopped');
    } catch (err) {
        console.warn('[mcp-manager] Error stopping MCP server:', err instanceof Error ? err.message : err);
    }

    mcpProcess = null;
    mcpPort = null;
}

/**
 * Restart the MCP server (stop + start).
 */
export function restartMcpServer() {
    stopMcpServer();
    // Small delay to let the port be freed
    setTimeout(() => startMcpServer(), 500);
}

/**
 * Get current MCP server status.
 * @returns {{ running: boolean, port: number|null, pid: number|null }}
 */
export function getMcpStatus() {
    return {
        running: mcpProcess !== null && !mcpProcess.killed,
        port: mcpPort,
        pid: mcpProcess?.pid ?? null,
    };
}
