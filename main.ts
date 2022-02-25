import { FuzzySuggestModal, MarkdownView, Plugin } from 'obsidian';
import { Command, SuggestModal } from "obsidian";

interface KeyItem {
	key_sequence: string;
	command: string;
}

let g_all_key_items: KeyItem[] = [];

export class KeySequenceModal extends SuggestModal<KeyItem> {
	// Returns all available suggestions.
	getSuggestions(query: string): KeyItem[] {
		const result = g_all_key_items.find((key_item) => {
			return key_item.key_sequence == query;
		})

		if (result != null) {
			this.execute(result);
			this.close();
		} 
		return g_all_key_items.filter((key_item) =>
			key_item.key_sequence.startsWith(query)
		);
	}

	// Renders each suggestion item.
	renderSuggestion(key_item: KeyItem, el: HTMLElement) {
		el.createEl("div", { text: key_item.key_sequence + ": " + key_item.command });
	}

	// Perform action on the selected suggestion.
	onChooseSuggestion(key_item: KeyItem, evt: MouseEvent | KeyboardEvent) {
		this.execute(key_item);
	}

	execute(key_item: KeyItem) {
		console.log(`Execute ${key_item.key_sequence}: ${key_item.command}`);
		(this.app as any).commands.executeCommandById(key_item.command);
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
			editor.replaceRange(item.id, pos);
			pos.ch += item.id.length;
			editor.setCursor(pos);
		}

	}
}

const PLUGIN_NAME = "obsidian-key-sequence-shortcut"
const KSSRC_FILE_PATH = ".obsidian.kssrc"
const DEFAULT_KSSRC_FILE_PATH = `.obsidian/plugins/${PLUGIN_NAME}/.obsidian.kssrc.default`

export default class KeySequenceShortcutPlugin extends Plugin {
	readKssInit(kss_config: string) {
		g_all_key_items = [];
		kss_config.split("\n").forEach(
			(line: string, index: number) => {
				line =line.trim();
				if (line.length > 0 && line[0] != '#') {
					const split = line.split(" ");
					if(split.length != 2)
					{
						console.log(`Skip line ${index} "${line}": Doesn't contain two fields.`)
						return
					}
					// FIXME: We can't check when loading the plugin, at this time, the commands list is not complete
					// if(! (split[1] in (this.app as any).commands.commands))
					// {
					// 	console.log(`Skip line ${index} "${line}": ${split[1]} is not a valid command id.`);
					// 	return
					// }
					g_all_key_items.push({key_sequence: split[0], command: split[1]});
				}
			}
		)
	}

	async onload() {
		
		if(! await this.app.vault.adapter.exists(KSSRC_FILE_PATH))
		{
			this.app.vault.adapter.copy(DEFAULT_KSSRC_FILE_PATH, KSSRC_FILE_PATH);
		}

		this.app.vault.adapter.read(KSSRC_FILE_PATH).
			then((lines) => this.readKssInit(lines)).
			catch(error => { console.log('Error loading kssrc file', KSSRC_FILE_PATH, 'from the vault root', error) });

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
	name: 'Insert Command Id',
	callback: () => {
		new InsertCommandIdModel(this.app).open();
	}
});



console.log("KeySequenceShortcutPlugin load successfully.")
	}

onunload() {

}

}
