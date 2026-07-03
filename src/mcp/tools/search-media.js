/**
 * MCP Tools: search-media, prepare-media
 *
 * Discover content that isn't in the library yet and turn a chosen result into a
 * mediaParentId ready for the add-to-arr download flow.
 */

import { get, post } from '../api.js';

export const tools = [
  {
    name: 'search-media',
    description:
      'Search external sources (TMDb for movies/TV, MusicBrainz for music) for content to add ' +
      'to the library. Use this — not the library "search" tool — when the item may not be in ' +
      'the library yet. Each result includes in_library, library_status, and media_parent_id. ' +
      'If a result already has a media_parent_id, pass it straight to add-to-arr; otherwise call ' +
      'prepare-media on the result first to obtain a mediaParentId.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query (title, artist name, etc.; min 2 characters)',
        },
        type: {
          type: 'string',
          enum: ['all', 'movie', 'show', 'music'],
          description: 'Limit search to a specific media type (default: all)',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'prepare-media',
    description:
      'Turn a search-media result into a mediaParentId ready for add-to-arr. Idempotent — ' +
      'returns the existing id if the item is already known. Only needed when a search-media ' +
      'result has a null media_parent_id. Pass the fields from the chosen result.',
    inputSchema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['movie', 'show', 'music'],
          description: 'Media type of the result',
        },
        title: {
          type: 'string',
          description: 'Title of the result',
        },
        tmdb_id: {
          type: 'string',
          description: 'TMDb ID (required for movie/show)',
        },
        musicbrainz_id: {
          type: 'string',
          description: 'MusicBrainz ID (required for music)',
        },
        release_year: {
          type: 'number',
          description: 'Release year (optional)',
        },
        poster_url: {
          type: 'string',
          description: 'Poster URL from the result (optional)',
        },
        overview: {
          type: 'string',
          description: 'Overview/summary from the result (optional)',
        },
      },
      required: ['type', 'title'],
    },
  },
];

/**
 * @param {string} name
 * @param {Record<string, any>} args
 */
export async function handle(name, args) {
  switch (name) {
    case 'search-media': {
      const params = new URLSearchParams({ q: args.query });
      // The route uses type=all|movie|tv|music; map 'show' -> 'tv'.
      if (args.type && args.type !== 'all') {
        params.set('type', args.type === 'show' ? 'tv' : args.type);
      }
      return get(`/api/search/external?${params}`);
    }
    case 'prepare-media': {
      if (args.type === 'music') {
        // Music carries a musicbrainz_id; the stub route sets it (discover/add can't).
        const result = await post('/api/search/external/stub', {
          type: 'artist',
          musicbrainz_id: args.musicbrainz_id,
          title: args.title,
          release_year: args.release_year,
          poster_url: args.poster_url,
          overview: args.overview,
        });
        return { mediaParentId: result.id, href: result.href };
      }
      // movie/show → discover/add (creates the media_children row movies need and
      // resolves the Sonarr tvdb_id), returns { mediaParentId }.
      return post('/api/discover/add', {
        tmdb_id: args.tmdb_id,
        media_type: args.type,
        title: args.title,
        release_year: args.release_year,
        poster_url: args.poster_url,
        overview: args.overview,
      });
    }
    default:
      return null;
  }
}
