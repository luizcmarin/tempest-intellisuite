import * as vscode from 'vscode';
import type { ProjectRegistry } from '../core/project';
import type { TodoScanner } from '../core/todos';
import type { ToPanel } from './protocol';

/**
 * The Todos section — the panel's side of the tag scanner.
 *
 * Unlike the Inspector it loads on demand: a scan walks every source file in
 * the project, which is cheap once and wasteful on every refresh of a panel
 * whose Routes tab is the one people actually keep open. The webview asks the
 * first time the sub-tab is shown, and after that a save updates just the file
 * that was saved.
 */
export class TodosSection implements vscode.Disposable {
	private loaded = false;
	private readonly disposables: vscode.Disposable[] = [];

	constructor(
		private readonly projects: ProjectRegistry,
		private readonly scanner: TodoScanner,
		private readonly post: (message: ToPanel) => Thenable<unknown>,
	) {
		this.disposables.push(
			vscode.workspace.onDidSaveTextDocument((document) => void this.onSave(document)),
		);
	}

	/** Called when the webview shows the tab; the scan happens at most once. */
	async load(): Promise<void> {
		if (this.loaded) {
			return;
		}

		await this.rescan();
	}

	/** Drops the scan, and repeats it only if the tab was already showing one. */
	async refresh(): Promise<void> {
		this.scanner.invalidate();

		if (this.loaded) {
			await this.rescan();
		}
	}

	private async rescan(): Promise<void> {
		const project = this.projects.active;

		if (!project) {
			this.loaded = false;

			await this.post({ type: 'todos', todos: [] });

			return;
		}

		await this.post({ type: 'todos-loading' });

		const todos = await this.scanner.scan(project);

		this.loaded = true;

		await this.post({ type: 'todos', todos });
	}

	private async onSave(document: vscode.TextDocument): Promise<void> {
		const project = this.projects.active;

		if (!this.loaded || !project || this.projects.find(document.uri) !== project) {
			return;
		}

		if (await this.scanner.update(project, document.uri)) {
			await this.post({ type: 'todos', todos: await this.scanner.scan(project) });
		}
	}

	async open(file: string, line: number): Promise<void> {
		const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
		const position = new vscode.Position(line, 0);

		await vscode.window.showTextDocument(document, {
			selection: new vscode.Range(position, position),
		});
	}

	dispose(): void {
		for (const disposable of this.disposables) {
			disposable.dispose();
		}

		this.disposables.length = 0;
	}
}
