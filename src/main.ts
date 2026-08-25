/**
 * Halyard Fetch — plugin entry: wires secrets, the per-source lock, the
 * scheduler, settings tab, wizard, log viewer, ribbon, status bar, and
 * commands together. See DESIGN.md for architecture.
 */

import { Notice, Platform, Plugin } from "obsidian";
import { KeyedAsyncLock } from "./async-lock";
import { obsidianRequest } from "./fetchers/obsidian-request";
import type { RequestFn } from "./fetchers/http";
import { withLogEntry, withoutSource as logsWithoutSource } from "./log-store";
import { refreshSource as runRefresh } from "./refresh-orchestrator";
import { Scheduler, type RefreshTrigger } from "./scheduler";
import { detectSecretStorage, SecretStore } from "./secrets";
import { HalyardFetchSettingTab } from "./settings";
import { detectHalyardSync, folderIgnorePattern } from "./sync-interop";
import { defaultSettings, type LogEntry, type PluginSettings, type RefreshResult, type Source, type SourceState } from "./types";
import { HALYARD_FETCH_ICON_ID, registerHalyardFetchIcon } from "./ui/icon";
import { LogViewerModal } from "./ui/log-viewer";
import { SourceWizardModal } from "./ui/wizard";

interface SavedData {
	settings: PluginSettings;
	sourceStates: Record<string, SourceState>;
	logs: Record<string, LogEntry[]>;
	fallbackSecrets?: Record<string, string>;
}

export default class HalyardFetchPlugin extends Plugin {
	settings!: PluginSettings;
	sourceStates: Record<string, SourceState> = {};
	logs: Record<string, LogEntry[]> = {};
	secretStore!: SecretStore;
	readonly isMobile: boolean = Platform.isMobile;
	readonly request: RequestFn = obsidianRequest;
	readonly lock = new KeyedAsyncLock();

	private scheduler!: Scheduler;
	private fallbackSecrets: Record<string, string> = {};
	private statusBarEl: HTMLElement | null = null;
	private ribbonEl: HTMLElement | null = null;
	/** sourceId -> displayName the currently-registered command label reflects, so a rename re-registers instead of going stale. */
	private registeredCommandLabels = new Map<string, string>();

	async onload(): Promise<void> {
		await this.loadAll();
		registerHalyardFetchIcon();

		const fallback = {
			load: async () => ({ ...this.fallbackSecrets }),
			save: async (secrets: Record<string, string>) => {
				this.fallbackSecrets = secrets;
				await this.saveAll();
			},
		};
		this.secretStore = new SecretStore(detectSecretStorage(this.app), fallback);

		// Best-effort Halyard Sync interop — see sync-interop.ts. This plugin's
		// own data.json can hold plaintext fallback tokens (SecretStore.insecure)
		// and should never be synced regardless of any source configuration.
		void this.syncIgnore(this.manifest.dir ? `${this.manifest.dir}/data.json` : null);

		this.scheduler = new Scheduler({
			now: () => Date.now(),
			isMobile: () => this.isMobile,
			isOnCellular: () => this.isOnCellular(),
			getSettings: () => this.settings,
			getState: (id) => this.sourceStates[id] ?? {},
			runRefresh: async (source, trigger) => {
				await this.refreshSource(source, trigger);
			},
		});

		this.addSettingTab(new HalyardFetchSettingTab(this.app, this));

		this.ribbonEl = this.addRibbonIcon(HALYARD_FETCH_ICON_ID, "Halyard Fetch: refresh all sources", () => {
			void this.onRibbonClick();
		});
		this.ribbonEl.addClass("halyard-fetch-ribbon-icon");

		this.statusBarEl = this.addStatusBarItem();
		this.statusBarEl.addClass("halyard-fetch-status-bar");
		this.statusBarEl.onClickEvent(() => {
			new LogViewerModal(this.app, this).open();
		});

		this.addCommand({
			id: "refresh-all",
			name: "Refresh all sources now",
			callback: () => void this.onRibbonClick(),
		});
		this.addCommand({
			id: "add-source",
			name: "Add source",
			callback: () => this.openWizard(),
		});
		this.addCommand({
			id: "open-log",
			name: "Open log",
			callback: () => new LogViewerModal(this.app, this).open(),
		});
		this.registerSourceCommands();
		this.updateStatusIndicators();

		// Desktop: a coarse periodic tick drives the "interval" trigger. Mobile
		// has no reliable background timer, but registering this unconditionally
		// is safe — a suspended webview never runs the callback, and the
		// visibilitychange listener below covers mobile's "on foreground" case.
		this.registerInterval(window.setInterval(() => void this.scheduler.tick(this.settings.sources, "interval"), 60_000));

		this.registerDomEvent(document, "visibilitychange", () => {
			if (document.visibilityState === "visible") {
				void this.scheduler.tick(this.settings.sources, "foreground");
			}
		});

		// Catch-up-on-launch — covers "Obsidian was fully quit," the one gap
		// the interval/foreground triggers can't close on their own.
		this.app.workspace.onLayoutReady(() => {
			void this.scheduler.tick(this.settings.sources, "launch");
			void this.maybePromptMobileWifiOnly();
		});
	}

	// ---- persistence --------------------------------------------------------

	private async loadAll(): Promise<void> {
		const raw = ((await this.loadData()) ?? {}) as Partial<SavedData>;
		this.settings = { ...defaultSettings(), ...raw.settings };
		this.sourceStates = raw.sourceStates ?? {};
		this.logs = raw.logs ?? {};
		this.fallbackSecrets = raw.fallbackSecrets ?? {};
	}

	async saveAll(): Promise<void> {
		const data: SavedData = {
			settings: this.settings,
			sourceStates: this.sourceStates,
			logs: this.logs,
			fallbackSecrets: Object.keys(this.fallbackSecrets).length > 0 ? this.fallbackSecrets : undefined,
		};
		await this.saveData(data);
	}

	// ---- source CRUD ----------------------------------------------------

	async upsertSource(source: Source, token: string | null): Promise<void> {
		if (token !== null) {
			await this.secretStore.setToken(source.tokenRef, token);
		}
		const index = this.settings.sources.findIndex((s) => s.id === source.id);
		if (index === -1) this.settings.sources.push(source);
		else this.settings.sources[index] = source;

		// Awaited, not fire-and-forget: this must land before the wizard's
		// first post-save refresh materializes anything into destinationFolder,
		// so Halyard Sync (if present) never sees an untracked-then-suddenly-
		// present folder — it's simply never tracked in the first place.
		await this.syncIgnore(folderIgnorePattern(source.destinationFolder));

		await this.saveAll();
		this.registerSourceCommands();
		this.updateStatusIndicators();
	}

	/** Best-effort — see sync-interop.ts. Never throws: Halyard Sync being absent, outdated, or erroring isn't this plugin's problem to surface. */
	private async syncIgnore(pattern: string | null): Promise<void> {
		if (pattern === null) return;
		const registrar = detectHalyardSync(this.app);
		if (registrar === null) return;
		try {
			await registrar.registerExternalIgnorePattern(pattern);
		} catch {
			// Halyard Sync present but the call failed for some reason of its own — not fatal here.
		}
	}

	/** Removing a source deliberately leaves its destination folder in place. */
	async removeSource(sourceId: string): Promise<void> {
		const source = this.settings.sources.find((s) => s.id === sourceId);
		this.settings.sources = this.settings.sources.filter((s) => s.id !== sourceId);
		delete this.sourceStates[sourceId];
		this.logs = logsWithoutSource(this.logs, sourceId);
		if (source) await this.secretStore.deleteToken(source.tokenRef);

		this.unregisterCommand(`refresh-source-${sourceId}`);
		await this.saveAll();
		this.updateStatusIndicators();
		if (source) new Notice(`${source.displayName}: removed. Its destination folder was left as-is.`);
	}

	// ---- refresh ----------------------------------------------------------

	async refreshSource(source: Source, trigger: RefreshTrigger): Promise<RefreshResult> {
		const result = await runRefresh(source, trigger, {
			lock: this.lock,
			secretStore: this.secretStore,
			adapter: this.app.vault.adapter,
			request: this.request,
			getSettings: () => this.settings,
			getState: (id) => this.sourceStates[id] ?? {},
			setState: (id, state) => {
				this.sourceStates[id] = state;
			},
			appendLog: (id, entry) => {
				this.logs = withLogEntry(this.logs, id, entry);
			},
			showFailureNotice: (src, error) => {
				new Notice(`${src.displayName}: ${error.message}`);
			},
			now: () => Date.now(),
		});
		await this.saveAll();
		this.updateStatusIndicators();
		return result;
	}

	/** Ribbon left-click. With no sources configured it opens the wizard instead. */
	private async onRibbonClick(): Promise<void> {
		if (this.settings.sources.length === 0) {
			this.openWizard();
			return;
		}
		await Promise.all(this.settings.sources.map((source) => this.refreshSource(source, "manual")));
	}

	// ---- UI helpers -----------------------------------------------------

	openWizard(existing?: Source): void {
		new SourceWizardModal(this.app, this, existing, () => this.updateStatusIndicators()).open();
	}

	private registerSourceCommands(): void {
		for (const source of this.settings.sources) {
			const id = `refresh-source-${source.id}`;
			if (this.registeredCommandLabels.get(source.id) === source.displayName) continue;
			this.registeredCommandLabels.set(source.id, source.displayName);
			this.addCommand({
				id,
				name: `Refresh ${source.displayName} now`,
				callback: () => void this.refreshSource(source, "manual"),
			});
		}
	}

	/** Best-effort: `commands.removeCommand` is a long-standing but undocumented API, structurally probed rather than assumed. */
	private unregisterCommand(id: string): void {
		const commands = (this.app as unknown as { commands?: { removeCommand?: (fullId: string) => void } }).commands;
		commands?.removeCommand?.(`${this.manifest.id}:${id}`);
		this.registeredCommandLabels.delete(id.replace(/^refresh-source-/, ""));
	}

	private updateStatusIndicators(): void {
		if (!this.statusBarEl) return;
		const sources = this.settings.sources;
		const failing = sources.filter((s) => {
			const outcome = this.sourceStates[s.id]?.lastOutcome;
			return outcome !== undefined && outcome !== "success";
		});

		if (sources.length === 0) {
			this.statusBarEl.setText("Halyard Fetch: no sources");
		} else if (failing.length > 0) {
			this.statusBarEl.setText(`Halyard Fetch: ${failing.length} failing`);
		} else {
			this.statusBarEl.setText("Halyard Fetch: ✓");
		}
		this.ribbonEl?.toggleClass("halyard-fetch-ribbon-failing", failing.length > 0);
	}

	// ---- mobile -------------------------------------------------------------

	/**
	 * Best-effort: the Network Information API isn't universally available
	 * (notably absent on iOS/WebKit, which the Obsidian iOS app is built on)
	 * so an undetectable connection type fails OPEN, treated as "not
	 * cellular". Blocking instead would silently stop every mobile refresh
	 * forever on a platform that cannot answer the question.
	 */
	private isOnCellular(): boolean {
		const connection = (navigator as unknown as { connection?: { type?: string } }).connection;
		return connection?.type === "cellular";
	}

	private async maybePromptMobileWifiOnly(): Promise<void> {
		if (!this.isMobile || this.settings.mobileWifiOnly !== null) return;

		const notice = new Notice("Halyard Fetch: restrict refreshes to Wi-Fi on this device? Change anytime in settings.", 0);
		const actions = notice.messageEl.createDiv({ cls: "halyard-fetch-notice-actions" });
		const finish = async (value: boolean) => {
			this.settings.mobileWifiOnly = value;
			await this.saveAll();
			notice.hide();
		};
		actions.createEl("button", { text: "Wi-Fi only" }).onclick = () => void finish(true);
		actions.createEl("button", { text: "No restriction" }).onclick = () => void finish(false);
	}
}
