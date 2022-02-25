import { Plugin } from 'obsidian';
import { Notice, SuggestModal } from "obsidian";

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
    return ALL_KEY_ITEMS.filter((key_item) =>
      key_item.key_sequence.startsWith(query)
    );
  }

  // Renders each suggestion item.
  renderSuggestion(key_item: KeyItem, el: HTMLElement) {
    el.createEl("div", { text: key_item.key_sequence + ": " + key_item.command });
  }

  // Perform action on the selected suggestion.
  onChooseSuggestion(key_item: KeyItem, evt: MouseEvent | KeyboardEvent) {
    console.log(`Selected ${key_item.key_sequence}: ${key_item.command}`);
	(this.app as any).commands.executeCommandById(key_item.command);
  }
}

export default class KeySequenceShortcutPlugin extends Plugin {
	async onload() {
		this.addCommand({
			id: 'open-key-sequence-palette',
			name: 'Open Key Sequence Palette',
			icon: 'any-key',
			hotkeys: [{modifiers: ['Ctrl'], key: 'q'}],
			callback: () => {
				new KeySequenceModal(this.app).open();
			}
		});
		console.log("KeySequenceShortcutPlugin load successfully.")
	}

	onunload() {

	}

}
