/**
 * MCP Tools: add-to-arr, search-downloads, get-arr-profiles
 */

import { get, post } from '../api.js';

export const tools = [
  {
    name: 'add-to-arr',
    description:
      'Add a media item to Sonarr (TV), Radarr (movies), or Lidarr (music) ' +
      'for automatic downloading. Requires a quality profile and root folder path — ' +
      'use get-arr-profiles first to get available options.',
    inputSchema: {
      type: 'object',
      properties: {
        service: {
          type: 'string',
          enum: ['sonarr', 'radarr', 'lidarr'],
          description: 'Which *arr service to add to',
        },
        mediaParentId: {
          type: 'number',
          description: 'MediaJam media parent ID',
        },
        qualityProfileId: {
          type: 'number',
          description: 'Quality profile ID (from get-arr-profiles)',
        },
        rootFolderPath: {
          type: 'string',
          description: 'Root folder path (from get-arr-profiles)',
        },
      },
      required: ['service', 'mediaParentId', 'qualityProfileId', 'rootFolderPath'],
    },
  },
  {
    name: 'search-downloads',
    description:
      'Trigger an automatic download search for a media item in its *arr service. ' +
      'The item must already be added to the *arr service.',
    inputSchema: {
      type: 'object',
      properties: {
        service: {
          type: 'string',
          enum: ['sonarr', 'radarr', 'lidarr'],
          description: 'Which *arr service',
        },
        mediaParentId: {
          type: 'number',
          description: 'MediaJam media parent ID',
        },
      },
      required: ['service', 'mediaParentId'],
    },
  },
  {
    name: 'get-arr-profiles',
    description:
      'Get available quality profiles and root folders from all configured *arr services. ' +
      'Use this to find valid qualityProfileId and rootFolderPath values for add-to-arr.',
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
    case 'add-to-arr':
      return post(`/api/arr/${args.service}/add`, {
        mediaParentId: args.mediaParentId,
        qualityProfileId: args.qualityProfileId,
        rootFolderPath: args.rootFolderPath,
      });
    case 'search-downloads':
      return post(`/api/arr/${args.service}/search`, {
        mediaParentId: args.mediaParentId,
      });
    case 'get-arr-profiles':
      return get('/api/arr/profiles');
    default:
      return null;
  }
}
