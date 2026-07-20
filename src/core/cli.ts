import { execFile, type ExecFileException } from 'node:child_process';
import * as vscode from 'vscode';
import type { TempestProject } from './project';

/**
 * Runs `php tempest <command>` and hands back the raw output.
 *
 * Everything here is read-only by design: commands that mutate the project
 * (`migrate:*`, `cache:clear`, `make:*`) belong in a real VS Code terminal, where
 * the user can see them, answer prompts and cancel. This runner exists to collect
 * data for the UI, nothing else.
 */

export interface CliResult {
	readonly stdout: string;
	readonly stderr: string;
}

export class CliError extends Error {
	constructor(
		message: string,
		readonly command: string,
		readonly stderr: string = '',
	) {
		super(message);
		this.name = 'CliError';
	}
}

/**
 * Turns a spawn failure into something the user can act on.
 *
 * Node reports a missing executable as `spawn <name> ENOENT`, which is accurate
 * and useless: it names neither the setting to change nor the fact that PHP is
 * what went missing. This is the most likely failure in the wild, so it gets a
 * real sentence.
 */
function explain(error: ExecFileException, php: string, timeout: number): string {
	if (error.killed) {
		return `timed out after ${timeout}ms — raise "tempest.cli.timeout" if this project is slow to boot`;
	}

	if (error.code === 'ENOENT') {
		return `PHP was not found at "${php}". Set "tempest.phpPath" to the full path of your PHP executable.`;
	}

	if (error.code === 'EACCES') {
		return `Not allowed to execute "${php}". Check the file's permissions.`;
	}

	return error.message.trim();
}

export class CliRunner {
	constructor(private readonly log: vscode.LogOutputChannel) {}

	async run(
		project: TempestProject,
		args: readonly string[],
		token?: vscode.CancellationToken,
	): Promise<CliResult> {
		return this.spawn(project, [project.console.fsPath, ...args], token);
	}

	private async spawn(
		project: TempestProject,
		args: readonly string[],
		token?: vscode.CancellationToken,
	): Promise<CliResult> {
		const config = vscode.workspace.getConfiguration('tempest', project.root);
		const php = config.get<string>('phpPath', 'php');
		const timeout = config.get<number>('cli.timeout', 15_000);

		const label = `${php} ${args.join(' ')}`;
		const started = Date.now();

		this.log.debug(`Running: ${label}`);

		return new Promise<CliResult>((resolve, reject) => {
			const child = execFile(
				php,
				[...args],
				{
					// The console's own directory, not the workspace folder. Tempest's
					// entry point resolves its autoloader as `getcwd() . '/vendor/autoload.php'`,
					// so running it from anywhere else loads the wrong autoloader — or,
					// in a monorepo that has its own `vendor/`, loads a real but unrelated
					// one and fails with "Class ConsoleApplication not found".
					cwd: consoleDirectory(project),
					timeout,
					// Tempest's console renders wide tables; 1 MB keeps the biggest
					// payload we know of (commands.json, ~33 KB) far from the ceiling.
					maxBuffer: 1024 * 1024,
					env: {
						...process.env,
						// Reduces ANSI noise. It does not remove it — the console still
						// emits escapes for tables, which is why JSON sources are always
						// preferred over parsing text.
						NO_COLOR: '1',
					},
				},
				(error, stdout, stderr) => {
					subscription?.dispose();

					if (error) {
						const reason = explain(error, php, timeout);

						this.log.warn(`Failed: ${label} — ${reason}`);

						reject(new CliError(reason, label, stderr));

						return;
					}

					this.log.debug(`Finished in ${Date.now() - started}ms: ${label}`);

					resolve({ stdout, stderr });
				},
			);

			const subscription = token?.onCancellationRequested(() => {
				child.kill();
				reject(new CliError('Cancelled', label));
			});
		});
	}

	/**
	 * Runs the configured PHP itself, without booting the console.
	 *
	 * The Health tab needs to know what the interpreter can do — its version, its
	 * loaded extensions, what it is allowed to write — and asking Tempest would
	 * only answer for a framework that already booted successfully. When it did
	 * not, that is exactly the question worth asking.
	 *
	 * Still read-only: the caller passes a script that measures and prints.
	 */
	async php(
		project: TempestProject,
		args: readonly string[],
		token?: vscode.CancellationToken,
	): Promise<CliResult> {
		return this.spawn(project, args, token);
	}

	/** Runs a command and parses its output as JSON. */
	async json<T>(
		project: TempestProject,
		args: readonly string[],
		token?: vscode.CancellationToken,
	): Promise<T> {
		const { stdout } = await this.run(project, args, token);

		try {
			return JSON.parse(stdout) as T;
		} catch {
			// A non-JSON body almost always means the command printed a warning or an
			// error page before its payload. Surfacing a slice of it beats "Unexpected
			// token <".
			throw new CliError(
				`Expected JSON from \`${args.join(' ')}\`, got: ${stdout.slice(0, 200)}`,
				args.join(' '),
			);
		}
	}
}

/**
 * The directory the console must run from.
 *
 * `Uri.joinPath(console, '..')` rather than `path.dirname`: the console is a Uri,
 * and this keeps the result one too, on every platform.
 */
function consoleDirectory(project: TempestProject): string {
	return vscode.Uri.joinPath(project.console, '..').fsPath;
}
