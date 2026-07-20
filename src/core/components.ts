import * as vscode from 'vscode';
import type { TempestProject } from './project';

/**
 * Finds the view components a project can actually use.
 *
 * Component discovery in Tempest is purely file-based: any file named
 * `x-<name>.view.php` inside a discovery location becomes `<x-name>`, and the
 * name is the file name minus the extension. So the files *are* the source of
 * truth, and globbing for them is not an approximation of what the framework
 * does — it is the same rule.
 *
 * That also means this works without running PHP at all, which matters: these
 * completions fire while typing and cannot afford to wait on a subprocess.
 */

export interface ViewComponent {
	/** Tag name without the angle brackets, e.g. `x-base`. */
	readonly name: string;
	readonly uri: vscode.Uri;
	/** Components from `vendor/` are the framework's; the rest are the user's. */
	readonly fromVendor: boolean;
}

/** Kept short: components are added rarely, and a stale list is worse than a re-scan. */
const CACHE_MS = 30_000;

export class ComponentIndex {
	private cache = new Map<string, { at: number; components: ViewComponent[] }>();

	constructor(private readonly log: vscode.LogOutputChannel) {}

	async all(project: TempestProject): Promise<ViewComponent[]> {
		const key = project.root.toString();
		const cached = this.cache.get(key);

		if (cached && Date.now() - cached.at < CACHE_MS) {
			return cached.components;
		}

		const found = await vscode.workspace.findFiles(
			new vscode.RelativePattern(project.root, '**/x-*.view.php'),
			// Only `node_modules` is excluded: `vendor/` is where the framework's own
			// components live, and they are exactly what a user wants to complete.
			'**/node_modules/**',
			500,
		);

		const components = found
			.map((uri) => ({
				name: basename(uri).replace(/\.view\.php$/, ''),
				uri,
				fromVendor: uri.path.includes('/vendor/'),
			}))
			.sort((a, b) => Number(a.fromVendor) - Number(b.fromVendor) || a.name.localeCompare(b.name));

		this.cache.set(key, { at: Date.now(), components });
		this.log.debug(`Indexed ${components.length} view component(s) in ${project.name}.`);

		return components;
	}

	invalidate(): void {
		this.cache.clear();
	}
}

function basename(uri: vscode.Uri): string {
	return uri.path.split('/').pop() ?? '';
}
