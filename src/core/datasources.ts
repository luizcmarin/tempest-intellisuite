import * as vscode from 'vscode';
import { CliRunner } from './cli';
import type { TempestProject } from './project';

/**
 * Structured data pulled out of a Tempest project.
 *
 * Two rules govern this file, both learned from probing a real install (see
 * docs/upstream.md):
 *
 *  1. Prefer JSON. `completion:generate`, `routes --json` and `about --json` are
 *     data; the console's tables are presentation and break with terminal width.
 *  2. Detect features, never versions. The published docs describe 3.0 while a
 *     current install is far ahead of it, so the only reliable question is
 *     "does this command exist here?" — which `commands.json` answers.
 */

/** Shape of `tempest completion:generate` output (schema `version: 1`). */
export interface CommandsManifest {
	readonly version: number;
	readonly commands: Record<string, CommandSpec>;
}

export interface CommandSpec {
	readonly hidden: boolean;
	readonly description: string | null;
	readonly flags: readonly CommandFlag[];
}

export interface CommandFlag {
	readonly name: string;
	readonly flag: string;
	readonly aliases: readonly string[];
	readonly description: string | null;
	readonly value_options: readonly string[];
	readonly repeatable: boolean;
	readonly requires_value: boolean;
}

/**
 * Shape of `tempest about --json`.
 *
 * Every value arrives as an array of strings — a leftover from the command's
 * rendering format rather than a data model. `AboutReader` normalises it.
 */
export type AboutReport = Record<string, Record<string, readonly string[]>>;

/** Highest schema version of `commands.json` this extension understands. */
const SUPPORTED_MANIFEST_VERSION = 1;

export class DataSources implements vscode.Disposable {
	private readonly manifests = new Map<string, CommandsManifest>();
	private readonly reports = new Map<string, AboutReport>();

	constructor(
		private readonly cli: CliRunner,
		private readonly log: vscode.LogOutputChannel,
	) {}

	/**
	 * The project's command manifest, cached per project.
	 *
	 * Generating it writes a file, so we send it to a throwaway path inside the
	 * extension's storage instead of letting the command drop it in the user's
	 * project. Nothing we do should leave artefacts behind.
	 */
	async commands(
		project: TempestProject,
		storage: vscode.Uri,
		token?: vscode.CancellationToken,
	): Promise<CommandsManifest | undefined> {
		const key = project.root.toString();
		const cached = this.manifests.get(key);

		if (cached) {
			return cached;
		}

		const target = vscode.Uri.joinPath(storage, `commands-${hash(key)}.json`);

		try {
			await vscode.workspace.fs.createDirectory(storage);
			await this.cli.run(project, ['completion:generate', `--path=${target.fsPath}`], token);

			const raw = await vscode.workspace.fs.readFile(target);
			const manifest = JSON.parse(new TextDecoder().decode(raw)) as CommandsManifest;

			if (manifest.version > SUPPORTED_MANIFEST_VERSION) {
				// Newer schema: still usable, since fields have only been added so far,
				// but worth saying out loud when a bug report lands.
				this.log.warn(
					`commands.json reports schema version ${manifest.version}; this extension was built for ${SUPPORTED_MANIFEST_VERSION}. Continuing.`,
				);
			}

			this.manifests.set(key, manifest);
			this.log.info(`Loaded ${Object.keys(manifest.commands).length} commands from ${project.name}.`);

			return manifest;
		} catch (error) {
			this.log.warn(`Could not read the command manifest: ${describe(error)}`);

			return undefined;
		}
	}

	/**
	 * Whether a command exists in this project — the basis for feature detection.
	 * Returns `undefined` when the manifest itself could not be read, so callers
	 * can tell "absent" apart from "unknown".
	 */
	async supports(
		project: TempestProject,
		command: string,
		storage: vscode.Uri,
	): Promise<boolean | undefined> {
		const manifest = await this.commands(project, storage);

		return manifest ? command in manifest.commands : undefined;
	}

	/**
	 * Environment, caches and database info from `about --json`, cached per
	 * project.
	 *
	 * Cached because two sections now ask for it during a single load — the
	 * header summary and the Health report — and each call boots the whole
	 * framework. The Refresh button is what invalidates it, which is also the
	 * only moment a user expects these numbers to move.
	 */
	async about(project: TempestProject, token?: vscode.CancellationToken): Promise<AboutReport | undefined> {
		const key = project.root.toString();
		const cached = this.reports.get(key);

		if (cached) {
			return cached;
		}

		try {
			const report = await this.cli.json<AboutReport>(project, ['about', '--json'], token);

			this.reports.set(key, report);

			return report;
		} catch (error) {
			this.log.warn(`Could not read the project report: ${describe(error)}`);

			return undefined;
		}
	}

	/** Drops cached data for a project, or for every project when omitted. */
	invalidate(project?: TempestProject): void {
		if (project) {
			this.manifests.delete(project.root.toString());
			this.reports.delete(project.root.toString());
		} else {
			this.manifests.clear();
			this.reports.clear();
		}
	}

	dispose(): void {
		this.manifests.clear();
		this.reports.clear();
	}
}

/** Reads a single value out of an `about --json` report, unwrapping its array. */
export function aboutValue(
	report: AboutReport | undefined,
	section: string,
	key: string,
): string | undefined {
	return report?.[section]?.[key]?.[0];
}

function hash(value: string): string {
	let result = 0;

	for (let index = 0; index < value.length; index++) {
		result = (Math.imul(31, result) + value.charCodeAt(index)) | 0;
	}

	return (result >>> 0).toString(36);
}

function describe(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
