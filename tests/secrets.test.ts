import { describe, expect, it } from "vitest";
import { detectSecretStorage, SecretStore, secretKeyForSource, type FallbackSecretPersistence } from "../src/secrets";

function memoryFallback(initial: Record<string, string> = {}) {
	let data = { ...initial };
	const saves: Array<Record<string, string>> = [];
	const persistence: FallbackSecretPersistence = {
		load: async () => ({ ...data }),
		save: async (secrets) => {
			data = { ...secrets };
			saves.push({ ...secrets });
		},
	};
	return {
		persistence,
		saves,
		get data() {
			return data;
		},
	};
}

describe("detectSecretStorage", () => {
	it("returns null when the app has no secretStorage", () => {
		expect(detectSecretStorage({})).toBeNull();
		expect(detectSecretStorage(null)).toBeNull();
		expect(detectSecretStorage({ secretStorage: 42 })).toBeNull();
		expect(detectSecretStorage({ secretStorage: {} })).toBeNull();
	});

	it("adapts a getSecret/setSecret-shaped storage", async () => {
		const backing = new Map<string, string>();
		const storage = detectSecretStorage({
			secretStorage: {
				getSecret: (key: string) => backing.get(key) ?? null,
				setSecret: (key: string, value: string) => void backing.set(key, value),
				deleteSecret: (key: string) => void backing.delete(key),
			},
		});
		expect(storage).not.toBeNull();
		await storage!.setSecret("k", "v");
		await expect(storage!.getSecret("k")).resolves.toBe("v");
		await storage!.deleteSecret("k");
		await expect(storage!.getSecret("k")).resolves.toBeNull();
	});

	it("adapts a plain get/set-shaped storage and empties instead of deleting", async () => {
		const backing = new Map<string, string>();
		const storage = detectSecretStorage({
			secretStorage: {
				get: (key: string) => backing.get(key) ?? null,
				set: (key: string, value: string) => void backing.set(key, value),
			},
		});
		expect(storage).not.toBeNull();
		await storage!.setSecret("k", "v");
		await storage!.deleteSecret("k");
		await expect(storage!.getSecret("k")).resolves.toBeNull();
	});
});

describe("SecretStore", () => {
	it("uses secure storage when available and is not insecure", async () => {
		const backing = new Map<string, string>();
		const fallback = memoryFallback();
		const store = new SecretStore(
			{
				getSecret: async (k) => backing.get(k) ?? null,
				setSecret: async (k, v) => void backing.set(k, v),
				deleteSecret: async (k) => void backing.delete(k),
			},
			fallback.persistence
		);

		expect(store.insecure).toBe(false);
		await store.setToken("team-handbook-ab12cd", "tok");
		expect(backing.get(secretKeyForSource("team-handbook-ab12cd"))).toBe("tok");
		expect(fallback.saves).toHaveLength(0);
		await expect(store.getToken("team-handbook-ab12cd")).resolves.toBe("tok");
		await store.deleteToken("team-handbook-ab12cd");
		await expect(store.getToken("team-handbook-ab12cd")).resolves.toBeNull();
	});

	it("falls back to plugin data and flags insecure", async () => {
		const fallback = memoryFallback();
		const store = new SecretStore(null, fallback.persistence);

		expect(store.insecure).toBe(true);
		await store.setToken("ledger-xy9z00", "tok2");
		expect(fallback.data[secretKeyForSource("ledger-xy9z00")]).toBe("tok2");
		await expect(store.getToken("ledger-xy9z00")).resolves.toBe("tok2");
		await store.deleteToken("ledger-xy9z00");
		await expect(store.getToken("ledger-xy9z00")).resolves.toBeNull();
	});

	it("keys tokens per source, not per host — two sources on the same host stay independent", async () => {
		const fallback = memoryFallback();
		const store = new SecretStore(null, fallback.persistence);
		await store.setToken("team-handbook-ab12cd", "a");
		await store.setToken("ledger-xy9z00", "b");
		await expect(store.getToken("team-handbook-ab12cd")).resolves.toBe("a");
		await expect(store.getToken("ledger-xy9z00")).resolves.toBe("b");
	});

	it("produces a lowercase-alphanumeric-plus-dashes ID (app.secretStorage's only accepted shape)", () => {
		expect(secretKeyForSource("Team Handbook!!")).toMatch(/^[a-z0-9-]+$/);
		expect(secretKeyForSource("team-handbook-ab12cd")).toBe("tether-fetch-team-handbook-ab12cd");
	});
});
