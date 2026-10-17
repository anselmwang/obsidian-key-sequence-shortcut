const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const vm = require("node:vm");
const { buildSync } = require("esbuild");

const source = process.argv.includes("--release") ? readFileSync("main.js", "utf8") : buildSync({
	entryPoints: ["main.ts"],
	bundle: true,
	platform: "browser",
	format: "cjs",
	target: "es2016",
	external: ["obsidian"],
	write: false
}).outputFiles[0].text;

const item = { key_sequence: "tp", command: "test:preview", description: "Preview" };
const newId = "vim-input-method-memory";
const legacyId = "obsidian-vim-im-switch-plugin";
const tests = [];
const test = (name, run) => tests.push({ name, run });
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function deferred() {
	let resolve, reject;
	const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
	return { promise, resolve, reject };
}

function provider(ready = Promise.resolve()) {
	const owners = [];
	const released = [];
	return {
		disposed: false,
		owners, released,
		beginEnglishOverride(reason) {
			const owner = { reason, ready };
			owners.push(owner);
			return owner;
		},
		endEnglishOverride(owner) { released.push(owner); }
	};
}

function environment(registry = {}) {
	const state = {
		now: 0, nextTimer: 0, timers: new Map(), notices: [], errors: [],
		opened: [], executed: [], commands: [], lookups: [], focused: true,
		failOpen: false, execute: () => true
	};
	class Plugin {
		constructor(app) { this.app = app; }
		async loadData() { return {}; }
		async saveData(data) { state.saved = data; }
		addCommand(command) { state.commands.push(command); }
		addSettingTab() {}
	}
	class SuggestModal {
		constructor(app) { this.app = app; }
		open() {
			if (state.failOpen) throw new Error("open failed");
			state.opened.push(this);
		}
		close() {
			if (this.baseClosed) return;
			this.baseClosed = true;
			this.onClose();
		}
		onClose() {}
	}
	const obsidian = {
		Plugin, SuggestModal,
		FuzzySuggestModal: class { constructor(app) { this.app = app; } },
		MarkdownView: class {},
		PluginSettingTab: class {},
		Setting: class {},
		Notice: class { constructor(message) { state.notices.push(message); } }
	};
	const app = {
		plugins: { getPlugin(id) { state.lookups.push(id); return registry[id] ?? null; } },
		commands: {
			commands: { "test:preview": { id: "test:preview", name: "Preview" } },
			executeCommandById(id) { state.executed.push(id); return state.execute(id); }
		},
		vault: { adapter: { read: async () => "tp\ttest:preview\tPreview\n" } },
		workspace: { getActiveViewOfType: () => null }
	};
	const module = { exports: {} };
	vm.runInNewContext(source, {
		module, exports: module.exports,
		require(name) {
			assert.equal(name, "obsidian", "release must not import a native dependency");
			return obsidian;
		},
		document: { hasFocus: () => state.focused },
		console: { log() {}, error: (...args) => state.errors.push(args) },
		setTimeout(fn, delay) {
			const id = ++state.nextTimer;
			state.timers.set(id, { fn, at: state.now + delay });
			return id;
		},
		clearTimeout(id) { state.timers.delete(id); }
	});
	const plugin = new module.exports.default(app);
	plugin.readKssInit("tp\ttest:preview\tPreview\n");
	async function tick(ms) {
		state.now += ms;
		for (const [id, timer] of [...state.timers]) {
			if (timer.at <= state.now) {
				state.timers.delete(id);
				void timer.fn();
			}
		}
		await flush();
	}
	return { state, app, plugin, registry, tick, exports: module.exports };
}

for (const mode of ["absent", "disabled", "outdated", "disposed", "no registry", "no lookup"]) {
	test(`standalone palette and commands: ${mode}`, async () => {
		const old = { pushIMStatus() { assert.fail("legacy push called"); } };
		const p = provider();
		if (mode === "disposed") p.disposed = true;
		const e = environment(mode === "outdated" ? { [legacyId]: old } :
			mode === "disposed" ? { [newId]: p } : {});
		if (mode === "disabled") e.registry[newId] = null;
		if (mode === "no registry") delete e.app.plugins;
		if (mode === "no lookup") e.app.plugins = {};
		await e.plugin.openPalette();
		assert.equal(e.state.opened.length, 1);
		e.plugin.activeModal.getSuggestions("tp");
		await e.tick(99);
		assert.equal(e.state.executed.length, 0);
		await e.tick(1);
		assert.deepEqual(e.state.executed, ["test:preview"]);
		assert.equal(e.plugin.activeModal, null);
		assert.equal(p.owners.length, 0);
		assert.equal(e.state.notices.length, 0);
	});
}

for (const id of [newId, legacyId]) {
	test(`wait for preparation, then cancel with scoped release: ${id}`, async () => {
		const ready = deferred();
		const p = provider(ready.promise);
		const e = environment({ [id]: p });
		const opening = e.plugin.openPalette();
		assert.equal(e.state.opened.length, 0);
		await e.plugin.openPalette();
		assert.equal(p.owners.length, 1);
		ready.resolve();
		await opening;
		assert.equal(e.state.opened.length, 1);
		assert.equal(p.owners[0].reason, "key-sequence");
		e.plugin.activeModal.close();
		assert.equal(p.released.length, 0);
		await flush();
		assert.deepEqual(p.released, [p.owners[0]]);
		assert.equal(e.plugin.activeModal, null);
		assert.equal(e.state.executed.length, 0);
		assert.equal(e.state.notices.length, 0);
	});
}

test("prefer new ID and fall back only when it is incompatible", async () => {
	const current = provider(), legacy = provider();
	const e = environment({ [newId]: current, [legacyId]: legacy });
	await e.plugin.openPalette();
	assert.equal(current.owners.length, 1);
	assert.equal(legacy.owners.length, 0);
	assert.deepEqual(e.state.lookups, [newId]);
	e.plugin.activeModal.close();
	await flush();
	e.registry[newId] = { disposed: false, beginEnglishOverride() {} };
	await e.plugin.openPalette();
	assert.equal(legacy.owners.length, 1);
	e.plugin.onunload();
});

test("re-check enablement and disablement on each open", async () => {
	const e = environment();
	await e.plugin.openPalette();
	e.plugin.activeModal.close();
	await flush();
	const p = e.registry[newId] = provider();
	await e.plugin.openPalette();
	assert.equal(p.owners.length, 1);
	e.plugin.activeModal.close();
	await flush();
	delete e.registry[newId];
	await e.plugin.openPalette();
	e.plugin.activeModal.choose(item);
	await e.tick(100);
	assert.equal(p.owners.length, 1);
	assert.equal(p.released.length, 1);
	assert.equal(e.state.executed.length, 1);
});

test("cancellation releases only the palette owner, not another consumer", async () => {
	const p = provider(), e = environment({ [newId]: p });
	const other = p.beginEnglishOverride("another-consumer");
	await e.plugin.openPalette();
	const paletteOwner = p.owners[1];
	e.plugin.activeModal.close();
	await flush();
	assert.deepEqual(p.released, [paletteOwner]);
	assert.ok(!p.released.includes(other));
});

test("repeated matches and selected suggestions execute once after exactly 100 ms", async () => {
	const p = provider(), e = environment({ [newId]: p });
	await e.plugin.openPalette();
	const modal = e.plugin.activeModal;
	modal.getSuggestions("tp");
	modal.getSuggestions("tp");
	modal.onChooseSuggestion(item, {});
	await flush();
	assert.equal(p.released.length, 0);
	await e.plugin.openPalette();
	assert.equal(e.state.opened.length, 1);
	await e.tick(99);
	assert.equal(e.state.executed.length, 0);
	await e.tick(1);
	assert.equal(e.state.executed.length, 1);
	assert.equal(p.released.length, 1);
	modal.choose(item);
	await e.tick(1000);
	assert.equal(e.state.executed.length, 1);
	assert.equal(p.released.length, 1);
});

test("close-before-choose retains ownership through asynchronous dispatch", async () => {
	const p = provider(), e = environment({ [newId]: p }), command = deferred();
	e.state.execute = () => {
		assert.equal(p.released.length, 0);
		return command.promise;
	};
	await e.plugin.openPalette();
	const modal = e.plugin.activeModal;
	modal.close();
	modal.onChooseSuggestion(item, {});
	await flush();
	assert.equal(p.released.length, 0);
	await e.tick(100);
	assert.equal(e.state.executed.length, 1);
	await e.tick(1000);
	assert.equal(p.released.length, 0, "no blind restore timer");
	command.resolve(true);
	await flush();
	assert.deepEqual(p.released, [p.owners[0]]);
	assert.equal(e.plugin.activeModal, null);
});

test("cancelled modal rejects late suggestions", async () => {
	const e = environment();
	await e.plugin.openPalette();
	const modal = e.plugin.activeModal;
	modal.close();
	await flush();
	modal.choose(item);
	await e.tick(100);
	assert.equal(e.state.executed.length, 0);
});

for (const phase of ["preparing", "open", "timer", "dispatch"]) {
	test(`unload during ${phase} releases once and cancels future work`, async () => {
		const ready = deferred(), command = deferred();
		const p = provider(phase === "preparing" ? ready.promise : Promise.resolve());
		const e = environment({ [newId]: p });
		e.state.execute = () => command.promise;
		const opening = e.plugin.openPalette();
		if (phase !== "preparing") await opening;
		const modal = e.plugin.activeModal;
		if (phase === "timer" || phase === "dispatch") modal.choose(item);
		if (phase === "dispatch") await e.tick(100);
		e.plugin.onunload();
		e.plugin.onunload();
		ready.resolve();
		command.resolve(true);
		await opening;
		await e.tick(1000);
		await e.plugin.openPalette();
		if (modal) modal.choose(item);
		assert.equal(e.state.timers.size, 0);
		assert.equal(e.state.executed.length, phase === "dispatch" ? 1 : 0);
		assert.equal(e.state.opened.length, phase === "preparing" ? 0 : 1);
		assert.equal(e.plugin.activeModal, null);
		assert.deepEqual(p.released, [p.owners[0]]);
	});
}

for (const reason of ["blur", "provider disposed"]) {
	test(`cancel pending opening after ${reason}`, async () => {
		const ready = deferred(), p = provider(ready.promise);
		const e = environment({ [newId]: p });
		const opening = e.plugin.openPalette();
		if (reason === "blur") e.state.focused = false;
		else p.disposed = true;
		ready.resolve();
		await opening;
		assert.equal(e.state.opened.length, 0);
		assert.deepEqual(p.released, [p.owners[0]]);
	});
}

for (const failure of ["begin throws", "ready rejects", "invalid owner", "invalid ready"]) {
	test(`compatible provider failure is surfaced: ${failure}`, async () => {
		const ready = deferred(), p = provider(ready.promise), legacy = provider();
		if (failure === "begin throws") p.beginEnglishOverride = () => { throw new Error("begin failed"); };
		if (failure === "invalid owner") p.beginEnglishOverride = () => null;
		if (failure === "invalid ready") p.beginEnglishOverride = () => ({ ready: null });
		const e = environment({ [newId]: p, [legacyId]: legacy });
		const opening = e.plugin.openPalette();
		if (failure === "ready rejects") ready.reject(new Error("helper failed"));
		await opening;
		assert.equal(e.state.opened.length, 0);
		assert.equal(e.plugin.activeModal, null);
		assert.equal(e.state.notices.length, 1);
		assert.equal(e.state.errors.length, 1);
		assert.equal(p.released.length, failure === "begin throws" ? 0 : 1);
		assert.equal(legacy.owners.length, 0, "do not hide operational failure using fallback");
		delete e.registry[newId];
		delete e.registry[legacyId];
		await e.plugin.openPalette();
		assert.equal(e.state.opened.length, 1, "failure must not leave palette blocked");
	});
}

for (const failure of ["false", "throw", "reject", "async false"]) {
	test(`command failure releases ownership and reports: ${failure}`, async () => {
		const p = provider(), e = environment({ [newId]: p });
		e.state.execute = () => {
			if (failure === "throw") throw new Error("command failed");
			if (failure === "reject") return Promise.reject(new Error("command failed"));
			if (failure === "async false") return Promise.resolve(false);
			return false;
		};
		await e.plugin.openPalette();
		e.plugin.activeModal.choose(item);
		await e.tick(100);
		assert.equal(e.state.notices.length, 1);
		assert.equal(e.state.errors.length, 1);
		assert.deepEqual(p.released, [p.owners[0]]);
		assert.equal(e.plugin.activeModal, null);
	});
}

for (const failure of ["throw", "reject"]) {
	test(`release failure is reported without blocking cleanup: ${failure}`, async () => {
		const p = provider(), e = environment({ [newId]: p });
		p.endEnglishOverride = owner => {
			p.released.push(owner);
			if (failure === "throw") throw new Error("release failed");
			return Promise.reject(new Error("release failed"));
		};
		await e.plugin.openPalette();
		e.plugin.activeModal.close();
		await flush();
		e.plugin.onunload();
		assert.equal(e.state.notices.length, 1);
		assert.equal(e.state.errors.length, 1);
		assert.equal(p.released.length, 1);
		assert.equal(e.plugin.activeModal, null);
	});
}

test("failed modal opening clears active state and releases ownership", async () => {
	const p = provider(), e = environment({ [newId]: p });
	e.state.failOpen = true;
	await e.plugin.openPalette();
	await flush();
	assert.equal(e.plugin.activeModal, null);
	assert.equal(p.released.length, 1);
	assert.equal(e.state.notices.length, 1);
	e.state.failOpen = false;
	await e.plugin.openPalette();
	assert.equal(e.state.opened.length, 1);
	e.plugin.onunload();
});

test("configuration, prefix matching, descriptions and command insertion are preserved", async () => {
	const e = environment();
	e.plugin.readKssInit('" comment\n\ninvalid\nab\ttest:a\nabc\ttest:b\tCustom label\nz\ttest:z\n');
	await e.plugin.openPalette();
	const modal = e.plugin.activeModal;
	assert.deepEqual(Array.from(modal.getSuggestions("a"), x => x.key_sequence), ["ab", "abc"]);
	assert.equal(e.state.timers.size, 0);
	const rendered = [];
	const el = { createEl: (tag, options) => rendered.push(options.text) };
	modal.renderSuggestion(modal.getSuggestions("a")[0], el);
	modal.renderSuggestion(modal.getSuggestions("a")[1], el);
	assert.deepEqual(rendered, ["ab: test:a", "abc: Custom label"]);
	modal.getSuggestions("ab");
	await e.tick(100);
	assert.deepEqual(e.state.executed, ["test:a"]);
	const inserter = new e.exports.InsertCommandIdModel(e.app);
	assert.equal(inserter.getItems()[0].id, item.command);
	assert.equal(inserter.getItemText({ id: item.command, name: "Preview" }), "Preview -> test:preview");
	const position = { line: 0, ch: 2 };
	const editor = {
		getCursor: () => position,
		replaceRange: (text, pos) => { assert.equal(text, "test:preview\tPreview"); assert.equal(pos, position); },
		setCursor: pos => assert.equal(pos.ch, 2 + item.command.length)
	};
	e.app.workspace.getActiveViewOfType = () => ({ editor });
	inserter.onChooseItem({ id: item.command, name: "Preview" }, {});
});

test("onload wires existing commands and settings without an IME dependency", async () => {
	const e = environment();
	await e.plugin.onload();
	assert.deepEqual(e.state.commands.map(x => x.id),
		["open-key-sequence-palette", "insert-command-id", "reload-kssrc"]);
	assert.equal(e.plugin.settings.kssrc_file_path, "kssrc.md");
	e.state.commands[0].callback();
	assert.equal(e.state.opened.length, 1);
	await e.plugin.saveSettings();
	assert.equal(e.state.saved.kssrc_file_path, "kssrc.md");
	e.plugin.onunload();
});

test("unload while loading settings prevents late command registration", async () => {
	const e = environment(), settings = deferred();
	e.plugin.loadData = () => settings.promise;
	const loading = e.plugin.onload();
	e.plugin.onunload();
	settings.resolve({});
	await loading;
	assert.equal(e.state.commands.length, 0);
});

(async () => {
	for (const { name, run } of tests) {
		await run();
		console.log(`PASS ${name}`);
	}
	console.log(`${tests.length} lifecycle tests passed.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
