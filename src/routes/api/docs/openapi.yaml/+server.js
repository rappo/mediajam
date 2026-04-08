import { readFileSync } from 'fs';
import { resolve } from 'path';

/** @type {import('./$types').RequestHandler} */
export function GET() {
	const yamlPath = resolve('docs/openapi.yaml');
	const yaml = readFileSync(yamlPath, 'utf-8');

	return new Response(yaml, {
		headers: {
			'Content-Type': 'text/yaml',
			'Cache-Control': 'public, max-age=60'
		}
	});
}
