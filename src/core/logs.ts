import * as vscode from 'vscode';
import { CliRunner } from './cli';
import type { TempestProject } from './project';

/**
 * Finds and follows the project's log files.
 *
 * Two things make this less obvious than "read `.tempest/logs/debug.log`":
 *
 *  - the paths are configurable, so they are resolved from the project's own
 *    config rather than assumed;
 *  - the application log rotates daily with an environment prefix, so the file
 *    name changes under us and the *directory* is what has to be watched.
 *
 * The framework also ships `tail:debug`, which deletes the log before tailing
 * it. We never call it — the file is read directly, so nothing the user dumped
 * is destroyed by opening the panel.
 */

export interface LogPaths {
	/** Where `lw()` / `dump()` / `ll()` write. */
	readonly debug?: vscode.Uri;
	/** The rotating application log, if one is configured. */
	readonly application?: vscode.Uri;
}

const ANSI = /\x1b\[[0-9;]*m/g;

export class LogLocator {
	private readonly cache = new Map<string, LogPaths>();

	constructor(
		private readonly cli: CliRunner,
		private readonly log: vscode.LogOutputChannel,
	) {}

	/**
	 * Resolves log paths from `config:show`.
	 *
	 * That command has no `--json` flag, but its output happens to be JSON with
	 * ANSI colour codes sprinkled in — so stripping the escapes yields a real
	 * document. Far better than reading a table, though still worth asking
	 * upstream for a proper flag (U-002).
	 */
	async resolve(project: TempestProject, token?: vscode.CancellationToken): Promise<LogPaths> {
		const key = project.root.toString();
		const cached = this.cache.get(key);

		if (cached) {
			return cached;
		}

		let paths: LogPaths = {};

		try {
			const { stdout } = await this.cli.run(project, ['config:show'], token);
			const configs = JSON.parse(stdout.replace(ANSI, '')) as Record<string, Record<string, unknown>>;

			paths = {
				debug: pick(configs, 'Tempest\\Debug\\DebugConfig', 'logPath'),
				application: pick(configs, 'LogConfig', 'path'),
			};

			this.log.info(
				`Log paths for ${project.name}: debug=${paths.debug?.fsPath ?? '(none)'}, application=${paths.application?.fsPath ?? '(none)'}`,
			);
		} catch (error) {
			this.log.warn(`Could not resolve log paths: ${error instanceof Error ? error.message : String(error)}`);
		}

		this.cache.set(key, paths);

		return paths;
	}

	invalidate(): void {
		this.cache.clear();
	}
}

/**
 * Follows a file, handing out only what was appended since the last read.
 *
 * Log files are append-only until they are rotated or cleared, so the offset is
 * reset whenever the file gets shorter than it was — otherwise a cleared log
 * would appear frozen forever.
 */
export class Tail {
	private offset = 0;

	constructor(readonly uri: vscode.Uri) {}

	async read(): Promise<string> {
		let bytes: Uint8Array;

		try {
			bytes = await vscode.workspace.fs.readFile(this.uri);
		} catch {
			// Missing or unreadable: nothing has been dumped yet, or the file belongs
			// to the web-server user. Both are normal.
			return '';
		}

		if (bytes.byteLength < this.offset) {
			this.offset = 0;
		}

		const chunk = bytes.subarray(this.offset);

		this.offset = bytes.byteLength;

		return new TextDecoder().decode(chunk);
	}

	/** Marks everything currently in the file as already seen. */
	async skipToEnd(): Promise<void> {
		try {
			const bytes = await vscode.workspace.fs.readFile(this.uri);

			this.offset = bytes.byteLength;
		} catch {
			this.offset = 0;
		}
	}

	rewind(): void {
		this.offset = 0;
	}
}

function pick(
	configs: Record<string, Record<string, unknown>>,
	typeSuffix: string,
	field: string,
): vscode.Uri | undefined {
	for (const config of Object.values(configs)) {
		const type = config['@type'];

		if (typeof type !== 'string' || !type.includes(typeSuffix)) {
			continue;
		}

		const value = config[field];

		if (typeof value === 'string' && value !== '') {
			return vscode.Uri.file(value);
		}
	}

	return undefined;
}
