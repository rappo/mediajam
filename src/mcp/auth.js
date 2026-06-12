/**
 * MediaJam MCP — Auth & Config
 *
 * Reads connection details from environment variables:
 *   MEDIAJAM_URL     — base URL  (default: http://localhost:7331)
 *   MEDIAJAM_API_KEY — Bearer token for API auth
 */

export function getConfig() {
  const url = (process.env.MEDIAJAM_URL || 'http://localhost:7331').replace(/\/+$/, '');
  const apiKey = process.env.MEDIAJAM_API_KEY || '';

  if (!apiKey) {
    console.error(
      '[mediajam-mcp] WARNING: MEDIAJAM_API_KEY not set. API calls will fail with 401.'
    );
  }

  return { url, apiKey };
}
