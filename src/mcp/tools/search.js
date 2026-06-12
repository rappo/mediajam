/**
 * MCP Tools: search, get-media-details
 */

import { get } from '../api.js';

export const tools = [
  {
    name: 'search',
    description:
      'Search across the media library for movies, TV shows, music artists, and people. ' +
      'Returns results grouped by type.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query (min 2 characters)',
        },
        type: {
          type: 'string',
          enum: ['all', 'movie', 'show', 'artist', 'person'],
          description: 'Limit search to a specific media type (default: all)',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'get-media-details',
    description:
      'Get full details for a specific media item by its ID. ' +
      'Returns title, year, overview, watch status, poster, external IDs, stats, and more.',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'number',
          description: 'Media parent ID',
        },
      },
      required: ['id'],
    },
  },
];

/**
 * @param {string} name
 * @param {Record<string, any>} args
 */
export async function handle(name, args) {
  switch (name) {
    case 'search': {
      const params = new URLSearchParams({ q: args.query });
      if (args.type && args.type !== 'all') params.set('type', args.type);
      return get(`/api/search?${params}`);
    }
    case 'get-media-details': {
      return get(`/api/media/${args.id}`);
    }
    default:
      return null;
  }
}
