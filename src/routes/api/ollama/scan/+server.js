import { json } from '@sveltejs/kit';
import { networkInterfaces } from 'os';

/**
 * GET /api/ollama/scan — Scan local network for Ollama instances on port 11434.
 * Tries the local subnet (based on the server's own IP) with fast timeouts.
 * @type {import('./$types').RequestHandler}
 */
export async function GET({ locals }) {
    if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

    // Get local subnet from server's network interfaces
    const subnets = getLocalSubnets();
    if (!subnets.length) {
        return json({ found: false, error: 'Could not determine local network' });
    }

    // Also try localhost and common addresses
    const candidates = new Set(['127.0.0.1', ...subnets.flatMap(s => generateSubnetIPs(s))]);

    const results = [];
    const BATCH = 50; // scan 50 IPs concurrently
    const ips = [...candidates];

    for (let i = 0; i < ips.length; i += BATCH) {
        const batch = ips.slice(i, i + BATCH);
        const batchResults = await Promise.allSettled(
            batch.map(ip => probeOllama(ip))
        );
        for (const r of batchResults) {
            if (r.status === 'fulfilled' && r.value) {
                results.push(r.value);
            }
        }
        // If we found any, stop scanning
        if (results.length > 0) break;
    }

    if (results.length > 0) {
        return json({ found: true, instances: results });
    }
    return json({ found: false, instances: [] });
}

/**
 * Get local subnet prefixes from network interfaces.
 * @returns {string[]} Array of subnet prefixes like "192.168.1"
 */
function getLocalSubnets() {
    const interfaces = networkInterfaces();
    const subnets = [];
    for (const iface of Object.values(interfaces)) {
        if (!iface) continue;
        for (const addr of iface) {
            if (addr.family === 'IPv4' && !addr.internal) {
                // Extract subnet (first 3 octets)
                const parts = addr.address.split('.');
                if (parts.length === 4) {
                    subnets.push(`${parts[0]}.${parts[1]}.${parts[2]}`);
                }
            }
        }
    }
    return [...new Set(subnets)];
}

/**
 * Generate IPs to scan in a subnet (skip .0 and .255).
 * @param {string} subnet — like "192.168.1"
 * @returns {string[]}
 */
function generateSubnetIPs(subnet) {
    const ips = [];
    for (let i = 1; i < 255; i++) {
        ips.push(`${subnet}.${i}`);
    }
    return ips;
}

/**
 * Probe a single IP for Ollama on port 11434.
 * @param {string} ip
 * @returns {Promise<{ url: string, models: number } | null>}
 */
async function probeOllama(ip) {
    try {
        const res = await fetch(`http://${ip}:11434/api/tags`, {
            signal: AbortSignal.timeout(800),
        });
        if (!res.ok) return null;
        const data = await res.json();
        const modelCount = (data.models || []).length;
        return { url: `http://${ip}:11434`, models: modelCount };
    } catch {
        return null;
    }
}
