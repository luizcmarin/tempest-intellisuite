/**
 * Parses the application log.
 *
 * Tempest writes Monolog-style lines:
 *
 *     [2026-07-18T19:27:30.276297+00:00] local.INFO: a message [] []
 *     [2026-07-18T19:27:30.277856+00:00] local.ERROR: it broke {"where":"…"} []
 *
 * The file rotates daily (`tempest-YYYY-MM-DD.log`), which is why the watcher
 * follows the directory rather than a fixed name.
 */

export type LogLevel =
	| 'DEBUG'
	| 'INFO'
	| 'NOTICE'
	| 'WARNING'
	| 'ERROR'
	| 'CRITICAL'
	| 'ALERT'
	| 'EMERGENCY';

export interface LogLine {
	readonly timestamp: string;
	readonly channel: string;
	readonly level: LogLevel;
	readonly message: string;
	/** Structured context, when the line carried any. */
	readonly context?: string;
}

/** Levels that deserve interrupting the user. */
const ALARMING: ReadonlySet<string> = new Set(['ERROR', 'CRITICAL', 'ALERT', 'EMERGENCY']);

const LINE = /^\[([^\]]+)\]\s+([\w-]+)\.([A-Z]+):\s+([^]*)$/;

export function parseLogLines(raw: string): LogLine[] {
	const lines: LogLine[] = [];

	for (const line of raw.split('\n')) {
		const match = LINE.exec(line.trim());

		if (!match) {
			// Continuation of a multi-line message (a stack trace, typically). It is
			// attached to the entry above rather than dropped.
			const previous = lines.at(-1);

			if (previous && line.trim() !== '') {
				lines[lines.length - 1] = { ...previous, message: `${previous.message}\n${line}` };
			}

			continue;
		}

		const [, timestamp, channel, level, remainder] = match;
		const { message, context } = splitContext(remainder);

		lines.push({ timestamp, channel, level: level as LogLevel, message, context });
	}

	return lines;
}

export function isAlarming(line: LogLine): boolean {
	return ALARMING.has(line.level);
}

/**
 * Separates the message from Monolog's trailing `{context} {extra}` pair.
 *
 * Both are always present, and both are usually the empty `[]`, so they are
 * dropped unless they actually carry something.
 */
function splitContext(remainder: string): { message: string; context?: string } {
	const trailing = /\s+(\[\]|\{.*\})\s+(\[\]|\{.*\})\s*$/.exec(remainder);

	if (!trailing) {
		return { message: remainder.trim() };
	}

	const parts = [trailing[1], trailing[2]].filter((part) => part !== '[]' && part !== '{}');

	return {
		message: remainder.slice(0, trailing.index).trim(),
		context: parts.length > 0 ? parts.join(' ') : undefined,
	};
}
