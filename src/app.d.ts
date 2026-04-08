// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		interface Locals {
			user?: { id: number; username: string; isAdmin: boolean; avatarUrl?: string | null } | null;
			theme?: string;
			isSetupComplete?: boolean;
			apiKeyPermissions?: string[];
		}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export { };
