/**
 * Settings tab. The per-source list is where a source gets configured; the
 * ribbon, status bar and log viewer exist so status can be noticed and acted
 * on without opening this tab.
 *
 * Declared rather than rendered: `getSettingDefinitions()` (Obsidian 1.13+) is
 * what puts these rows in the app's settings search.
 */

import {
	Notice,
	PluginSettingTab,
	Setting,
	type App,
	type SettingDefinitionItem,
	type SettingGroupItem,
} from "obsidian";
import { SourceWizardModal } from "./ui/wizard";
import { LogViewerModal } from "./ui/log-viewer";
import type HalyardFetchPlugin from "./main";
import type { Source } from "./types";
import { detectHalyardSync } from "./sync-interop";

function formatTimestamp(ms: number | undefined): string {
	if (ms === undefined) return "never";
	return new Date(ms).toLocaleString();
}

/** The tri-state Wi-Fi setting as the dropdown's string values. */
const WIFI_OPTIONS: Record<string, string> = {
	unset: "Not yet decided (defaults to Wi-Fi only)",
	true: "Wi-Fi only",
	false: "No restriction",
};

export class HalyardFetchSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private readonly plugin: HalyardFetchPlugin
	) {
		super(app, plugin);
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		const items: SettingDefinitionItem[] = [];

		if (this.plugin.secretStore.insecure) {
			items.push({
				name: "Tokens are stored in plaintext",
				desc: this.insecureStorageWarning(),
				render: (setting: Setting) => {
					setting.settingEl.addClass("mod-warning");
				},
			});
		}

		items.push(
			{
				// A list, not a group: these are entries the user adds and
				// removes, and the framework renders the add/delete
				// affordances for them.
				type: "list",
				heading: "Sources",
				emptyState: "No sources configured.",
				addItem: {
					name: "Add source",
					action: () => this.openWizard(),
				},
				onDelete: (index: number) => {
					const source = this.plugin.settings.sources[index];
					if (!source) return;
					void this.plugin.removeSource(source.id).then(() => this.update());
				},
				items: this.plugin.settings.sources.map((source) => this.sourceItem(source)),
			},
			{
				type: "group",
				heading: "Mobile",
				items: [
					{
						name: "Restrict scheduled refreshes to Wi-Fi",
						desc:
							'Applies only on mobile devices; desktop ignores this. "Refresh now" always ' +
							"bypasses it. A source can override this individually from its own settings.",
						control: { type: "dropdown", key: "mobileWifiOnly", options: WIFI_OPTIONS },
					},
				],
			},
			{
				type: "group",
				heading: "Defaults",
				items: [
					{
						name: "Default max artifact size (MB)",
						desc:
							"A soft guard against a misconfigured source or an unexpectedly large " +
							"download. Overridable per source.",
						control: { type: "number", key: "defaultMaxSizeMB", min: 1 },
					},
				],
			}
		);

		return items;
	}

	/**
	 * `mobileWifiOnly` is tri-state (`null` = never answered) and the dropdown
	 * carries strings, so it needs a translation on the way out and back.
	 */
	getControlValue(key: string): unknown {
		if (key === "mobileWifiOnly") {
			const value = this.plugin.settings.mobileWifiOnly;
			return value === null ? "unset" : String(value);
		}
		if (key === "defaultMaxSizeMB") return this.plugin.settings.defaultMaxSizeMB;
		return undefined;
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		if (key === "mobileWifiOnly") {
			this.plugin.settings.mobileWifiOnly = value === "unset" ? null : value === "true";
		} else if (key === "defaultMaxSizeMB") {
			const parsed = Number(value);
			// A zero or negative cap would block every download; keep the old
			// value rather than persisting something unusable.
			if (!Number.isFinite(parsed) || parsed <= 0) return;
			this.plugin.settings.defaultMaxSizeMB = parsed;
		} else {
			return;
		}
		await this.plugin.saveAll();
	}

	private insecureStorageWarning(): string {
		const halyardSyncPresent = detectHalyardSync(this.app) !== null;
		return halyardSyncPresent
			? "OS keychain storage is unavailable, so tokens are stored in this plugin's data.json in plaintext. Halyard Sync is also installed here: this plugin adds its data.json to Halyard Sync's ignore list automatically, but check that list if you've customized it — a plaintext token pushed to a git remote is a leaked credential, not just a local file."
			: "OS keychain storage is unavailable, so tokens are stored in this plugin's data.json in plaintext. Use the narrowest token scope your host allows.";
	}

	private sourceItem(source: Source): SettingGroupItem {
		const state = this.plugin.sourceStates[source.id] ?? {};
		const statusText =
			state.lastOutcome === "success"
				? `Last success: ${formatTimestamp(state.lastSuccessAt)}`
				: state.lastOutcome
					? `Last failure (${state.lastOutcome}): ${formatTimestamp(state.lastAttemptAt)}`
					: "Never refreshed";

		return {
			name: source.displayName,
			desc: `${source.destinationFolder} — ${statusText}`,
			render: (setting: Setting) => {
				setting
					.addButton((btn) =>
						btn.setButtonText("Refresh now").onClick(async () => {
							const result = await this.plugin.refreshSource(source, "manual");
							if (result.ok) new Notice(`${source.displayName}: refreshed`);
							this.update();
						})
					)
					.addButton((btn) =>
						btn.setButtonText("History").onClick(() => {
							new LogViewerModal(this.app, this.plugin, source.id).open();
						})
					)
					.addButton((btn) =>
						btn.setButtonText("Edit").onClick(() => {
							this.openWizard(source);
						})
					)
					.addButton((btn) =>
						btn
							.setButtonText("Remove")
							.setDestructive()
							.onClick(async () => {
								await this.plugin.removeSource(source.id);
								this.update();
							})
					);
			},
		};
	}

	private openWizard(existing?: Source): void {
		new SourceWizardModal(this.app, this.plugin, existing, () => this.update()).open();
	}
}
