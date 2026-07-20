import * as vscode from 'vscode';
import { CliRunner } from './cli';
import type { TempestProject } from './project';

/**
 * Reads the project's registered routes.
 *
 * This is the one place in the extension that parses console output, and it
 * exists for a single reason: `routes --json` returns `"handler": {}` — an empty
 * object — so the controller behind a route is missing from the structured
 * source. The tabular output does show it.
 *
 * So we take the data from JSON and the handler from text, and keep the text
 * parsing narrow: if it fails, routes still render, just without a link to the
 * code. Tracked upstream as U-001; when that lands, `parseHandlers` and its
 * caller can be deleted outright.
 */

export interface Route {
	readonly method: string;
	readonly uri: string;
	readonly isDynamic: boolean;
	readonly middleware: readonly string[];
	/** Fully-qualified class of the controller, when it could be recovered. */
	readonly handlerClass?: string;
	/** Method on the controller, when it could be recovered. */
	readonly handlerMethod?: string;
}

/** Shape of one entry in `routes --json`, keyed by `"{uri}:{METHOD}"`. */
interface RouteJson {
	readonly uri: string;
	readonly method: string;
	readonly isDynamic: boolean;
	readonly middleware: readonly string[];
}

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

/**
 * `     GET / ... App\HomeController::__invoke()`
 *
 * Written to tolerate the console's padding and its dotted leader, and to accept
 * a missing handler rather than reject the line.
 */
const TABULAR_ROUTE = new RegExp(
	String.raw`^\s*(${HTTP_METHODS.join('|')})\s+(\S+)\s+\.{2,}\s+([\w\\]+)::(\w+)\(\)`,
);

const ANSI = /\[[0-9;]*m/g;

export class RouteReader {
	constructor(
		private readonly cli: CliRunner,
		private readonly log: vscode.LogOutputChannel,
	) {}

	async read(project: TempestProject, token?: vscode.CancellationToken): Promise<Route[] | undefined> {
		let json: Record<string, RouteJson>;

		try {
			json = await this.cli.json<Record<string, RouteJson>>(project, ['routes', '--json'], token);
		} catch (error) {
			this.log.warn(`Could not read routes: ${error instanceof Error ? error.message : String(error)}`);

			return undefined;
		}

		const handlers = await this.readHandlers(project, token);

		return Object.entries(json).map(([key, route]) => ({
			method: route.method,
			uri: route.uri,
			isDynamic: route.isDynamic,
			middleware: route.middleware ?? [],
			...handlers.get(key),
		}));
	}

	/**
	 * Handlers by `"{uri}:{METHOD}"`, matching the keys of the JSON output.
	 *
	 * A failure here is not worth reporting to the user: routes still work, they
	 * just are not clickable.
	 */
	private async readHandlers(
		project: TempestProject,
		token?: vscode.CancellationToken,
	): Promise<Map<string, { handlerClass: string; handlerMethod: string }>> {
		const handlers = new Map<string, { handlerClass: string; handlerMethod: string }>();

		try {
			const { stdout } = await this.cli.run(project, ['routes'], token);

			for (const line of stdout.split('\n')) {
				const match = TABULAR_ROUTE.exec(line.replace(ANSI, ''));

				if (!match) {
					continue;
				}

				const [, method, uri, handlerClass, handlerMethod] = match;

				handlers.set(`${uri}:${method}`, { handlerClass, handlerMethod });
			}

			this.log.debug(`Recovered ${handlers.size} route handler(s) from the tabular output.`);
		} catch (error) {
			this.log.debug(`Route handlers unavailable: ${error instanceof Error ? error.message : String(error)}`);
		}

		return handlers;
	}
}
