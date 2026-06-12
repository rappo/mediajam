/**
 * MCP Tools: get-watchlist, toggle-watchlist, toggle-favorite, get-history
 */

import { get, post } from '../api.js';

export const tools = [
  {
    name: 'get-watchlist',
    description: "Get the current user's watchlist — items they want to watch next.",
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'toggle-watchlist',
    description:
      'Add or remove a media item from the watchlist. ' +
      'If the item is already on the watchlist it will be removed, and vice versa.',
    inputSchema: {
      type: 'object',
      properties: {
        mediaParentId: {
          type: 'number',
          description: 'ID of the media item to toggle',
        },
      },
      required: ['mediaParentId'],
    },
  },
  {
    name: 'toggle-favorite',
    description: 'Toggle favorite status on a media item or person.',
    inputSchema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['media', 'person'],
          description: 'Type of item to favorite',
        },
        id: {
          type: 'number',
          description: 'ID of the media item or person',
        },
        isFavorite: {
          type: 'boolean',
          description: 'Set to true to favorite, false to unfavorite',
        },
      },
      required: ['type', 'id', 'isFavorite'],
    },
  },
  {
    name: 'get-history',
    description:
      'Get recent playback history — what the user has been watching/listening to.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Max items to return (default: 50)',
        },
        type: {
          type: 'string',
          enum: ['movie', 'show', 'artist'],
          description: 'Filter by media type',
        },
      },
    },
  },
];

/**
 * @param {string} name
 * @param {Record<string, any>} args
 */
export async function handle(name, args) {
  switch (name) {
    case 'get-watchlist':
      return get('/api/watchlist');
    case 'toggle-watchlist':
      return post('/api/watchlist', { mediaParentId: args.mediaParentId });
    case 'toggle-favorite':
      return post('/api/favorite', {
        type: args.type,
        id: args.id,
        isFavorite: args.isFavorite,
      });
    case 'get-history': {
      const params = new URLSearchParams();
      if (args.limit) params.set('limit', String(args.limit));
      if (args.type) params.set('type', args.type);
      const qs = params.toString();
      return get(`/api/history${qs ? '?' + qs : ''}`);
    }
    default:
      return null;
  }
}
