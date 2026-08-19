/**
 * Setup and edit wizard. One modal and one code path serve both: editing
 * pre-fills from the existing `Source` and re-runs the same validation on
 * save. The wizard front-loads checks a flat settings form would defer to
 * the next scheduled tick — connectivity (step 4), the real zip's content
 * root (step 5), and destination-folder overlap (step 6).
 */

import { Modal, Notice, Setting, type App } from "obsidian";
import { githubCheckFreshness, githubFetchZip } from "../fetchers/github-release";
import { gitlabCheckFreshness, gitlabFetchZip } from "../fetchers/gitlab-package";
import { generateSourceId } from "../id";
import type TetherFetchPlugin from "../main";
import type { GithubReleaseSource, GitlabPackageSource, Source, SourceConfig } from "../types";
import { findOverlappingDestination, normalizeVaultPath } from "../validation";
import { detectContentRoot, exceedsSizeGuard, explodeZip } from "../zip/explode";

type WizardStep = "host-type" | "identify" | "token" | "test" | "content-root" | "destination" | "confirm";

const STEP_ORDER: WizardStep[] = ["host-type", "identify", "token", "test", "content-root", "destination", "confirm"];
const STEP_TITLES: Record<WizardStep, string> = {
	"host-type": "1. Host & type",
	identify: "2. Identify the artifact",
	token: "3. Token",
	test: "4. Test connection",
	"content-root": "5. Content root",
	destination: "6. Destination & schedule",
	confirm: "7. Confirm",
};

export class SourceWizardModal extends Modal {
	private step: WizardStep = "host-type";

	private readonly isEdit: boolean;
	private displayName: string;
	private host: "gitlab" | "github" = "gitlab";

	private gitlabBaseUrl = "";
	private gitlabProjectId = "";
	private gitlabPackageName = "";
	private gitlabVersion = "latest";
	private gitlabFileName = "";

	private githubRepo = "";
	private githubTag = "latest";
	private githubAssetName = "";

	private readonly hadExistingToken: boolean;
	private token = "";

	private testState: "untested" | "testing" | "ok" | "failed" = "untested";
	private testMessage = "";
	private skipTestArmed = false;
	private skipTestConfirmed = false;

	private downloading = false;
	private downloadError: string | null = null;
	private contentRootCandidates: string[] = [];
	private hasRootLevelFiles = false;
	private contentRootPath: string | undefined;
	private contentRootChosen = false;
	private manualContentRoot = false;

	private destinationFolder: string;
	private refreshIntervalMinutes: number;
	private refreshOnForeground: boolean;
	private maxSizeMBOverride: number | undefined;
	private wifiOnlyOverride: boolean | undefined;
	private destinationError: string | null = null;

	private saving = false;

	private footerNextBtn: HTMLButtonElement | null = null;

	constructor(
		app: App,
		private readonly plugin: TetherFetchPlugin,
		private readonly existing: Source | undefined,
		private readonly onDone?: () => void
	) {
		super(app);
		this.isEdit = existing !== undefined;
		this.hadExistingToken = this.isEdit;
		this.displayName = existing?.displayName ?? "";
		this.destinationFolder = existing?.destinationFolder ?? "";
		this.refreshIntervalMinutes = existing?.refreshIntervalMinutes ?? 240;
		this.refreshOnForeground = existing?.refreshOnForeground ?? true;
		this.maxSizeMBOverride = existing?.maxSizeMB;
		this.wifiOnlyOverride = existing?.wifiOnlyOverride;
		this.contentRootPath = existing?.contentRootPath;
		this.contentRootChosen = existing?.contentRootPath !== undefined;

		if (existing) {
			if (existing.config.kind === "gitlab-package") {
				this.host = "gitlab";
				this.gitlabBaseUrl = existing.config.baseUrl ?? "";
				this.gitlabProjectId = existing.config.projectId;
				this.gitlabPackageName = existing.config.packageName;
				this.gitlabVersion = existing.config.version;
				this.gitlabFileName = existing.config.fileName;
			} else {
				this.host = "github";
				this.githubRepo = existing.config.repo;
				this.githubTag = existing.config.tag;
				this.githubAssetName = existing.config.assetName ?? "";
			}
		}
	}

	onOpen(): void {
		this.modalEl.addClass("tether-fetch-wizard-modal");
		this.render();
	}

	onClose(): void {
		this.contentEl.empty();
		this.onDone?.();
	}

	private draftConfig(): SourceConfig {
		if (this.host === "gitlab") {
			const config: GitlabPackageSource = {
				kind: "gitlab-package",
				projectId: this.gitlabProjectId.trim(),
				packageName: this.gitlabPackageName.trim(),
				version: this.gitlabVersion.trim() || "latest",
				fileName: this.gitlabFileName.trim(),
			};
			const baseUrl = this.gitlabBaseUrl.trim();
			if (baseUrl) config.baseUrl = baseUrl;
			return config;
		}
		const config: GithubReleaseSource = {
			kind: "github-release",
			repo: this.githubRepo.trim(),
			tag: this.githubTag.trim() || "latest",
		};
		const assetName = this.githubAssetName.trim();
		if (assetName) config.assetName = assetName;
		return config;
	}

	private goTo(step: WizardStep): void {
		this.step = step;
		this.render();
	}

	private stepIndex(): number {
		return STEP_ORDER.indexOf(this.step);
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h2", { text: `${this.isEdit ? "Edit source" : "Add source"} — ${STEP_TITLES[this.step]}` });

		switch (this.step) {
			case "host-type":
				this.renderHostType(contentEl);
				break;
			case "identify":
				this.renderIdentify(contentEl);
				break;
			case "token":
				this.renderToken(contentEl);
				break;
			case "test":
				this.renderTest(contentEl);
				break;
			case "content-root":
				this.renderContentRoot(contentEl);
				break;
			case "destination":
				this.renderDestination(contentEl);
				break;
			case "confirm":
				this.renderConfirm(contentEl);
				break;
		}
	}

	private renderFooter(
		containerEl: HTMLElement,
		opts: { canNext: boolean; nextLabel?: string; onNext: () => void }
	): void {
		const footer = containerEl.createDiv({ cls: "tether-fetch-wizard-footer" });
		const index = this.stepIndex();
		if (index > 0) {
			footer.createEl("button", { text: "Back" }).onclick = () => this.goTo(STEP_ORDER[index - 1]);
		}
		const nextBtn = footer.createEl("button", { text: opts.nextLabel ?? "Next", cls: "mod-cta" });
		nextBtn.disabled = !opts.canNext;
		nextBtn.onclick = opts.onNext;
		this.footerNextBtn = nextBtn;
	}

	/**
	 * Steps with required-field gating (identify, token) recompute validity
	 * from a live keystroke, but the footer is only built once per render().
	 * This lets those steps flip the already-rendered Next button without
	 * tearing down and rebuilding the text inputs (which would drop focus
	 * and cursor position on every keystroke).
	 */
	private setNextEnabled(enabled: boolean): void {
		if (this.footerNextBtn) this.footerNextBtn.disabled = !enabled;
	}

	// Step 1 -------------------------------------------------------------

	private renderHostType(containerEl: HTMLElement): void {
		new Setting(containerEl).setName("Host").addDropdown((dropdown) =>
			dropdown
				.addOption("gitlab", "GitLab (Generic Package Registry)")
				.addOption("github", "GitHub (Releases)")
				.setValue(this.host)
				.onChange((value) => {
					this.host = value as "gitlab" | "github";
				})
		);
		new Setting(containerEl)
			.setName("Source type")
			.setDesc("v1 supports a named artifact at a version alias only. CI-artifact and plain-URL sources are planned but not yet built.")
			.addDropdown((dropdown) =>
				dropdown
					.addOption("package", "Named artifact at a version alias")
					.addOption("ci-artifact", "Most recent CI job artifact (coming soon)")
					.addOption("url", "Plain authenticated URL (coming soon)")
					.setValue("package")
					.setDisabled(false)
			);

		this.renderFooter(containerEl, { canNext: true, onNext: () => this.goTo("identify") });
	}

	// Step 2 -------------------------------------------------------------

	private renderIdentify(containerEl: HTMLElement): void {
		new Setting(containerEl)
			.setName("Display name")
			.setDesc("Shown in settings, the command palette, and the log viewer.")
			.addText((text) =>
				text.setValue(this.displayName).onChange((value) => {
					this.displayName = value;
				})
			);

		const computeValid = (): boolean =>
			this.host === "gitlab"
				? Boolean(this.gitlabProjectId.trim() && this.gitlabPackageName.trim() && this.gitlabFileName.trim())
				: Boolean(this.githubRepo.trim());

		const warningEl = containerEl.createEl("p", { text: "Fill in the required fields to continue.", cls: "mod-warning" });

		const updateValidity = (): void => {
			const valid = computeValid();
			warningEl.toggle(!valid);
			this.setNextEnabled(valid);
		};

		if (this.host === "gitlab") {
			new Setting(containerEl)
				.setName("Self-managed base URL")
				.setDesc("Leave blank for gitlab.com.")
				.addText((text) => text.setValue(this.gitlabBaseUrl).onChange((v) => (this.gitlabBaseUrl = v)));
			new Setting(containerEl)
				.setName("Project ID")
				.setDesc("Numeric project id, or a URL-encoded namespace/project path.")
				.addText((text) =>
					text.setValue(this.gitlabProjectId).onChange((v) => {
						this.gitlabProjectId = v;
						updateValidity();
					})
				);
			new Setting(containerEl)
				.setName("Package name")
				.addText((text) =>
					text.setValue(this.gitlabPackageName).onChange((v) => {
						this.gitlabPackageName = v;
						updateValidity();
					})
				);
			new Setting(containerEl)
				.setName("Version")
				.setDesc('A package-registry version alias (e.g. "latest") or an exact version.')
				.addText((text) => text.setValue(this.gitlabVersion || "latest").onChange((v) => (this.gitlabVersion = v)));
			new Setting(containerEl)
				.setName("File name")
				.setDesc("The specific file published within the package (the zip asset).")
				.addText((text) =>
					text.setValue(this.gitlabFileName).onChange((v) => {
						this.gitlabFileName = v;
						updateValidity();
					})
				);
		} else {
			new Setting(containerEl)
				.setName("Repository")
				.setDesc('"owner/repo".')
				.addText((text) =>
					text.setValue(this.githubRepo).onChange((v) => {
						this.githubRepo = v;
						updateValidity();
					})
				);
			new Setting(containerEl)
				.setName("Release tag")
				.setDesc('A release tag, or "latest" for the newest release.')
				.addText((text) => text.setValue(this.githubTag || "latest").onChange((v) => (this.githubTag = v)));
			new Setting(containerEl)
				.setName("Asset name")
				.setDesc("Required only when a release has more than one asset.")
				.addText((text) => text.setValue(this.githubAssetName).onChange((v) => (this.githubAssetName = v)));
		}

		// Placing the warning <p> before the per-host fields above means it needs
		// moving after them in the DOM; containerEl's children render in append
		// order, so re-append it now that the fields it validates exist.
		containerEl.appendChild(warningEl);
		warningEl.toggle(!computeValid());

		this.renderFooter(containerEl, {
			canNext: computeValid(),
			onNext: () => {
				if (!this.displayName.trim()) {
					this.displayName = this.host === "gitlab" ? this.gitlabPackageName.trim() : this.githubRepo.trim();
				}
				this.goTo("token");
			},
		});
	}

	// Step 3 -------------------------------------------------------------

	private renderToken(containerEl: HTMLElement): void {
		const scopeHint =
			this.host === "gitlab"
				? "GitLab: a personal access token with the read_api scope."
				: "GitHub: a fine-grained PAT with Contents: Read for Releases.";

		const computeValid = (): boolean => this.token.trim().length > 0 || this.hadExistingToken;

		const warningEl = containerEl.createEl("p", { text: "A token is required.", cls: "mod-warning" });

		new Setting(containerEl)
			.setName("Personal access token")
			.setDesc(this.hadExistingToken ? `${scopeHint} Leave blank to keep the existing token.` : scopeHint)
			.addText((text) => {
				text.inputEl.type = "password";
				text.setValue(this.token).onChange((v) => {
					this.token = v;
					const valid = computeValid();
					warningEl.toggle(!valid);
					this.setNextEnabled(valid);
				});
			});

		containerEl.appendChild(warningEl);
		warningEl.toggle(!computeValid());

		this.renderFooter(containerEl, {
			canNext: computeValid(),
			onNext: () => {
				this.testState = "untested";
				this.testMessage = "";
				this.skipTestArmed = false;
				this.skipTestConfirmed = false;
				this.goTo("test");
			},
		});
	}

	private async resolveTokenForTest(): Promise<string | null> {
		const typed = this.token.trim();
		if (typed) return typed;
		if (this.hadExistingToken && this.existing) return this.plugin.secretStore.getToken(this.existing.tokenRef);
		return null;
	}

	// Step 4 -------------------------------------------------------------

	private renderTest(containerEl: HTMLElement): void {
		const status = containerEl.createDiv({ cls: "tether-fetch-wizard-status" });
		if (this.testState === "untested") status.setText("Not tested yet.");
		else if (this.testState === "testing") status.setText("Testing…");
		else if (this.testState === "ok") status.setText("✓ Connection OK.");
		else status.setText(`✗ ${this.testMessage}`);

		new Setting(containerEl).addButton((btn) =>
			btn
				.setButtonText("Test connection")
				.setCta()
				.setDisabled(this.testState === "testing")
				.onClick(async () => {
					this.testState = "testing";
					this.render();
					const token = await this.resolveTokenForTest();
					if (token === null) {
						this.testState = "failed";
						this.testMessage = "No token available to test with.";
						this.render();
						return;
					}
					const config = this.draftConfig();
					const result =
						config.kind === "gitlab-package"
							? await gitlabCheckFreshness(config, token, this.plugin.request)
							: await githubCheckFreshness(config, token, this.plugin.request);
					if (result.ok) {
						this.testState = "ok";
					} else {
						this.testState = "failed";
						this.testMessage = result.error.message;
					}
					this.render();
				})
		);

		if (this.testState !== "ok") {
			new Setting(containerEl)
				.setDesc(this.skipTestArmed ? "Click again to confirm skipping the connection test." : "Offline or rate-limited right now? You can skip this check.")
				.addButton((btn) =>
					btn
						.setButtonText(this.skipTestArmed ? "Confirm skip" : "Skip and save anyway")
						.setDestructive()
						.onClick(() => {
							if (!this.skipTestArmed) {
								this.skipTestArmed = true;
								this.render();
								return;
							}
							this.skipTestConfirmed = true;
							this.goTo("content-root");
						})
				);
		}

		this.renderFooter(containerEl, {
			canNext: this.testState === "ok" || this.skipTestConfirmed,
			onNext: () => this.goTo("content-root"),
		});
	}

	// Step 5 -------------------------------------------------------------

	private async downloadForContentRoot(): Promise<void> {
		this.downloading = true;
		this.downloadError = null;
		this.render();

		const token = await this.resolveTokenForTest();
		if (token === null) {
			this.downloading = false;
			this.downloadError = "No token available to download with.";
			this.render();
			return;
		}

		const config = this.draftConfig();
		const result = config.kind === "gitlab-package" ? await gitlabFetchZip(config, token, this.plugin.request) : await githubFetchZip(config, token, this.plugin.request);

		this.downloading = false;
		if (!result.ok) {
			this.downloadError = result.error.message;
			this.render();
			return;
		}

		const maxSizeMB = this.maxSizeMBOverride ?? this.plugin.settings.defaultMaxSizeMB;
		if (exceedsSizeGuard(result.value.bytes.byteLength, maxSizeMB)) {
			this.downloadError = `Artifact exceeds the configured ${maxSizeMB} MB limit.`;
			this.render();
			return;
		}

		try {
			const unzipped = explodeZip(result.value.bytes);
			const detection = detectContentRoot(Object.keys(unzipped));
			this.contentRootCandidates = detection.topLevelFolders;
			this.hasRootLevelFiles = detection.hasRootLevelFiles;
			if (detection.autoDetected !== null) {
				this.contentRootPath = detection.autoDetected;
				this.contentRootChosen = true;
			}
		} catch (e) {
			this.downloadError = `Could not read zip: ${(e as Error).message}`;
		}
		this.render();
	}

	private renderContentRoot(containerEl: HTMLElement): void {
		if (this.downloading) {
			containerEl.createEl("p", { text: "Downloading and inspecting the artifact…" });
			this.renderFooter(containerEl, { canNext: false, onNext: () => {} });
			return;
		}

		if (this.downloadError) {
			containerEl.createEl("p", { text: this.downloadError, cls: "mod-warning" });
			new Setting(containerEl).addButton((btn) => btn.setButtonText("Retry download").setCta().onClick(() => void this.downloadForContentRoot()));
		} else if (this.contentRootCandidates.length === 0 && !this.hasRootLevelFiles && !this.manualContentRoot && this.contentRootPath === undefined) {
			new Setting(containerEl).addButton((btn) => btn.setButtonText("Download and detect").setCta().onClick(() => void this.downloadForContentRoot()));
		} else if (this.contentRootChosen && !this.manualContentRoot) {
			containerEl.createEl("p", { text: `Content root: ${this.contentRootPath === "" ? "(zip root)" : this.contentRootPath}` });
			new Setting(containerEl).addButton((btn) =>
				btn.setButtonText("Change").onClick(() => {
					this.contentRootChosen = false;
					this.render();
				})
			);
		} else if (!this.manualContentRoot) {
			containerEl.createEl("p", {
				text:
					this.contentRootCandidates.length === 0
						? "This zip has files directly at its root (no wrapping folder)."
						: `Multiple top-level folders found: ${this.contentRootCandidates.join(", ")}.`,
			});
			new Setting(containerEl).setName("Content root").addDropdown((dropdown) => {
				if (this.hasRootLevelFiles || this.contentRootCandidates.length === 0) dropdown.addOption("", "(zip root)");
				for (const candidate of this.contentRootCandidates) dropdown.addOption(candidate, candidate);
				dropdown.onChange((value) => {
					this.contentRootPath = value;
				});
				if (this.contentRootPath !== undefined) dropdown.setValue(this.contentRootPath);
			});
			new Setting(containerEl).addButton((btn) =>
				btn
					.setButtonText("Confirm")
					.setCta()
					.onClick(() => {
						this.contentRootChosen = true;
						this.render();
					})
			);
		}

		if (!this.contentRootChosen) {
			new Setting(containerEl)
				.setDesc("Already know the path? Skip detection and enter it directly.")
				.addButton((btn) =>
					btn.setButtonText("Enter manually").onClick(() => {
						this.manualContentRoot = true;
						this.render();
					})
				);
		}

		if (this.manualContentRoot) {
			new Setting(containerEl)
				.setName("Content root path")
				.setDesc("Leave blank to use the zip root itself.")
				.addText((text) =>
					text.setValue(this.contentRootPath ?? "").onChange((v) => {
						this.contentRootPath = v;
						this.contentRootChosen = true;
					})
				);
		}

		this.renderFooter(containerEl, {
			canNext: this.contentRootChosen,
			onNext: () => this.goTo("destination"),
		});
	}

	// Step 6 -------------------------------------------------------------

	private renderDestination(containerEl: HTMLElement): void {
		new Setting(containerEl)
			.setName("Destination folder")
			.setDesc("Relative to the vault root. Overwritten on every refresh — don't point it at notes you edit.")
			.addText((text) =>
				text.setValue(this.destinationFolder).onChange((v) => {
					this.destinationFolder = v;
					this.destinationError = null;
				})
			);

		new Setting(containerEl).setName("Refresh interval (minutes)").addText((text) =>
			text.setValue(String(this.refreshIntervalMinutes)).onChange((v) => {
				const parsed = Number(v);
				if (Number.isFinite(parsed) && parsed > 0) this.refreshIntervalMinutes = parsed;
			})
		);

		new Setting(containerEl)
			.setName("Also check on foreground")
			.setDesc("On mobile this is effectively the only trigger — the OS suspends background timers.")
			.addToggle((toggle) => toggle.setValue(this.refreshOnForeground).onChange((v) => (this.refreshOnForeground = v)));

		new Setting(containerEl).setName("Advanced").setHeading();

		new Setting(containerEl)
			.setName("Max artifact size override (MB)")
			.setDesc(`Leave blank to use the default (${this.plugin.settings.defaultMaxSizeMB} MB).`)
			.addText((text) =>
				text.setValue(this.maxSizeMBOverride === undefined ? "" : String(this.maxSizeMBOverride)).onChange((v) => {
					const parsed = Number(v);
					this.maxSizeMBOverride = v.trim() === "" ? undefined : Number.isFinite(parsed) && parsed > 0 ? parsed : this.maxSizeMBOverride;
				})
			);

		new Setting(containerEl).setName("Mobile Wi-Fi-only override").addDropdown((dropdown) =>
			dropdown
				.addOption("inherit", "Use the global setting")
				.addOption("true", "Always Wi-Fi only")
				.addOption("false", "Never restrict")
				.setValue(this.wifiOnlyOverride === undefined ? "inherit" : String(this.wifiOnlyOverride))
				.onChange((v) => {
					this.wifiOnlyOverride = v === "inherit" ? undefined : v === "true";
				})
		);

		if (this.destinationError) {
			containerEl.createEl("p", { text: this.destinationError, cls: "mod-warning" });
		}

		this.renderFooter(containerEl, {
			canNext: true,
			onNext: () => {
				const normalized = normalizeVaultPath(this.destinationFolder);
				if (!normalized) {
					this.destinationError = "A destination folder is required.";
					this.render();
					return;
				}
				const conflict = findOverlappingDestination(normalized, this.plugin.settings.sources, this.existing?.id);
				if (conflict) {
					const other = this.plugin.settings.sources.find((s) => s.id === conflict);
					this.destinationError = `Overlaps with "${other?.displayName ?? conflict}"'s destination.`;
					this.render();
					return;
				}
				this.destinationFolder = normalized;
				this.goTo("confirm");
			},
		});
	}

	// Step 7 -------------------------------------------------------------

	private renderConfirm(containerEl: HTMLElement): void {
		const summary = containerEl.createEl("ul");
		summary.createEl("li", { text: `Name: ${this.displayName}` });
		summary.createEl("li", { text: `Host: ${this.host === "gitlab" ? "GitLab" : "GitHub"}` });
		summary.createEl("li", { text: `Destination: ${this.destinationFolder}` });
		summary.createEl("li", { text: `Content root: ${this.contentRootPath === "" ? "(zip root)" : this.contentRootPath}` });
		summary.createEl("li", { text: `Refresh every ${this.refreshIntervalMinutes} minutes${this.refreshOnForeground ? " (+ on foreground)" : ""}` });
		containerEl.createEl("p", { text: "Tokens are stored locally on this device and don't travel with the vault to another device." });

		this.renderFooter(containerEl, {
			canNext: !this.saving,
			nextLabel: this.saving ? "Saving…" : "Finish",
			onNext: () => void this.finish(),
		});
	}

	private async finish(): Promise<void> {
		this.saving = true;
		this.render();

		const id = this.existing?.id ?? generateSourceId(this.displayName);
		const source: Source = {
			id,
			displayName: this.displayName.trim() || id,
			config: this.draftConfig(),
			contentRootPath: this.contentRootPath,
			destinationFolder: this.destinationFolder,
			tokenRef: id,
			maxSizeMB: this.maxSizeMBOverride,
			wifiOnlyOverride: this.wifiOnlyOverride,
			refreshIntervalMinutes: this.refreshIntervalMinutes,
			refreshOnForeground: this.refreshOnForeground,
		};

		const tokenToStore = this.token.trim() || null;
		await this.plugin.upsertSource(source, tokenToStore);
		this.close();
		new Notice(`${source.displayName}: saved, refreshing…`);
		const result = await this.plugin.refreshSource(source, "manual");
		if (result.ok) new Notice(`${source.displayName}: refreshed`);
	}
}
