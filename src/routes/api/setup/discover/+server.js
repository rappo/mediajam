import { json } from '@sveltejs/kit';
import { createJellyfinApi, getSystemApi } from '$lib/server/jellyfin.js';

/** @type {import('./$types').RequestHandler} */
export async function POST({ request }) {
    const { urls, validate } = await request.json();

    const results = [];

    for (const url of urls) {
        try {
            const cleanUrl = url.replace(/\/+$/, '');
            const api = createJellyfinApi(cleanUrl);
            const sysInfo = await getSystemApi(api).getPublicSystemInfo();

            results.push({
                url: cleanUrl,
                success: true,
                info: {
                    ServerName: sysInfo.data.ServerName,
                    Version: sysInfo.data.Version,
                    Id: sysInfo.data.Id,
                    OperatingSystem: sysInfo.data.OperatingSystem
                }
            });
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            results.push({ url, success: false, error: msg });
        }
    }

    return json({ results });
}
