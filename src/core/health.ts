import * as vscode from 'vscode';
import type { CliRunner } from './cli';
import { aboutValue, type AboutReport, type DataSources } from './datasources';
import type { TempestProject } from './project';

/**
 * The Health report — why this project will (or will not) boot.
 *
 * Tempest's zero-config design means most of what can go wrong goes wrong
 * outside the code: an interpreter without `ext-intl`, a `.tempest/` directory
 * the web server may not write to, a discovery cache left invalid by a rebase,
 * a `.env` missing the key that was added to `.env.example` last week. Those
 * failures surface as a stack trace at the worst possible moment —
 * `CouldNotRegisterInternalStorage` is the one everybody meets first — and none
 * of them are visible from the editor.
 *
 * Three sources feed the report, in order of trust:
 *
 *  1. **The project's own `composer.json` tree.** The PHP constraint and the
 *     `ext-*` requirements are read from the installed `tempest/framework`, not
 *     hardcoded here, so the report keeps telling the truth as the framework
 *     moves. Nothing about a version is assumed.
 *  2. **The configured PHP itself**, asked directly with a one-shot script (see
 *     `PROBE`). It answers even when the framework cannot boot, which is when
 *     the question matters most.
 *  3. **`about --json`**, for what only a booted application knows: cache state,
 *     database engine.
 *
 * Nothing is written to the project, and no check ever repairs anything on its
 * own: a failing check carries advice, and at most an action the user chooses to
 * take — a console command run in a real terminal, or a shell line copied to the
 * clipboard for them to read before they run it.
 */

export type HealthStatus = 'ok' | 'warning' | 'error';

/**
 * A remedy the panel can offer for a failing check.
 *
 * `copy` exists because the honest fix for a permissions problem is a `chmod`
 * or `chown` the user should read before running — this extension has no
 * business executing it for them.
 */
export interface HealthFix {
	readonly label: string;
	readonly kind: 'command' | 'copy' | 'setting' | 'file';
	readonly value: string;
}

export interface HealthCheck {
	readonly id: string;
	readonly group: string;
	readonly label: string;
	readonly status: HealthStatus;
	/** What was measured, in the project's own terms. */
	readonly detail: string;
	/** What to do about it — only on checks that are not `ok`. */
	readonly advice?: string;
	readonly fix?: HealthFix;
}

export interface HealthReport {
	readonly checks: readonly HealthCheck[];
	readonly errors: number;
	readonly warnings: number;
	/** Set when the probe itself could not run: the report is then partial. */
	readonly note?: string;
}

const GROUP_REQUIREMENTS = 'Requirements';
const GROUP_ENVIRONMENT = 'Environment';
const GROUP_STORAGE = 'Storage';
const GROUP_CACHES = 'Caches';
const GROUP_DATABASE = 'Database';

/**
 * What the framework needs when its `composer.json` cannot be read — a project
 * with no `vendor/` yet, which is precisely a project someone is trying to get
 * running. Taken from `tempest/framework` 3.16 and used only as a fallback; the
 * installed manifest always wins.
 */
const FALLBACK_REQUIREMENTS = {
	php: '8.5',
	extensions: ['dom', 'fileinfo', 'intl', 'libxml', 'mbstring', 'pdo', 'readline', 'simplexml'],
};

/** Below this, a Tempest console command that touches discovery tends to die. */
const MINIMUM_MEMORY_MB = 128;

/**
 * Asked of the configured PHP, with the paths to test passed as arguments.
 *
 * Deliberately a single expression-free script rather than a file: nothing is
 * written anywhere, and `execFile` passes it as one argument, so no shell ever
 * sees it.
 */
const PROBE = `
$paths = [];
foreach (array_slice($argv, 1) as $path) {
	$full = $path[0] === '/' ? $path : getcwd() . '/' . $path;
	$exists = file_exists($full);
	$owner = null;
	if ($exists && function_exists('posix_getpwuid')) {
		$owner = (posix_getpwuid(fileowner($full))['name'] ?? null);
	}
	$paths[$path] = [
		'exists' => $exists,
		'directory' => $exists && is_dir($full),
		'writable' => $exists && is_writable($full),
		'mode' => $exists ? substr(sprintf('%o', fileperms($full)), -4) : null,
		'owner' => $owner,
	];
}
$ini = [];
foreach (['memory_limit', 'date.timezone', 'display_errors', 'opcache.enable_cli'] as $key) {
	$ini[$key] = (string) ini_get($key);
}
echo json_encode([
	'version' => PHP_VERSION,
	'binary' => PHP_BINARY,
	'user' => function_exists('posix_geteuid') ? (posix_getpwuid(posix_geteuid())['name'] ?? '') : (string) getenv('USER'),
	'extensions' => array_map('strtolower', get_loaded_extensions()),
	'ini' => $ini,
	'paths' => $paths,
]);
`;

/** Every path the probe reports on, relative to the project root. */
const PROBED_PATHS = [
	'.tempest',
	'.tempest/cache',
	'.tempest/logs',
	'.tempest/sessions',
	'.env',
	'.env.example',
	'composer.json',
	'composer.lock',
	'vendor/autoload.php',
	'public/index.php',
];

interface PathReport {
	readonly exists: boolean;
	readonly directory: boolean;
	readonly writable: boolean;
	readonly mode: string | null;
	readonly owner: string | null;
}

interface Probe {
	readonly version: string;
	readonly binary: string;
	readonly user: string;
	readonly extensions: readonly string[];
	readonly ini: Record<string, string>;
	readonly paths: Record<string, PathReport>;
}

interface Requirements {
	readonly php: string;
	readonly extensions: readonly string[];
	/** False when the framework's manifest could not be read. */
	readonly measured: boolean;
}

export class HealthReader {
	constructor(
		private readonly cli: CliRunner,
		private readonly data: DataSources,
		private readonly log: vscode.LogOutputChannel,
	) {}

	async read(project: TempestProject, token?: vscode.CancellationToken): Promise<HealthReport> {
		const [requirements, about, env, example] = await Promise.all([
			readRequirements(project),
			this.data.about(project, token),
			readEnv(project, '.env'),
			readEnv(project, '.env.example'),
		]);

		// The database path is configuration, not a constant — a SQLite file can
		// live anywhere — so the probe cannot be started until the application has
		// said where it is. `about` is cached, so this costs one boot per refresh
		// rather than one per check.
		const database = aboutValue(about, 'database', 'path');
		const probe = await this.probe(
			project,
			database && !PROBED_PATHS.includes(database) ? [database] : [],
			token,
		);

		const checks: HealthCheck[] = [];

		if (!probe) {
			// Without the probe there is exactly one thing worth saying, and it is
			// not a list of unknowns.
			return {
				checks: [
					{
						id: 'php',
						group: GROUP_REQUIREMENTS,
						label: 'PHP',
						status: 'error',
						detail: 'The configured PHP executable could not be run.',
						advice:
							'Every check here asks PHP a question, so none of them could be answered. Set "tempest.phpPath" to the full path of your PHP executable.',
						fix: { label: 'Open the setting', kind: 'setting', value: 'tempest.phpPath' },
					},
				],
				errors: 1,
				warnings: 0,
				note: 'PHP could not be reached; nothing else could be measured.',
			};
		}

		checks.push(
			...requirementChecks(probe, requirements),
			...environmentChecks(project, probe, about, env, example),
			...storageChecks(probe),
			...cacheChecks(about, env),
			...databaseChecks(probe, about),
		);

		const errors = checks.filter((check) => check.status === 'error').length;
		const warnings = checks.filter((check) => check.status === 'warning').length;

		this.log.info(
			`Health: ${checks.length} check(s) on ${project.name} — ${errors} error(s), ${warnings} warning(s).`,
		);

		return {
			checks,
			errors,
			warnings,
			note: about ? undefined : 'The application could not boot, so cache and database state is unknown.',
		};
	}

	private async probe(
		project: TempestProject,
		extra: readonly string[],
		token?: vscode.CancellationToken,
	): Promise<Probe | undefined> {
		try {
			const { stdout } = await this.cli.php(project, ['-r', PROBE, ...PROBED_PATHS, ...extra], token);

			return JSON.parse(stdout) as Probe;
		} catch (error) {
			this.log.warn(`Could not probe PHP: ${error instanceof Error ? error.message : String(error)}`);

			return undefined;
		}
	}
}

// Requirements ---------------------------------------------------------------

function requirementChecks(probe: Probe, requirements: Requirements): HealthCheck[] {
	const checks: HealthCheck[] = [];
	const satisfied = compareVersions(probe.version, requirements.php) >= 0;

	checks.push({
		id: 'php-version',
		group: GROUP_REQUIREMENTS,
		label: 'PHP version',
		status: satisfied ? 'ok' : 'error',
		detail: `${probe.version} at ${probe.binary}${requirements.measured ? '' : ' (requirement assumed: the framework is not installed)'}`,
		advice: satisfied
			? undefined
			: `tempest/framework needs PHP ${requirements.php} or newer. If a newer PHP is installed alongside this one, point "tempest.phpPath" at it.`,
		fix: satisfied ? undefined : { label: 'Open the setting', kind: 'setting', value: 'tempest.phpPath' },
	});

	const missing = requirements.extensions.filter((name) => !probe.extensions.includes(name));

	checks.push({
		id: 'php-extensions',
		group: GROUP_REQUIREMENTS,
		label: 'PHP extensions',
		status: missing.length === 0 ? 'ok' : 'error',
		detail:
			missing.length === 0
				? `All ${requirements.extensions.length} required extensions are loaded.`
				: `Missing: ${missing.join(', ')}.`,
		advice:
			missing.length === 0
				? undefined
				: 'Install them and restart PHP. On Debian and Ubuntu each one is its own package.',
		fix:
			missing.length === 0
				? undefined
				: {
						label: 'Copy the install command',
						kind: 'copy',
						value: `sudo apt install ${missing.map((name) => `php-${name}`).join(' ')}`,
					},
	});

	const limit = memoryMb(probe.ini.memory_limit);

	checks.push({
		id: 'php-memory',
		group: GROUP_REQUIREMENTS,
		label: 'Memory limit',
		status: limit === undefined || limit >= MINIMUM_MEMORY_MB ? 'ok' : 'warning',
		detail: probe.ini.memory_limit === '-1' ? 'Unlimited' : (probe.ini.memory_limit || 'unknown'),
		advice:
			limit !== undefined && limit < MINIMUM_MEMORY_MB
				? `Discovery walks the whole project and its dependencies. Under ${MINIMUM_MEMORY_MB}M it tends to be killed halfway, which looks like a hang rather than an error.`
				: undefined,
	});

	const vendor = probe.paths['vendor/autoload.php'];
	const lock = probe.paths['composer.lock'];

	checks.push({
		id: 'composer',
		group: GROUP_REQUIREMENTS,
		label: 'Dependencies',
		status: vendor?.exists ? 'ok' : 'error',
		detail: vendor?.exists
			? lock?.exists
				? 'vendor/ is installed and composer.lock is present.'
				: 'vendor/ is installed, but there is no composer.lock.'
			: 'vendor/autoload.php is missing.',
		advice: vendor?.exists
			? undefined
			: 'The console loads its autoloader from vendor/, so nothing can run until dependencies are installed.',
		fix: vendor?.exists ? undefined : { label: 'Copy the command', kind: 'copy', value: 'composer install' },
	});

	return checks;
}

// Environment ----------------------------------------------------------------

function environmentChecks(
	project: TempestProject,
	probe: Probe,
	about: AboutReport | undefined,
	env: Map<string, string> | undefined,
	example: Map<string, string> | undefined,
): HealthCheck[] {
	const checks: HealthCheck[] = [];
	const environment = aboutValue(about, 'environment', 'environment') ?? env?.get('ENVIRONMENT');
	const production = /^prod/i.test(environment ?? '');

	if (!env) {
		checks.push({
			id: 'env-file',
			group: GROUP_ENVIRONMENT,
			label: '.env',
			status: 'error',
			detail: 'No .env file in the project root.',
			advice:
				'Tempest reads its environment, its base URI and its signing key from .env. Start from the example and fill it in.',
			fix: probe.paths['.env.example']?.exists
				? { label: 'Copy the command', kind: 'copy', value: 'cp .env.example .env' }
				: undefined,
		});

		return checks;
	}

	checks.push({
		id: 'environment',
		group: GROUP_ENVIRONMENT,
		label: 'Environment',
		status: 'ok',
		detail: environment ?? 'not set (Tempest will assume local)',
	});

	const key = env.get('SIGNING_KEY');

	checks.push({
		id: 'signing-key',
		group: GROUP_ENVIRONMENT,
		label: 'Signing key',
		status: key ? 'ok' : 'error',
		detail: key ? 'Set.' : 'SIGNING_KEY is missing or empty.',
		advice: key
			? undefined
			: 'Sessions, signed URIs and anything else that has to survive a round trip depend on it. It is generated once per installation and never committed.',
		fix: key ? undefined : { label: 'Run key:generate', kind: 'command', value: 'key:generate' },
	});

	// A key present in the example and absent from `.env` is the shape of every
	// "works on my machine": the setting was added by someone else and arrived
	// through git in the example only.
	const drifted = example
		? [...example.keys()].filter((name) => !env.has(name))
		: [];

	checks.push({
		id: 'env-drift',
		group: GROUP_ENVIRONMENT,
		label: '.env against .env.example',
		status: drifted.length === 0 ? 'ok' : 'warning',
		detail:
			drifted.length === 0
				? example
					? 'Every key in the example is present.'
					: 'No .env.example to compare against.'
				: `Missing from .env: ${drifted.join(', ')}.`,
		advice:
			drifted.length === 0
				? undefined
				: 'These keys were added to the example but never to your .env, so the application falls back to whatever the framework defaults to.',
		fix:
			drifted.length === 0
				? undefined
				: { label: 'Open .env', kind: 'file', value: vscode.Uri.joinPath(project.root, '.env').fsPath },
	});

	if (production) {
		const displaying = /^(1|on|true)$/i.test(probe.ini.display_errors ?? '');

		checks.push({
			id: 'display-errors',
			group: GROUP_ENVIRONMENT,
			label: 'Error display',
			status: displaying ? 'error' : 'ok',
			detail: displaying ? 'display_errors is on, in a production environment.' : 'display_errors is off.',
			advice: displaying
				? 'A stack trace served to a visitor leaks paths, queries and configuration. Turn it off in php.ini and log instead.'
				: undefined,
		});
	}

	if (!probe.ini['date.timezone']) {
		checks.push({
			id: 'timezone',
			group: GROUP_ENVIRONMENT,
			label: 'Timezone',
			status: 'warning',
			detail: 'date.timezone is not set in php.ini.',
			advice:
				'PHP falls back to UTC and warns in some configurations. Setting it explicitly keeps dates stored by the CLI and by the web server in agreement.',
		});
	}

	return checks;
}

// Storage --------------------------------------------------------------------

/**
 * The `.tempest/` directory — the single most common way a Tempest project
 * refuses to boot, and the reason this tab exists.
 *
 * Two different failures hide behind the same error. The first is simple: the
 * directory is not writable at all. The second is the one that confuses people,
 * because everything works from the terminal and nothing works in the browser —
 * the CLI runs as you, PHP-FPM runs as `www-data`, and the directory belongs to
 * whoever created it first. That one cannot be detected from here (we can only
 * ask about our own user), so it is reported as what it is: a risk, with the
 * ownership on screen so the user can judge it.
 */
function storageChecks(probe: Probe): HealthCheck[] {
	const root = probe.paths['.tempest'];

	if (!root?.exists) {
		return [
			{
				id: 'internal-storage',
				group: GROUP_STORAGE,
				label: 'Internal storage',
				status: 'warning',
				detail: '.tempest/ does not exist yet.',
				advice:
					'Tempest creates it on the first run, for caches, logs, sessions and — in a default install — the SQLite database. If creating it fails, the project root is not writable.',
				fix: { label: 'Run discovery:generate', kind: 'command', value: 'discovery:generate' },
			},
		];
	}

	const checks: HealthCheck[] = [];
	const unwritable = PROBED_PATHS.filter(
		(path) => path.startsWith('.tempest') && probe.paths[path]?.exists && !probe.paths[path].writable,
	);

	checks.push({
		id: 'internal-storage',
		group: GROUP_STORAGE,
		label: 'Internal storage',
		status: unwritable.length === 0 ? 'ok' : 'error',
		detail:
			unwritable.length === 0
				? `.tempest/ is writable by ${probe.user || 'the current user'} (${root.owner ?? 'unknown owner'}, mode ${root.mode ?? '?'}).`
				: `Not writable: ${unwritable.join(', ')}.`,
		advice:
			unwritable.length === 0
				? undefined
				: 'This is what CouldNotRegisterInternalStorage reports. Give the directory back to your user, or to the group your web server runs as.',
		fix:
			unwritable.length === 0
				? undefined
				: {
						label: 'Copy the fix',
						kind: 'copy',
						value: `sudo chown -R ${probe.user || '"$USER"'} .tempest && chmod -R u+rwX .tempest`,
					},
	});

	// Group-writable is what lets the CLI and the web server share the directory.
	// Without it they only coexist while they happen to be the same user.
	// The group digit is always the second from the end, in `0755` as in `2775`.
	const shared = root.mode ? Number.parseInt(root.mode.slice(-2, -1), 10) >= 6 : false;

	// Only when the directory is otherwise fine: the check above already tells
	// someone whose own user cannot write it what to do, and a second permissions
	// warning underneath it is noise.
	if (unwritable.length === 0 && root.writable && !shared) {
		checks.push({
			id: 'internal-storage-sharing',
			group: GROUP_STORAGE,
			label: 'Internal storage sharing',
			status: 'warning',
			detail: `.tempest/ is mode ${root.mode ?? '?'}, owned by ${root.owner ?? 'unknown'} — writable by its owner only.`,
			advice:
				'Your CLI can write it; a web server running as another user (www-data, http, _www) cannot, and will fail with CouldNotRegisterInternalStorage the first time a page is served. Making it group-writable, with the setgid bit so new files inherit the group, fixes both at once.',
			fix: {
				label: 'Copy the fix',
				kind: 'copy',
				value: 'sudo chgrp -R www-data .tempest && sudo chmod -R g+rwX .tempest && sudo chmod g+s .tempest',
			},
		});
	}

	const entry = probe.paths['public/index.php'];

	checks.push({
		id: 'public',
		group: GROUP_STORAGE,
		label: 'Web root',
		status: entry?.exists ? 'ok' : 'warning',
		detail: entry?.exists ? 'public/index.php is in place.' : 'There is no public/index.php.',
		advice: entry?.exists
			? undefined
			: 'Tempest serves from public/. Without that entry point the console still works, but nothing is reachable over HTTP.',
	});

	return checks;
}

// Caches ---------------------------------------------------------------------

function cacheChecks(about: AboutReport | undefined, env: Map<string, string> | undefined): HealthCheck[] {
	const discovery = aboutValue(about, 'internal_caches', 'discovery');
	const environment = aboutValue(about, 'environment', 'environment') ?? env?.get('ENVIRONMENT');
	const production = /^prod/i.test(environment ?? '');

	if (!discovery) {
		return [];
	}

	const checks: HealthCheck[] = [];

	// "Invalid" means the cache exists but no longer matches the code — the state
	// a branch switch leaves behind, and the one that hides a controller you can
	// see in the editor from the router that is supposed to serve it.
	if (/invalid/i.test(discovery)) {
		checks.push({
			id: 'discovery-cache',
			group: GROUP_CACHES,
			label: 'Discovery cache',
			status: 'warning',
			detail: 'Invalid — the cached discovery no longer matches the project.',
			advice:
				'Until it is rebuilt, routes, commands and view components can be served from a picture of the code as it used to be.',
			fix: { label: 'Rebuild it', kind: 'command', value: 'discovery:generate' },
		});
	} else if (production && /disabled/i.test(discovery)) {
		checks.push({
			id: 'discovery-cache',
			group: GROUP_CACHES,
			label: 'Discovery cache',
			status: 'warning',
			detail: 'Disabled, in a production environment.',
			advice:
				'Every request then re-scans the project. Enable it with DISCOVERY_CACHE=true and generate it as part of your deploy.',
			fix: { label: 'Generate it', kind: 'command', value: 'discovery:generate' },
		});
	} else {
		checks.push({
			id: 'discovery-cache',
			group: GROUP_CACHES,
			label: 'Discovery cache',
			status: 'ok',
			detail: discovery,
			advice: /enabled/i.test(discovery)
				? 'Fully enabled in development means newly written classes are not discovered until it is cleared.'
				: undefined,
			fix: /enabled/i.test(discovery)
				? { label: 'Clear it', kind: 'command', value: 'discovery:clear' }
				: undefined,
		});
	}

	for (const [key, label] of [
		['configuration', 'Configuration cache'],
		['view', 'View cache'],
	] as const) {
		const value = aboutValue(about, 'internal_caches', key);

		if (!value) {
			continue;
		}

		const off = /disabled/i.test(value);

		checks.push({
			id: `cache-${key}`,
			group: GROUP_CACHES,
			label,
			status: production && off ? 'warning' : 'ok',
			detail: value,
			advice:
				production && off
					? 'Left off in production, this is recomputed on every request for no benefit.'
					: undefined,
		});
	}

	return checks;
}

// Database -------------------------------------------------------------------

function databaseChecks(probe: Probe, about: AboutReport | undefined): HealthCheck[] {
	const engine = aboutValue(about, 'database', 'engine');

	if (!engine) {
		return [];
	}

	const checks: HealthCheck[] = [];
	const version = aboutValue(about, 'database', 'version');
	const driver = `pdo_${engine.toLowerCase().replace('postgresql', 'pgsql')}`;
	const loaded = probe.extensions.includes(driver);

	checks.push({
		id: 'database-driver',
		group: GROUP_DATABASE,
		label: 'Database driver',
		status: loaded ? 'ok' : 'error',
		detail: loaded
			? `${engine} ${version ?? ''}`.trim() + ` — ${driver} is loaded.`
			: `${engine} is configured, but ${driver} is not loaded in this PHP.`,
		advice: loaded ? undefined : 'The connection cannot be opened without its PDO driver.',
		fix: loaded ? undefined : { label: 'Copy the install command', kind: 'copy', value: `sudo apt install php-${engine.toLowerCase()}` },
	});

	// SQLite is the default install, and its whole database is one file in a
	// directory whose permissions are already suspect. Worth its own line.
	const path = aboutValue(about, 'database', 'path');

	if (/sqlite/i.test(engine) && path) {
		const file = probe.paths[path];

		checks.push({
			id: 'database-file',
			group: GROUP_DATABASE,
			label: 'Database file',
			status: file?.exists && file.writable ? 'ok' : 'warning',
			detail: file?.exists
				? file.writable
					? `${path} is writable.`
					: `${path} exists but is not writable.`
				: `${path} does not exist yet.`,
			advice: file?.exists
				? file.writable
					? undefined
					: 'Reads will work and every write will fail. Same ownership problem as the directory above.'
				: 'It is created by the first migration.',
			fix: file?.exists
				? undefined
				: { label: 'Run migrate:up', kind: 'command', value: 'migrate:up' },
		});
	}

	return checks;
}

// Sources --------------------------------------------------------------------

/**
 * What the installed framework asks for, read from its own manifest.
 *
 * Hardcoding "Tempest needs PHP 8.5 and ext-intl" would be a version assumption
 * with a shelf life; the manifest sitting in `vendor/` is the requirement this
 * project actually has.
 */
async function readRequirements(project: TempestProject): Promise<Requirements> {
	try {
		const manifest = vscode.Uri.joinPath(project.root, 'vendor/tempest/framework/composer.json');
		const raw = await vscode.workspace.fs.readFile(manifest);
		const parsed = JSON.parse(new TextDecoder().decode(raw)) as {
			require?: Record<string, string>;
		};

		const require = parsed.require ?? {};
		const extensions = Object.keys(require)
			.filter((name) => name.startsWith('ext-'))
			.map((name) => name.slice(4));

		const php = /(\d+\.\d+(?:\.\d+)?)/.exec(require.php ?? '')?.[1];

		if (!php || extensions.length === 0) {
			return { ...FALLBACK_REQUIREMENTS, measured: false };
		}

		return { php, extensions, measured: true };
	} catch {
		return { ...FALLBACK_REQUIREMENTS, measured: false };
	}
}

/** Keys of a dotenv file; values are only read for the few checks that need one. */
async function readEnv(project: TempestProject, name: string): Promise<Map<string, string> | undefined> {
	try {
		const raw = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(project.root, name));
		const values = new Map<string, string>();

		for (const line of new TextDecoder().decode(raw).split(/\r?\n/)) {
			const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line.trim());

			if (match) {
				values.set(match[1], match[2].trim().replace(/^["']|["']$/g, ''));
			}
		}

		return values;
	} catch {
		return undefined;
	}
}

// Helpers --------------------------------------------------------------------

/** `-1`, `512M`, `1G` and plain byte counts, in megabytes. */
function memoryMb(value: string | undefined): number | undefined {
	if (!value || value === '-1') {
		return undefined;
	}

	const match = /^(\d+)\s*([kmg])?$/i.exec(value.trim());

	if (!match) {
		return undefined;
	}

	const size = Number(match[1]);

	switch (match[2]?.toLowerCase()) {
		case 'g':
			return size * 1024;
		case 'm':
			return size;
		case 'k':
			return size / 1024;
		default:
			return size / (1024 * 1024);
	}
}

/** Numeric comparison, so 8.10 sorts after 8.9 — which a string compare does not. */
function compareVersions(left: string, right: string): number {
	const a = left.split(/[.-]/).map(Number);
	const b = right.split(/[.-]/).map(Number);

	for (let index = 0; index < Math.max(a.length, b.length); index++) {
		const difference = (a[index] || 0) - (b[index] || 0);

		if (difference !== 0) {
			return difference;
		}
	}

	return 0;
}
