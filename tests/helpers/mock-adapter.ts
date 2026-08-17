import type { VaultAdapterLike } from "../../src/vault-adapter";

/** In-memory fake of the `VaultAdapterLike` subset of Obsidian's `DataAdapter`. */
export class MockAdapter implements VaultAdapterLike {
	files = new Map<string, Uint8Array>();
	folders = new Set<string>();
	log: Array<[string, ...unknown[]]> = [];

	async exists(path: string): Promise<boolean> {
		return path === "" || this.files.has(path) || this.folders.has(path);
	}

	async list(path: string): Promise<{ files: string[]; folders: string[] }> {
		const prefix = path === "" ? "" : `${path}/`;
		const isChild = (p: string) => p.startsWith(prefix) && !p.slice(prefix.length).includes("/");
		return {
			files: [...this.files.keys()].filter(isChild),
			folders: [...this.folders].filter(isChild),
		};
	}

	async writeBinary(path: string, data: ArrayBuffer): Promise<void> {
		this.log.push(["writeBinary", path]);
		this.files.set(path, new Uint8Array(data));
	}

	async mkdir(path: string): Promise<void> {
		this.log.push(["mkdir", path]);
		const parts = path.split("/");
		for (let i = 1; i <= parts.length; i++) {
			this.folders.add(parts.slice(0, i).join("/"));
		}
	}

	async remove(path: string): Promise<void> {
		this.log.push(["remove", path]);
		if (!this.files.delete(path)) {
			throw new Error(`File does not exist: ${path}`);
		}
	}

	async rmdir(path: string, recursive: boolean): Promise<void> {
		this.log.push(["rmdir", path, recursive]);
		if (!this.folders.has(path)) {
			throw new Error(`Folder does not exist: ${path}`);
		}
		this.folders.delete(path);
		if (recursive) {
			for (const f of [...this.files.keys()]) {
				if (f.startsWith(`${path}/`)) this.files.delete(f);
			}
			for (const d of [...this.folders]) {
				if (d.startsWith(`${path}/`)) this.folders.delete(d);
			}
		}
	}
}
