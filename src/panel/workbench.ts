import * as vscode from 'vscode';
import type { DataSources } from '../core/datasources';
import type { HealthReader } from '../core/health';
import type { ClassLocator } from '../core/phpClass';
import type { LogWatcher } from '../core/logWatcher';
import type { ProjectRegistry } from '../core/project';
import type { RouteReader } from '../core/routes';
import type { TodoScanner } from '../core/todos';
import { HealthSection } from './health';
import { InspectorSection } from './inspector';
import { LensSection } from './lens';
import { TodosSection } from './todos';
import type { FromPanel, Tab, ToPanel } from './protocol';

/**
 * The Workbench — everything the extension knows about the project, in the
 * Tempest sidebar.
 *
 * It lives in the activity bar container rather than in an editor tab, which is
 * what a tool panel is for: the editor area belongs to the user's code, and a
 * view that is open all day should not be competing for it.
 *
 * Because it is a sidebar, everything here is laid out for roughly 300px: the
 * project summary is a vertical list, and rows stack rather than tabulate.
 */

/**
 * Fallbacks for the light/dark toggle, used only when the user has not set
 * `workbench.preferredLightColorTheme` / `preferredDarkColorTheme`. These are
 * VS Code's own built-in defaults, so they exist in every installation.
 */
const DEFAULT_LIGHT_THEME = 'Default Light Modern';
const DEFAULT_DARK_THEME = 'Default Dark Modern';

export class WorkbenchViewProvider implements vscode.WebviewViewProvider {
	static readonly viewId = 'tempest.workbench';

	private view: vscode.WebviewView | undefined;
	private inspector: InspectorSection | undefined;
	private lens: LensSection | undefined;
	private health: HealthSection | undefined;
	private todos: TodosSection | undefined;

	/** Torn down and rebuilt every time the view is resolved. */
	private disposables: vscode.Disposable[] = [];

	/**
	 * The tab the view was asked to open on, held until the webview says it is
	 * listening. Posting to a webview that has not finished loading drops the
	 * message, which is how "Open Panel: Lens" used to land on Routes.
	 */
	private pending: Tab | undefined;

	constructor(
		private readonly extensionUri: vscode.Uri,
		private readonly storage: vscode.Uri,
		private readonly projects: ProjectRegistry,
		private readonly data: DataSources,
		private readonly routes: RouteReader,
		private readonly locator: ClassLocator,
		private readonly watcher: LogWatcher,
		private readonly healthReader: HealthReader,
		private readonly scanner: TodoScanner,
		private readonly log: vscode.LogOutputChannel,
	) {}

	resolveWebviewView(view: vscode.WebviewView): void {
		this.view = view;
		this.disposeSections();

		view.webview.options = {
			enableScripts: true,
			localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')],
		};

		const post = (message: ToPanel): Thenable<unknown> => this.post(message);

		this.inspector = new InspectorSection(
			this.storage,
			this.projects,
			this.data,
			this.routes,
			this.locator,
			this.log,
			post,
		);
		this.lens = new LensSection(this.projects, this.watcher, this.log, post);
		this.health = new HealthSection(
			this.projects,
			this.healthReader,
			(command) => this.inspector?.runInTerminal(command),
			this.log,
			post,
		);
		this.todos = new TodosSection(this.projects, this.scanner, post);

		view.webview.html = this.render(view.webview);

		this.disposables.push(
			view.webview.onDidReceiveMessage((message: FromPanel) => void this.handle(message)),
			this.projects.onDidChange(() => void this.reload()),
			// The button flips the editor's theme, so the icon has to follow the
			// editor — including when something else changes it.
			vscode.window.onDidChangeActiveColorTheme(() => void this.postTheme()),
			view.onDidDispose(() => this.disposeSections()),
		);
	}

	/** Reveals the view in the sidebar and selects a tab. */
	async show(tab: Tab): Promise<void> {
		this.pending = tab;

		if (this.view?.visible) {
			await this.post({ type: 'select', tab });
			this.pending = undefined;

			return;
		}

		// Focusing the view is what resolves it the first time; the pending tab
		// is then applied when the webview reports it is ready.
		await vscode.commands.executeCommand(`${WorkbenchViewProvider.viewId}.focus`);
	}

	/** Drops every cache and reloads every section. */
	async refresh(): Promise<void> {
		await Promise.all([
			this.inspector?.refresh(),
			this.lens?.restart(),
			this.health?.load(),
			this.todos?.refresh(),
		]);
	}

	private async handle(message: FromPanel): Promise<void> {
		switch (message.type) {
			case 'ready':
				if (this.pending) {
					await this.post({ type: 'select', tab: this.pending });
					this.pending = undefined;
				}

				await this.postTheme();
				await this.reload();

				return;

			case 'refresh':
				await this.refresh();

				return;

			case 'openRoute':
				await this.inspector?.openRoute(message.uri, message.method);

				return;

			case 'runCommand':
				this.inspector?.runInTerminal(message.command);

				return;

			case 'clearDiscoveryCache':
				this.inspector?.runInTerminal('discovery:clear');

				return;

				return;

			case 'openSettings':
				await vscode.commands.executeCommand(
					'workbench.action.openSettings',
					'tempest.consolePath',
				);

				return;

			case 'selectProject':
				await this.projects.setActive(message.id);

				return;

			case 'toggleTheme':
				await toggleColorTheme();

				return;

			case 'lens-clear':
				await this.lens?.clear();

				return;

			case 'openDump':
				await this.lens?.openDump(message.file, message.line);

				return;

			case 'installCollectors':
				await this.lens?.installCollectors();

				return;

			case 'loadTodos':
				await this.todos?.load();

				return;

			case 'openTodo':
				await this.todos?.open(message.file, message.line);

				return;

			case 'healthFix':
				await this.health?.apply(message.kind, message.value);

				return;
		}
	}

	/**
	 * The eager sections load together: the header belongs to none of them, and
	 * the Health count has to be on the tab before anyone thinks to open it.
	 * The Todos scan stays out of this — it is asked for when its tab is shown.
	 */
	private async reload(): Promise<void> {
		await Promise.all([this.inspector?.load(), this.lens?.restart(), this.health?.load()]);
	}

	private post(message: ToPanel): Thenable<unknown> {
		return this.view?.webview.postMessage(message) ?? Promise.resolve(false);
	}

	private async postTheme(): Promise<void> {
		await this.post({ type: 'theme', dark: isDarkTheme() });
	}

	private render(webview: vscode.Webview): string {
		const media = vscode.Uri.joinPath(this.extensionUri, 'media');
		const script = webview.asWebviewUri(vscode.Uri.joinPath(media, 'workbench.js'));
		const style = webview.asWebviewUri(vscode.Uri.joinPath(media, 'panel.css'));
		const nonce = makeNonce();

		// No remote origins are allowed at all: styles and scripts come from the
		// extension, and the nonce keeps inline injection out.
		const csp = [
			"default-src 'none'",
			`style-src ${webview.cspSource}`,
			`script-src 'nonce-${nonce}'`,
			`font-src ${webview.cspSource}`,
		].join('; ');

		// Stamped server-side so the button shows the right glyph on first paint
		// instead of flickering to it once the ready handshake lands.
		const themeAttribute = isDarkTheme() ? ' data-dark' : '';

		return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link href="${style}" rel="stylesheet">
<title>Tempest</title>
</head>
<body class="sidebar"${themeAttribute}>
<header>
	<div id="summary" class="summary"></div>

	<div class="actions">
		<button id="refresh" class="icon-button" type="button" title="Refresh" aria-label="Refresh">
			<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M13.6 8a5.6 5.6 0 1 1-1.7-4"/><path d="M13.6 1.6v3.2h-3.2"/></svg>
		</button>
		<button id="theme" class="icon-button" type="button" title="Switch to a light theme" aria-label="Switch the editor theme">
			<!-- Each glyph shows what the click will switch the editor to. -->
			<svg class="icon-to-dark" viewBox="0 0 16 16" aria-hidden="true"><path d="M13.2 9.6A5.6 5.6 0 0 1 6.4 2.8a5.6 5.6 0 1 0 6.8 6.8z"/></svg>
			<svg class="icon-to-light" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="3"/><path d="M8 1v1.6M8 13.4V15M1 8h1.6M13.4 8H15M3.1 3.1l1.1 1.1M11.8 11.8l1.1 1.1M12.9 3.1l-1.1 1.1M4.2 11.8l-1.1 1.1"/></svg>
		</button>
	</div>
</header>

<hr class="divider">

<div id="problems" class="problems" hidden></div>

<!-- Replaces the tree's viewsWelcome: with no project there is nothing to tab
     through, and a blank panel would not say why. -->
<div id="welcome" class="welcome" hidden>
	<p>No Tempest project found in this workspace.</p>
	<p class="muted">Every folder is searched, at any depth, for a <code>tempest</code> console executable sitting next to a <code>composer.json</code>. Dependency and build directories are skipped.</p>
	<button id="scan-again" type="button">Search again</button>
	<button id="open-settings" type="button">Set the console path…</button>
</div>

<nav id="tabs" class="tabs" role="tablist">
	<button class="tab" role="tab" data-tab="routes" aria-selected="true">Routes</button>
	<button class="tab" role="tab" data-tab="lens" aria-selected="false">Lens</button>
	<button class="tab" role="tab" data-tab="commands" aria-selected="false">Commands</button>
	<!-- The count is the whole point of the tab: what is wrong with the project
	     has to be visible from the tab strip, before anything goes wrong. -->
	<button class="tab" role="tab" data-tab="health" aria-selected="false">Health <span id="health-badge" class="badge" hidden></span></button>
</nav>

<div id="browse">
	<!-- Routes and the tag list are both "what is in this project", so they
	     share a tab and divide it, the way the Lens divides its own. -->
	<nav id="browse-tabs" class="tabs sub" role="tablist" hidden>
		<button class="tab" role="tab" data-browse="routes" aria-selected="true">Routes</button>
		<button class="tab" role="tab" data-browse="todos" aria-selected="false">Todos <span id="count-todos" class="badge">0</span></button>
	</nav>

	<input id="filter" class="filter" type="search" placeholder="Filter…" aria-label="Filter">

	<section id="panel-routes" class="panel" role="tabpanel"></section>
	<section id="panel-todos" class="panel" role="tabpanel" hidden></section>
	<section id="panel-commands" class="panel" role="tabpanel" hidden></section>
</div>

<div id="health" hidden>
	<div id="health-score" class="health-score"></div>
	<section id="panel-health" class="panel" role="tabpanel"></section>
</div>

<div id="lens" hidden>
	<nav class="tabs sub" role="tablist">
		<button class="tab" role="tab" data-lens="dumps" aria-selected="true">Dumps <span id="count-dumps" class="badge">0</span></button>
		<button class="tab" role="tab" data-lens="logs" aria-selected="false">Log <span id="count-logs" class="badge">0</span></button>
		<button class="tab" role="tab" data-lens="queries" aria-selected="false">Queries <span id="count-queries" class="badge">0</span></button>
		<button class="tab" role="tab" data-lens="requests" aria-selected="false">Requests <span id="count-requests" class="badge">0</span></button>
	</nav>

	<div class="strip">
		<input id="lens-filter" class="filter" type="search" placeholder="Filter…" aria-label="Filter the stream">
		<label class="toggle"><input id="follow" type="checkbox" checked> Follow</label>
		<button id="lens-clear" class="btn-small" type="button" title="Clear the view, and offer to empty the log files on disk">Clear</button>
		<div id="status" class="status"></div>
	</div>

	<section id="panel-dumps" class="panel stream" role="tabpanel"></section>
	<section id="panel-logs" class="panel stream" role="tabpanel" hidden></section>
	<section id="panel-queries" class="panel stream" role="tabpanel" hidden></section>
	<section id="panel-requests" class="panel stream" role="tabpanel" hidden></section>
</div>

<script nonce="${nonce}" src="${script}"></script>
</body>
</html>`;
	}

	private disposeSections(): void {
		this.lens?.dispose();
		this.lens = undefined;
		this.todos?.dispose();
		this.todos = undefined;
		this.health = undefined;
		this.inspector = undefined;

		for (const disposable of this.disposables) {
			disposable.dispose();
		}

		this.disposables = [];
	}
}

function isDarkTheme(): boolean {
	const { kind } = vscode.window.activeColorTheme;

	return kind === vscode.ColorThemeKind.Dark || kind === vscode.ColorThemeKind.HighContrast;
}

/**
 * Flips the whole editor between light and dark.
 *
 * It switches to whichever themes the user already nominated for each mode in
 * `workbench.preferredLightColorTheme` / `preferredDarkColorTheme` — the same
 * pair VS Code's own "sync with OS" feature uses — rather than imposing a theme
 * of ours. The update is global on purpose: a colour theme is a property of the
 * editor, not of one workspace.
 */
async function toggleColorTheme(): Promise<void> {
	const workbench = vscode.workspace.getConfiguration('workbench');
	const dark = isDarkTheme();

	const next = dark
		? workbench.get<string>('preferredLightColorTheme', DEFAULT_LIGHT_THEME)
		: workbench.get<string>('preferredDarkColorTheme', DEFAULT_DARK_THEME);

	// Following the OS would immediately undo the switch, so it has to go.
	if (workbench.get<boolean>('autoDetectColorScheme', false)) {
		await workbench.update('autoDetectColorScheme', false, vscode.ConfigurationTarget.Global);
	}

	await workbench.update('colorTheme', next, vscode.ConfigurationTarget.Global);
}

function makeNonce(): string {
	const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

	return Array.from({ length: 32 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
}
