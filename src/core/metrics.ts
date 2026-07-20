/**
 * Query and request measurements collected inside the project.
 *
 * Unlike dumps and logs, these do not exist unless the user opts in: the
 * framework emits `QueryExecuted` as an in-memory event and has no
 * request-lifecycle event at all, so two small PHP files have to live in the
 * project to write them down. The Lens installs them only when asked, and they
 * append JSON Lines, which is the one format that survives being written by
 * several processes and read halfway through.
 */

export interface QueryRecord {
	readonly at: string;
	readonly sql: string;
	readonly bindings: readonly unknown[];
	readonly durationMs: number;
	readonly type: string;
	readonly failed: boolean;
	readonly slow: boolean;
	readonly connection: string | null;
	/** Set when the same statement ran several times in one burst. */
	repeated?: number;
}

export interface RequestRecord {
	readonly at: string;
	readonly method: string;
	readonly uri: string;
	readonly status: number;
	readonly durationMs: number;
	readonly memoryMb: number;
}

/**
 * Parses JSON Lines, skipping anything malformed.
 *
 * A truncated final line is normal — the collector may be mid-write — and is
 * silently dropped rather than reported, because the next read will pick it up
 * complete.
 */
export function parseJsonLines<T>(raw: string): T[] {
	const records: T[] = [];

	for (const line of raw.split('\n')) {
		const trimmed = line.trim();

		if (trimmed === '') {
			continue;
		}

		try {
			records.push(JSON.parse(trimmed) as T);
		} catch {
			// Half-written line; it will arrive whole on the next read.
		}
	}

	return records;
}

/**
 * Flags statements that ran more than once, which is what an N+1 looks like
 * from the outside.
 *
 * Bindings are deliberately ignored when comparing: `select * from posts where
 * id = ?` run two hundred times with two hundred different ids is precisely the
 * problem worth reporting, and comparing the filled-in values would hide it.
 */
export function markRepeats(queries: readonly QueryRecord[]): QueryRecord[] {
	const counts = new Map<string, number>();

	for (const query of queries) {
		const key = normalise(query.sql);

		counts.set(key, (counts.get(key) ?? 0) + 1);
	}

	return queries.map((query) => {
		const repeated = counts.get(normalise(query.sql)) ?? 1;

		return repeated > 1 ? { ...query, repeated } : query;
	});
}

/** Totals for the header, so a slow page is obvious without reading every row. */
export function summarise(queries: readonly QueryRecord[]): {
	count: number;
	totalMs: number;
	slow: number;
	repeated: number;
	failed: number;
} {
	const marked = markRepeats(queries);

	return {
		count: marked.length,
		totalMs: Math.round(marked.reduce((total, query) => total + query.durationMs, 0) * 100) / 100,
		slow: marked.filter((query) => query.slow).length,
		repeated: marked.filter((query) => (query.repeated ?? 1) > 1).length,
		failed: marked.filter((query) => query.failed).length,
	};
}

function normalise(sql: string): string {
	return sql.replace(/\s+/g, ' ').trim().toLowerCase();
}
