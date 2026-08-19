// @ts-check
import eslint from "@eslint/js";
import obsidianmd from "eslint-plugin-obsidianmd";
import tseslint from "typescript-eslint";

// The Obsidian plugin portal reviews submissions with eslint-plugin-obsidianmd
// plus typescript-eslint's *type-checked* preset. Running anything less here
// means the portal finds problems CI cannot — so this config deliberately
// mirrors the reviewer's, and `npm run lint` is the gate that keeps a release
// reviewable. (tether-sync carries a copy of this file; keep the two in sync
// by hand.)
export default tseslint.config(
	{
		ignores: ["node_modules/**", "main.js", ".obsidian-cache/**"],
	},
	eslint.configs.recommended,
	...tseslint.configs.recommendedTypeChecked,
	...obsidianmd.configs.recommended,
	{
		languageOptions: {
			parserOptions: {
				projectService: true,
				tsconfigRootDir: import.meta.dirname,
			},
		},
		rules: {
			// tsconfig's noUnusedLocals/noUnusedParameters already cover this,
			// with the compiler's own leading-underscore convention for
			// intentionally-unused parameters — avoid a second, differently
			// configured copy of the same check disagreeing with it.
			"@typescript-eslint/no-unused-vars": "off",
			// TypeScript's own checker (with this project's lib/types config)
			// already catches genuinely undefined identifiers more accurately
			// than this rule can for ambient globals — the typescript-eslint
			// project's own documented recommendation.
			"no-undef": "off",
			// Sentence-case checking cannot tell a proper noun from a word it
			// wants to lowercase: it asks for "Tether fetch" (the plugin's own
			// name), "GitLab" and "GitHub" variants, and so on. The portal does
			// not enforce this rule, and every finding it produces here is a
			// false positive on a product name. UI text is reviewed by hand.
			"obsidianmd/ui/sentence-case": "off",
		},
	},
	{
		// Build/config scripts are plain ESM outside tsconfig's `include`, so
		// the type-aware rules have no program to consult for them.
		files: ["**/*.mjs", "**/*.js"],
		extends: [tseslint.configs.disableTypeChecked],
	},
	{
		// e2e specs drive a real Obsidian install from the *host* via
		// WebdriverIO: they run in Node, never inside the app, so the mobile
		// "no Node built-ins" and popout-window timer rules do not apply to
		// them. Scoped here rather than as inline disable comments, which the
		// portal rejects when undescribed.
		files: ["e2e/**/*.ts", "wdio.conf.mts"],
		rules: {
			"obsidianmd/no-nodejs-modules": "off",
			"obsidianmd/prefer-window-timers": "off",
		},
	},
	{
		// Unit tests run under vitest in Node against fakes, for the same
		// reason as the e2e override above.
		files: ["tests/**/*.ts"],
		rules: {
			"obsidianmd/no-nodejs-modules": "off",
			"obsidianmd/prefer-window-timers": "off",
			"obsidianmd/hardcoded-config-path": "off",
			"no-restricted-globals": "off",
		},
	},
	{
		// `window` is what this file *creates* out of the Node global, so
		// `globalThis` is the only thing it can reach for — the rule's
		// suggested replacement is the very thing being defined here.
		files: ["tests/setup/**/*.ts"],
		rules: {
			"obsidianmd/no-global-this": "off",
		},
	},
	{
		// Build tooling: runs on the developer's machine and in CI, never
		// inside Obsidian, so Node built-ins are exactly right here.
		files: ["esbuild.config.mjs", "version-bump.mjs", "wdio.conf.mts", "vitest.config.ts"],
		rules: {
			"obsidianmd/no-nodejs-modules": "off",
		},
	}
);
