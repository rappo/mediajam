import { json } from '@sveltejs/kit';

/** @type {import('./$types').RequestHandler} */
export async function POST({ request }) {
    const { urls, validate } = await request.json();

    const results = [];

    for (const url of urls) {
        try {
            const cleanUrl = url.replace(/\/+$/, '');
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 3000);

            const res = await fetch(`${cleanUrl}/System/Info/Public`, {
                signal: controller.signal,
                headers: { 'Accept': 'application/json' }
            });

            clearTimeout(timeoutId);

            if (res.ok) {
                const info = await res.json();
                results.push({
                    url: cleanUrl,
                    success: true,
                    info: {
                        ServerName: info.ServerName,
                        Version: info.Version,
                        Id: info.Id,
                        OperatingSystem: info.OperatingSystem
                    }
                });
            } else {
                results.push({ url: cleanUrl, success: false, error: `HTTP ${res.status}` });
            }
        } catch (e) {
            results.push({ url, success: false, error: e.message });
        }
    }

    return json({ results });
}
