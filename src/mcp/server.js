#!/usr/bin/env node

/**
 * MediaJam MCP Server
 *
 * A Model Context Protocol server that exposes MediaJam's media library
 * management capabilities to LLM agents.
 *
 * Usage:
 *   MEDIAJAM_URL=http://localhost:7331 MEDIAJAM_API_KEY=your-key node server.js
 *
 * Or via MCP client config (e.g. Claude Desktop):
 *   {
 *     "mcpServers": {
 *       "mediajam": {
 *         "command": "node",
 *         "args": ["/path/to/src/mcp/server.js"],
 *         "env": {
 *           "MEDIAJAM_URL": "http://localhost:7331",
 *           "MEDIAJAM_API_KEY": "your-key"
 *         }
 *       }
 *     }
 *   }
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { get, post, put } from './api.js';

// ── Tool modules ──────────────────────────────────────────────────
import * as askModule from './tools/ask.js';
import * as searchModule from './tools/search.js';
import * as libraryModule from './tools/library.js';
import * as collectionsModule from './tools/collections.js';
import * as calendarModule from './tools/calendar.js';
import * as arrModule from './tools/arr.js';
import * as playbackModule from './tools/playback.js';
import * as discoverModule from './tools/discover.js';

const modules = [
  askModule,
  searchModule,
  libraryModule,
  collectionsModule,
  calendarModule,
  arrModule,
  playbackModule,
  discoverModule,
];

// ── Server setup ──────────────────────────────────────────────────
const server = new McpServer({
  name: 'mediajam',
  version: '1.0.0',
  description: 'MediaJam media library — search, browse, manage watchlists, control downloads, and play media.',
});

// ── Convert JSON Schema → Zod shapes for MCP SDK ─────────────────
/**
 * Convert a JSON Schema property definition to a Zod type.
 * The MCP SDK requires Zod schemas, but our tools define JSON Schema.
 *
 * @param {object} prop — JSON Schema property
 * @param {boolean} required — whether the property is required
 * @returns {import('zod').ZodType}
 */
function jsonSchemaToZod(prop, required = false) {
  let zodType;

  if (prop.enum) {
    zodType = z.enum(prop.enum);
  } else {
    switch (prop.type) {
      case 'number':
      case 'integer':
        zodType = z.number();
        break;
      case 'boolean':
        zodType = z.boolean();
        break;
      case 'array':
        zodType = z.array(prop.items?.type === 'number' ? z.number() : z.string());
        break;
      case 'string':
      default:
        zodType = z.string();
        break;
    }
  }

  if (prop.description) {
    zodType = zodType.describe(prop.description);
  }

  if (!required) {
    zodType = zodType.optional();
  }

  return zodType;
}

/**
 * Convert a tool's JSON Schema inputSchema to a Zod shape object.
 * @param {object} inputSchema
 * @returns {Record<string, import('zod').ZodType>}
 */
function buildZodShape(inputSchema) {
  const shape = {};
  const props = inputSchema.properties || {};
  const required = inputSchema.required || [];

  for (const [key, prop] of Object.entries(props)) {
    shape[key] = jsonSchemaToZod(prop, required.includes(key));
  }

  return shape;
}

// ── Register all tools ────────────────────────────────────────────
for (const mod of modules) {
  for (const toolDef of mod.tools) {
    const zodShape = buildZodShape(toolDef.inputSchema);

    server.tool(
      toolDef.name,
      toolDef.description,
      zodShape,
      async (args) => {
        try {
          const result = await mod.handle(toolDef.name, args);

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
        } catch (err) {
          return {
            content: [
              {
                type: 'text',
                text: `Error: ${err.message}`,
              },
            ],
            isError: true,
          };
        }
      }
    );
  }
}

// ── Start ─────────────────────────────────────────────────────────
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[mediajam-mcp] Server running on stdio (${modules.reduce((n, m) => n + m.tools.length, 0)} tools)`);
}

main().catch((err) => {
  console.error('[mediajam-mcp] Fatal:', err);
  process.exit(1);
});
