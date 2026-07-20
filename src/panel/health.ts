import * as vscode from 'vscode';
import type { HealthFix, HealthReader } from '../core/health';
import type { ProjectRegistry } from '../core/project';
import type { ToPanel } from './protocol';

/**
 * The Health section — the panel's side of the project report.
 *
 * It loads with the rest of the Workbench rather than when its tab is opened,
 * because the point of the tab is to be noticed: the count on the tab is the
 * only warning a developer gets before the stack trace.
 *
 * Fixes never run by themselves. A console command goes to a real terminal
 * where it can be watched and cancelled; anything that touches ownership or
 * permissions is copied to the clipboard, for the user to read and run in their
 * own shell — this extension does not `chmod` other people's directories.
 */
export class HealthSection {
	constructor(
		private readonly projects: ProjectRegistry,
		private readonly reader: HealthReader,
		private readonly runInTerminal: (command: string) => void,
		private readonly log: vscode.LogOutputChannel,
		private readonly post: (message: ToPanel) => Thenable<unknown>,
	) {}

	async load(): Promise<void> {
		const project = this.projects.active;

		if (!project) {
			await this.post({ type: 'health', report: { checks: [], errors: 0, warnings: 0 } });

			return;
		}

		await this.post({ type: 'health', report: await this.reader.read(project) });
	}

	async apply(kind: HealthFix['kind'], value: string): Promise<void> {
		switch (kind) {
			case 'command':
				this.runInTerminal(value);

				return;

			case 'copy':
				await vscode.env.clipboard.writeText(value);
				void vscode.window.showInformationMessage(`Copied: ${value}`);
				this.log.info(`Health fix copied to the clipboard: ${value}`);

				return;

			case 'setting':
				await vscode.commands.executeCommand('workbench.action.openSettings', value);

				return;

			case 'file': {
				const document = await vscode.workspace.openTextDocument(vscode.Uri.file(value));

				await vscode.window.showTextDocument(document);

				return;
			}
		}
	}
}
