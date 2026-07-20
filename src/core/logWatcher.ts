import * as vscode from 'vscode';
import { parseDumps, splitPending, type Dump } from './dumps';
import { isAlarming, parseLogLines, type LogLine } from './logLines';
import { LogLocator, Tail } from './logs';
import { parseJsonLines, type QueryRecord, type RequestRecord } from './metrics';
import type { TempestProject } from './project';

/**
 * Watches a project's logs and reports what was appended.
 *
 * The directory is watched rather than individual files, because the application
 * log rotates daily and a watcher bound to today's name goes deaf at midnight.
 *
 * Everything here is best-effort by design: parts of `.tempest/` are owned by
 * the web-server user while the extension runs as the editor user, so read
 * failures are an expected state and never surfaced as errors.
 */

export interface LogUpdate {
	readonly dumps: readonly Dump[];
	readonly lines: readonly LogLine[];
	readonly queries: readonly QueryRecord[];
	readonly requests: readonly RequestRecord[];
}

/** Coalesces the burst of events a single request can produce. */
const DEBOUNCE_MS = 150;

/** How much of the past the panel loads, in minutes, when nothing is configured. */
const DEFAULT_HISTORY_MINUTES = 60;

/**
 * The instant history starts at, or `undefined` for "load everything".
 *
 * Read per call rather than cached: the setting takes effect on the next
 * refresh of the panel, with no reload of the window.
 */
export function historyCutoff(now: number = Date.now()): number | undefined {
	const minutes = vscode.workspace
		.getConfiguration('tempest')
		.get<number>('lens.historyMinutes', DEFAULT_HISTORY_MINUTES);

	if (!Number.isFinite(minutes) || minutes <= 0) {
		return undefined;
	}

	return now - minutes * 60_000;
}

/**
 * Drops entries older than `cutoff`.
 *
 * An entry whose timestamp cannot be read is kept: the parse failing is our
 * problem, and hiding real activity because of it would be the worse error.
 */
export function since<T>(
	entries: readonly T[],
	timestampOf: (entry: T) => string | undefined,
	cutoff: number | undefined,
): T[] {
	if (cutoff === undefined) {
		return [...entries];
	}

	return entries.filter((entry) => {
		const at = Date.parse(timestampOf(entry) ?? '');

		return Number.isNaN(at) || at >= cutoff;
	});
}

export class LogWatcher implements vscode.Disposable {
	private watcher: vscode.FileSystemWatcher | undefined;
	private metricsWatcher: vscode.FileSystemWatcher | undefined;
	private debugTail: Tail | undefined;
	private queryTail: Tail | undefined;
	private requestTail: Tail | undefined;
	private applicationTails = new Map<string, Tail>();
	private pending = '';
	private timer: ReturnType<typeof setTimeout> | undefined;
	private project: TempestProject | undefined;

	private readonly onDidUpdateEmitter = new vscode.EventEmitter<LogUpdate>();
	readonly onDidUpdate = this.onDidUpdateEmitter.event;

	private readonly onDidAlarmEmitter = new vscode.EventEmitter<LogLine>();
	/** Fires for lines at ERROR level and above. */
	readonly onDidAlarm = this.onDidAlarmEmitter.event;

	constructor(
		private readonly locator: LogLocator,
		private readonly log: vscode.LogOutputChannel,
	) {}

	/**
	 * Starts following `project`.
	 *
	 * History already in the files is deliberately *not* replayed as new activity:
	 * the panel loads it once, up front, and the watcher only reports what happens
	 * from now on.
	 */
	async start(project: TempestProject): Promise<void> {
		// Idempotent on purpose: watching starts when a project is detected, so that
		// a crash can be reported before the panel is ever opened, and the panel
		// then attaches to the same watcher instead of restarting it and losing the
		// offsets it had built up.
		if (this.watcher && this.project?.id === project.id) {
			return;
		}

		this.stop();
		this.project = project;

		const paths = await this.locator.resolve(project);
		const directory = paths.debug
			? vscode.Uri.joinPath(paths.debug, '..')
			: vscode.Uri.joinPath(project.root, '.tempest', 'logs');

		this.debugTail = paths.debug ? new Tail(paths.debug) : undefined;

		// Whatever is already on disk is history, not activity: the panel loads it
		// separately, and replaying it as if it just happened would be a lie.
		await this.debugTail?.skipToEnd();

		if (paths.application) {
			for (const uri of await this.rotatedFiles(paths.application)) {
				const tail = new Tail(uri);

				await tail.skipToEnd();
				this.applicationTails.set(uri.toString(), tail);
			}
		}

		this.watcher = vscode.workspace.createFileSystemWatcher(
			new vscode.RelativePattern(directory, '*.log'),
		);

		const schedule = () => {
			clearTimeout(this.timer);
			this.timer = setTimeout(() => void this.collect(), DEBOUNCE_MS);
		};

		this.watcher.onDidCreate(schedule);
		this.watcher.onDidChange(schedule);

		// The metrics directory only exists once the collectors are installed, so
		// it is watched separately and its absence is not a problem.
		const metrics = this.metricsDirectory(project);

		this.queryTail = new Tail(vscode.Uri.joinPath(metrics, 'queries.jsonl'));
		this.requestTail = new Tail(vscode.Uri.joinPath(metrics, 'requests.jsonl'));

		await this.queryTail.skipToEnd();
		await this.requestTail.skipToEnd();

		this.metricsWatcher = vscode.workspace.createFileSystemWatcher(
			new vscode.RelativePattern(metrics, '*.jsonl'),
		);

		this.metricsWatcher.onDidCreate(schedule);
		this.metricsWatcher.onDidChange(schedule);

		this.log.info(`Lens watching ${directory.fsPath}`);
	}

	private metricsDirectory(project: TempestProject): vscode.Uri {
		return vscode.Uri.joinPath(project.root, '.tempest', 'intellisuite');
	}

	/**
	 * Reads what is currently in the logs, for the initial view.
	 *
	 * Only the recent past is loaded. The log file is written for the whole day
	 * and errors are never removed from it, so replaying it whole shows failures
	 * that were fixed hours ago next to what is happening now, with nothing to
	 * tell them apart — the panel reports state, and yesterday's crash is not
	 * current state. Entries older than the window are left on disk, where the
	 * file itself remains the record.
	 *
	 * Dumps have no timestamp in the debug log, so they cannot be cut by time;
	 * they are bounded by `limit` alone. That is the right default anyway — a
	 * dump is something the developer deliberately wrote to see.
	 */
	async history(project: TempestProject, limit = 200): Promise<LogUpdate> {
		const paths = await this.locator.resolve(project);
		const cutoff = historyCutoff();

		const dumps = paths.debug ? parseDumps(await new Tail(paths.debug).read()) : [];
		const lines = paths.application ? parseLogLines(await this.readRotated(paths.application)) : [];

		const metrics = this.metricsDirectory(project);
		const queries = parseJsonLines<QueryRecord>(
			await new Tail(vscode.Uri.joinPath(metrics, 'queries.jsonl')).read(),
		);
		const requests = parseJsonLines<RequestRecord>(
			await new Tail(vscode.Uri.joinPath(metrics, 'requests.jsonl')).read(),
		);

		return {
			dumps: dumps.slice(-limit),
			lines: since(lines, (line) => line.timestamp, cutoff).slice(-limit),
			queries: since(queries, (query) => query.at, cutoff).slice(-limit),
			requests: since(requests, (request) => request.at, cutoff).slice(-limit),
		};
	}

	/** The files the Lens reads, with their current size — what "clear" would empty. */
	async writtenFiles(project: TempestProject): Promise<{ uri: vscode.Uri; bytes: number }[]> {
		const paths = await this.locator.resolve(project);
		const metrics = this.metricsDirectory(project);

		const candidates = [
			...(paths.debug ? [paths.debug] : []),
			...(paths.application ? await this.rotatedFiles(paths.application) : []),
			vscode.Uri.joinPath(metrics, 'queries.jsonl'),
			vscode.Uri.joinPath(metrics, 'requests.jsonl'),
		];

		const files: { uri: vscode.Uri; bytes: number }[] = [];

		for (const uri of candidates) {
			try {
				const { size } = await vscode.workspace.fs.stat(uri);

				if (size > 0) {
					files.push({ uri, bytes: size });
				}
			} catch {
				// Not written yet, or not ours to read. Both are normal.
			}
		}

		return files;
	}

	/**
	 * Empties the log files on disk.
	 *
	 * They are truncated, never deleted: the framework and the web server hold
	 * these paths open and own them — often as a different user — and replacing
	 * the file with one created by the editor would hand it new ownership and
	 * leave the writer logging into an unlinked inode until it restarts.
	 *
	 * The tails need no adjustment: `Tail` already rewinds when a file gets
	 * shorter than the offset it held, which is exactly what just happened.
	 */
	async clearFiles(project: TempestProject): Promise<{ cleared: number; failed: vscode.Uri[] }> {
		const failed: vscode.Uri[] = [];
		let cleared = 0;

		for (const { uri } of await this.writtenFiles(project)) {
			try {
				await vscode.workspace.fs.writeFile(uri, new Uint8Array());
				cleared += 1;
			} catch {
				// Owned by the web-server user, most likely. Reported, not thrown:
				// clearing what we can is still worth doing.
				failed.push(uri);
			}
		}

		this.pending = '';

		return { cleared, failed };
	}

	/** Whether the opt-in collectors have produced anything yet. */
	async hasMetrics(project: TempestProject): Promise<boolean> {
		try {
			await vscode.workspace.fs.stat(this.metricsDirectory(project));

			return true;
		} catch {
			return false;
		}
	}

	private async collect(): Promise<void> {
		if (!this.project) {
			return;
		}

		const dumps = await this.collectDumps();
		const lines = await this.collectLines();
		const queries = parseJsonLines<QueryRecord>((await this.queryTail?.read()) ?? '');
		const requests = parseJsonLines<RequestRecord>((await this.requestTail?.read()) ?? '');

		if (dumps.length === 0 && lines.length === 0 && queries.length === 0 && requests.length === 0) {
			return;
		}

		this.log.debug(
			`Lens captured ${dumps.length} dump(s), ${lines.length} log line(s), ` +
				`${queries.length} query(ies) and ${requests.length} request(s).`,
		);

		for (const line of lines) {
			if (isAlarming(line)) {
				this.onDidAlarmEmitter.fire(line);
			}
		}

		this.onDidUpdateEmitter.fire({ dumps, lines, queries, requests });
	}

	private async collectDumps(): Promise<Dump[]> {
		if (!this.debugTail) {
			return [];
		}

		// A watcher can fire mid-write, so a chunk may end halfway through an entry.
		// The incomplete tail is carried over instead of being shown truncated and
		// then again in full.
		const { complete, pending } = splitPending(this.pending + (await this.debugTail.read()));

		this.pending = pending;

		return parseDumps(complete);
	}

	private async collectLines(): Promise<LogLine[]> {
		const paths = this.project ? await this.locator.resolve(this.project) : {};

		if (!paths.application) {
			return [];
		}

		const collected: LogLine[] = [];

		for (const uri of await this.rotatedFiles(paths.application)) {
			const key = uri.toString();
			let tail = this.applicationTails.get(key);

			if (!tail) {
				// A log file created *after* watching began — the first write of the
				// day, or a rotation — holds nothing but new activity, so it is read
				// from the start. Only files that already existed when we attached are
				// skipped past, and those were handled in `start`.
				tail = new Tail(uri);
				this.applicationTails.set(key, tail);
			}

			collected.push(...parseLogLines(await tail.read()));
		}

		return collected;
	}

	/** `…/tempest.log` is configured, but `…/tempest-2026-07-18.log` is written. */
	private async rotatedFiles(configured: vscode.Uri): Promise<vscode.Uri[]> {
		const directory = vscode.Uri.joinPath(configured, '..');
		const base = configured.path.split('/').pop()?.replace(/\.log$/, '') ?? '';

		try {
			const entries = await vscode.workspace.fs.readDirectory(directory);

			return entries
				.filter(([name, type]) => type === vscode.FileType.File && name.startsWith(base) && name.endsWith('.log'))
				.sort(([a], [b]) => a.localeCompare(b))
				.map(([name]) => vscode.Uri.joinPath(directory, name));
		} catch {
			return [];
		}
	}

	private async readRotated(configured: vscode.Uri): Promise<string> {
		const files = await this.rotatedFiles(configured);
		const chunks: string[] = [];

		// Only the most recent file is read for history; older days are noise in a
		// live panel.
		for (const uri of files.slice(-1)) {
			chunks.push(await new Tail(uri).read());
		}

		return chunks.join('\n');
	}

	stop(): void {
		clearTimeout(this.timer);
		this.watcher?.dispose();
		this.metricsWatcher?.dispose();
		this.watcher = undefined;
		this.metricsWatcher = undefined;
		this.debugTail = undefined;
		this.queryTail = undefined;
		this.requestTail = undefined;
		this.applicationTails.clear();
		this.pending = '';
	}

	dispose(): void {
		this.stop();
		this.onDidUpdateEmitter.dispose();
		this.onDidAlarmEmitter.dispose();
	}
}
