import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
	// Pin the root to this file's own resolved location rather than letting it
	// fall out of process.cwd(), and scope discovery to this project's tests.
	// Vitest's default include glob is repo-wide and does not consult
	// .gitignore, so it would otherwise sweep up anything test-shaped that
	// lands in the tree (downloaded Obsidian builds under .obsidian-cache/,
	// for one).
	root: fileURLToPath(new URL(".", import.meta.url)),
	test: {
		include: ["tests/**/*.test.ts"],
		// Supplies the `window` that plugin code reaches for — see the setup
		// file's comment.
		setupFiles: ["tests/setup/window-globals.ts"],
	},
});
