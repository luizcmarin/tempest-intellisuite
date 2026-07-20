import * as vscode from 'vscode';
import { CliRunner } from './cli';
import type { TempestProject } from './project';

/**
 * The services the project's container can actually autowire.
 *
 * This is the second place in the extension that parses console output, and the
 * less comfortable one: `container:show` has no `--json`, so the only available
 * shape is a padded, coloured table. It is tracked upstream as U-002.
 *
 * Because of that, the parser is written to fail quietly and completely: if the
 * format shifts, the result is an empty list and the completions fall back to
 * the built-in set of core services. A wrong suggestion would be worse than a
 * missing one.
 */

export interface ContainerService {
	/** Fully-qualified class or interface the container resolves. */
	readonly id: string;
	readonly shortName: string;
	/** Present when the binding is tagged, e.g. `Highlighter#console`. */
	readonly tag?: string;
	readonly section: string;
}

/**
 * `Tempest\Clock\Clock .......... Tempest\Clock\ClockInitializer`
 *
 * Both columns are captured because which one holds the service depends on the
 * section — see `parseContainer`.
 */
const ROW = /^([\w\\]+)(?:#(\w+))?\s+\.{3,}\s+(.+?)\s*$/;
const SECTION = /^\s*\/\/\s*(.+?)\s*$/;
const ANSI = /\x1b\[[0-9;]*m/g;

/**
 * The one section whose columns are the other way round.
 *
 * `INITIALIZERS` and `SINGLETONS` read `service .... initializer`, but
 * `DYNAMIC INITIALIZERS` reads `initializer .... what it produces`. Taking
 * column one everywhere would offer `CacheInitializer` for injection and hide
 * `Cache`, which is precisely backwards.
 */
const PRODUCER_SECTION = 'DYNAMIC INITIALIZERS';

/** Long enough that typing never triggers a re-run; short enough to notice new bindings. */
const CACHE_MS = 60_000;

export class ContainerIndex {
	private cache = new Map<string, { at: number; services: ContainerService[] }>();

	constructor(
		private readonly cli: CliRunner,
		private readonly log: vscode.LogOutputChannel,
	) {}

	async all(project: TempestProject): Promise<ContainerService[]> {
		const key = project.root.toString();
		const cached = this.cache.get(key);

		if (cached && Date.now() - cached.at < CACHE_MS) {
			return cached.services;
		}

		let services: ContainerService[] = [];

		try {
			const { stdout } = await this.cli.run(project, ['container:show']);

			services = parseContainer(stdout);

			this.log.debug(`Indexed ${services.length} container binding(s) in ${project.name}.`);
		} catch (error) {
			this.log.debug(
				`Container bindings unavailable: ${error instanceof Error ? error.message : String(error)}`,
			);
		}

		this.cache.set(key, { at: Date.now(), services });

		return services;
	}

	invalidate(): void {
		this.cache.clear();
	}
}

export function parseContainer(stdout: string): ContainerService[] {
	const services: ContainerService[] = [];
	const seen = new Set<string>();
	let section = '';

	for (const raw of stdout.replace(ANSI, '').split('\n')) {
		const line = raw.trimEnd();
		const heading = SECTION.exec(line);

		if (heading) {
			section = heading[1];

			continue;
		}

		const row = ROW.exec(line);

		if (!row) {
			continue;
		}

		const [, first, tag, second] = row;

		for (const id of identifiers(section, first, second)) {
			// The same class can be bound in more than one section; the first wins,
			// and duplicates in a completion list are just noise.
			if (seen.has(id)) {
				continue;
			}

			seen.add(id);

			services.push({
				id,
				shortName: id.split('\\').pop() ?? id,
				tag,
				section,
			});
		}
	}

	return services;
}

function identifiers(section: string, first: string, second: string): string[] {
	if (section !== PRODUCER_SECTION) {
		return [first];
	}

	// The produced type can be a union (`Psr\Log\LoggerInterface|Tempest\Log\Logger`),
	// and is sometimes just `object` when the initializer decides at runtime —
	// nothing worth suggesting there.
	return second
		.split('|')
		.map((part) => part.trim())
		.filter((part) => part.includes('\\'));
}
