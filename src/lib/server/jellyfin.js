import { Jellyfin } from '@jellyfin/sdk';
import { getItemsApi } from '@jellyfin/sdk/lib/utils/api/items-api.js';
import { getSystemApi } from '@jellyfin/sdk/lib/utils/api/system-api.js';
import { getUserApi } from '@jellyfin/sdk/lib/utils/api/user-api.js';
import { getLibraryApi } from '@jellyfin/sdk/lib/utils/api/library-api.js';
import { getTvShowsApi } from '@jellyfin/sdk/lib/utils/api/tv-shows-api.js';

const jellyfin = new Jellyfin({
    clientInfo: { name: 'Mediajam', version: '0.1.0' },
    deviceInfo: { name: 'Mediajam Server', id: 'mediajam-server-001' }
});

/**
 * Create an authenticated Jellyfin API instance.
 * @param {string} serverUrl - The Jellyfin server URL
 * @param {string} [accessToken] - Optional access token for authenticated requests
 */
export function createJellyfinApi(serverUrl, accessToken) {
    const api = jellyfin.createApi(serverUrl);
    if (accessToken) {
        api.accessToken = accessToken;
    }
    return api;
}

/**
 * Get the items API for a given API instance.
 */
export { getItemsApi, getSystemApi, getUserApi, getLibraryApi, getTvShowsApi };

/**
 * Convenience: create an API and return common sub-APIs.
 * @param {string} serverUrl
 * @param {string} accessToken
 */
export function getJellyfinApis(serverUrl, accessToken) {
    const api = createJellyfinApi(serverUrl, accessToken);
    return {
        api,
        items: getItemsApi(api),
        system: getSystemApi(api),
        users: getUserApi(api),
        library: getLibraryApi(api),
        tvShows: getTvShowsApi(api)
    };
}

export { jellyfin };
