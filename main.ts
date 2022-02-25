import { FuzzySuggestModal, MarkdownView, Plugin } from 'obsidian';
import { Command, SuggestModal } from "obsidian";

interface KeyItem {
	key_sequence: string;
	command: string;
}

const ALL_KEY_ITEMS = [
	{
		key_sequence: "tb",
		command: "editor:toggle-bullet-list",
	},
];

export class KeySequenceModal extends SuggestModal<KeyItem> {
	// Returns all available suggestions.
	getSuggestions(query: string): KeyItem[] {
		const result = ALL_KEY_ITEMS.find((key_item) => {
			return key_item.key_sequence == query;
		})

		if (result != null)
		{
			this.execute(result);
			this.close();
		} else {
			return ALL_KEY_ITEMS.filter((key_item) =>
				key_item.key_sequence.startsWith(query)
			);
		}
	}

	// Renders each suggestion item.
	renderSuggestion(key_item: KeyItem, el: HTMLElement) {
		el.createEl("div", { text: key_item.key_sequence + ": " + key_item.command });
	}

	// Perform action on the selected suggestion.
	onChooseSuggestion(key_item: KeyItem, evt: MouseEvent | KeyboardEvent) {
		this.execute(key_item);
	}

	execute(key_item: KeyItem)
	{
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

export default class KeySequenceShortcutPlugin extends Plugin {
	async onload() {
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
