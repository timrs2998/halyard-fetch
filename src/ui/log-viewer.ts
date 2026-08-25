/**
 * In-app log viewer: per-source refresh history, readable without leaving
 * Obsidian or hunting down a log file.
 */

import { Modal, type App } from "obsidian";
import type HalyardFetchPlugin from "../main";
import type { LogEntry } from "../types";

function formatTimestamp(ms: number): string {
	return new Date(ms).toLocaleString();
}

export class LogViewerModal extends Modal {
	constructor(
		app: App,
		private readonly plugin: HalyardFetchPlugin,
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
		contentEl.addClass("halyard-fetch-log-viewer");

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

		const list = contentEl.createDiv({ cls: "halyard-fetch-log-list" });
		for (const row of rows) {
			const item = list.createDiv({ cls: "halyard-fetch-log-entry" });
			const outcomeClass = row.entry.outcome === "success" ? "halyard-fetch-log-success" : "halyard-fetch-log-failure";
			item.createSpan({ text: formatTimestamp(row.entry.timestamp), cls: "halyard-fetch-log-time" });
			if (!this.sourceId) item.createSpan({ text: row.sourceLabel, cls: "halyard-fetch-log-source" });
			item.createSpan({ text: row.entry.outcome, cls: outcomeClass });
			item.createSpan({ text: row.entry.detail, cls: "halyard-fetch-log-detail" });
		}
	}
}
