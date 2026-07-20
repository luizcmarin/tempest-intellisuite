import * as vscode from 'vscode';

/**
 * Detects Tempest projects in the open workspace.
 *
 * A directory counts as a Tempest project when it holds the console executable
 * (`tempest` by default) next to a `composer.json`. We deliberately do not read
 * `composer.json` to decide: the console is what every feature of this extension
 * actually talks to, so its presence is the honest signal, and the manifest
 * beside it only rules out unrelated scripts that happen to share the name.
 *
 * Projects are searched for at any depth, not just at the root of a workspace
 * folder. Opening a directory that *contains* several Tempest apps — a monorepo,
 * a folder of client projects — is completely normal, and demanding one window
 * per app is a tax this extension has no right to charge. One detected project
 * is active at a time; the panel switches between them.
 */

export const CONTEXT_KEY = 'tempest.isTempestProject';

/** Where the search never goes: dependency trees, VCS data and build output. */
const EXCLUDED = '**/{vendor,node_modules,.git,.svn,.hg,build,dist,out,.tempest,coverage}/**';

/**
 * Enough for any workspace a person actually works in, and a ceiling on the
 * damage if the pattern ever matches more than it should.
 */
const MAX_RESULTS = 64;

const ACTIVE_KEY = 'tempest.activeProject';

export interface TempestProject {
	/** Workspace folder the project was found in. */
	readonly folder: vscode.WorkspaceFolder;
	/** The project's own root — the directory holding the console. */
	readonly root: vscode.Uri;
	/** Absolute URI of the Tempest console executable. */
	readonly console: vscode.Uri;
	/** Label for the UI: the folder name, or the path when nested. */
	readonly name: string;
	/** Stable key for persistence and for the panel's project picker. */
	readonly id: string;
}

export class ProjectRegistry implements vscode.Disposable {
	private projects: TempestProject[] = [];
	private activeId: string | undefined;
	private readonly disposables: vscode.Disposable[] = [];

	private readonly onDidChangeEmitter = new vscode.EventEmitter<void>();
	/** Fires when the set of detected projects changes, or the active one does. */
	readonly onDidChange = this.onDidChangeEmitter.event;

	constructor(
		private readonly state: vscode.Memento,
		private readonly log: vscode.LogOutputChannel,
	) {
		this.activeId = this.state.get<string>(ACTIVE_KEY);

		this.disposables.push(
			vscode.workspace.onDidChangeWorkspaceFolders(() => void this.refresh()),
			vscode.workspace.onDidChangeConfiguration((event) => {
				if (event.affectsConfiguration('tempest.consolePath')) {
					void this.refresh();
				}
			}),
		);
	}

	/** All detected projects, sorted by name. */
	get all(): readonly TempestProject[] {
		return this.projects;
	}

	/**
	 * The project every panel and command works against.
	 *
	 * Falls back to the first detected project, so a remembered choice that no
	 * longer exists — a folder closed, a project deleted — degrades to something
	 * usable instead of to nothing.
	 */
	get active(): TempestProject | undefined {
		return this.projects.find((project) => project.id === this.activeId) ?? this.projects[0];
	}

	async setActive(id: string): Promise<void> {
		if (id === this.active?.id || !this.projects.some((project) => project.id === id)) {
			return;
		}

		this.activeId = id;
		await this.state.update(ACTIVE_KEY, id);

		this.log.info(`Active project: ${this.active?.name}`);

		this.onDidChangeEmitter.fire();
	}

	/**
	 * The project a given resource belongs to.
	 *
	 * Matches on the longest root containing the resource, so a project nested
	 * inside another wins over its parent. A resource outside every detected
	 * project falls back to the active one, which is what an editor-less caller
	 * — a panel button, a command — means by "here".
	 */
	find(resource: vscode.Uri | undefined): TempestProject | undefined {
		if (!resource) {
			return this.active;
		}

		const path = resource.fsPath;

		return (
			this.projects
				.filter((project) => isInside(path, project.root.fsPath))
				.sort((a, b) => b.root.fsPath.length - a.root.fsPath.length)[0] ?? this.active
		);
	}

	/** Re-scans the workspace and updates the `tempest.isTempestProject` context key. */
	async refresh(): Promise<void> {
		const folders = vscode.workspace.workspaceFolders ?? [];
		const detected = new Map<string, TempestProject>();

		for (const folder of folders) {
			for (const project of await this.scan(folder)) {
				detected.set(project.id, project);
			}
		}

		this.projects = [...detected.values()].sort((a, b) => a.name.localeCompare(b.name));

		await vscode.commands.executeCommand('setContext', CONTEXT_KEY, this.projects.length > 0);

		this.log.info(
			this.projects.length > 0
				? `Detected ${this.projects.length} Tempest project(s): ${this.projects.map((p) => p.name).join(', ')}`
				: 'No Tempest project detected in this workspace.',
		);

		this.onDidChangeEmitter.fire();
	}

	private async scan(folder: vscode.WorkspaceFolder): Promise<TempestProject[]> {
		const configured = vscode.workspace
			.getConfiguration('tempest', folder)
			.get<string>('consolePath', 'tempest');

		const found: TempestProject[] = [];

		// An explicitly configured path is taken at its word — it exists precisely
		// for layouts the search cannot guess, so it skips the composer.json check.
		const explicit = vscode.Uri.joinPath(folder.uri, configured);

		if (await isFile(explicit)) {
			found.push(this.toProject(folder, explicit));
		}

		// The console keeps its name wherever it lives, so the search looks for the
		// last segment of the configured path anywhere in the folder.
		const name = configured.split(/[\\/]/).pop() || 'tempest';

		const matches = await vscode.workspace.findFiles(
			new vscode.RelativePattern(folder, `**/${name}`),
			EXCLUDED,
			MAX_RESULTS,
		);

		for (const match of matches) {
			if (await this.isConsole(match)) {
				found.push(this.toProject(folder, match));
			}
		}

		return found;
	}

	/** A file named like the console, with a `composer.json` for company. */
	private async isConsole(candidate: vscode.Uri): Promise<boolean> {
		if (!(await isFile(candidate))) {
			return false;
		}

		return isFile(vscode.Uri.joinPath(candidate, '..', 'composer.json'));
	}

	private toProject(folder: vscode.WorkspaceFolder, console: vscode.Uri): TempestProject {
		const root = vscode.Uri.joinPath(console, '..');
		const relative = relativePath(folder.uri.fsPath, root.fsPath);

		return {
			folder,
			root,
			console,
			// A project at the folder root is known by the folder's name; a nested
			// one by its path, so two `api` directories stay tellable apart.
			name: relative === '' ? folder.name : relative,
			id: root.toString(),
		};
	}

	dispose(): void {
		this.onDidChangeEmitter.dispose();

		for (const disposable of this.disposables) {
			disposable.dispose();
		}
	}
}

async function isFile(uri: vscode.Uri): Promise<boolean> {
	try {
		const stat = await vscode.workspace.fs.stat(uri);

		// A directory named `tempest` is a common false positive — the framework's
		// own source tree has one, and so does a clean install sitting beside its
		// siblings in a monorepo.
		return (stat.type & vscode.FileType.File) !== 0;
	} catch {
		return false;
	}
}

function isInside(path: string, root: string): boolean {
	return path === root || path.startsWith(root.endsWith('/') ? root : `${root}/`);
}

function relativePath(from: string, to: string): string {
	if (to === from) {
		return '';
	}

	return to.startsWith(`${from}/`) ? to.slice(from.length + 1) : to;
}
