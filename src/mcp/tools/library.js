/**
 * MCP Tools: get-dashboard, list-movies, list-tv-shows, list-music, get-library-stats
 */

import { get } from '../api.js';

export const tools = [
  {
    name: 'get-dashboard',
    description:
      'Get the full dashboard with trending items, recently added, continue watching, ' +
      'upcoming releases, library stats, and watchlist summary.',
    inputSchema: {
      type: 'object',
      properties: {
        calendarDays: {
          type: 'number',
          description: 'Number of days for upcoming calendar (default: 7)',
        },
      },
    },
  },
  {
    name: 'list-movies',
    description:
      'List movies in the library. Smart view groups by recently added, favorites, ' +
      'unwatched, etc. Library view returns the full collection.',
    inputSchema: {
      type: 'object',
      properties: {
        view: {
          type: 'string',
          enum: ['smart', 'library'],
          description: 'View mode (default: smart)',
        },
        limit: {
          type: 'number',
          description: 'Max items to return',
        },
      },
    },
  },
  {
    name: 'list-tv-shows',
    description: 'List TV shows in the library with episode counts and watch progress.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Max items to return',
        },
      },
    },
  },
  {
    name: 'list-music',
    description: 'List music artists and albums in the library.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Max items to return',
        },
      },
    },
  },
  {
    name: 'get-library-stats',
    description:
      'Get overall library statistics — total counts of movies, shows, episodes, ' +
      'artists, play counts, watch time, and more.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

/**
 * @param {string} name
 * @param {Record<string, any>} args
 */
export async function handle(name, args) {
  switch (name) {
    case 'get-dashboard': {
      const params = new URLSearchParams();
      if (args.calendarDays) params.set('calendarDays', String(args.calendarDays));
      const qs = params.toString();
      return get(`/api/pages/dashboard${qs ? '?' + qs : ''}`);
    }
    case 'list-movies': {
      const params = new URLSearchParams();
      if (args.view) params.set('view', args.view);
      if (args.limit) params.set('limit', String(args.limit));
      const qs = params.toString();
      return get(`/api/pages/movies${qs ? '?' + qs : ''}`);
    }
    case 'list-tv-shows': {
      const params = new URLSearchParams();
      if (args.limit) params.set('limit', String(args.limit));
      const qs = params.toString();
      return get(`/api/pages/tv${qs ? '?' + qs : ''}`);
    }
    case 'list-music': {
      const params = new URLSearchParams();
      if (args.limit) params.set('limit', String(args.limit));
      const qs = params.toString();
      return get(`/api/pages/music${qs ? '?' + qs : ''}`);
    }
    case 'get-library-stats': {
      return get('/api/pages/stats');
    }
    default:
      return null;
  }
}
