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

    // Also try localhost, Docker host gateway, and common addresses
    const hostIPs = await getDockerHostIPs();
    const candidates = new Set([
        '127.0.0.1',
        ...hostIPs,
        ...subnets.flatMap(s => generateSubnetIPs(s)),
        // Also scan subnets discovered from the host gateway
        ...hostIPs.flatMap(ip => {
            const parts = ip.split('.');
            if (parts.length === 4) {
                const subnet = `${parts[0]}.${parts[1]}.${parts[2]}`;
                // Only scan non-Docker subnets we haven't covered yet
                if (!subnets.includes(subnet)) return generateSubnetIPs(subnet);
            }
            return [];
        })
    ]);

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
 * Get Docker host gateway IPs so we can scan the host's network.
 * Inside Docker, the container only sees 172.17.x.x — this resolves the actual host IP.
 * @returns {Promise<string[]>}
 */
async function getDockerHostIPs() {
    const ips = [];

    // 1. Try host.docker.internal (Docker Desktop + extra_hosts in compose)
    try {
        const dns = await import('dns');
        const { promisify } = await import('util');
        const lookup = promisify(dns.lookup);
        const result = await lookup('host.docker.internal');
        if (result?.address) ips.push(result.address);
    } catch { /* not available */ }

    // 2. Try reading default gateway from /proc/net/route (Linux Docker)
    try {
        const fs = await import('fs');
        const routes = fs.readFileSync('/proc/net/route', 'utf8');
        for (const line of routes.split('\n').slice(1)) {
            const parts = line.trim().split(/\s+/);
            if (parts[1] === '00000000' && parts[7] === '00000000') {
                // Default route — gateway is in parts[2] as little-endian hex
                const hex = parts[2];
                const ip = [
                    parseInt(hex.slice(6, 8), 16),
                    parseInt(hex.slice(4, 6), 16),
                    parseInt(hex.slice(2, 4), 16),
                    parseInt(hex.slice(0, 2), 16)
                ].join('.');
                if (ip !== '0.0.0.0') ips.push(ip);
                break;
            }
        }
    } catch { /* not on Linux or no /proc */ }

    // 3. Common Docker bridge gateway
    ips.push('172.17.0.1');

    return [...new Set(ips)];
}

/**
 * Probe a single IP for Ollama on port 11434.
 * @param {string} ip
 * @returns {Promise<{ url: string, models: number } | null>}
 */
async function probeOllama(ip) {
    try {
        const res = await fetch(`http://${ip}:11434/api/tags`, {
            signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) return null;
        const data = await res.json();
        const modelCount = (data.models || []).length;
        return { url: `http://${ip}:11434`, models: modelCount };
    } catch {
        return null;
    }
}
