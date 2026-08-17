/**
 * Settings tab. The per-source list is where a source gets configured; the
 * ribbon, status bar and log viewer exist so status can be noticed and acted
 * on without opening this tab.
 */

import { Notice, PluginSettingTab, Setting, type App } from "obsidian";
import { SourceWizardModal } from "./ui/wizard";
import { LogViewerModal } from "./ui/log-viewer";
import type TetherFetchPlugin from "./main";
import type { Source } from "./types";
import { detectTetherSync } from "./sync-interop";

function formatTimestamp(ms: number | undefined): string {
	if (ms === undefined) return "never";
	return new Date(ms).toLocaleString();
}

export class TetherFetchSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private readonly plugin: TetherFetchPlugin
	) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		if (this.plugin.secretStore.insecure) {
			const tetherSyncPresent = detectTetherSync(this.app) !== null;
			containerEl.createEl("p", {
				text: tetherSyncPresent
					? "OS keychain storage is unavailable, so tokens are stored in this plugin's data.json in plaintext. Tether Sync is also installed here: this plugin adds its data.json to Tether Sync's ignore list automatically, but check that list if you've customized it — a plaintext token pushed to a git remote is a leaked credential, not just a local file."
					: "OS keychain storage is unavailable, so tokens are stored in this plugin's data.json in plaintext. Use the narrowest token scope your host allows.",
				cls: "mod-warning",
			});
		}

		new Setting(containerEl).setName("Sources").setHeading();

		if (this.plugin.settings.sources.length === 0) {
			const empty = containerEl.createDiv({ cls: "tether-fetch-empty-state" });
			empty.createEl("p", { text: "No sources configured." });
			new Setting(empty).addButton((btn) =>
				btn
					.setButtonText("Add source")
					.setCta()
					.onClick(() => this.openWizard())
			);
		} else {
			for (const source of this.plugin.settings.sources) {
				this.renderSource(containerEl, source);
			}

			new Setting(containerEl).addButton((btn) =>
				btn
					.setButtonText("Add source")
					.setCta()
					.onClick(() => this.openWizard())
			);
		}

		new Setting(containerEl).setName("Mobile").setHeading();
		new Setting(containerEl)
			.setName("Restrict scheduled refreshes to Wi-Fi")
			.setDesc(
				"Applies only on mobile devices; desktop ignores this. \"Refresh now\" always bypasses it. A source can override this individually from its own settings."
			)
			.addDropdown((dropdown) =>
				dropdown
					.addOption("unset", "Not yet decided (defaults to Wi-Fi only)")
					.addOption("true", "Wi-Fi only")
					.addOption("false", "No restriction")
					.setValue(this.plugin.settings.mobileWifiOnly === null ? "unset" : String(this.plugin.settings.mobileWifiOnly))
					.onChange(async (value) => {
						this.plugin.settings.mobileWifiOnly = value === "unset" ? null : value === "true";
						await this.plugin.saveAll();
					})
			);

		new Setting(containerEl).setName("Defaults").setHeading();
		new Setting(containerEl)
			.setName("Default max artifact size (MB)")
			.setDesc("A soft guard against a misconfigured source or an unexpectedly large download. Overridable per source.")
			.addText((text) =>
				text.setValue(String(this.plugin.settings.defaultMaxSizeMB)).onChange(async (value) => {
					const parsed = Number(value);
					if (Number.isFinite(parsed) && parsed > 0) {
						this.plugin.settings.defaultMaxSizeMB = parsed;
						await this.plugin.saveAll();
					}
				})
			);
	}

	private renderSource(containerEl: HTMLElement, source: Source): void {
		const state = this.plugin.sourceStates[source.id] ?? {};
		const statusText =
			state.lastOutcome === "success"
				? `Last success: ${formatTimestamp(state.lastSuccessAt)}`
				: state.lastOutcome
					? `Last failure (${state.lastOutcome}): ${formatTimestamp(state.lastAttemptAt)}`
					: "Never refreshed";

		new Setting(containerEl)
			.setName(source.displayName)
			.setDesc(`${source.destinationFolder} — ${statusText}`)
			.addButton((btn) =>
				btn.setButtonText("Refresh now").onClick(async () => {
					const result = await this.plugin.refreshSource(source, "manual");
					if (result.ok) new Notice(`${source.displayName}: refreshed`);
					this.display();
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
					.setWarning()
					.onClick(async () => {
						await this.plugin.removeSource(source.id);
						this.display();
					})
			);
	}

	private openWizard(existing?: Source): void {
		new SourceWizardModal(this.app, this.plugin, existing, () => this.display()).open();
	}
}
