/**
 * MCP Tools: get-calendar, get-wanted
 */

import { get } from '../api.js';

export const tools = [
  {
    name: 'get-calendar',
    description:
      'Get upcoming and recently released media (movies, TV episodes, music). ' +
      'Shows what is airing soon or just came out.',
    inputSchema: {
      type: 'object',
      properties: {
        start: {
          type: 'string',
          description: 'Start date in YYYY-MM-DD format (default: today)',
        },
        end: {
          type: 'string',
          description: 'End date in YYYY-MM-DD format (default: 7 days from now)',
        },
      },
    },
  },
  {
    name: 'get-wanted',
    description:
      'Get all missing/wanted items from Sonarr, Radarr, and Lidarr. ' +
      'Shows what is monitored but not yet downloaded, grouped by reason ' +
      '(not released, unavailable, in queue, etc.).',
    inputSchema: {
      type: 'object',
      properties: {
        includeCutoff: {
          type: 'boolean',
          description: 'Include items where quality cutoff is unmet (default: false)',
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
    case 'get-calendar': {
      const params = new URLSearchParams();
      if (args.start) params.set('start', args.start);
      if (args.end) params.set('end', args.end);
      const qs = params.toString();
      return get(`/api/calendar${qs ? '?' + qs : ''}`);
    }
    case 'get-wanted': {
      const params = new URLSearchParams();
      if (args.includeCutoff) params.set('includeCutoff', '1');
      return get(`/api/arr/wanted?${params}`);
    }
    default:
      return null;
  }
}
