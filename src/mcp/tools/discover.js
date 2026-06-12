/**
 * MCP Tools: get-recommendations
 */

import { get } from '../api.js';

export const tools = [
  {
    name: 'get-recommendations',
    description:
      'Get similar/recommended media based on a movie or TV show in the library. ' +
      'Uses TMDb recommendations. Also shows which results are already in your library.',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'number',
          description: 'MediaJam media parent ID to get recommendations for',
        },
        type: {
          type: 'string',
          enum: ['movie', 'show'],
          description: 'Media type (movie or show)',
        },
      },
      required: ['id', 'type'],
    },
  },
];

/**
 * @param {string} name
 * @param {Record<string, any>} args
 */
export async function handle(name, args) {
  if (name !== 'get-recommendations') return null;

  const endpoint = args.type === 'show'
    ? `/api/discover/show/${args.id}`
    : `/api/discover/movie/${args.id}`;

  return get(endpoint);
}
