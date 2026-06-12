#!/usr/bin/env node

/**
 * MediaJam MCP Server
 *
 * A Model Context Protocol server that exposes MediaJam's media library
 * management capabilities to LLM agents.
 *
 * Transports:
 *   stdio (default):
 *     MEDIAJAM_URL=http://localhost:7331 MEDIAJAM_API_KEY=your-key node server.js
 *
 *   SSE (for remote/network access):
 *     MEDIAJAM_URL=http://localhost:7331 MEDIAJAM_API_KEY=your-key node server.js --sse
 *     MEDIAJAM_URL=http://localhost:7331 MEDIAJAM_API_KEY=your-key node server.js --sse --port 3099
 *
 *   MCP client config (stdio):
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
 *
 *   MCP client config (SSE):
 *   {
 *     "mcpServers": {
 *       "mediajam": {
 *         "url": "http://your-host:3099/sse"
 *       }
 *     }
 *   }
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { createServer } from 'node:http';
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

/**
 * Create a new McpServer instance with all tools registered.
 * We need a factory because SSE creates a new server per session.
 */
function createMcpServer() {
  const server = new McpServer({
    name: 'mediajam',
    version: '1.0.0',
    description: 'MediaJam media library — search, browse, manage watchlists, control downloads, and play media.',
  });

  // Register all tools
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

  return server;
}

// ── Parse CLI args ────────────────────────────────────────────────
const args = process.argv.slice(2);
const useSSE = args.includes('--sse');
const portIdx = args.indexOf('--port');
const port = portIdx !== -1 ? parseInt(args[portIdx + 1], 10) : 3099;
const toolCount = modules.reduce((n, m) => n + m.tools.length, 0);

// ── Start ─────────────────────────────────────────────────────────
async function main() {
  if (useSSE) {
    await startSSE();
  } else {
    await startStdio();
  }
}

async function startStdio() {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[mediajam-mcp] Server running on stdio (${toolCount} tools)`);
}

async function startSSE() {
  // Track active sessions: sessionId → transport
  /** @type {Map<string, SSEServerTransport>} */
  const sessions = new Map();

  const httpServer = createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://localhost:${port}`);

    // CORS headers for cross-origin access
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204).end();
      return;
    }

    // GET /sse — establish SSE stream
    if (req.method === 'GET' && url.pathname === '/sse') {
      const server = createMcpServer();
      const transport = new SSEServerTransport('/message', res);
      sessions.set(transport.sessionId, transport);

      transport.onclose = () => {
        sessions.delete(transport.sessionId);
        console.error(`[mediajam-mcp] SSE session closed: ${transport.sessionId}`);
      };

      await server.connect(transport);
      console.error(`[mediajam-mcp] SSE session started: ${transport.sessionId}`);
      return;
    }

    // POST /message?sessionId=xxx — receive client messages
    if (req.method === 'POST' && url.pathname === '/message') {
      const sessionId = url.searchParams.get('sessionId');
      const transport = sessionId ? sessions.get(sessionId) : undefined;

      if (!transport) {
        res.writeHead(400).end('Invalid or missing sessionId');
        return;
      }

      await transport.handlePostMessage(req, res);
      return;
    }

    // Health check
    if (req.method === 'GET' && url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        transport: 'sse',
        tools: toolCount,
        sessions: sessions.size,
      }));
      return;
    }

    // Fallback
    res.writeHead(404).end('Not found');
  });

  httpServer.listen(port, '0.0.0.0', () => {
    console.error(`[mediajam-mcp] SSE server listening on http://0.0.0.0:${port}/sse (${toolCount} tools)`);
    console.error(`[mediajam-mcp] Health check: http://0.0.0.0:${port}/health`);
  });
}

main().catch((err) => {
  console.error('[mediajam-mcp] Fatal:', err);
  process.exit(1);
});
