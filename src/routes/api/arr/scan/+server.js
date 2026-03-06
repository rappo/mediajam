import { json } from '@sveltejs/kit';
import { networkInterfaces } from 'os';
import { probeArr, SERVICE_CONFIG } from '$lib/server/arr-client.js';

/**
 * GET /api/arr/scan — Scan local network for Radarr/Sonarr/Lidarr instances.
 * Probes default ports on the local subnet.
 * @type {import('./$types').RequestHandler}
 */
export async function GET({ locals }) {
    if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

    const subnets = getLocalSubnets();
    // Always try localhost + Docker common addresses
    const baseIPs = new Set(['127.0.0.1', '172.17.0.1', ...subnets.flatMap(s => generateSubnetIPs(s))]);
    const ips = [...baseIPs];

    /** @type {Array<{ service: string, url: string, needsAuth: boolean }>} */
    const results = [];
    const BATCH = 50;

    const services = Object.entries(SERVICE_CONFIG).map(([name, cfg]) => ({
        name,
        port: cfg.defaultPort,
    }));

    for (let i = 0; i < ips.length; i += BATCH) {
        const batch = ips.slice(i, i + BATCH);
        const probes = batch.flatMap(ip =>
            services.map(svc => probeArr(ip, svc.port, svc.name))
        );
        const settled = await Promise.allSettled(probes);
        for (const r of settled) {
            if (r.status === 'fulfilled' && r.value) {
                // Deduplicate by service (keep first found)
                if (!results.find(x => x.service === r.value.service)) {
                    results.push(r.value);
                }
            }
        }
        // Stop early if we found all 3
        if (results.length >= 3) break;
    }

    return json({ found: results.length > 0, instances: results });
}

/** @returns {string[]} Array of subnet prefixes like "192.168.1" */
function getLocalSubnets() {
    const interfaces = networkInterfaces();
    const subnets = [];
    for (const iface of Object.values(interfaces)) {
        if (!iface) continue;
        for (const addr of iface) {
            if (addr.family === 'IPv4' && !addr.internal) {
                const parts = addr.address.split('.');
                if (parts.length === 4) {
                    subnets.push(`${parts[0]}.${parts[1]}.${parts[2]}`);
                }
            }
        }
    }
    return [...new Set(subnets)];
}

/** @param {string} subnet */
function generateSubnetIPs(subnet) {
    const ips = [];
    for (let i = 1; i < 255; i++) {
        ips.push(`${subnet}.${i}`);
    }
    return ips;
}
