import { json } from '@sveltejs/kit';
import { getMcpStatus } from '$lib/server/mcp-manager.js';

/** @type {import('./$types').RequestHandler} */
export async function GET() {
    const status = getMcpStatus();
    return json(status);
}
