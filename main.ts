import { App, FuzzySuggestModal, MarkdownView, Plugin, PluginSettingTab, Setting } from 'obsidian';
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

export class KeySequenceModal extends SuggestModal<KeyItem> {
	// Returns all available suggestions.
	getSuggestions(query: string): KeyItem[] {
		const result = g_all_key_items.find((key_item) => {
			return key_item.key_sequence == query;
		})

		if (result != null) {
			this.close();
			this.delay(100).then(data => {this.execute(result);} )
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
		this.execute(key_item);
	}

	execute(key_item: KeyItem) {
		console.log(`Execute ${key_item.key_sequence}: ${key_item.command}`);
		(this.app as any).commands.executeCommandById(key_item.command);
	}

	async delay(ms: number) {
		return new Promise(resolve => setTimeout(resolve, ms));
	}
}

export class InsertCommandIdModel extends FuzzySuggestModal<Command> {
	getItems(): Command[] {
		return Object.values((this.app as any).commands.commands);
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
		await this.loadSettings();

		this.load_kssrc_file();

		this.addCommand({
			id: 'open-key-sequence-palette',
			name: 'Open Key Sequence Palette (Menu)',
			icon: 'any-key',
			hotkeys: [{ modifiers: ['Ctrl'], key: 'm' }],
			callback: () => {
				new KeySequenceModal(this.app).open();
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

	}

}
