import * as vscode from 'vscode';
import type { ProjectRegistry } from '../core/project';
import type { Route, RouteReader } from '../core/routes';

/**
 * Completes the URIs the project actually serves, inside `href` and `action`
 * attributes in views.
 *
 * A link to a route that does not exist is a broken page that nothing catches —
 * no compiler, no type checker, and often no test. Offering the real list is the
 * cheapest possible guard against it.
 *
 * Reading routes means running the console, so the list is cached and refreshed
 * lazily; completions must never block typing on a subprocess.
 */

const CACHE_MS = 30_000;

/** `href="` or `:action="'` and anything typed since. */
const ATTRIBUTE = /(?:href|action)\s*=\s*["'](?:'\s*\.?\s*)?([^"']*)$/;

export class RouteUriCompletionProvider implements vscode.CompletionItemProvider {
	private cache = new Map<string, { at: number; routes: Route[] }>();

	constructor(
		private readonly projects: ProjectRegistry,
		private readonly routes: RouteReader,
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
		const attribute = ATTRIBUTE.exec(line);

		if (!attribute) {
			return undefined;
		}

		const typed = attribute[1];
		const routes = await this.load(project.root.toString(), () => this.routes.read(project));

		return routes
			// Only GET routes are worth offering here: `href` and a form's default
			// action are navigations, and suggesting a DELETE URI as a link would be
			// actively misleading.
			.filter((route) => route.method === 'GET')
			.map((route, index) => {
				const item = new vscode.CompletionItem(route.uri, vscode.CompletionItemKind.Reference);

				item.detail = route.handlerClass
					? `${route.handlerClass}::${route.handlerMethod ?? '__invoke'}`
					: 'route';
				item.range = new vscode.Range(position.translate(0, -typed.length), position);
				item.sortText = String(index).padStart(4, '0');

				if (route.isDynamic) {
					item.documentation = new vscode.MarkdownString(
						'Dynamic route — replace the `{…}` segments with real values.',
					);
				}

				return item;
			});
	}

	private async load(key: string, read: () => Promise<Route[] | undefined>): Promise<Route[]> {
		const cached = this.cache.get(key);

		if (cached && Date.now() - cached.at < CACHE_MS) {
			return cached.routes;
		}

		const routes = (await read()) ?? [];

		this.cache.set(key, { at: Date.now(), routes });

		return routes;
	}

	invalidate(): void {
		this.cache.clear();
	}
}
