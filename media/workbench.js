/*
 * Workbench webview.
 *
 * Renders whatever state the host sends and reports what the user clicked. It
 * has no access to the file system, no process and no network — every DOM node
 * here is built with createElement/textContent rather than innerHTML, so project
 * data (route URIs, command descriptions, dumped values) can never be
 * interpreted as markup. That matters most in the Lens, which renders arbitrary
 * application output.
 */

// @ts-check
(function () {
	const vscode = acquireVsCodeApi();

	const elements = {
		summary: document.getElementById('summary'),
		problems: document.getElementById('problems'),
		refresh: document.getElementById('refresh'),
		theme: document.getElementById('theme'),

		tabBar: document.getElementById('tabs'),
		welcome: document.getElementById('welcome'),
		openSettings: document.getElementById('open-settings'),
		scanAgain: document.getElementById('scan-again'),
		browse: document.getElementById('browse'),
		browseTabs: document.getElementById('browse-tabs'),
		filter: /** @type {HTMLInputElement} */ (document.getElementById('filter')),
		routes: document.getElementById('panel-routes'),
		todos: document.getElementById('panel-todos'),
		commands: document.getElementById('panel-commands'),
		countTodos: document.getElementById('count-todos'),

		health: document.getElementById('health'),
		healthScore: document.getElementById('health-score'),
		healthPanel: document.getElementById('panel-health'),
		healthBadge: document.getElementById('health-badge'),

		lens: document.getElementById('lens'),
		lensFilter: /** @type {HTMLInputElement} */ (document.getElementById('lens-filter')),
		follow: /** @type {HTMLInputElement} */ (document.getElementById('follow')),
		lensClear: document.getElementById('lens-clear'),
		status: document.getElementById('status'),
		dumps: document.getElementById('panel-dumps'),
		logs: document.getElementById('panel-logs'),
		queries: document.getElementById('panel-queries'),
		requests: document.getElementById('panel-requests'),
		countDumps: document.getElementById('count-dumps'),
		countLogs: document.getElementById('count-logs'),
		countQueries: document.getElementById('count-queries'),
		countRequests: document.getElementById('count-requests'),

		tabs: Array.from(document.querySelectorAll('[data-tab]')),
		lensTabs: Array.from(document.querySelectorAll('[data-lens]')),
		browseSubTabs: Array.from(document.querySelectorAll('[data-browse]')),
	};

	/** Kept bounded: a long debugging session can produce thousands of entries. */
	const LIMIT = 500;

	let state = { routes: [], commands: [] };
	let todos = [];
	/** Undefined until the first scan answers; null while one is running. */
	let todosLoaded;
	let health;
	let dumps = [];
	let lines = [];
	let queries = [];
	let requests = [];
	let collecting = false;

	let tab = 'routes';
	let lensTab = 'dumps';
	let browseTab = 'routes';

	/**
	 * Why a render is happening, which decides where the view is left scrolled.
	 *
	 * `REREAD` is the user turning their attention to something — a tab, a
	 * filter — and a list you have just been shown is read from its first line.
	 * Following the tail is only right when new output arrives while you watch.
	 */
	const REREAD = 'reread';

	// Wiring ---------------------------------------------------------------

	elements.refresh.addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));
	elements.theme.addEventListener('click', () => vscode.postMessage({ type: 'toggleTheme' }));
	elements.lensClear.addEventListener('click', () => vscode.postMessage({ type: 'lens-clear' }));
	elements.openSettings.addEventListener('click', () => vscode.postMessage({ type: 'openSettings' }));
	elements.scanAgain.addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));
	// Wrapped rather than passed straight through: a handler receives the input
	// event as its first argument, and `render` reads its first argument.
	elements.filter.addEventListener('input', () => render(REREAD));
	elements.lensFilter.addEventListener('input', () => render(REREAD));

	for (const button of elements.tabs) {
		button.addEventListener('click', () => select(button.dataset.tab));
	}

	for (const button of elements.lensTabs) {
		button.addEventListener('click', () => selectLens(button.dataset.lens));
	}

	for (const button of elements.browseSubTabs) {
		button.addEventListener('click', () => selectBrowse(button.dataset.browse));
	}

	window.addEventListener('message', (event) => {
		const message = event.data;

		switch (message.type) {
			case 'loading':
				document.body.classList.toggle('loading', message.loading);

				return;

			case 'state':
				document.body.classList.remove('loading');
				apply(message.state);

				return;

			case 'select':
				select(message.tab);

				return;

			case 'theme':
				applyTheme(message.dark);

				return;

			case 'lens-reset':
				dumps = [];
				lines = [];
				queries = [];
				requests = [];
				render();

				return;

			case 'lens-status':
				elements.status.textContent = message.status;

				if (message.collecting !== undefined) {
					collecting = message.collecting;
				}

				render();

				return;

			case 'health':
				health = message.report;
				renderHealth();

				return;

			case 'todos-loading':
				todosLoaded = null;
				render(REREAD);

				return;

			case 'todos':
				todos = message.todos ?? [];
				todosLoaded = true;
				render(REREAD);

				return;

			case 'lens-append':
				dumps = dumps.concat(message.dumps ?? []).slice(-LIMIT);
				lines = lines.concat(message.lines ?? []).slice(-LIMIT);
				queries = queries.concat(message.queries ?? []).slice(-LIMIT);
				requests = requests.concat(message.requests ?? []).slice(-LIMIT);

				// A busy log fires this several times a second. The counters are
				// cheap and always visible once the Lens tab is open; rebuilding the
				// route list underneath it is neither.
				renderCounts();

				if (tab === 'lens') {
					render();
				}

				return;
		}
	});

	// Theme ----------------------------------------------------------------

	/*
	 * The button switches the editor's theme, not the panel's — the host owns the
	 * change and reports the result back, so the glyph can never drift from what
	 * the editor is actually wearing.
	 */
	function applyTheme(dark) {
		document.body.toggleAttribute('data-dark', dark);
		elements.theme.title = dark ? 'Switch to a light theme' : 'Switch to a dark theme';
	}

	// Tabs -----------------------------------------------------------------

	function select(next) {
		if (!next) {
			return;
		}

		tab = next;

		for (const button of elements.tabs) {
			button.setAttribute('aria-selected', String(button.dataset.tab === tab));
		}

		elements.browse.hidden = tab === 'lens' || tab === 'health';
		elements.lens.hidden = tab !== 'lens';
		elements.health.hidden = tab !== 'health';
		// The sub-tabs belong to Routes; Commands borrows the same container and
		// its filter, but has nothing to divide.
		elements.browseTabs.hidden = tab !== 'routes';
		elements.routes.hidden = tab !== 'routes' || browseTab !== 'routes';
		elements.todos.hidden = tab !== 'routes' || browseTab !== 'todos';
		elements.commands.hidden = tab !== 'commands';
		elements.filter.hidden = tab === 'health';
		elements.filter.placeholder = placeholder();

		if (tab === 'routes' && browseTab === 'todos') {
			requestTodos();
		}

		render(REREAD);
	}

	function selectBrowse(next) {
		if (!next) {
			return;
		}

		browseTab = next;

		for (const button of elements.browseSubTabs) {
			button.setAttribute('aria-selected', String(button.dataset.browse === browseTab));
		}

		select(tab);
	}

	function placeholder() {
		if (tab === 'commands') {
			return 'Filter commands…';
		}

		return browseTab === 'todos' ? 'Filter todos…' : 'Filter routes…';
	}

	/**
	 * A scan walks the whole project, so it is asked for rather than pushed —
	 * once, the first time the tab is looked at. The Refresh button is what
	 * repeats it.
	 */
	function requestTodos() {
		if (todosLoaded === undefined) {
			todosLoaded = null;
			vscode.postMessage({ type: 'loadTodos' });
		}
	}

	function selectLens(next) {
		if (!next) {
			return;
		}

		lensTab = next;

		for (const button of elements.lensTabs) {
			button.setAttribute('aria-selected', String(button.dataset.lens === lensTab));
		}

		elements.dumps.hidden = lensTab !== 'dumps';
		elements.logs.hidden = lensTab !== 'logs';
		elements.queries.hidden = lensTab !== 'queries';
		elements.requests.hidden = lensTab !== 'requests';

		render(REREAD);
	}

	// Rendering ------------------------------------------------------------

	function apply(next) {
		state = { routes: next.routes ?? [], commands: next.commands ?? [] };

		// No project means no routes, no commands and no log to watch: the tabs
		// would all be empty, so they give way to an explanation.
		const hasProject = Boolean(next.project);

		elements.welcome.hidden = hasProject;
		elements.tabBar.hidden = !hasProject;

		renderSummary(next);
		renderProblems(hasProject ? (next.problems ?? []) : []);

		if (hasProject) {
			select(tab);

			return;
		}

		elements.browse.hidden = true;
		elements.lens.hidden = true;
	}

	function renderSummary(next) {
		const about = next.about ?? {};
		const projects = next.projects ?? [];
		const pairs = [
			// A workspace holding several Tempest apps is normal, so "Project" is a
			// choice, not a label — but only when there is something to choose.
			['Project', projects.length > 1 ? projects : next.project],
			['Tempest', about.tempestVersion],
			['PHP', about.phpVersion],
			['Env', about.environment],
			['Database', about.database],
			['Discovery cache', about.discoveryCache],
		].filter(([, value]) => Boolean(value));

		elements.summary.replaceChildren(
			...pairs.map(([label, value]) => {
				const span = document.createElement('span');
				const name = document.createElement('span');

				name.textContent = `${label}:`;
				span.append(name, Array.isArray(value) ? projectPicker(value, next.activeProject) : strong(value));

				// The discovery cache silently serves stale code in development, so
				// the way to clear it hangs off the line that reports it — the header
				// button row is for the three actions that act on everything.
				if (label === 'Discovery cache' && /enabled/i.test(value)) {
					const clear = document.createElement('button');

					clear.type = 'button';
					clear.className = 'inline-action';
					clear.textContent = 'Clear';
					clear.title = 'Run discovery:clear in a terminal';
					clear.addEventListener('click', () =>
						vscode.postMessage({ type: 'clearDiscoveryCache' }),
					);

					span.appendChild(clear);
				}

				return span;
			}),
		);
	}

	/** The "Project" line as a picker, when the workspace holds more than one. */
	function projectPicker(projects, activeId) {
		const select = document.createElement('select');

		select.className = 'project-picker';
		select.title = 'Which project the panel is showing';

		for (const project of projects) {
			const option = document.createElement('option');

			option.value = project.id;
			option.textContent = project.name;
			option.selected = project.id === activeId;

			select.appendChild(option);
		}

		select.addEventListener('change', () =>
			vscode.postMessage({ type: 'selectProject', id: select.value }),
		);

		return select;
	}

	function renderProblems(problems) {
		elements.problems.hidden = problems.length === 0;

		elements.problems.replaceChildren(
			...problems.map((problem) => {
				const p = document.createElement('p');

				p.textContent = problem;

				return p;
			}),
		);
	}

	function renderCounts() {
		elements.countTodos.textContent = String(todos.length);
		elements.countDumps.textContent = String(dumps.length);
		elements.countLogs.textContent = String(lines.length);
		elements.countQueries.textContent = String(queries.length);
		elements.countRequests.textContent = String(requests.length);
	}

	function render(reason) {
		renderCounts();

		if (tab === 'health') {
			renderHealth();
			restore(reason);

			return;
		}

		if (tab === 'routes' && browseTab === 'todos') {
			renderTodos(
				filtered(todos, elements.filter, (todo) => [todo.text, todo.relative, todo.tag]),
			);

			restore(reason);

			return;
		}

		if (tab === 'routes') {
			renderRoutes(
				filtered(state.routes, elements.filter, (route) => [
					route.uri,
					route.method,
					route.handler,
					route.group,
				]),
			);

			// Routes and commands never follow a tail — there is no tail. They still
			// go back to the top when the user picks the tab or types a filter, which
			// is why this falls through to the scroll below rather than returning.
			restore(reason);

			return;
		}

		if (tab === 'commands') {
			renderCommands(
				filtered(state.commands, elements.filter, (command) => [command.name, command.description]),
			);

			restore(reason);

			return;
		}

		if (lensTab === 'queries') {
			renderQueries(filtered(queries, elements.lensFilter, (query) => [query.sql]));
		} else if (lensTab === 'requests') {
			renderRequests(filtered(requests, elements.lensFilter, (request) => [request.uri, request.method]));
		} else if (lensTab === 'dumps') {
			renderDumps(filtered(dumps, elements.lensFilter, (dump) => [dump.body, dump.file]));
		} else {
			renderLines(filtered(lines, elements.lensFilter, (line) => [line.message, line.level]));
		}

		restore(reason);
	}

	/**
	 * Leaves the view where the user can start reading.
	 *
	 * A list is read from its first line, so anything the user just asked to see
	 * — a tab, a filter — starts at the top. Following the tail is for output
	 * arriving while they watch, which is the only case where the end is the
	 * interesting end.
	 */
	function restore(reason) {
		if (reason === REREAD) {
			window.scrollTo(0, 0);
		} else if (tab === 'lens' && elements.follow.checked) {
			window.scrollTo(0, document.body.scrollHeight);
		}
	}

	function filtered(items, input, fields) {
		const needle = input.value.trim().toLowerCase();

		if (!needle) {
			return items;
		}

		return items.filter((item) =>
			fields(item).some((field) => (field ?? '').toLowerCase().includes(needle)),
		);
	}

	function renderRoutes(routes) {
		if (routes.length === 0) {
			elements.routes.replaceChildren(empty('No routes to show.'));

			return;
		}

		const nodes = [];
		let group = null;

		for (const route of routes) {
			// The list arrives sorted by group, so a heading is due whenever the
			// group changes. Filtering can empty a group entirely — building the
			// headings here, from what survived, means no heading is ever left
			// standing over nothing.
			if (route.group !== group) {
				group = route.group;

				const heading = document.createElement('div');

				// Not `.group`: that style upper-cases its text, which would print a
				// PHP namespace as APP\CATEGORIES — a name that does not exist.
				heading.className = 'group namespace';
				heading.textContent = group;
				nodes.push(heading);
			}

			nodes.push(routeRow(route));
		}

		elements.routes.replaceChildren(...nodes);
	}

	function routeRow(route) {
		const row = document.createElement('div');

		row.className = route.openable ? 'row clickable' : 'row';

		const method = document.createElement('span');

		method.className = `method method-${route.method}`;
		method.textContent = route.method;

		const uri = document.createElement('span');

		uri.className = 'uri';
		uri.textContent = route.uri;

		row.append(method, uri);

		if (route.isDynamic) {
			row.appendChild(badge('dynamic'));
		}

		if (route.middleware.length > 0) {
			row.appendChild(badge(`${route.middleware.length} middleware`));
		}

		if (route.handler) {
			const handler = document.createElement('span');

			handler.className = 'handler';
			// The namespace is already the heading above; repeating it on every row
			// pushes the part that differs off the edge of a 300px sidebar.
			handler.textContent = route.group === 'Unresolved'
				? route.handler
				: route.handler.slice(route.group.length + 1);
			handler.title = route.handler;
			row.appendChild(handler);
		}

		if (route.openable) {
			row.tabIndex = 0;
			row.title = 'Open the controller';

			const open = () =>
				vscode.postMessage({ type: 'openRoute', uri: route.uri, method: route.method });

			row.addEventListener('click', open);
			row.addEventListener('keydown', (event) => {
				if (event.key === 'Enter' || event.key === ' ') {
					event.preventDefault();
					open();
				}
			});
		}

		return row;
	}

	function renderCommands(commands) {
		if (commands.length === 0) {
			elements.commands.replaceChildren(empty('No commands to show.'));

			return;
		}

		const nodes = [];
		let group = null;

		for (const command of commands) {
			if (command.group !== group) {
				group = command.group;

				const heading = document.createElement('div');

				heading.className = 'group';
				heading.textContent = group;
				nodes.push(heading);
			}

			const row = document.createElement('div');

			row.className = 'row';

			const name = document.createElement('span');

			name.className = 'name';
			name.textContent = command.name;

			const run = document.createElement('button');

			run.className = 'run';
			run.type = 'button';
			run.textContent = 'Run';
			run.title = `Run ${command.name} in a terminal`;
			run.addEventListener('click', () =>
				vscode.postMessage({ type: 'runCommand', command: command.name }),
			);

			row.append(name, run);

			if (command.description) {
				const description = document.createElement('span');

				description.className = 'description';
				description.textContent = command.description;
				row.appendChild(description);
			}

			nodes.push(row);
		}

		elements.commands.replaceChildren(...nodes);
	}

	/**
	 * Queries, with the two things worth interrupting for called out: a statement
	 * that took too long, and one that ran many times — which is what an N+1 looks
	 * like from outside the ORM.
	 */
	function renderQueries(items) {
		if (items.length === 0) {
			elements.queries.replaceChildren(collecting ? empty('No queries captured yet.') : optIn());

			return;
		}

		const total = items.reduce((sum, query) => sum + query.durationMs, 0);
		const header = document.createElement('div');

		header.className = 'summary metrics';
		header.append(
			metric(`${items.length}`, 'queries'),
			metric(`${total.toFixed(1)} ms`, 'total'),
			metric(`${items.filter((q) => q.slow).length}`, 'slow'),
			metric(`${items.filter((q) => (q.repeated ?? 1) > 1).length}`, 'repeated'),
		);

		elements.queries.replaceChildren(
			header,
			...items.map((query) => {
				const entry = document.createElement('article');

				entry.className = 'entry';

				if (query.failed) {
					entry.classList.add('level-ERROR');
				} else if (query.slow) {
					entry.classList.add('level-WARNING');
				}

				const head = document.createElement('div');

				head.className = 'entry-head';

				const duration = document.createElement('span');

				duration.className = 'level';
				duration.textContent = `${query.durationMs.toFixed(2)} ms`;

				const type = document.createElement('span');

				type.textContent = query.type;

				head.append(duration, type);

				if (query.slow) {
					head.appendChild(badge('slow'));
				}

				if ((query.repeated ?? 1) > 1) {
					head.appendChild(badge(`ran ${query.repeated}× — possible N+1`));
				}

				if (query.failed) {
					head.appendChild(badge('failed'));
				}

				const body = document.createElement('pre');

				body.className = 'entry-body';
				body.textContent = query.sql;

				entry.append(head, body);

				if (query.bindings && query.bindings.length > 0) {
					const bindings = document.createElement('pre');

					bindings.className = 'entry-body bindings';
					bindings.textContent = JSON.stringify(query.bindings);
					entry.appendChild(bindings);
				}

				return entry;
			}),
		);
	}

	function renderRequests(items) {
		if (items.length === 0) {
			elements.requests.replaceChildren(collecting ? empty('No requests captured yet.') : optIn());

			return;
		}

		elements.requests.replaceChildren(
			...items.map((request) => {
				const row = document.createElement('div');

				row.className = 'row';

				const method = document.createElement('span');

				method.className = `method method-${request.method}`;
				method.textContent = request.method;

				const uri = document.createElement('span');

				uri.className = 'uri';
				uri.textContent = request.uri;

				const status = document.createElement('span');

				status.className = 'level';
				status.textContent = String(request.status);

				if (request.status >= 500) {
					row.classList.add('level-ERROR');
				} else if (request.status >= 400) {
					row.classList.add('level-WARNING');
				}

				const timing = document.createElement('span');

				timing.className = 'handler';
				timing.textContent = `${request.durationMs.toFixed(1)} ms · ${request.memoryMb} MB`;

				row.append(method, uri, status, timing);

				return row;
			}),
		);
	}

	function renderDumps(items) {
		if (items.length === 0) {
			elements.dumps.replaceChildren(
				empty('Nothing dumped yet. Call dump() or lw() and it will show up here.'),
			);

			return;
		}

		elements.dumps.replaceChildren(
			...items.map((dump) => {
				const entry = document.createElement('article');

				entry.className = 'entry';

				const head = document.createElement('div');

				head.className = 'entry-head';

				if (dump.file) {
					const link = document.createElement('button');

					link.type = 'button';
					link.className = 'link';
					link.textContent = `${shorten(dump.file)}:${dump.line ?? 1}`;
					link.title = dump.file;
					link.addEventListener('click', () =>
						vscode.postMessage({ type: 'openDump', file: dump.file, line: dump.line }),
					);
					head.appendChild(link);
				} else {
					head.appendChild(document.createTextNode('unknown origin'));
				}

				const body = document.createElement('pre');

				body.className = 'entry-body';
				body.textContent = dump.body;

				entry.append(head, body);

				return entry;
			}),
		);
	}

	function renderLines(items) {
		if (items.length === 0) {
			elements.logs.replaceChildren(empty('No log output yet.'));

			return;
		}

		elements.logs.replaceChildren(
			...items.map((line) => {
				const entry = document.createElement('article');

				entry.className = `entry level-${line.level}`;

				const head = document.createElement('div');

				head.className = 'entry-head';

				const level = document.createElement('span');

				level.className = 'level';
				level.textContent = line.level;

				const time = document.createElement('span');

				time.className = 'time';
				time.textContent = shortTime(line.timestamp);

				head.append(level, time);

				const body = document.createElement('pre');

				body.className = 'entry-body';
				body.textContent = line.context ? `${line.message}\n${line.context}` : line.message;

				entry.append(head, body);

				return entry;
			}),
		);
	}

	/**
	 * The tag list, grouped by file.
	 *
	 * The file is the heading rather than the tag: a `FIXME` matters because of
	 * what it sits next to, and a list sorted by tag scatters one file's
	 * unfinished business across four groups.
	 */
	function renderTodos(items) {
		if (todosLoaded === null) {
			elements.todos.replaceChildren(empty('Scanning the project…'));

			return;
		}

		if (items.length === 0) {
			elements.todos.replaceChildren(
				empty(
					todos.length === 0
						? 'No TODO, FIXME or HACK comments in this project.'
						: 'Nothing matches the filter.',
				),
			);

			return;
		}

		const nodes = [];
		let file = null;

		for (const todo of items) {
			if (todo.relative !== file) {
				file = todo.relative;

				const heading = document.createElement('div');

				heading.className = 'group namespace';
				heading.textContent = file;
				heading.title = file;
				nodes.push(heading);
			}

			const row = document.createElement('div');

			row.className = 'row clickable';
			row.tabIndex = 0;
			row.title = 'Open the line';

			const tag = document.createElement('span');

			tag.className = `tag tag-${todo.tag.toUpperCase()}`;
			tag.textContent = todo.tag.toUpperCase();

			const line = document.createElement('span');

			line.className = 'line-number';
			line.textContent = String(todo.line + 1);

			const text = document.createElement('span');

			// Not `.uri`: a note is a sentence, and the monospace break-anywhere
			// treatment a route gets chops it in the middle of words.
			text.className = 'todo-text';
			text.textContent = todo.text || '(no description)';

			row.append(tag, line, text);

			const open = () =>
				vscode.postMessage({ type: 'openTodo', file: todo.file, line: todo.line });

			row.addEventListener('click', open);
			row.addEventListener('keydown', (event) => {
				if (event.key === 'Enter' || event.key === ' ') {
					event.preventDefault();
					open();
				}
			});

			nodes.push(row);
		}

		elements.todos.replaceChildren(...nodes);
	}

	/**
	 * The Health report.
	 *
	 * Runs on every state load, not on tab selection, because the badge is the
	 * feature: a project whose internal storage is unwritable should say so from
	 * the tab strip, before the first request fails.
	 */
	function renderHealth() {
		if (!health) {
			elements.healthBadge.hidden = true;
			elements.healthPanel.replaceChildren(empty('Nothing to report yet.'));
			elements.healthScore.replaceChildren();

			return;
		}

		const problems = health.errors + health.warnings;

		elements.healthBadge.hidden = problems === 0;
		elements.healthBadge.textContent = String(problems);

		const healthTab = elements.tabs.find((button) => button.dataset.tab === 'health');

		if (healthTab) {
			healthTab.classList.toggle('has-error', health.errors > 0);
			healthTab.classList.toggle('has-warning', health.errors === 0 && health.warnings > 0);
			healthTab.title =
				problems === 0
					? 'No problems detected in this project'
					: `${describeCount(health.errors, 'error')}, ${describeCount(health.warnings, 'warning')}`;
		}

		renderScore(problems);

		const nodes = [];
		let group = null;

		for (const check of health.checks) {
			if (check.group !== group) {
				group = check.group;

				const heading = document.createElement('div');

				heading.className = 'group';
				heading.textContent = group;
				nodes.push(heading);
			}

			nodes.push(checkRow(check));
		}

		if (health.note) {
			nodes.push(empty(health.note));
		}

		elements.healthPanel.replaceChildren(...nodes);
	}

	/** One line, in the tone the worst check earns. */
	function renderScore(problems) {
		const box = document.createElement('div');

		box.className = `score ${health.errors > 0 ? 'score-error' : health.warnings > 0 ? 'score-warning' : 'score-ok'}`;

		const headline = document.createElement('strong');

		headline.textContent =
			health.errors > 0
				? 'This project has problems that stop it working.'
				: health.warnings > 0
					? 'This project works, with things worth fixing.'
					: 'No problems detected.';

		const detail = document.createElement('span');

		detail.textContent = `${health.checks.length} checks · ${describeCount(health.errors, 'error')} · ${describeCount(health.warnings, 'warning')}`;

		box.append(headline, detail);
		elements.healthScore.replaceChildren(box);
	}

	function checkRow(check) {
		const row = document.createElement('div');

		row.className = `check check-${check.status}`;

		const head = document.createElement('div');

		head.className = 'check-head';

		const marker = document.createElement('span');

		// A shape as well as a colour: a status told in colour alone is no status
		// at all for a good share of the people reading it.
		marker.className = 'marker';
		marker.textContent = check.status === 'ok' ? '✓' : check.status === 'warning' ? '!' : '✕';
		marker.setAttribute('aria-label', check.status);

		const label = document.createElement('span');

		label.className = 'check-label';
		label.textContent = check.label;

		head.append(marker, label);

		const detail = document.createElement('span');

		detail.className = 'check-detail';
		detail.textContent = check.detail;

		row.append(head, detail);

		if (check.advice) {
			const advice = document.createElement('p');

			advice.className = 'check-advice';
			advice.textContent = check.advice;
			row.appendChild(advice);
		}

		if (check.fix) {
			const button = document.createElement('button');

			button.type = 'button';
			button.className = 'btn-small';
			button.textContent = check.fix.label;
			button.title = check.fix.value;
			button.addEventListener('click', () =>
				vscode.postMessage({ type: 'healthFix', kind: check.fix.kind, value: check.fix.value }),
			);

			row.appendChild(button);
		}

		return row;
	}

	function describeCount(count, noun) {
		return `${count} ${noun}${count === 1 ? '' : 's'}`;
	}

	// Helpers --------------------------------------------------------------

	/** Shown where measurements would be, when the collectors are not installed. */
	function optIn() {
		const box = document.createElement('div');

		box.className = 'empty optin';

		const text = document.createElement('p');

		text.textContent =
			'Query timings and request durations live only in memory, so capturing them needs two small PHP files in your project. They run in the local environment only, and can be removed at any time.';

		const button = document.createElement('button');

		button.type = 'button';
		button.textContent = 'Install collectors…';
		button.addEventListener('click', () => vscode.postMessage({ type: 'installCollectors' }));

		box.append(text, button);

		return box;
	}

	function metric(value, label) {
		const span = document.createElement('span');

		span.append(strong(value), ` ${label}`);

		return span;
	}

	function badge(text) {
		const span = document.createElement('span');

		span.className = 'badge';
		span.textContent = text;

		return span;
	}

	function strong(text) {
		const b = document.createElement('b');

		b.textContent = text;

		return b;
	}

	function empty(text) {
		const div = document.createElement('div');

		div.className = 'empty';
		div.textContent = text;

		return div;
	}

	function shorten(file) {
		const parts = file.split('/');

		return parts.slice(-2).join('/');
	}

	function shortTime(timestamp) {
		const match = /T(\d{2}:\d{2}:\d{2})/.exec(timestamp ?? '');

		return match ? match[1] : (timestamp ?? '');
	}

	applyTheme(document.body.hasAttribute('data-dark'));
	vscode.postMessage({ type: 'ready' });
})();
