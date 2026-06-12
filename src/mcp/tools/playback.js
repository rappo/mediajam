/**
 * MCP Tools: remote-play, list-players
 */

import { get, post } from '../api.js';

export const tools = [
  {
    name: 'remote-play',
    description:
      'Start playback of a media item on a Jellyfin client/device. ' +
      'Use list-players first to find available devices.',
    inputSchema: {
      type: 'object',
      properties: {
        jellyfinId: {
          type: 'string',
          description: 'Jellyfin item ID to play',
        },
        playerId: {
          type: 'string',
          description: 'Jellyfin session/player ID to play on (from list-players)',
        },
      },
      required: ['jellyfinId'],
    },
  },
  {
    name: 'list-players',
    description:
      'List available Jellyfin playback clients/devices that can receive remote playback commands.',
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
    case 'remote-play':
      return post('/api/jellyfin/remote', {
        jellyfinId: args.jellyfinId,
        playerId: args.playerId,
      });
    case 'list-players':
      return get('/api/jellyfin/sessions');
    default:
      return null;
  }
}
