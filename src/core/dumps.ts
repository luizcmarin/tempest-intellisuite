/**
 * Parses Tempest's debug log into individual dumps.
 *
 * The framework writes each dump as a terminal-styled block: a blue-background
 * key, an arrow, the call site in italics, then the dump body. Recovering the
 * call site is what makes a dump useful in an editor — it turns "someone dumped
 * an array" into a line you can jump to.
 *
 * Format, with escapes spelled out:
 *
 *     ESC[104m 0 ESC[0m ESC[90m → ESC[3m/path/File.php:18 ESC[23m ESC[0m <body…>
 *
 * Parsing terminal output is normally a smell, but here it is the only
 * representation that exists — the log has no structured counterpart, and no
 * amount of upstream work would change that this is a human-facing log file.
 */

export interface Dump {
	/** Index the framework assigned within a single dump call. */
	readonly key: string;
	/** Absolute path of the file the dump was called from. */
	readonly file?: string;
	/** One-based line the dump was called from. */
	readonly line?: number;
	/** The dumped value, with terminal styling removed. */
	readonly body: string;
}

/** Every dump entry starts with the blue-background key. */
const ENTRY_START = '[104m';

const ANSI = /\[[0-9;]*m/g;

/** ` 0 ` then the arrow, then the italic call site. */
const HEADER = /^\s*(\S+)\s*\[0m.*?→\s*\[3m([^]+)\[23m/;

/** Trailing `:18` on the call site. */
const CALL_SITE = /^(.*):(\d+)$/;

export function parseDumps(raw: string): Dump[] {
	const dumps: Dump[] = [];

	for (const block of raw.split(ENTRY_START).slice(1)) {
		const header = HEADER.exec(block);

		if (!header) {
			// An entry we do not recognise is skipped rather than shown raw: a
			// half-parsed dump is worse than a missing one, and the format may
			// legitimately change between framework versions.
			continue;
		}

		const [matched, key, callPath] = header;
		const site = CALL_SITE.exec(callPath.trim());

		dumps.push({
			key,
			file: site?.[1],
			line: site ? Number(site[2]) : undefined,
			body: block.slice(matched.length).replace(ANSI, '').replace(/^\s*\n/, '').trimEnd(),
		});
	}

	return dumps;
}

/**
 * Splits a partial read into what is safe to parse and what must wait.
 *
 * A watcher can fire while the framework is mid-write, so a chunk can end
 * halfway through an entry. The framework writes each dump as a header followed
 * by a body terminated with a newline, so "ends with a newline" is the signal
 * that nothing is half-written.
 *
 * Holding back the last entry unconditionally would be the obvious
 * implementation and is wrong: a single `dump()` would sit in the buffer
 * forever, invisible until something else happened to be dumped.
 */
export function splitPending(raw: string): { complete: string; pending: string } {
	if (raw === '' || raw.endsWith('\n')) {
		return { complete: raw, pending: '' };
	}

	const lastBreak = raw.lastIndexOf('\n');

	if (lastBreak === -1) {
		return { complete: '', pending: raw };
	}

	return { complete: raw.slice(0, lastBreak + 1), pending: raw.slice(lastBreak + 1) };
}
