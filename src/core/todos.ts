import * as vscode from 'vscode';
import type { TempestProject } from './project';

/**
 * The tag scanner behind the Todos tab.
 *
 * A codebase carries a running list of its own unfinished business — `TODO`,
 * `FIXME`, `HACK` — and it is invisible until someone opens the file that has
 * it. Collecting them next to the routes puts that list where the rest of the
 * project's map already is.
 *
 * Written from scratch for this extension rather than adapted from any of the
 * existing tag browsers, and deliberately smaller than all of them: one project
 * at a time, no tree of its own in the activity bar, no per-tag configuration
 * beyond which words count.
 *
 * Two decisions keep it honest on a large project:
 *
 *  - A tag only counts when a comment marker precedes it on the line. The word
 *    "TODO" inside a string or a URL is not a task, and a scanner that reports
 *    it teaches people to ignore the list.
 *  - Everything is bounded — file count, file size, total results. Scanning is
 *    a background convenience; it may never be the reason the editor stutters.
 */

export interface Todo {
	/** Absolute path, for opening. */
	readonly file: string;
	/** Path relative to the project root, for display. */
	readonly relative: string;
	/** Zero-based, as VS Code counts them. */
	readonly line: number;
	readonly tag: string;
	readonly text: string;
}

export const DEFAULT_TAGS = ['TODO', 'FIXME', 'HACK', 'BUG', 'NOTE', 'XXX'];

const DEFAULT_INCLUDE = '**/*.{php,js,mjs,ts,tsx,jsx,css,scss,md,sql,sh,yaml,yml,json}';

/** Dependency trees, VCS data, build output and Tempest's own scratch space. */
const EXCLUDE = '**/{vendor,node_modules,.git,.svn,.hg,build,dist,out,.tempest,coverage,public/build}/**';

const MAX_FILES = 4_000;
const MAX_RESULTS = 2_000;
/** Generated files — minified bundles, fixtures, dumps — hide in the size. */
const MAX_BYTES = 512 * 1024;

/**
 * Comment markers, then the tag, then the rest of the line.
 *
 * `*` on its own covers both a continuation line inside a block comment and a
 * Markdown bullet, which is where a plan file keeps its tasks.
 */
function pattern(tags: readonly string[]): RegExp {
	const alternatives = tags
		.map((tag) => tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
		.join('|');

	return new RegExp(`(?://|/\\*|\\*|#|<!--|--)\\s*(${alternatives})\\b[:\\-]?\\s*(.*)$`, 'i');
}

export class TodoScanner {
	private readonly cache = new Map<string, Todo[]>();

	constructor(private readonly log: vscode.LogOutputChannel) {}

	/** Which tags this project looks for, in the order they were configured. */
	tags(project: TempestProject): string[] {
		const configured = vscode.workspace
			.getConfiguration('tempest', project.root)
			.get<string[]>('todo.tags', DEFAULT_TAGS);

		return configured.length > 0 ? configured : DEFAULT_TAGS;
	}

	async scan(project: TempestProject, token?: vscode.CancellationToken): Promise<Todo[]> {
		const key = project.root.toString();
		const cached = this.cache.get(key);

		if (cached) {
			return cached;
		}

		const config = vscode.workspace.getConfiguration('tempest', project.root);
		const include = config.get<string>('todo.include', DEFAULT_INCLUDE);
		const expression = pattern(this.tags(project));

		const files = await vscode.workspace.findFiles(
			new vscode.RelativePattern(project.root, include),
			EXCLUDE,
			MAX_FILES,
			token,
		);

		const found: Todo[] = [];

		for (const file of files) {
			if (token?.isCancellationRequested || found.length >= MAX_RESULTS) {
				break;
			}

			found.push(...(await this.read(project, file, expression)));
		}

		// By file, then by line: the list is read as "what is left in this file",
		// and jumping between files for consecutive rows makes it unreadable.
		found.sort((a, b) => a.relative.localeCompare(b.relative) || a.line - b.line);

		const bounded = found.slice(0, MAX_RESULTS);

		this.cache.set(key, bounded);
		this.log.info(`Todos: ${bounded.length} tag(s) across ${files.length} file(s) in ${project.name}.`);

		return bounded;
	}

	/**
	 * Rescans one file and folds the result into the cache.
	 *
	 * Saving a file is the only moment a tag list realistically changes, and
	 * walking the whole project for one keystroke's worth of change would be
	 * absurd.
	 */
	async update(project: TempestProject, file: vscode.Uri): Promise<boolean> {
		const key = project.root.toString();
		const cached = this.cache.get(key);

		if (!cached) {
			return false;
		}

		const path = file.fsPath;
		const kept = cached.filter((todo) => todo.file !== path);
		const fresh = await this.read(project, file, pattern(this.tags(project)));

		if (kept.length === cached.length && fresh.length === 0) {
			return false;
		}

		const merged = [...kept, ...fresh].sort(
			(a, b) => a.relative.localeCompare(b.relative) || a.line - b.line,
		);

		this.cache.set(key, merged.slice(0, MAX_RESULTS));

		return true;
	}

	invalidate(project?: TempestProject): void {
		if (project) {
			this.cache.delete(project.root.toString());
		} else {
			this.cache.clear();
		}
	}

	private async read(
		project: TempestProject,
		file: vscode.Uri,
		expression: RegExp,
	): Promise<Todo[]> {
		try {
			const raw = await vscode.workspace.fs.readFile(file);

			if (raw.byteLength > MAX_BYTES) {
				return [];
			}

			const relative = relativePath(project.root.fsPath, file.fsPath);
			const found: Todo[] = [];
			const lines = new TextDecoder().decode(raw).split(/\r?\n/);

			for (let index = 0; index < lines.length; index++) {
				const match = expression.exec(lines[index]);

				if (!match) {
					continue;
				}

				found.push({
					file: file.fsPath,
					relative,
					line: index,
					// Reported as written in the source rather than upper-cased: a
					// project that writes `Fixme` is not writing a different tag, and
					// showing it back differently reads as a transcription error.
					tag: match[1],
					// A trailing `*/` or `-->` belongs to the comment, not to the task.
					text: match[2].replace(/\s*(?:\*\/|-->)\s*$/, '').trim(),
				});
			}

			return found;
		} catch {
			// Binary files, broken symlinks, a file deleted between the search and
			// the read: none of them are worth a message.
			return [];
		}
	}
}

function relativePath(root: string, file: string): string {
	return file.startsWith(`${root}/`) ? file.slice(root.length + 1) : file;
}
