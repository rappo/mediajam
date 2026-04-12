import db from '$lib/server/db.js';
import { json } from '@sveltejs/kit';

/**
 * GET /api/pages/calendar — Fetch all library media grouped by release date.
 *
 * Query params:
 *   year      — Filter to specific year (default: current year)
 *   month     — Filter to specific month 1-12 (optional)
 *   type      — all | show | movie | artist (default: all)
 *   status    — all | watched | unwatched | in_progress (default: all)
 *   span      — Time span preset: last7d | last30d | last90d | lastYear | custom (default: custom)
 *   futureDays — Include items releasing up to N days in the future (default: 0)
 */
export async function GET({ url, locals }) {
    if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

    const type = url.searchParams.get('type') || 'all';
    const status = url.searchParams.get('status') || 'all';
    const span = url.searchParams.get('span') || 'custom';
    const futureDays = Math.min(365, Math.max(0, parseInt(url.searchParams.get('futureDays') || '0') || 0));

    // Resolve date range based on span
    let startDate = '';
    let endDate = '';

    const now = new Date();

    if (span === 'last7d') {
        const s = new Date(now);
        s.setDate(s.getDate() - 7);
        startDate = s.toISOString().split('T')[0];
    } else if (span === 'last30d') {
        const s = new Date(now);
        s.setDate(s.getDate() - 30);
        startDate = s.toISOString().split('T')[0];
    } else if (span === 'last90d') {
        const s = new Date(now);
        s.setDate(s.getDate() - 90);
        startDate = s.toISOString().split('T')[0];
    } else if (span === 'lastYear') {
        const s = new Date(now);
        s.setFullYear(s.getFullYear() - 1);
        startDate = s.toISOString().split('T')[0];
    } else {
        // custom — use year/month
        const year = parseInt(url.searchParams.get('year') || '') || now.getFullYear();
        const month = parseInt(url.searchParams.get('month') || '') || 0;
        if (month >= 1 && month <= 12) {
            startDate = `${year}-${String(month).padStart(2, '0')}-01`;
            // Last day of month
            const lastDay = new Date(year, month, 0).getDate();
            endDate = `${year}-${String(month).padStart(2, '0')}-${lastDay}`;
        } else {
            startDate = `${year}-01-01`;
            endDate = `${year}-12-31`;
        }
    }

    // Apply future padding
    if (!endDate) {
        if (futureDays > 0) {
            const e = new Date(now);
            e.setDate(e.getDate() + futureDays);
            endDate = e.toISOString().split('T')[0];
        } else {
            endDate = now.toISOString().split('T')[0];
        }
    } else if (futureDays > 0) {
        // Extend endDate by futureDays if it's in the future
        const e = new Date(now);
        e.setDate(e.getDate() + futureDays);
        const futureEnd = e.toISOString().split('T')[0];
        if (futureEnd > endDate) endDate = futureEnd;
    }

    // ── Build queries per type ──────────────────────────────────────
    /** @type {any[]} */
    let items = [];

    const typeFilter = type === 'all' ? ['movie', 'show', 'artist'] : [type];

    // ── Movies ──────────────────────────────────────────────────────
    if (typeFilter.includes('movie')) {
        const movieStatusClause = status === 'all' ? ''
            : status === 'watched' ? "AND mc.watch_status = 'watched'"
            : status === 'unwatched' ? "AND mc.watch_status = 'unwatched'"
            : status === 'in_progress' ? "AND mc.watch_status = 'in_progress'"
            : '';

        const movieRows = /** @type {any[]} */ (db.prepare(`
            SELECT mp.id, mp.title, mp.media_type, mp.release_year, mp.poster_url, mp.slug,
                   mc.watch_status, mc.play_count, mc.premiere_date,
                   COALESCE(mc.premiere_date, mp.release_year || '-01-01') as release_date
            FROM media_parents mp
            JOIN media_children mc ON mc.parent_id = mp.id
            WHERE mp.media_type = 'movie'
              AND COALESCE(date(mc.premiere_date), mp.release_year || '-01-01') >= ?
              AND COALESCE(date(mc.premiere_date), mp.release_year || '-01-01') <= ?
              ${movieStatusClause}
            ORDER BY release_date DESC
        `).all(startDate, endDate));

        items.push(...movieRows.map(r => ({
            id: r.id,
            title: r.title,
            media_type: 'movie',
            release_year: r.release_year,
            release_date: r.release_date?.split('T')[0] || `${r.release_year}-01-01`,
            poster_url: r.poster_url,
            slug: r.slug,
            watch_status: r.watch_status,
            play_count: r.play_count || 0,
            href: `/movies/${r.slug || r.id}`,
        })));
    }

    // ── TV Shows — use episode air dates ────────────────────────────
    if (typeFilter.includes('show')) {
        // Query individual episodes by premiere_date so episodes show up
        // on the day they air, not just where the show's release_year falls.
        const epStatusClause = status === 'all' ? ''
            : status === 'watched' ? "AND mc.watch_status = 'watched'"
            : status === 'unwatched' ? "AND mc.watch_status != 'watched'"
            : status === 'in_progress' ? "AND mc.watch_status = 'in_progress'"
            : '';

        const epRows = /** @type {any[]} */ (db.prepare(`
            SELECT mc.id as episode_id, mc.title as episode_title,
                   mc.season_number, mc.item_number, mc.premiere_date,
                   mc.watch_status, mc.is_collected, mc.play_count,
                   mp.id as show_id, mp.title as show_title, mp.poster_url, mp.slug,
                   mp.release_year,
                   mp.watched_children, mp.collected_children, mp.total_released_children
            FROM media_children mc
            JOIN media_parents mp ON mc.parent_id = mp.id
            WHERE mp.media_type = 'show'
              AND mp.is_dashboard_hidden = 0
              AND mc.premiere_date IS NOT NULL
              AND mc.is_special = 0
              AND date(mc.premiere_date) >= ?
              AND date(mc.premiere_date) <= ?
              ${epStatusClause}
            ORDER BY mc.premiere_date DESC, mp.title ASC
        `).all(startDate, endDate));

        // Group episodes by show — one entry per show per air-date
        /** @type {Map<string, any>} */
        const showDateMap = new Map();

        for (const ep of epRows) {
            const dateKey = ep.premiere_date.split('T')[0];
            const key = `${ep.show_id}-${dateKey}`;

            if (!showDateMap.has(key)) {
                const total = ep.collected_children || 0;
                const watched = ep.watched_children || 0;
                let show_watch_status = 'unwatched';
                if (watched > 0 && watched >= total) show_watch_status = 'watched';
                else if (watched > 0) show_watch_status = 'in_progress';

                showDateMap.set(key, {
                    id: ep.show_id,
                    title: ep.show_title,
                    media_type: 'show',
                    release_year: ep.release_year,
                    release_date: dateKey,
                    poster_url: ep.poster_url,
                    slug: ep.slug,
                    watch_status: show_watch_status,
                    play_count: watched,
                    collected_children: total,
                    watched_children: watched,
                    total_released_children: ep.total_released_children || 0,
                    href: `/tv/${ep.slug || ep.show_id}`,
                    episodes: [],
                });
            }

            showDateMap.get(key).episodes.push({
                id: ep.episode_id,
                title: ep.episode_title,
                season: ep.season_number,
                episode: ep.item_number,
                watch_status: ep.watch_status,
            });
        }

        // Build subtitle from episodes (e.g., "S02E05, S02E06")
        for (const entry of showDateMap.values()) {
            const epLabels = entry.episodes
                .sort((/** @type {any} */ a, /** @type {any} */ b) => (a.season * 10000 + a.episode) - (b.season * 10000 + b.episode))
                .map((/** @type {any} */ e) => `S${String(e.season).padStart(2, '0')}E${String(e.episode).padStart(2, '0')}`);
            entry.subtitle = epLabels.join(', ');
            // Count how many are watched vs total
            const epWatched = entry.episodes.filter((/** @type {any} */ e) => e.watch_status === 'watched').length;
            entry.ep_count = entry.episodes.length;
            entry.ep_watched = epWatched;
            delete entry.episodes;
            items.push(entry);
        }
    }

    // ── Music (Albums) ─────────────────────────────────────────────
    if (typeFilter.includes('artist')) {
        const albumRows = /** @type {any[]} */ (db.prepare(`
            SELECT mc.id as album_id, mc.title as album_title, mc.premiere_date,
                   mc.play_count, mc.poster_url as album_poster,
                   mp.id as artist_id, mp.title as artist_name, mp.poster_url as artist_poster,
                   mp.release_year as artist_year,
                   COALESCE(mc.premiere_date, mp.release_year || '-01-01') as release_date
            FROM media_children mc
            JOIN media_parents mp ON mc.parent_id = mp.id
            WHERE mp.media_type = 'artist'
              AND COALESCE(date(mc.premiere_date), mp.release_year || '-01-01') >= ?
              AND COALESCE(date(mc.premiere_date), mp.release_year || '-01-01') <= ?
            ORDER BY release_date DESC
        `).all(startDate, endDate));

        for (const r of albumRows) {
            const played = (r.play_count || 0) > 0;
            let watch_status = played ? 'watched' : 'unwatched';

            if (status !== 'all') {
                if (status === 'watched' && !played) continue;
                if (status === 'unwatched' && played) continue;
                if (status === 'in_progress') continue; // music doesn't have in_progress
            }

            items.push({
                id: r.artist_id,
                album_id: r.album_id,
                title: r.album_title,
                subtitle: r.artist_name,
                media_type: 'album',
                release_year: r.premiere_date ? new Date(r.premiere_date).getFullYear() : r.artist_year,
                release_date: r.release_date?.split('T')[0] || `${r.artist_year}-01-01`,
                poster_url: r.album_poster || r.artist_poster,
                watch_status,
                play_count: r.play_count || 0,
                href: `/music/${r.artist_id}/${r.album_id}`,
            });
        }
    }

    // Sort by release_date descending
    items.sort((a, b) => (b.release_date || '').localeCompare(a.release_date || ''));

    // ── Get all distinct years for year picker ──────────────────────
    const yearRows = /** @type {any[]} */ (db.prepare(`
        SELECT DISTINCT release_year FROM media_parents
        WHERE release_year IS NOT NULL AND release_year > 1800
        ORDER BY release_year DESC
    `).all());
    const years = yearRows.map(r => r.release_year);

    // Total count (all items without filters)
    const totalCount = /** @type {any} */ (db.prepare(
        'SELECT COUNT(*) as c FROM media_parents WHERE release_year IS NOT NULL'
    ).get()).c;

    return json({
        items,
        years,
        totalCount,
        filteredCount: items.length,
    });
}
