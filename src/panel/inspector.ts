import * as vscode from 'vscode';
import { aboutValue, DataSources } from '../core/datasources';
import { ClassLocator } from '../core/phpClass';
import type { ProjectRegistry, TempestProject } from '../core/project';
import { RouteReader, type Route } from '../core/routes';
import type { AboutSummary, CommandView, RouteView, ToPanel } from './protocol';

/**
 * The Inspector — an X-ray of what Tempest discovered in the open project.
 *
 * It answers the question the framework's zero-config design makes hard to
 * answer from the outside: what is actually registered right now? Routes with a
 * link to their controller, every console command with a way to run it, and the
 * state of the discovery cache, which in development quietly hides code you just
 * wrote.
 *
 * It owns no webview: the Workbench panel hosts it, and hands it a `post` to
 * speak through. The header summary it produces belongs to the whole panel, not
 * to a tab, which is the reason this section loads even when the Lens is the
 * one on screen.
 */
export class InspectorSection {
	private routes: Route[] | undefined;
	private project: TempestProject | undefined;

	constructor(
		private readonly storage: vscode.Uri,
		private readonly projects: ProjectRegistry,
		private readonly data: DataSources,
		private readonly routeReader: RouteReader,
		private readonly locator: ClassLocator,
		private readonly log: vscode.LogOutputChannel,
		private readonly post: (message: ToPanel) => Thenable<unknown>,
	) {}

	/** Drops every cache the panel reads from, then reloads. */
	async refresh(): Promise<void> {
		this.data.invalidate();
		this.locator.invalidate();

		await this.load();
	}

	async load(): Promise<void> {
		this.project = this.projects.active;

		if (!this.project) {
			await this.post({
				type: 'state',
				state: { project: '', projects: [], problems: [] },
			});

			return;
		}

		await this.post({ type: 'loading', loading: true });

		const problems: string[] = [];

		const [about, manifest, routes] = await Promise.all([
			this.data.about(this.project),
			this.data.commands(this.project, this.storage),
			this.routeReader.read(this.project),
		]);

		this.routes = routes;

		if (!about) {
			problems.push('Could not read the project report. Is PHP on your PATH?');
		}

		if (!manifest) {
			problems.push('Could not read the command list.');
		}

		if (!routes) {
			problems.push('Could not read the route list.');
		}

		const routeViews = routes && (await this.toRouteViews(routes));
		const commandViews = manifest && toCommandViews(manifest.commands);

		// Recorded because it is the fastest way to tell, from a bug report, whether
		// the panel was empty because the project has nothing or because a source
		// failed to load.
		this.log.info(
			`Inspector loaded: ${routeViews?.length ?? 0} route(s) ` +
				`(${routeViews?.filter((route) => route.openable).length ?? 0} linked to a file), ` +
				`${commandViews?.length ?? 0} command(s)` +
				(problems.length > 0 ? `, ${problems.length} problem(s)` : ''),
		);

		await this.post({
			type: 'state',
			state: {
				project: this.project.name,
				projects: this.projects.all.map(({ id, name }) => ({ id, name })),
				activeProject: this.project.id,
				about: about && summarise(about),
				routes: routeViews,
				commands: commandViews,
				problems,
			},
		});
	}

	private async toRouteViews(routes: readonly Route[]): Promise<RouteView[]> {
		const views: RouteView[] = [];

		for (const route of routes) {
			// Resolving up front means the panel can grey out what it cannot open,
			// instead of offering a link that goes nowhere.
			const openable = Boolean(
				route.handlerClass &&
					this.project &&
					(await this.locator.locate(this.project, route.handlerClass, route.handlerMethod)),
			);

			views.push({
				method: route.method,
				uri: route.uri,
				isDynamic: route.isDynamic,
				middleware: route.middleware,
				group: groupOf(route.handlerClass),
				handler: route.handlerClass
					? `${route.handlerClass}::${route.handlerMethod ?? '__invoke'}`
					: undefined,
				openable,
			});
		}

		// Grouped, then alphabetical within the group. A flat list ordered by
		// discovery scatters the routes of one feature across the panel, which is
		// the opposite of how they are read: nobody asks "what is route 14", they
		// ask "what does Categories expose".
		return views.sort(
			(a, b) =>
				a.group.localeCompare(b.group) ||
				a.uri.localeCompare(b.uri) ||
				a.method.localeCompare(b.method),
		);
	}

	async openRoute(uri: string, method: string): Promise<void> {
		const route = this.routes?.find((candidate) => candidate.uri === uri && candidate.method === method);

		if (!route?.handlerClass || !this.project) {
			return;
		}

		const location = await this.locator.locate(this.project, route.handlerClass, route.handlerMethod);

		if (!location) {
			void vscode.window.showWarningMessage(`Could not find a file for ${route.handlerClass}.`);

			return;
		}

		const document = await vscode.workspace.openTextDocument(location.uri);
		const position = new vscode.Position(location.line, 0);

		await vscode.window.showTextDocument(document, {
			selection: new vscode.Range(position, position),
		});
	}

	/**
	 * Commands run in a real terminal, never through the CliRunner: many of them
	 * prompt for input, some take a long time, and all of them are things the user
	 * should be able to watch and cancel.
	 */
	runInTerminal(command: string): void {
		if (!this.project) {
			return;
		}

		const php = vscode.workspace
			.getConfiguration('tempest', this.project.root)
			.get<string>('phpPath', 'php');

		const terminal =
			vscode.window.terminals.find((candidate) => candidate.name === 'Tempest') ??
			vscode.window.createTerminal({ name: 'Tempest', cwd: this.project.root });

		terminal.show();
		terminal.sendText(`${php} ${quote(this.project.console.fsPath)} ${command}`);

		this.log.info(`Ran in terminal: ${command}`);
	}
}

function summarise(about: Record<string, Record<string, readonly string[]>>): AboutSummary {
	const engine = aboutValue(about, 'database', 'engine');
	const version = aboutValue(about, 'database', 'version');

	return {
		tempestVersion: aboutValue(about, 'environment', 'tempest_version'),
		phpVersion: aboutValue(about, 'environment', 'php_version'),
		environment: aboutValue(about, 'environment', 'environment'),
		database: engine ? [engine, version].filter(Boolean).join(' ') : undefined,
		discoveryCache: aboutValue(about, 'internal_caches', 'discovery'),
	};
}

function toCommandViews(
	commands: Record<string, { hidden: boolean; description: string | null; flags: readonly { flag: string }[] }>,
): CommandView[] {
	return Object.entries(commands)
		.filter(([, spec]) => !spec.hidden)
		.map(([name, spec]) => ({
			name,
			// Tempest groups commands by the segment before the colon; the ones
			// without a colon are the top-level "general" commands.
			group: name.includes(':') ? name.split(':')[0] : 'general',
			description: spec.description ?? undefined,
			flags: spec.flags.map((flag) => flag.flag),
		}))
		.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The namespace a route's handler lives in — `App\Categories` for
 * `App\Categories\CategoryController`.
 *
 * Tempest apps are organised by feature folder rather than by layer, so the
 * namespace is already the name of the feature; nothing has to be inferred from
 * the URI, which would guess wrong the moment a controller serves more than one
 * path.
 */
function groupOf(handlerClass: string | undefined): string {
	if (!handlerClass) {
		return 'Unresolved';
	}

	const namespace = handlerClass.split('\\').slice(0, -1).join('\\');

	// A handler in the global namespace, and framework routes that arrive as a
	// bare class name.
	return namespace === '' ? handlerClass : namespace;
}

function quote(value: string): string {
	return /[\s"']/.test(value) ? `'${value.replace(/'/g, `'\\''`)}'` : value;
}
