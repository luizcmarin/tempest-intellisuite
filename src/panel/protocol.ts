/**
 * The contract between the extension host and the panel webview.
 *
 * The webview never touches disk, spawns a process or runs a console command —
 * it renders what it is given and reports what the user clicked. Everything else
 * happens on the host side. Keeping that boundary explicit is what lets the
 * content security policy stay strict.
 */

import type { HealthFix, HealthReport } from '../core/health';

export type { HealthCheck, HealthFix, HealthReport, HealthStatus } from '../core/health';

/** Which top-level tab the panel is showing. */
export type Tab = 'routes' | 'lens' | 'commands' | 'health';

/** Host → webview. */
export type ToPanel =
	| { readonly type: 'state'; readonly state: PanelState }
	| { readonly type: 'loading'; readonly loading: boolean }
	| { readonly type: 'select'; readonly tab: Tab }
	| { readonly type: 'health'; readonly report: HealthReport }
	/** Scanning is lazy, so the tab says so instead of looking empty. */
	| { readonly type: 'todos-loading' }
	| { readonly type: 'todos'; readonly todos: readonly TodoView[] }
	/** The editor's current colour theme, so the button can offer the other one. */
	| { readonly type: 'theme'; readonly dark: boolean }
	| { readonly type: 'lens-reset' }
	| { readonly type: 'lens-status'; readonly status: string; readonly collecting?: boolean }
	| {
			readonly type: 'lens-append';
			readonly dumps: readonly unknown[];
			readonly lines: readonly unknown[];
			readonly queries: readonly unknown[];
			readonly requests: readonly unknown[];
	  };

/** Webview → host. */
export type FromPanel =
	| { readonly type: 'ready' }
	| { readonly type: 'refresh' }
	| { readonly type: 'openRoute'; readonly uri: string; readonly method: string }
	| { readonly type: 'runCommand'; readonly command: string }
	| { readonly type: 'clearDiscoveryCache' }
	| { readonly type: 'openSettings' }
	| { readonly type: 'selectProject'; readonly id: string }
	| { readonly type: 'toggleTheme' }
	| { readonly type: 'lens-clear' }
	| { readonly type: 'openDump'; readonly file?: string; readonly line?: number }
	| { readonly type: 'installCollectors' }
	/** Sent the first time the Todos sub-tab is shown; the scan is not free. */
	| { readonly type: 'loadTodos' }
	| { readonly type: 'openTodo'; readonly file: string; readonly line: number }
	| { readonly type: 'healthFix'; readonly kind: HealthFix['kind']; readonly value: string };

export interface PanelState {
	/** Display name of the active project; empty when none was detected. */
	readonly project: string;
	/** Every detected project, so the header can offer a picker. */
	readonly projects: readonly ProjectChoice[];
	readonly activeProject?: string;
	readonly about?: AboutSummary;
	readonly routes?: readonly RouteView[];
	readonly commands?: readonly CommandView[];
	/** Set when something could not be read, so the panel can say why. */
	readonly problems: readonly string[];
}

export interface ProjectChoice {
	readonly id: string;
	readonly name: string;
}

export interface AboutSummary {
	readonly tempestVersion?: string;
	readonly phpVersion?: string;
	readonly environment?: string;
	readonly database?: string;
	/** e.g. "Enabled (partial)" — the discovery cache state. */
	readonly discoveryCache?: string;
}

export interface RouteView {
	readonly method: string;
	readonly uri: string;
	readonly isDynamic: boolean;
	readonly middleware: readonly string[];
	/** Namespace of the handler, e.g. `App\Categories`; the routes are grouped by it. */
	readonly group: string;
	readonly handler?: string;
	/** False when the handler could not be resolved to a file on disk. */
	readonly openable: boolean;
}

export interface TodoView {
	readonly file: string;
	readonly relative: string;
	readonly line: number;
	readonly tag: string;
	readonly text: string;
}

export interface CommandView {
	readonly name: string;
	readonly group: string;
	readonly description?: string;
	readonly flags: readonly string[];
}
