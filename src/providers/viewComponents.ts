import * as vscode from 'vscode';
import type { ComponentIndex } from '../core/components';
import type { ProjectRegistry } from '../core/project';

/**
 * Completes `<x-…>` with the components the project actually has.
 *
 * The predecessor extension could only offer a fixed list of tags, which is
 * precisely backwards: the interesting components are the ones a team wrote for
 * itself, and those are the ones a hard-coded list can never know about.
 *
 * The project's own components are ranked above the framework's, since typing
 * `<x-` in an application view is far more often reaching for one of them.
 */
/** Kept in step with `snippets/tempest-view.json`. */
const COVERED_BY_SNIPPETS = new Set(['x-slot', 'x-component']);

export class ViewComponentCompletionProvider implements vscode.CompletionItemProvider {
	constructor(
		private readonly projects: ProjectRegistry,
		private readonly components: ComponentIndex,
	) {}

	async provideCompletionItems(
		document: vscode.TextDocument,
		position: vscode.Position,
	): Promise<vscode.CompletionItem[] | undefined> {
		const project = this.projects.find(document.uri);

		if (!project) {
			return undefined;
		}

		const line = document.lineAt(position).text.slice(0, position.character);
		const opening = /<(x-?[\w-]*)$/.exec(line);

		if (!opening) {
			return undefined;
		}

		const components = await this.components.all(project);
		const replacing = new vscode.Range(
			position.translate(0, -opening[1].length),
			position,
		);

		return components
			// These already ship as snippets that fill in the attributes they need —
			// `<x-slot name="…">` and `<x-component :is="…" />`. Offering a bare tag
			// beside the better suggestion would just be the same name twice.
			.filter((component) => !COVERED_BY_SNIPPETS.has(component.name))
			.map((component, index) => {
			const item = new vscode.CompletionItem(component.name, vscode.CompletionItemKind.Struct);

			item.detail = component.fromVendor ? 'Tempest component' : 'Project component';
			item.range = replacing;

			// Self-closing by default: most components are used as a single tag, and
			// turning `<x-input />` into a pair is a smaller annoyance than the other
			// way round.
			item.insertText = new vscode.SnippetString(`${component.name} $0/>`);

			item.documentation = new vscode.MarkdownString(
				`Defined in \`${vscode.workspace.asRelativePath(component.uri)}\`.`,
			);

			// Project components first, then alphabetical within each group.
			item.sortText = `${component.fromVendor ? '1' : '0'}${String(index).padStart(4, '0')}`;

			return item;
		});
	}
}
