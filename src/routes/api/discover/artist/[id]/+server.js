import db from '$lib/server/db.js';
import { json } from '@sveltejs/kit';

const MB_BASE = 'https://musicbrainz.org/ws/2';
const MB_USER_AGENT = 'Mediajam/1.0 (https://github.com/mediajam)';
const CAA_BASE = 'https://coverartarchive.org';

/**
 * GET /api/discover/artist/[id] — fetch full discography from MusicBrainz,
 * cross-reference with local library, return albums not owned.
 */
export async function GET({ params, locals }) {
    if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

    const artistId = parseInt(params.id);
    const artist = /** @type {any} */ (db.prepare(
        'SELECT id, title, musicbrainz_id FROM media_parents WHERE id = ? AND media_type = ?'
    ).get(artistId, 'artist'));

    if (!artist) return json({ error: 'Artist not found' }, { status: 404 });
    if (!artist.musicbrainz_id) {
        return json({ error: 'No MusicBrainz ID — cannot discover discography' }, { status: 400 });
    }

    const mbId = artist.musicbrainz_id;

    // Step 1: Fetch all release groups (albums, EPs, singles, compilations) from MusicBrainz
    /** @type {any[]} */
    let allReleaseGroups = [];
    let offset = 0;
    const limit = 100;

    while (true) {
        const url = `${MB_BASE}/release-group?artist=${mbId}&limit=${limit}&offset=${offset}&fmt=json`;
        const res = await fetch(url, {
            headers: { 'User-Agent': MB_USER_AGENT, 'Accept': 'application/json' }
        });

        if (!res.ok) {
            return json({ error: `MusicBrainz API error: ${res.status}` }, { status: 502 });
        }

        const data = await res.json();
        const groups = data['release-groups'] || [];
        allReleaseGroups = allReleaseGroups.concat(groups);

        if (allReleaseGroups.length >= (data['release-group-count'] || 0) || groups.length < limit) {
            break;
        }
        offset += limit;

        // Rate limit: MusicBrainz requires 1 req/sec
        await new Promise(r => setTimeout(r, 1100));
    }

    // Step 2: Get local albums for cross-reference
    const localAlbums = /** @type {any[]} */ (db.prepare(
        `SELECT mc.id, mc.title, mc.item_number as release_year, mc.jellyfin_id
         FROM media_children mc WHERE mc.parent_id = ?`
    ).all(artistId));

    // Build lookup sets
    const localTitleYears = new Set(
        localAlbums.map(a => `${(a.title || '').toLowerCase().trim()}:${a.release_year || ''}`)
    );
    const localTitles = new Set(
        localAlbums.map(a => (a.title || '').toLowerCase().trim())
    );

    // Step 3: Normalize and deduplicate release groups
    /** @type {any[]} */
    const discoveredAlbums = [];

    for (const rg of allReleaseGroups) {
        const title = rg.title || 'Unknown';
        const titleNorm = title.toLowerCase().trim();
        const year = rg['first-release-date']?.split('-')[0] || null;
        const type = rg['primary-type'] || 'Album';
        const secondaryTypes = (rg['secondary-types'] || []);

        // Skip compilations and live albums by default (they clutter discovery)
        if (secondaryTypes.includes('Compilation') || secondaryTypes.includes('DJ-mix')) continue;

        // Check if in library (by title+year or just title)
        const inLibrary = localTitleYears.has(`${titleNorm}:${year || ''}`) || localTitles.has(titleNorm);
        const libraryAlbum = inLibrary ? localAlbums.find(a =>
            (a.title || '').toLowerCase().trim() === titleNorm
        ) : null;

        // Cover art from Cover Art Archive
        const coverUrl = `${CAA_BASE}/release-group/${rg.id}/front-250`;

        discoveredAlbums.push({
            mbid: rg.id,
            title,
            release_year: year ? parseInt(year) : null,
            type, // Album, EP, Single
            secondary_types: secondaryTypes,
            cover_url: coverUrl,
            in_library: inLibrary,
            library_id: libraryAlbum?.id || null,
            disambiguation: rg.disambiguation || null,
        });
    }

    // Sort: type priority (Album > EP > Single), then by year desc
    const typePriority = { 'Album': 0, 'EP': 1, 'Single': 2 };
    discoveredAlbums.sort((a, b) => {
        const ta = typePriority[a.type] ?? 3;
        const tb = typePriority[b.type] ?? 3;
        if (ta !== tb) return ta - tb;
        return (b.release_year || 0) - (a.release_year || 0);
    });

    const notInLibrary = discoveredAlbums.filter(a => !a.in_library);
    const inLibrary = discoveredAlbums.filter(a => a.in_library);

    return json({
        artist: { id: artist.id, name: artist.title, musicbrainz_id: mbId },
        discography: notInLibrary,
        inLibrary,
        totalReleaseGroups: discoveredAlbums.length
    });
}
