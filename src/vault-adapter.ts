/**
 * The subset of Obsidian's `DataAdapter` that `materialize.ts` needs.
 * `app.vault.adapter` satisfies it directly; tests supply an in-memory fake
 * (`tests/helpers/mock-adapter.ts`) and need no live vault.
 */
export interface VaultAdapterLike {
	exists(path: string): Promise<boolean>;
	mkdir(path: string): Promise<void>;
	writeBinary(path: string, data: ArrayBuffer): Promise<void>;
	remove(path: string): Promise<void>;
	rmdir(path: string, recursive: boolean): Promise<void>;
	list(path: string): Promise<{ files: string[]; folders: string[] }>;
}
