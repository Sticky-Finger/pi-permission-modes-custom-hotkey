/**
 * Wrap-around permission selector.
 *
 * pi's built-in `ctx.ui.select()` renders an `ExtensionSelectorComponent`
 * whose arrow keys clamp at the ends (first item + ↑ stays on the first,
 * last item + ↓ stays on the last). Every permission prompt in this
 * extension needs first ⇄ last cycling, so we render the list ourselves
 * through `ctx.ui.custom()` and keep the rest of the gate logic untouched.
 *
 * The list itself is `SelectList` from `@earendil-works/pi-tui` (the same
 * component pi's own `/model` picker uses), which already wraps at the ends
 * and windows long option lists to the terminal height. `j` / `k` are kept
 * as aliases for ↓ / ↑, matching the native extension selector.
 *
 * RPC mode keeps pi's native `ui.select()`: custom components need a TUI,
 * while the RPC host implements `select` over its JSON UI protocol.
 */

import {
	Container,
	SelectList,
	Spacer,
	Text,
	getKeybindings,
	wrapTextWithAnsi,
	type Component,
	type KeybindingsManager,
	type TUI,
} from "@earendil-works/pi-tui"
import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent"

/** Borders (2) + spacers (4); title and hint lines are counted separately. */
export const SELECTOR_BASE_CHROME_LINES = 6

/**
 * How many option rows fit on screen without pushing the dialog past the
 * terminal bottom. `SelectList` spends one extra line on its scroll counter
 * whenever the list is windowed, so reserve that line too.
 */
export function computeSelectorMaxVisible(
	termRows: number,
	optionCount: number,
	titleLines = 1,
	hintLines = 1,
): number {
	const chrome =
		SELECTOR_BASE_CHROME_LINES + Math.max(1, titleLines) + Math.max(1, hintLines)
	const available = Math.max(1, termRows - chrome)
	if (optionCount <= available) return Math.max(1, optionCount)
	return Math.max(1, available - 1)
}

export interface PermissionSelectorOptions {
	title: string
	options: readonly string[]
	theme: Theme
	tui: TUI
	/** Resolved keybindings from `ctx.ui.custom`; falls back to the global manager. */
	keybindings?: KeybindingsManager
	done: (result: string | undefined) => void
}

export interface PermissionSelectorComponent extends Component {
	readonly options: readonly string[]
	/** Index of the highlighted option (0-based). */
	readonly selectedIndex: number
	handleInput(data: string): void
	dispose(): void
}

function keyList(
	keybindings: KeybindingsManager,
	binding: "tui.select.confirm" | "tui.select.cancel",
): string {
	const keys = keybindings.getKeys(binding)
	return keys.length > 0 ? keys.join("/") : "?"
}

class CyclicPermissionSelector extends Container implements PermissionSelectorComponent {
	readonly options: readonly string[]
	private readonly list: SelectList
	private readonly done: (result: string | undefined) => void
	private readonly tui: TUI
	private readonly keybindings: KeybindingsManager
	private finished = false

	constructor(opts: PermissionSelectorOptions) {
		super()
		this.options = [...opts.options]
		this.done = opts.done
		this.tui = opts.tui
		this.keybindings = opts.keybindings ?? getKeybindings()

		const { theme } = opts
		const border = (text: string) => theme.fg("border", text)
		const accent = (text: string) => theme.fg("accent", text)
		const dim = (text: string) => theme.fg("dim", text)
		const muted = (text: string) => theme.fg("muted", text)

		const columns = Math.max(20, Math.floor(this.tui.terminal.columns) || 20)
		const rows = Math.max(1, Math.floor(this.tui.terminal.rows) || 24)
		const title = accent(theme.bold(opts.title))
		const hint =
			`${dim("↑↓")}${muted(" navigate")}  ` +
			`${dim(keyList(this.keybindings, "tui.select.confirm"))}${muted(" select")}  ` +
			`${dim(keyList(this.keybindings, "tui.select.cancel"))}${muted(" cancel")}`

		const titleLines = Math.max(1, wrapTextWithAnsi(opts.title, columns - 2).length)
		const hintLines = Math.max(1, wrapTextWithAnsi(hint, columns - 2).length)
		const maxVisible = computeSelectorMaxVisible(
			rows,
			this.options.length,
			titleLines,
			hintLines,
		)

		this.list = new SelectList(
			this.options.map((label, index) => ({ value: String(index), label })),
			maxVisible,
			{
				selectedPrefix: accent,
				selectedText: accent,
				description: muted,
				scrollInfo: dim,
				noMatch: dim,
			},
		)
		this.list.onSelect = (item) => this.finish(this.options[Number(item.value)])
		this.list.onCancel = () => this.finish(undefined)

		this.addChild(new RuleLine(border))
		this.addChild(new Spacer(1))
		this.addChild(new Text(title, 1, 0))
		this.addChild(new Spacer(1))
		this.addChild(this.list)
		this.addChild(new Spacer(1))
		this.addChild(new Text(hint, 1, 0))
		this.addChild(new Spacer(1))
		this.addChild(new RuleLine(border))
	}

	get selectedIndex(): number {
		const item = this.list.getSelectedItem()
		return item ? Number(item.value) : 0
	}

	handleInput(data: string): void {
		if (this.finished) return

		// j / k are navigation aliases, same as the native extension selector.
		if (data === "k" || data === "j") {
			this.moveBy(data === "k" ? -1 : 1)
			return
		}

		// Some terminals deliver Enter as "\n", which the native selector
		// also accepts explicitly.
		if (data === "\n" || this.keybindings.matches(data, "tui.select.confirm")) {
			const item = this.list.getSelectedItem()
			if (item) this.finish(this.options[Number(item.value)])
			return
		}

		if (this.keybindings.matches(data, "tui.select.cancel")) {
			this.finish(undefined)
			return
		}

		this.list.handleInput(data)
		this.tui.requestRender()
	}

	dispose(): void {
		this.finished = true
	}

	private moveBy(delta: number): void {
		const count = this.options.length
		if (count === 0) return
		const next = (((this.selectedIndex + delta) % count) + count) % count
		this.list.setSelectedIndex(next)
		this.tui.requestRender()
	}

	private finish(result: string | undefined): void {
		if (this.finished) return
		this.finished = true
		this.done(result)
	}
}

/** A full-width horizontal rule. */
class RuleLine implements Component {
	private readonly color: (text: string) => string

	constructor(color: (text: string) => string) {
		this.color = color
	}

	invalidate(): void {
		/* no cached state */
	}

	render(width: number): string[] {
		return [this.color("─".repeat(Math.max(1, width)))]
	}
}

export function createPermissionSelectorComponent(
	options: PermissionSelectorOptions,
): PermissionSelectorComponent {
	return new CyclicPermissionSelector(options)
}

/**
 * Show a wrap-around option list and return the chosen label (or undefined
 * when the user cancels / no UI is available).
 */
export async function showPermissionSelector(
	ctx: ExtensionContext,
	title: string,
	options: readonly string[],
): Promise<string | undefined> {
	if (!ctx.hasUI) return undefined

	// RPC hosts have no TUI to mount a component in, but they do implement
	// `select` over the extension UI protocol — keep approvals working there.
	if (ctx.mode === "rpc") return ctx.ui.select(title, [...options])

	return ctx.ui.custom<string | undefined>(
		(tui, theme, keybindings, done) =>
			createPermissionSelectorComponent({
				title,
				options,
				theme,
				tui,
				keybindings,
				done,
			}),
		{ overlay: false },
	)
}
