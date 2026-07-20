import * as vscode from 'vscode';
import type { Collectors } from '../core/collectors';
import type { LogLine } from '../core/logLines';
import type { LogWatcher } from '../core/logWatcher';
import { markRepeats } from '../core/metrics';
import type { ProjectRegistry, TempestProject } from '../core/project';
import type { ToPanel } from './protocol';

/**
 * The Lens — dumps, logs and crashes streamed into the editor.
 *
 * `dump()` in a web app writes into the page you are looking at, wrecking the
 * layout you were debugging; in a console command it scrolls past. Here the same
 * output lands beside the code, keeps its call site, and stays clickable.
 *
 * Nothing has to be installed in the project for this: the framework already
 * writes dumps and logs to `.tempest/logs/`. It only reads those files, and it
 * never calls `tail:debug`, which would delete them.
 *
 * Like the Inspector, this owns no webview — it is a tab inside the Workbench
 * panel, and speaks through the `post` it is given.
 */
export class LensSection {
	private readonly disposables: vscode.Disposable[] = [];

	constructor(
		private readonly projects: ProjectRegistry,
		private readonly watcher: LogWatcher,
		private readonly log: vscode.LogOutputChannel,
		private readonly post: (message: ToPanel) => Thenable<unknown>,
	) {
		this.disposables.push(
			this.watcher.onDidUpdate((update) => {
				void this.post({
					type: 'lens-append',
					dumps: update.dumps,
					lines: update.lines,
					queries: markRepeats(update.queries),
					requests: update.requests,
				});
			}),
		);
	}

	/**
	 * Empties the view, and offers to empty the files behind it.
	 *
	 * Clearing only the view is a lie that lasts until the next refresh: the
	 * panel reloads from the log, so everything just dismissed comes straight
	 * back. The files are what actually hold the history, so they are what has to
	 * go — but they are the user's project data, and the framework's own
	 * `tail:debug` deleting the log is precisely the behaviour this extension
	 * exists to avoid. So the view clears immediately and the disk is asked
	 * about, once, naming every file and what it costs.
	 */
	async clear(): Promise<void> {
		await this.post({ type: 'lens-reset' });

		const project = this.projects.active;

		if (!project) {
			return;
		}

		const files = await this.watcher.writtenFiles(project);

		if (files.length === 0) {
			return;
		}

		const choice = await vscode.window.showWarningMessage(
			'Also empty the log files on disk?',
			{
				modal: true,
				detail: [
					'The view is cleared. These files still hold that history, and the panel',
					'reads them again every time it reloads:',
					'',
					...files.map((file) => `  • ${relative(project, file.uri)} (${kb(file.bytes)})`),
					'',
					'They are truncated, not deleted, so the application keeps logging into',
					'them. Anything already written is gone for good.',
				].join('\n'),
			},
			'Empty them',
		);

		if (choice !== 'Empty them') {
			return;
		}

		const { cleared, failed } = await this.watcher.clearFiles(project);

		this.log.info(`Lens cleared ${cleared} file(s); ${failed.length} could not be written.`);

		if (failed.length > 0) {
			void vscode.window.showWarningMessage(
				`Could not empty ${failed.map((uri) => relative(project, uri)).join(', ')} — ` +
					'the files belong to another user, most likely the web server.',
			);
		}
	}

	async restart(): Promise<void> {
		const project = this.projects.active;

		if (!project) {
			await this.post({
				type: 'lens-status',
				status: 'No Tempest project is open in this workspace.',
			});

			return;
		}

		const history = await this.watcher.history(project);
		const collecting = await this.watcher.hasMetrics(project);

		await this.post({ type: 'lens-reset' });
		await this.post({
			type: 'lens-append',
			dumps: history.dumps,
			lines: history.lines,
			queries: markRepeats(history.queries),
			requests: history.requests,
		});
		await this.post({
			type: 'lens-status',
			status: `Watching ${describe(project)} — dump() and log output will appear here.${historyNote()}`,
			collecting,
		});

		await this.watcher.start(project);

		this.log.info(
			`Lens opened: ${history.dumps.length} dump(s), ${history.lines.length} log line(s), ` +
				`${history.queries.length} query(ies), ${history.requests.length} request(s); ` +
				`collectors ${collecting ? 'installed' : 'not installed'}.`,
		);
	}

	async installCollectors(): Promise<void> {
		await vscode.commands.executeCommand('tempest.installCollectors');
		await this.restart();
	}

	dispose(): void {
		// The watcher outlives the panel — it belongs to the project, and closing
		// this view must not switch off crash reporting.
		for (const disposable of this.disposables) {
			disposable.dispose();
		}
	}

	async openDump(file: string | undefined, line: number | undefined): Promise<void> {
		if (!file) {
			return;
		}

		try {
			const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
			// The log records a one-based line; positions are zero-based.
			const position = new vscode.Position(Math.max(0, (line ?? 1) - 1), 0);

			await vscode.window.showTextDocument(document, {
				selection: new vscode.Range(position, position),
				viewColumn: vscode.ViewColumn.One,
			});
		} catch {
			void vscode.window.showWarningMessage(`Could not open ${file}.`);
		}
	}
}

/**
 * Installs the two collector files that query and timing capture need.
 *
 * This is the only place the extension ever writes into a user's project, so it
 * asks first, in a modal, and says plainly what will
 * land and where. The files are ordinary project code: discovered by the
 * framework, inert outside `local`, and removable in one command.
 */
export async function installCollectors(
	projects: ProjectRegistry,
	collectors: Collectors,
	log: vscode.LogOutputChannel,
): Promise<void> {
	const project = projects.active;

	if (!project) {
		void vscode.window.showWarningMessage('No Tempest project is open in this workspace.');

		return;
	}

	collectors.invalidate();

	const planned = await collectors.plan(project);
	const already = planned.filter((file) => file.exists);

	if (already.length === planned.length) {
		void vscode.window.showInformationMessage('The Lens collectors are already installed.');

		return;
	}

	const choice = await vscode.window.showInformationMessage(
		'Install the Lens collectors?',
		{
			modal: true,
			detail: [
				'The framework keeps query timings in memory and has no request-lifecycle event,',
				'so capturing them needs two small PHP files in your project:',
				'',
				...planned.map((file) => `  • ${file.relativePath}${file.exists ? ' (already there)' : ''}`),
				'',
				'They only run in the local environment, they swallow their own errors, and',
				'"Tempest: Remove Lens Collectors" deletes them again.',
			].join('\n'),
		},
		'Install',
	);

	if (choice !== 'Install') {
		return;
	}

	try {
		await collectors.write(planned.filter((file) => !file.exists));

		void vscode.window.showInformationMessage(
			'Lens collectors installed. Reload a page or run a command to see queries appear.',
		);

		log.info('Lens collectors installed.');
	} catch (error) {
		void vscode.window.showErrorMessage(
			`Could not install the collectors: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

/** Deletes the collector files, and the data they gathered. */
export async function removeCollectors(
	projects: ProjectRegistry,
	collectors: Collectors,
	log: vscode.LogOutputChannel,
): Promise<void> {
	const project = projects.active;

	if (!project) {
		return;
	}

	const planned = await collectors.plan(project);
	const present = planned.filter((file) => file.exists);

	if (present.length === 0) {
		void vscode.window.showInformationMessage('The Lens collectors are not installed.');

		return;
	}

	const choice = await vscode.window.showWarningMessage(
		'Remove the Lens collectors?',
		{
			modal: true,
			detail: [
				'These files will be deleted:',
				'',
				...present.map((file) => `  • ${file.relativePath}`),
				'',
				'Collected query and timing data in .tempest/intellisuite/ goes with them.',
			].join('\n'),
		},
		'Remove',
	);

	if (choice !== 'Remove') {
		return;
	}

	for (const file of present) {
		await vscode.workspace.fs.delete(file.uri);
		log.info(`Removed ${file.relativePath}`);
	}

	try {
		await vscode.workspace.fs.delete(
			vscode.Uri.joinPath(project.root, '.tempest', 'intellisuite'),
			{ recursive: true },
		);
	} catch {
		// Nothing collected yet, or already gone.
	}

	void vscode.window.showInformationMessage('Lens collectors removed.');
}

/** Registers the notification that fires when the application logs an error. */
export function registerCrashNotifications(
	context: vscode.ExtensionContext,
	watcher: LogWatcher,
	show: () => void,
	log: vscode.LogOutputChannel,
): void {
	let muted = false;

	context.subscriptions.push(
		watcher.onDidAlarm((line: LogLine) => {
			if (!vscode.workspace.getConfiguration('tempest').get<boolean>('lens.notifyOnError', true)) {
				return;
			}

			// One notification per burst: a single failure often logs several lines,
			// and a stack of identical toasts helps nobody.
			if (muted) {
				return;
			}

			muted = true;
			setTimeout(() => (muted = false), 5000);

			log.info(`Lens alarm: ${line.level} — ${firstLine(line.message)}`);

			void vscode.window
				.showWarningMessage(`Tempest logged ${line.level}: ${firstLine(line.message)}`, 'Open Lens')
				.then((choice) => {
					if (choice === 'Open Lens') {
						show();
					}
				});
		}),
	);
}

function firstLine(message: string): string {
	const [first] = message.split('\n');

	return first.length > 120 ? `${first.slice(0, 117)}…` : first;
}

function describe(project: TempestProject): string {
	return project.name;
}

/** Paths are shown relative to the project — the absolute ones are unreadably long. */
function relative(project: TempestProject, uri: vscode.Uri): string {
	const root = `${project.root.path}/`;

	return uri.path.startsWith(root) ? uri.path.slice(root.length) : uri.fsPath;
}

function kb(bytes: number): string {
	return bytes < 1024 ? `${bytes} B` : `${Math.round(bytes / 1024)} KB`;
}

/**
 * Says how far back the loaded history goes.
 *
 * Without this the window is invisible: an error the user knows is in the log
 * would simply not be in the panel, and the only reading available is that the
 * Lens missed it.
 */
function historyNote(): string {
	const minutes = vscode.workspace.getConfiguration('tempest').get<number>('lens.historyMinutes', 60);

	if (!Number.isFinite(minutes) || minutes <= 0) {
		return ' Showing the whole log.';
	}

	return ` History shown: the last ${describeMinutes(minutes)}.`;
}

function describeMinutes(minutes: number): string {
	if (minutes < 60) {
		return `${minutes} min`;
	}

	const hours = Math.round((minutes / 60) * 10) / 10;

	return `${hours} h`;
}

