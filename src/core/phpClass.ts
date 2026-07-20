import * as vscode from 'vscode';
import type { TempestProject } from './project';

/**
 * Locates the file that declares a PHP class, so the panel can link to it.
 *
 * The mapping comes from the project's own `composer.json` PSR-4 autoload block
 * rather than a guess about directory layout — Tempest projects are free to map
 * namespaces wherever they like, and reading the manifest is both cheaper and
 * more honest than searching the workspace.
 */

interface ComposerManifest {
	autoload?: { 'psr-4'?: Record<string, string | string[]> };
	'autoload-dev'?: { 'psr-4'?: Record<string, string | string[]> };
}

export interface ClassLocation {
	readonly uri: vscode.Uri;
	/** Zero-based line of the member we were asked for, or of the class itself. */
	readonly line: number;
}

export class ClassLocator {
	private readonly prefixes = new Map<string, Array<[string, string[]]>>();

	constructor(private readonly log: vscode.LogOutputChannel) {}

	/**
	 * Resolves `App\HomeController` (optionally with a method) to a file and line.
	 * Returns `undefined` when the class cannot be mapped or does not exist on disk.
	 */
	async locate(
		project: TempestProject,
		fqcn: string,
		member?: string,
	): Promise<ClassLocation | undefined> {
		const candidates = await this.candidatesFor(project, fqcn);

		for (const candidate of candidates) {
			try {
				const raw = await vscode.workspace.fs.readFile(candidate);

				return { uri: candidate, line: findLine(new TextDecoder().decode(raw), fqcn, member) };
			} catch {
				// Next candidate: a namespace can map to several roots.
			}
		}

		return undefined;
	}

	private async candidatesFor(project: TempestProject, fqcn: string): Promise<vscode.Uri[]> {
		const prefixes = await this.psr4(project);
		const normalised = fqcn.replace(/^\\/, '');

		// Longest prefix wins, so `App\Admin\` beats `App\` when both are mapped.
		const matches = prefixes
			.filter(([prefix]) => normalised.startsWith(prefix))
			.sort((a, b) => b[0].length - a[0].length);

		const candidates: vscode.Uri[] = [];

		for (const [prefix, roots] of matches) {
			const relative = normalised.slice(prefix.length).replace(/\\/g, '/');

			for (const root of roots) {
				candidates.push(vscode.Uri.joinPath(project.root, root, `${relative}.php`));
			}
		}

		return candidates;
	}

	private async psr4(project: TempestProject): Promise<Array<[string, string[]]>> {
		const key = project.root.toString();
		const cached = this.prefixes.get(key);

		if (cached) {
			return cached;
		}

		const entries: Array<[string, string[]]> = [];

		try {
			const raw = await vscode.workspace.fs.readFile(
				vscode.Uri.joinPath(project.root, 'composer.json'),
			);
			const manifest = JSON.parse(new TextDecoder().decode(raw)) as ComposerManifest;

			for (const block of [manifest.autoload?.['psr-4'], manifest['autoload-dev']?.['psr-4']]) {
				for (const [prefix, target] of Object.entries(block ?? {})) {
					entries.push([prefix, Array.isArray(target) ? target : [target]]);
				}
			}
		} catch (error) {
			this.log.debug(`No PSR-4 map for ${project.name}: ${error instanceof Error ? error.message : String(error)}`);
		}

		this.prefixes.set(key, entries);

		return entries;
	}

	invalidate(): void {
		this.prefixes.clear();
	}
}

/**
 * Best-effort line lookup. A regex over source is not a parser, but the target
 * here is a declaration on its own line, and being one line off is a far better
 * outcome than not opening the file at all.
 */
function findLine(source: string, fqcn: string, member?: string): number {
	const lines = source.split('\n');

	if (member) {
		const method = new RegExp(String.raw`function\s+${escapeRegExp(member)}\s*\(`);
		const index = lines.findIndex((line) => method.test(line));

		if (index !== -1) {
			return index;
		}
	}

	const shortName = fqcn.split('\\').pop() ?? fqcn;
	const declaration = new RegExp(String.raw`\b(class|interface|trait|enum)\s+${escapeRegExp(shortName)}\b`);
	const index = lines.findIndex((line) => declaration.test(line));

	return index === -1 ? 0 : index;
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
