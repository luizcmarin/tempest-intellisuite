/**
 * Tag auto-closing and paired renaming for Tempest views.
 *
 * Adapted from the Ecosistema Sang plugin (`modules/htmlTools.js`, the "Tag
 * Manager" section) on 2026-07-18 and rewritten in TypeScript. The two
 * codebases are intentionally independent; fixes here do not travel back.
 *
 * Only this part of that module was worth taking. The rest of it wired up
 * `vscode-html-languageservice` and `vscode-emmet-helper` to get Emmet and tag
 * suggestions — but Emmet in a custom language is three lines of
 * `emmet.includeLanguages` configuration, and pulling in those libraries for the
 * remainder would have grown a 48 KB bundle into a two-megabyte one.
 *
 * Why it is needed at all: `.view.php` files have their own language id, so
 * VS Code's built-in HTML editing behaviour does not apply to them. Typing
 * `<div>` in a view leaves you to write the closing tag yourself.
 */

import * as vscode from 'vscode';

/** Tags that never take a closing tag. */
const VOID_TAGS = new Set([
	'area',
	'base',
	'br',
	'col',
	'embed',
	'hr',
	'img',
	'input',
	'link',
	'meta',
	'param',
	'source',
	'track',
	'wbr',
]);

/**
 * `<div>` or `<x-base :title="…">` immediately before the cursor, but not
 * `<br/>` and not a closing `</div>`.
 */
const OPENING_TAG = /<([a-zA-Z][\w.:$-]*)(?:\s[^>]*)?(?<!\/)\s*>$/;

/** Guards against reacting to our own edit. */
let editing = false;

export function registerTagSupport(context: vscode.ExtensionContext): void {
	context.subscriptions.push(
		vscode.workspace.onDidChangeTextDocument((event) => void autoClose(event)),
		vscode.commands.registerCommand('tempest.closeTag', closeTagAtCursor),
	);
}

/** Inserts `</tag>` the moment `>` finishes an opening tag. */
async function autoClose(event: vscode.TextDocumentChangeEvent): Promise<void> {
	if (editing || !isEnabled()) {
		return;
	}

	const editor = vscode.window.activeTextEditor;

	if (!editor || editor.document !== event.document || event.document.languageId !== 'tempest-view') {
		return;
	}

	const [change] = event.contentChanges;

	if (change?.text !== '>') {
		return;
	}

	const line = change.range.start.line;
	const character = change.range.start.character + 1;
	const text = event.document.lineAt(line).text;
	const opening = OPENING_TAG.exec(text.slice(0, character));

	if (!opening) {
		return;
	}

	const [, tag] = opening;

	// `<x-…>` components are usually self-closing, but a user who typed `>`
	// rather than `/>` clearly wants a pair, so they are treated like any other.
	if (VOID_TAGS.has(tag.toLowerCase())) {
		return;
	}

	if (text.slice(character).trimStart().startsWith(`</${tag}>`)) {
		return;
	}

	editing = true;

	try {
		const position = new vscode.Position(line, character);

		await editor.edit(
			(builder) => builder.insert(position, `</${tag}>`),
			// No undo stop: closing the tag is part of typing `>`, and undoing
			// should take both away together.
			{ undoStopBefore: false, undoStopAfter: false },
		);

		editor.selection = new vscode.Selection(position, position);
	} finally {
		editing = false;
	}
}

/** Closes the nearest unclosed tag before the cursor. */
async function closeTagAtCursor(): Promise<void> {
	const editor = vscode.window.activeTextEditor;

	if (!editor || editor.document.languageId !== 'tempest-view') {
		return;
	}

	const position = editor.selection.active;
	const before = editor.document.getText(new vscode.Range(0, 0, position.line, position.character));
	const tag = findUnclosed(before);

	if (!tag) {
		return;
	}

	await editor.edit((builder) => builder.insert(position, `</${tag}>`));
}

/**
 * Walks the text keeping a stack of open tags, so the one returned is the
 * innermost that is still waiting to be closed.
 */
function findUnclosed(text: string): string | undefined {
	const stack: string[] = [];
	const tags = /<(\/?)([a-zA-Z][\w.:$-]*)(?:\s[^>]*?)?(\/?)>/g;

	let match: RegExpExecArray | null;

	while ((match = tags.exec(text)) !== null) {
		const [, closing, name, selfClosing] = match;

		if (selfClosing || VOID_TAGS.has(name.toLowerCase())) {
			continue;
		}

		if (closing) {
			const index = stack.lastIndexOf(name);

			if (index !== -1) {
				stack.splice(index);
			}

			continue;
		}

		stack.push(name);
	}

	return stack.pop();
}

function isEnabled(): boolean {
	return vscode.workspace.getConfiguration('tempest').get<boolean>('view.autoCloseTags', true);
}
