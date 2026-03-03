import { json } from '@sveltejs/kit';

/**
 * POST /api/settings/validate — Test API keys against external services.
 * Body: { service: 'tvdb' | 'tmdb' | 'trakt' | 'lastfm', credentials: { ... } }
 * @type {import('./$types').RequestHandler}
 */
export async function POST({ request }) {
    const { service, credentials } = await request.json();

    try {
        switch (service) {
            case 'tvdb': {
                // TVDB v4 API — login with API key
                const res = await fetch('https://api4.thetvdb.com/v4/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ apikey: credentials.tvdb_api_key })
                });
                if (res.ok) {
                    return json({ valid: true, message: 'TVDB API key is valid' });
                }
                const err = await res.json().catch(() => ({}));
                return json({ valid: false, message: err?.message || `TVDB returned ${res.status}` });
            }

            case 'tmdb': {
                // TMDB v3 — test with configuration endpoint
                const res = await fetch(`https://api.themoviedb.org/3/configuration?api_key=${encodeURIComponent(credentials.tmdb_api_key)}`);
                if (res.ok) {
                    return json({ valid: true, message: 'TMDB API key is valid' });
                }
                const err = await res.json().catch(() => ({}));
                return json({ valid: false, message: err?.status_message || `TMDB returned ${res.status}` });
            }

            case 'trakt': {
                // Trakt — test with calendars endpoint (no auth needed, just client-id header)
                const res = await fetch('https://api.trakt.tv/shows/trending?limit=1', {
                    headers: {
                        'Content-Type': 'application/json',
                        'trakt-api-version': '2',
                        'trakt-api-key': credentials.trakt_client_id
                    }
                });
                if (res.ok) {
                    return json({ valid: true, message: 'Trakt Client ID is valid' });
                }
                return json({ valid: false, message: `Trakt returned ${res.status} — check your Client ID` });
            }

            case 'lastfm': {
                // Last.fm — test with a simple info request
                const res = await fetch(`https://ws.audioscrobbler.com/2.0/?method=chart.gettopartists&api_key=${encodeURIComponent(credentials.lastfm_api_key)}&format=json&limit=1`);
                if (res.ok) {
                    const data = await res.json();
                    if (data.error) {
                        return json({ valid: false, message: data.message || 'Invalid API key' });
                    }
                    return json({ valid: true, message: 'Last.fm API key is valid' });
                }
                return json({ valid: false, message: `Last.fm returned ${res.status}` });
            }

            default:
                return json({ valid: false, message: `Unknown service: ${service}` }, { status: 400 });
        }
    } catch (e) {
        return json({ valid: false, message: `Connection error: ${e.message}` });
    }
}
