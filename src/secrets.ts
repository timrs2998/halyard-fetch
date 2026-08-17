/**
 * Token storage, keyed per source (`tokenRef`) rather than per host: two
 * sources can share a host and still need different least-privilege tokens.
 *
 * Prefers `app.secretStorage` (OS keychain, Obsidian >=1.11), falling back to
 * plugin data (`data.json`, plaintext) when unavailable. Obsidian's typings
 * don't declare `secretStorage` in every version, so detection probes the App
 * object structurally instead of depending on a typings version.
 */

export interface SecretStorageLike {
	getSecret(key: string): Promise<string | null>;
	setSecret(key: string, value: string): Promise<void>;
	deleteSecret(key: string): Promise<void>;
}

type LooseFn = (...args: unknown[]) => unknown;

function pickMethod(obj: Record<string, unknown>, names: string[]): LooseFn | null {
	for (const name of names) {
		const fn = obj[name];
		if (typeof fn === "function") return (fn as LooseFn).bind(obj);
	}
	return null;
}

/** Accepts both `getSecret/setSecret` and plain `get/set` spellings so an API rename doesn't silently break token storage. */
export function detectSecretStorage(app: unknown): SecretStorageLike | null {
	const storage = (app as { secretStorage?: unknown } | null | undefined)?.secretStorage;
	if (typeof storage !== "object" || storage === null) return null;
	const obj = storage as Record<string, unknown>;
	const get = pickMethod(obj, ["getSecret", "get"]);
	const set = pickMethod(obj, ["setSecret", "set"]);
	if (get === null || set === null) return null;
	const del = pickMethod(obj, ["deleteSecret", "removeSecret", "delete", "remove"]);
	return {
		getSecret: async (key) => {
			const value = await get(key);
			return typeof value === "string" && value.length > 0 ? value : null;
		},
		setSecret: async (key, value) => {
			await set(key, value);
		},
		deleteSecret: async (key) => {
			if (del !== null) await del(key);
			else await set(key, "");
		},
	};
}

/** Persistence for the insecure fallback (plugin `data.json`, injected for tests). */
export interface FallbackSecretPersistence {
	load(): Promise<Record<string, string>>;
	save(secrets: Record<string, string>): Promise<void>;
}

const KEY_PREFIX = "tether-fetch-";

/** `app.secretStorage.setSecret` requires a lowercase-alphanumeric-plus-dashes ID. */
function sanitizeSecretId(raw: string): string {
	return raw
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

/** `tokenRef` is already a generated `Source.id` (see `id.ts`), which is already this shape — sanitized again defensively. */
export function secretKeyForSource(tokenRef: string): string {
	return `${KEY_PREFIX}${sanitizeSecretId(tokenRef)}`;
}

export class SecretStore {
	constructor(
		private readonly storage: SecretStorageLike | null,
		private readonly fallback: FallbackSecretPersistence
	) {}

	/** True when tokens live in plugin data instead of the OS keychain. */
	get insecure(): boolean {
		return this.storage === null;
	}

	async getToken(tokenRef: string): Promise<string | null> {
		const key = secretKeyForSource(tokenRef);
		if (this.storage !== null) return this.storage.getSecret(key);
		const secrets = await this.fallback.load();
		const value = secrets[key];
		return typeof value === "string" && value.length > 0 ? value : null;
	}

	async setToken(tokenRef: string, token: string): Promise<void> {
		const key = secretKeyForSource(tokenRef);
		if (this.storage !== null) {
			await this.storage.setSecret(key, token);
			return;
		}
		const secrets = { ...(await this.fallback.load()) };
		secrets[key] = token;
		await this.fallback.save(secrets);
	}

	async deleteToken(tokenRef: string): Promise<void> {
		const key = secretKeyForSource(tokenRef);
		if (this.storage !== null) {
			await this.storage.deleteSecret(key);
			return;
		}
		const secrets = { ...(await this.fallback.load()) };
		delete secrets[key];
		await this.fallback.save(secrets);
	}
}
