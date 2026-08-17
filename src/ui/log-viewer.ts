/**
 * In-app log viewer: per-source refresh history, readable without leaving
 * Obsidian or hunting down a log file.
 */

import { Modal, type App } from "obsidian";
import type TetherFetchPlugin from "../main";
import type { LogEntry } from "../types";

function formatTimestamp(ms: number): string {
	return new Date(ms).toLocaleString();
}

export class LogViewerModal extends Modal {
	constructor(
		app: App,
		private readonly plugin: TetherFetchPlugin,
		/** Omitted shows every source's history, most recent first, source-labeled. */
		private readonly sourceId?: string
	) {
		super(app);
	}

	onOpen(): void {
		this.render();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("tether-fetch-log-viewer");

		const sources = this.sourceId
			? this.plugin.settings.sources.filter((s) => s.id === this.sourceId)
			: this.plugin.settings.sources;

		contentEl.createEl("h2", { text: sources.length === 1 ? `${sources[0].displayName} — history` : "Refresh history" });

		type Row = { entry: LogEntry; sourceLabel: string };
		const rows: Row[] = [];
		for (const source of sources) {
			const entries = this.plugin.logs[source.id] ?? [];
			for (const entry of entries) {
				rows.push({ entry, sourceLabel: source.displayName });
			}
		}
		rows.sort((a, b) => b.entry.timestamp - a.entry.timestamp);

		if (rows.length === 0) {
			contentEl.createEl("p", { text: "No refresh attempts recorded yet." });
			return;
		}

		const list = contentEl.createEl("div", { cls: "tether-fetch-log-list" });
		for (const row of rows) {
			const item = list.createEl("div", { cls: "tether-fetch-log-entry" });
			const outcomeClass = row.entry.outcome === "success" ? "tether-fetch-log-success" : "tether-fetch-log-failure";
			item.createEl("span", { text: formatTimestamp(row.entry.timestamp), cls: "tether-fetch-log-time" });
			if (!this.sourceId) item.createEl("span", { text: row.sourceLabel, cls: "tether-fetch-log-source" });
			item.createEl("span", { text: row.entry.outcome, cls: outcomeClass });
			item.createEl("span", { text: row.entry.detail, cls: "tether-fetch-log-detail" });
		}
	}
}
