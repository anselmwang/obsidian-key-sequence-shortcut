import { App, FuzzySuggestModal, MarkdownView, Notice, Plugin, PluginSettingTab, Setting } from 'obsidian';
import { Command, SuggestModal } from "obsidian";

interface KeySequenceShortcutSettings {
	kssrc_file_path: string
}

const DEFAULT_SETTINGS: Partial<KeySequenceShortcutSettings> = {
	kssrc_file_path: "kssrc.md"
};

export class KeySequenceShortcutSettingTab extends PluginSettingTab {
  plugin: KeySequenceShortcutPlugin;

  constructor(app: App, plugin: KeySequenceShortcutPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Config File")
      .addText((text) =>
        text
          .setPlaceholder("")
          .setValue(this.plugin.settings.kssrc_file_path)
          .onChange(async (value) => {
            this.plugin.settings.kssrc_file_path= value;
            await this.plugin.saveSettings();
          })
      );
  }
}

interface KeyItem {
	key_sequence: string;
	command: string;
	description: string,
}

let g_all_key_items: KeyItem[] = [];

interface CommandApp extends App {
	commands: {
		commands: Record<string, Command>;
		executeCommandById(id: string): boolean | void | Promise<boolean | void>;
	};
}

interface EnglishOverrideManager {
	disposed: boolean;
	beginEnglishOverride(reason: string): unknown;
	endEnglishOverride(owner: unknown): void | Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isManager(value: unknown): value is EnglishOverrideManager {
	return isRecord(value) && value.disposed === false &&
		typeof value.beginEnglishOverride === "function" &&
		typeof value.endEnglishOverride === "function";
}

function hasReady(owner: unknown): owner is { ready: PromiseLike<void> } {
	return isRecord(owner) && isRecord(owner.ready) &&
		typeof owner.ready.then === "function";
}

function findEnglishOverrideManager(app: App): EnglishOverrideManager | null {
	// Obsidian's runtime plugin registry is not part of its public App typings.
	const registry = (app as App & { plugins?: { getPlugin?: (id: string) => unknown } }).plugins;
	if (typeof registry?.getPlugin !== "function")
		return null;
	for (const id of ["vim-input-method-memory", "obsidian-vim-im-switch-plugin"]) {
		const plugin = registry.getPlugin(id);
		if (isManager(plugin))
			return plugin;
	}
	return null;
}

function reportError(message: string, error: unknown): void {
	console.error(`[Key Sequence] ${message}`, error);
	new Notice(`Key Sequence ${message}; see Console.`);
}

class EnglishOverride {
	private released = false;

	constructor(readonly manager: EnglishOverrideManager, readonly owner: unknown) {}

	release(): void {
		if (this.released)
			return;
		this.released = true;
		try {
			Promise.resolve(this.manager.endEnglishOverride(this.owner))
				.catch(error => reportError("could not release English input", error));
		} catch (error) {
			reportError("could not release English input", error);
		}
	}
}

export class KeySequenceModal extends SuggestModal<KeyItem> {
	private executing = false;
	private closed = false;
	private finished = false;
	private commandTimer: ReturnType<typeof setTimeout> | null = null;

	constructor(app: App, private plugin: KeySequenceShortcutPlugin,
		private override: EnglishOverride | null = null) {
		super(app);
	}

	// Returns all available suggestions.
	getSuggestions(query: string): KeyItem[] {
		const result = g_all_key_items.find((key_item) => {
			return key_item.key_sequence == query;
		})

		if (result != null) {
			this.choose(result);
		}
		return g_all_key_items.filter((key_item) =>
			key_item.key_sequence.startsWith(query)
		);
	}

	// Renders each suggestion item.
	renderSuggestion(key_item: KeyItem, el: HTMLElement) {
		el.createEl("div", { text: key_item.key_sequence + ": " + (key_item.description == "" ? key_item.command : key_item.description) });
	}

	// Perform action on the selected suggestion.
	onChooseSuggestion(key_item: KeyItem, evt: MouseEvent | KeyboardEvent) {
		this.choose(key_item);
	}

	choose(key_item: KeyItem): void {
		if (this.executing || this.finished || this.plugin.stopped)
			return;
		this.executing = true;
		this.close();
		// Let editor focus settle; ownership lasts through dispatch, not a restore timer.
		this.commandTimer = setTimeout(async () => {
			this.commandTimer = null;
			try {
				if (!this.plugin.stopped)
					await this.execute(key_item);
			} catch (error) {
				reportError("command failed", error);
			} finally {
				this.release();
			}
		}, 100);
	}

	async execute(key_item: KeyItem): Promise<void> {
		console.log(`Execute ${key_item.key_sequence}: ${key_item.command}`);
		const result = await (this.app as CommandApp).commands.executeCommandById(key_item.command);
		if (result === false)
			throw new Error(`Command unavailable: ${key_item.command}`);
	}

	onClose(): void {
		this.closed = true;
		super.onClose();
		// SuggestModal closes before calling onChooseSuggestion in the same turn.
		Promise.resolve().then(() => {
			if (!this.executing)
				this.release();
		});
	}

	private release(): void {
		if (this.finished)
			return;
		this.finished = true;
		this.override?.release();
		this.override = null;
		if (this.plugin.activeModal === this)
			this.plugin.activeModal = null;
	}

	dispose(): void {
		if (this.commandTimer !== null) {
			clearTimeout(this.commandTimer);
			this.commandTimer = null;
		}
		if (!this.closed)
			this.close();
		this.release();
	}
}

export class InsertCommandIdModel extends FuzzySuggestModal<Command> {
	getItems(): Command[] {
		return Object.values((this.app as CommandApp).commands.commands);
	}

	getItemText(item: Command): string {
		return item.name + " -> " + item.id;
	}

	onChooseItem(item: Command, evt: MouseEvent | KeyboardEvent): void {
		console.log(this.getItemText(item));
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (view) {
			const editor = view.editor;
			const pos = editor.getCursor();
			editor.replaceRange(`${item.id}\t${item.name}`, pos);
			pos.ch += item.id.length;
			editor.setCursor(pos);
		}

	}
}

export default class KeySequenceShortcutPlugin extends Plugin {
	settings: KeySequenceShortcutSettings;
	settingTab: KeySequenceShortcutSettingTab;
	stopped = false;
	activeModal: KeySequenceModal | null = null;
	private opening = false;
	private pendingOverride: EnglishOverride | null = null;

	readKssInit(kss_config: string) {
		g_all_key_items = [];
		kss_config.split("\n").forEach(
			(line: string, index: number) => {
				line = line.trim();
				if (line.length > 0 && line[0] != '"') {
					const split = line.split("\t");
					if ((split.length != 2) && (split.length != 3) ) {
						console.log(`Skip line ${index} "${line}": the format should be "key-sequence<TAB>command-id<TAB>description", the last field "description" is optional.`)
						return
					}
					// FIXME: We can't check when loading the plugin, at this time, the commands list is not complete
					// if(! (split[1] in (this.app as any).commands.commands))
					// {
					// 	console.log(`Skip line ${index} "${line}": ${split[1]} is not a valid command id.`);
					// 	return
					// }
					const key_item: KeyItem = { key_sequence: split[0], command: split[1],  description: split.length == 3 ? split[2] : ""}
					g_all_key_items.push(key_item);
				}
			}
		)
	}

	async onload() {
		this.stopped = false;
		await this.loadSettings();
		if (this.stopped)
			return;

		this.load_kssrc_file();

		this.addCommand({
			id: 'open-key-sequence-palette',
			name: 'Open Key Sequence Palette (Menu)',
			icon: 'any-key',
			hotkeys: [{ modifiers: ['Ctrl'], key: 'm' }],
			callback: () => {
				void this.openPalette();
			}
		});

		this.addCommand({
			id: 'insert-command-id',
			name: 'Insert Command Id and Name',
			hotkeys: [{ modifiers: ['Ctrl', 'Shift'], key: '8' }],
			icon: "duplicate-glyph",
			callback: () => {
				new InsertCommandIdModel(this.app).open();
			}
		});

		this.addCommand({
			id: 'reload-kssrc',
			name: 'Reload Key Sequence Shortcut Config File',
			icon: "play-audio-glyph",
			callback: async () => {
				await this.load_kssrc_file();
			}
		});
		this.settingTab = new KeySequenceShortcutSettingTab(this.app, this);
		this.addSettingTab(this.settingTab);
		console.log("KeySequenceShortcutPlugin load successfully.")
	}

	async openPalette(): Promise<void> {
		if (this.opening || this.activeModal || this.stopped)
			return;
		this.opening = true;
		let override: EnglishOverride | null = null;
		let modal: KeySequenceModal | null = null;
		try {
			const manager = findEnglishOverrideManager(this.app);
			if (manager) {
				const owner = manager.beginEnglishOverride("key-sequence");
				override = new EnglishOverride(manager, owner);
				this.pendingOverride = override;
				if (!hasReady(owner))
					throw new Error("Input method provider returned an invalid English override.");
				await owner.ready;
				if (this.stopped || manager.disposed || !document.hasFocus())
					return;
			}
			modal = new KeySequenceModal(this.app, this, override);
			this.activeModal = modal;
			modal.open();
			// The modal now owns cleanup; otherwise finally releases preparation.
			override = null;
		} catch (error) {
			modal?.dispose();
			reportError("could not open palette or prepare English input", error);
		} finally {
			override?.release();
			this.pendingOverride = null;
			this.opening = false;
		}
	}

	private async load_kssrc_file() {
		try {
			const lines = await this.app.vault.adapter.read(this.settings.kssrc_file_path);
			this.readKssInit(lines);
		} catch (error)
		{ 
			console.log('Error loading kssrc file', this.settings.kssrc_file_path, 'from the vault root', error); 
		}
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
		this.load_kssrc_file();
	}

	onunload() {
		this.stopped = true;
		this.activeModal?.dispose();
		this.pendingOverride?.release();
		this.pendingOverride = null;
	}

}
