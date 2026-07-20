import * as vscode from 'vscode';
import type { TempestProject } from './project';

/**
 * The two files the Lens needs inside the project to collect query timings and
 * request durations. They are the only thing this extension ever asks to add to
 * a project, and only when the user explicitly turns the feature on.
 *
 * This used to be part of a general-purpose scaffold generator (the Forge). That
 * generator moved to the Sang plugin, because scaffolding is opinion — it has to
 * decide names, layout and styling — and this extension is language tooling. What
 * stayed is the narrow slice the Lens actually depends on: render two stubs, plan
 * where they go, write them without clobbering anything.
 *
 * Placeholders are `%%name%%`. The obvious `{{ name }}` is unusable here: it is
 * exactly Tempest View's interpolation syntax.
 */

export const COLLECTORS = [
	{ stub: 'collector-queries', class: 'IntelliSuiteQueryCollector' },
	{ stub: 'collector-timing', class: 'IntelliSuiteTimingMiddleware' },
] as const;

/** One file the Lens wants to write. */
export interface PlannedFile {
	readonly uri: vscode.Uri;
	/** Path shown to the user, relative to the workspace folder. */
	readonly relativePath: string;
	readonly contents: string;
	/** True when a file is already there — installation refuses to overwrite. */
	readonly exists: boolean;
}

export class Collectors {
	private readonly stubs = new Map<string, string>();

	constructor(
		private readonly extensionUri: vscode.Uri,
		private readonly log: vscode.LogOutputChannel,
	) {}

	/** Works out both collector files without writing anything. */
	async plan(project: TempestProject): Promise<PlannedFile[]> {
		const namespace = await this.namespaceFor(project);
		const planned: PlannedFile[] = [];

		for (const collector of COLLECTORS) {
			const relativePath = `${namespace.root}/${collector.class}.php`;
			const uri = vscode.Uri.joinPath(project.root, relativePath);

			planned.push({
				uri,
				relativePath,
				contents: this.fill(await this.stub(collector.stub), {
					namespace: namespace.prefix,
					class: collector.class,
				}),
				exists: await exists(uri),
			});
		}

		return planned;
	}

	/** Writes a plan. Refuses outright if anything in it already exists. */
	async write(planned: readonly PlannedFile[]): Promise<void> {
		const clash = planned.find((file) => file.exists);

		if (clash) {
			throw new Error(`${clash.relativePath} already exists.`);
		}

		for (const file of planned) {
			await vscode.workspace.fs.writeFile(file.uri, new TextEncoder().encode(file.contents));
			this.log.info(`Wrote ${file.relativePath}`);
		}
	}

	/**
	 * Where generated classes go, from the project's own PSR-4 map.
	 *
	 * `autoload-dev` is skipped: the collectors run in the app, not the tests, and
	 * picking it would put files somewhere surprising.
	 */
	private async namespaceFor(project: TempestProject): Promise<{ prefix: string; root: string }> {
		try {
			const raw = await vscode.workspace.fs.readFile(
				vscode.Uri.joinPath(project.root, 'composer.json'),
			);
			const manifest = JSON.parse(new TextDecoder().decode(raw)) as {
				autoload?: { 'psr-4'?: Record<string, string | string[]> };
			};

			for (const [prefix, target] of Object.entries(manifest.autoload?.['psr-4'] ?? {})) {
				const root = Array.isArray(target) ? target[0] : target;

				return { prefix: prefix.replace(/\\+$/, ''), root: root.replace(/\/+$/, '') };
			}
		} catch {
			// Fall through to the framework's own default layout.
		}

		return { prefix: 'App', root: 'app' };
	}

	private async stub(name: string): Promise<string> {
		const cached = this.stubs.get(name);

		if (cached) {
			return cached;
		}

		const contents = new TextDecoder().decode(
			await vscode.workspace.fs.readFile(
				vscode.Uri.joinPath(this.extensionUri, 'templates', `${name}.stub`),
			),
		);

		this.stubs.set(name, contents);

		return contents;
	}

	private fill(stub: string, values: Record<string, string>): string {
		return stub.replace(/%%(\w+)%%/g, (whole, key: string) => values[key] ?? whole);
	}

	invalidate(): void {
		this.stubs.clear();
	}
}

async function exists(uri: vscode.Uri): Promise<boolean> {
	try {
		await vscode.workspace.fs.stat(uri);

		return true;
	} catch {
		return false;
	}
}
