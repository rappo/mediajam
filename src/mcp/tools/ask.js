/**
 * MCP Tool: ask
 *
 * Natural language queries against the media library.
 * Wraps POST /api/ask which does text-to-SQL + RAG internally.
 */

import { post } from '../api.js';

export const tools = [
  {
    name: 'ask',
    description:
      'Ask a natural language question about your media library. ' +
      'Supports queries like "what movies did I watch this week?", ' +
      '"recommend something like Blade Runner", "how many shows do I have?", etc. ' +
      'Uses text-to-SQL and RAG internally for accurate answers.',
    inputSchema: {
      type: 'object',
      properties: {
        question: {
          type: 'string',
          description: 'Natural language question about your media library',
        },
        history: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional conversation history for follow-up questions',
        },
      },
      required: ['question'],
    },
  },
];

/**
 * @param {string} name
 * @param {Record<string, any>} args
 */
export async function handle(name, args) {
  if (name !== 'ask') return null;

  const result = await post('/api/ask', {
    question: args.question,
    history: args.history || [],
  });

  return result;
}
