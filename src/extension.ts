import * as vscode from 'vscode';
import { CliRunner } from './core/cli';
import { DataSources } from './core/datasources';
import { ComponentIndex } from './core/components';
import { ContainerIndex } from './core/container';
import { Collectors } from './core/collectors';
import { HealthReader } from './core/health';
import { LogWatcher } from './core/logWatcher';
import { LogLocator } from './core/logs';
import { ClassLocator } from './core/phpClass';
import { ProjectRegistry } from './core/project';
import { RouteReader } from './core/routes';
import { TodoScanner } from './core/todos';
import { installCollectors, registerCrashNotifications, removeCollectors } from './panel/lens';
import type { Tab } from './panel/protocol';
import { WorkbenchViewProvider } from './panel/workbench';
import { AttributeCompletionProvider } from './providers/attributeCompletions';
import { ConstructorInjectionProvider } from './providers/constructorInjection';
import { registerDotenvDiagnostics } from './providers/dotenv';
import { RouteUriCompletionProvider } from './providers/routeUris';
import { registerTagSupport } from './providers/tags';
import { ViewComponentCompletionProvider } from './providers/viewComponents';

/**
 * Tempest PHP IntelliSuite — the Tempest development ecosystem inside VS Code.
 *
 * This entry point wires up the language features and the project-aware core
 * that later phases (Inspector, Lens, Health) build on:
 *
 *  - discovery-attribute completions (#[Get], #[ConsoleCommand], #[Schedule]…);
 *  - constructor autowiring suggestions for core Tempest services;
 *  - `.env` diagnostics inside Tempest projects;
 *  - project detection, a read-only console runner and cached data sources.
 *
 * Syntax highlighting for `.view.php` is declarative (contributes.grammars) and
 * needs no code here.
 *
 * Nothing in this extension writes to the user's project, and nothing leaves the
 * machine.
 */

const PHP_DOCUMENTS: vscode.DocumentSelector = [
	{ language: 'php', scheme: 'file' },
	{ language: 'php', scheme: 'untitled' },
];

const VIEW_DOCUMENTS: vscode.DocumentSelector = [
	{ language: 'tempest-view', scheme: 'file' },
	{ language: 'tempest-view', scheme: 'untitled' },
];

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	const log = vscode.window.createOutputChannel('Tempest IntelliSuite', { log: true });

	const projects = new ProjectRegistry(context.workspaceState, log);
	const cli = new CliRunner(log);
	const data = new DataSources(cli, log);
	const routes = new RouteReader(cli, log);
	const locator = new ClassLocator(log);
	const logLocator = new LogLocator(cli, log);
	const logWatcher = new LogWatcher(logLocator, log);
	const collectors = new Collectors(context.extensionUri, log);
	const components = new ComponentIndex(log);
	const container = new ContainerIndex(cli, log);
	const health = new HealthReader(cli, data, log);
	const todos = new TodoScanner(log);
	const routeUris = new RouteUriCompletionProvider(projects, routes);
	const workbench = new WorkbenchViewProvider(
		context.extensionUri,
		context.globalStorageUri,
		projects,
		data,
		routes,
		locator,
		logWatcher,
		health,
		todos,
		log,
	);

	context.subscriptions.push(log, projects, data, logWatcher);

	// Registered before anything else can fail: the sidebar view is how a user
	// finds out the extension is alive, so it must appear even if project
	// detection or the console never come good.
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(WorkbenchViewProvider.viewId, workbench, {
			// The Lens is a live stream; losing it every time the sidebar is
			// collapsed would make it useless.
			webviewOptions: { retainContextWhenHidden: true },
		}),
	);

	context.subscriptions.push(
		vscode.languages.registerCompletionItemProvider(
			PHP_DOCUMENTS,
			new AttributeCompletionProvider(),
			'[',
			'\\',
		),
		vscode.languages.registerCompletionItemProvider(
			PHP_DOCUMENTS,
			new ConstructorInjectionProvider(projects, container),
			'(',
			' ',
		),
		vscode.languages.registerCompletionItemProvider(
			VIEW_DOCUMENTS,
			new ViewComponentCompletionProvider(projects, components),
			'<',
			'-',
		),
		vscode.languages.registerCompletionItemProvider(VIEW_DOCUMENTS, routeUris, '/', '"', "'"),
	);

	registerDotenvDiagnostics(context, projects);
	registerTagSupport(context);

	// The Inspector and the Lens are tabs of one sidebar view now, so both of
	// their commands land here and differ only in which tab they arrive on.
	const openWorkbench = (tab: Tab): void => void workbench.show(tab);

	context.subscriptions.push(
		vscode.commands.registerCommand('tempest.showOutput', () => log.show()),
		vscode.commands.registerCommand('tempest.refresh', async () => {
			data.invalidate();
			locator.invalidate();
			logLocator.invalidate();
			components.invalidate();
			container.invalidate();
			routeUris.invalidate();
			todos.invalidate();
			await projects.refresh();
			await workbench.refresh();
		}),
		vscode.commands.registerCommand('tempest.installCollectors', () =>
			installCollectors(projects, collectors, log),
		),
		vscode.commands.registerCommand('tempest.removeCollectors', () =>
			removeCollectors(projects, collectors, log),
		),
		vscode.commands.registerCommand('tempest.openLens', () => openWorkbench('lens')),
		vscode.commands.registerCommand('tempest.openInspector', () => openWorkbench('routes')),
		vscode.commands.registerCommand('tempest.openWorkbench', () => openWorkbench('routes')),
		vscode.commands.registerCommand('tempest.openHealth', () => openWorkbench('health')),
	);

	// Warming the command manifest as soon as a project appears means feature
	// detection is ready before anything asks, and a broken PHP setup shows up in
	// the log at startup instead of halfway through a user's first interaction.
	// Deliberately not awaited: activation must not wait on a subprocess.
	context.subscriptions.push(
		projects.onDidChange(() => {
			for (const project of projects.all) {
				void data.commands(project, context.globalStorageUri);
			}

			// Watching starts with the project, not with the panel: a crash should be
			// reported the moment it happens, not only if the Lens happens to be open.
			const [first] = projects.all;

			if (first) {
				void logWatcher.start(first);
			} else {
				logWatcher.stop();
			}
		}),
	);

	registerCrashNotifications(
		context,
		logWatcher,
		() => openWorkbench('lens'),
		log,
	);

	// Detection runs after registration so the language features are live even if
	// the workspace scan is slow or fails.
	await projects.refresh();
}

export function deactivate(): void {
	// Nothing to clean up: everything lives in context.subscriptions.
}
