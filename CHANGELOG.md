# Changelog

All notable changes to this project are documented here, following
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

### Removed

- **The Forge.** Generating scaffolds means deciding action names, file layout and — as the styling
  question made plain — an entire CSS vocabulary. Those are opinions, and this extension is language
  tooling: it should tell you what your project *is*, not what your code *should look like*. The
  generator, its stubs and `docs/conventions.md` moved to the Sang plugin, where opinion is the
  point. Gone with it: **Tempest: Open Forge**, **Tempest: Generate…**, the
  `tempest.forge.templateDir` setting, the Forge button in the Workbench header, and the one
  third-party asset the extension shipped (a Microsoft codicon used only on that button).
- What stayed is `src/core/collectors.ts` — the narrow slice of the old Forge that renders and
  writes the Lens's two collector files. The Lens is unchanged; only the class behind it is.

### Added

- **`docs/conventions.md`** — the naming convention for generated code, decided once and binding on
  both the stubs and the Atlas demo. Tempest routes by attribute and never reads a method name, so
  it imposes no action names at all; that vacuum is what kept pulling CakePHP and Laravel habits
  into the stubs. The seven canonical actions are `index`, `createForm`, `create`, `show`,
  `updateForm`, `update` and `delete`, each with a fixed verb, URI shape and return type.

### Changed

- **The CRUD scaffold now generates a working CRUD.** It was a skeleton: `store`, `update` and
  `delete` redirected without touching anything, because nothing in the plan knew about a model.
  The generator gained a **Model class** field, and the emitted controller persists, paginates
  (`PER_PAGE`), binds the record from the route instead of taking a bare id, flashes through
  `Session`, and builds redirects with `uri()` rather than string literals.
- The scaffold emits a model alongside the controller, and **skips it when one is already there** —
  scaffolding onto an existing model is the normal case, and the plan no longer fails over it.
- `store` was renamed to `create` throughout: the framework's docs use `create` for the POST handler
  six times to `store`'s two, and pair it with `update` in a single example controller.
- The two form *components* became one form **page**, `form.view.php`, serving `createForm` and
  `updateForm` — the shape the Atlas already proved.

## 1.10.0 — 2026-07-19

### Added

- **A Health tab, after Commands.** It answers the question a stack trace answers too late: will
  this project run, and if not, why. The checks are Tempest's own — the PHP version and `ext-*`
  list are read from the installed `tempest/framework`, never hardcoded, so they stay true as the
  framework moves; the interpreter is asked directly what it has loaded and what it may write; and
  `about --json` fills in cache and database state. It covers the internal storage directory (the
  `CouldNotRegisterInternalStorage` everybody meets first, including the case where your terminal
  can write it and your web server cannot), the signing key, `.env` against `.env.example`, an
  invalid discovery cache, the PDO driver for the configured engine, and the SQLite file itself.
  The tab title turns red with a count when something is wrong, so a broken project says so from
  the tab strip. Every failing check explains itself and offers at most one action: a console
  command run in a real terminal, or a shell line copied to your clipboard for you to read first —
  nothing is repaired behind your back, and nothing is written to your project.
- **A Todos sub-tab, sharing the Routes tab.** Routes and unfinished business are both "what is in
  this project", so they now divide one tab the way the Lens divides its own. It collects `TODO`,
  `FIXME`, `HACK`, `BUG`, `NOTE` and `XXX` — configurable through `tempest.todo.tags` — grouped by
  file, and a row opens the line. A word only counts when a comment marker precedes it, so `TODO`
  inside a string or a URL is not reported as a task. The scan runs the first time you open the
  tab, not on every panel load, and a save re-reads only the file you saved.
- `tempest.todo.tags` and `tempest.todo.include`, and a **Tempest: Open Panel: Health** command.

### Changed

- **`about --json` is cached per project,** like the command manifest already was. Two sections now
  read it during a single load, and each call boots the whole framework. *Refresh* clears it, which
  is also the only moment these numbers are expected to move.

## 1.9.1 — 2026-07-19

### Fixed

- **The Lens streams opened at the end of the list.** *Follow* scrolled to the bottom on every
  render, including the render that a tab switch or a filter causes — so picking **Dumps**, **Log**,
  **Queries** or **Requests** landed you past everything, and reading meant scrolling back up. The
  view now starts at the top whenever you change what you are looking at; *Follow* still tracks
  output that arrives while you watch, which is the only time the end is the interesting end.

## 1.9.0 — 2026-07-19

### Changed

- **The Lens loads the recent past, not the whole log.** History was every entry in today's log
  file, which meant errors fixed hours earlier arrived looking exactly like errors happening now —
  the panel reported the day, not the state. It now loads the last hour by default, says so in its
  status line, and `tempest.lens.historyMinutes` moves or removes the window. Live output is never
  filtered.
- **Routes are grouped by the namespace of their handler,** under a heading that keeps the name as
  PHP writes it — `App\Categories`, not `APP\CATEGORIES`. Tempest apps are organised by feature
  folder, so the namespace already *is* the feature; a flat list ordered by discovery scattered each
  feature's routes across the panel. Rows drop the namespace from the handler, since the heading
  above them carries it, leaving room for the part that differs. Filtering matches the group name
  too, so typing `Categories` narrows to that feature.
- **Clear offers to empty the log files, not just the view.** Clearing the view alone lasted until
  the next reload, which read the same history back off disk. It now asks — once, naming every file
  and its size — and truncates rather than deletes, so the application keeps logging into the same
  files instead of finding them replaced by ones the editor owns.

## 1.8.0 — 2026-07-19

### Changed

- **The Inspector, the Lens and the routes tree are one view, and it lives in the sidebar.** There
  were three surfaces showing overlapping things: a tree listing routes, an Inspector webview
  listing the same routes, and a Lens that opened `Beside` — so asking for it split the editor
  whether or not you wanted a split, and then competed for the space your code was in. The Tempest
  container now holds a single view with **Routes**, **Lens** and **Commands** as tabs, the Lens's
  four streams as sub-tabs beneath, and everything that describes the project rather than one view —
  versions, environment, database, discovery cache — stated once above the divider. The editor area
  goes back to being for the user's code.
- **Laid out for a sidebar.** The project summary is a vertical list, list rows stack instead of
  tabulating (a handler name in a table column is a two-character sliver at 300px), and the Lens
  sub-tabs scroll rather than wrap.
- **The Forge is the one webview still in the editor** — it is a document you read and fill in, not
  a dashboard you glance at. A button in the sidebar header replaces the trip through the command
  palette, and opening it from there lands it in the active editor group, after the last file you
  had open, without splitting anything.
- **`Tempest: Open Panel: Routes` / `: Lens`** reveal the sidebar view on the right tab. They
  replace `Open Inspector` and `Open Lens`.

### Added

- **Projects are found at any depth, and there can be several.** Detection used to look only at the
  root of each workspace folder, so opening a directory that *contains* Tempest apps — a monorepo, a
  folder of client projects — found nothing at all and said the workspace had no project in it. Every
  folder is now searched for a `tempest` console next to a `composer.json`, skipping dependency and
  build directories. When more than one turns up, the **Project** line in the header becomes a
  picker, and the whole panel follows the choice, which is remembered per workspace.
- **A theme button in the header,** switching the **whole editor** between light and dark. It uses
  the themes already nominated in `workbench.preferredLightColorTheme` and
  `preferredDarkColorTheme` — the same pair VS Code's own "sync with OS" uses — so it imposes no
  theme of its own, and it turns `autoDetectColorScheme` off, which would otherwise undo the switch
  immediately.
- **Refresh reloads everything.** It used to drop only the Inspector's caches; the Lens kept
  whatever it had.

### Removed

- **The `Project` tree and `Tempest: Open Route Handler`.** The tree listed routes and linked to
  Inspector, Lens and Forge; all four are now tabs or buttons in the view that replaced it. Its
  "no project detected" welcome moved into the view, buttons and all.

### Fixed

- **A busy log rebuilt the route list.** Every batch of incoming dumps and log lines re-rendered
  whichever tab was showing, including tabs the new data had nothing to do with. Only the counters
  update now when the Lens is not the tab on screen.
- **Hidden panels could stay visible.** The `hidden` attribute only carries the user agent's
  `display: none`, which any `display` rule of ours outranks — a hidden tab bar stayed on screen
  because it is `display: flex`.

## 1.7.0 — 2026-07-18

### Added

- **A Tempest view in the activity bar.** Every feature used to be reachable only through the
  command palette, and the palette entries are gated on `tempest.isTempestProject` — so a fresh
  install in a workspace the extension had not recognised showed nothing at all, anywhere, with no
  way to tell "not activated" from "not installed". The view is always visible: it lists Inspector,
  Lens and Forge, shows the project's routes (click one to open its handler), and when no project is
  detected it says so and links to the `tempest.consolePath` setting instead of staying blank.

### Fixed

- **Every console-backed panel failed when the project was not the workspace root.** The runner
  executed the console with the workspace folder as its working directory, but Tempest's entry point
  resolves its autoloader from `getcwd()` — so a project in a subfolder loaded the wrong autoloader.
  In a monorepo whose root has its own `vendor/`, it loaded a real but unrelated one and died with
  `Class "Tempest\Console\ConsoleApplication" not found`, which the UI could only report as
  "Is PHP on your PATH?". The console now runs from its own directory. Filed as U-005.

### Changed

- **The CRUD forms are now their own files.** 1.6.2 inlined them into `index.view.php` and
  `show.view.php`; they are now `x-<resource>-store-form.view.php` and
  `x-<resource>-update-form.view.php`, rendered by the pages as `<x-products-store-form />`.

  The `x-` prefix is not decoration — `ViewComponentDiscovery::discoverPath` requires it, and it is
  the shape the framework uses for its own `x-form`, `x-input` and `x-base`. It is also the only
  composition mechanism Tempest has for a fragment shared between pages: there is no include for a
  plain view file. The files are named after the actions they feed, which stays true to 1.6.2 —
  `store` and `update` still return a `Redirect`, and there is still no page rendered from a POST.

## 1.6.2 — 2026-07-18

### Fixed

- **The CRUD scaffold generated endpoints nothing could reach.** Removing the `create` and `edit`
  actions in 1.6.1 left `store` and `update` with no page to submit from — working routes that no
  browser could get to. The forms now live in the views that already exist: the listing renders a
  create form, and the detail page renders update and delete forms. No new action, no new route, no
  convention invented.

  They are built from the framework's own `<x-form>`, `<x-input>` and `<x-submit>`, which means
  validation errors and previously-entered values are displayed without any extra work — and the
  delete form gets `_method` spoofing for free.

- **The detail view handed `<x-input>` the wrong DOM id.** View data is in scope inside the
  components a view renders, so passing `id` to the view silently became the input's `id` attribute:
  `<label for="7">` pointing at `<input id="7">`. The route parameter is now passed as `recordId`.

  There are no `store.view.php` or `update.view.php` files, and there should not be: those actions
  return a `Redirect`, not a `View`. Rendering HTML straight from a POST would break the back button
  and re-submit the form on refresh.

## 1.6.1 — 2026-07-18

### Changed

- **The CRUD scaffold now generates only what Tempest documents.** `create` and `edit` actions are
  gone, along with the two form views that went with them. Neither name appears as a controller
  action anywhere in the framework, its documentation or its examples — they were carried over from
  another framework's convention, and generating them would have handed people a convention Tempest
  does not have.

  What is left is the five actions the framework's own examples and docs use:

  | Verb | URI | Action |
  | ---- | --- | ------ |
  | `GET` | `/products` | `index` |
  | `POST` | `/products` | `store` |
  | `GET` | `/products/{id}` | `show` |
  | `POST` | `/products/{id}` | `update` |
  | `DELETE` | `/products/{id}` | `delete` |

  The index view no longer links to routes that would not exist.

## 1.6.0 — 2026-07-18

### Added

- **Emmet works in `.view.php` files.** Type `ul>li*3` and expand it, the same as in any HTML file.
- **Tags close themselves.** Finishing `<div>` writes `</div>` and leaves the cursor between them —
  for components too, so `<x-base :title="…">` gets its pair. Void tags (`<br>`, `<img>`) are left
  alone, and so are closing tags. Turn it off with `tempest.view.autoCloseTags`.
- **Tempest: Close Current Tag** closes the innermost tag still open before the cursor.

### Why this was missing

`.view.php` files have their own language id, which is what makes the Tempest View grammar, the
`<x-…>` completions and the directive highlighting possible — but it also means VS Code's built-in
HTML editing behaviour does not reach them. Views were the one place in a Tempest project where the
editor knew *less* than it does about a plain `.html` file.

Emmet needed only three lines of `emmet.includeLanguages` configuration. Full HTML tag suggestions
would have meant bundling `vscode-html-languageservice`, taking the extension from 48 KB to
roughly two megabytes — not a trade worth making for something Emmet already covers.

## 1.5.0 — 2026-07-18

### Added

- **`<x-…>` completes with the components your project actually has.** Discovery in Tempest is
  file-based — any `x-<name>.view.php` becomes `<x-name>` — so the files are the source of truth and
  no PHP has to run to read them. Your own components rank above the framework's, and each one shows
  where it is defined.
- **URI completion inside `href` and `action`.** Only `GET` routes are offered, since both are
  navigations and suggesting a `DELETE` URI as a link would be misleading. A link to a route that
  does not exist is a broken page nothing else catches.
- **Autowiring now reads the project's container**, not a fixed list — 113 bindings in a stock
  install, including anything the project registered itself. The ten services people actually reach
  for stay pinned to the top, and if the container cannot be read the list falls back to exactly
  those ten.

### Notes

`container:show` has no `--json`, so its table is parsed. The parser fails quietly and completely: a
format change yields an empty list and the core-service fallback, never a wrong suggestion. Tracked
upstream as U-002.

One subtlety it has to handle: `INITIALIZERS` and `SINGLETONS` read *service → initializer*, but
`DYNAMIC INITIALIZERS` reads *initializer → what it produces*. Reading column one everywhere would
offer `CacheInitializer` for injection and hide `Cache`.

## 1.4.1 — 2026-07-18

### Fixed

- **The CRUD controller imported two classes that do not exist.** `Response` and `Redirect` were
  taken from `Tempest\Router\…` instead of `Tempest\Http\…`, so the generated `store` and `delete`
  actions raised a fatal error the first time they were called. `php -l` does not resolve imports
  and the earlier check only exercised the `GET` routes, so both slipped through. Every verb is now
  exercised over HTTP.

### Changed

- **CRUD action names follow Tempest, not Laravel.** `destroy` is gone; the framework's own examples
  use `delete`. The scaffold is now `index`, `create`, `store`, `show`, `edit`, `update`, `delete`.
- CRUD gained the two form pages that were missing: `create.view.php` and `edit.view.php`, with the
  index linking to both. URIs put the verb in the path — `/products/create`,
  `/products/{id}/edit` — matching the framework's published examples, where a form and its
  submission share a URI.

## 1.4.0 — 2026-07-18

### Added

- **Lens: Queries** — every statement the ORM ran, with its duration, and the two things worth
  interrupting for called out:
  - **slow** statements, using the framework's own `isSlow()` threshold;
  - **repeated** statements — the same SQL run many times is what an N+1 looks like from outside the
    ORM. Bindings are ignored when comparing, because `… where id = ?` run two hundred times with
    two hundred different ids is exactly the case worth reporting.
  - A header totals the count, the time spent, and how many were slow, repeated or failed.
- **Lens: Requests** — method, URI, status, duration and peak memory per request, with 4xx and 5xx
  coloured.
- **Tempest: Install Lens Collectors** / **Remove Lens Collectors** — query timings live only in
  memory and the framework has no request-lifecycle event, so capturing either needs two small PHP
  files in the project. They are installed only when you ask, after a dialog that names every file
  it will write, and removed again in one command.

### About those two files

They are the only thing this extension ever adds to a project, and they are ordinary project code:

- `IntelliSuiteQueryCollector` listens for `QueryExecuted`; `IntelliSuiteTimingMiddleware` wraps the
  request;
- both return immediately outside the **local** environment;
- both swallow their own errors — instrumentation must never be able to break a request;
- both append JSON Lines under `.tempest/intellisuite/`, a format that survives being written by
  several processes and read halfway through;
- paths come from the framework's own `internal_storage_path()`, so they follow a project that keeps
  its code somewhere other than `app/`.

Everything else in the Lens — dumps, logs, errors — still needs nothing installed.

## 1.3.0 — 2026-07-18

### Added

- **Forge** (*Tempest: Open Forge*) — generates files from templates, with a preview of every file
  before anything is written.
  - Generators for **controller**, **CRUD scaffold**, **model**, **request**, **middleware**,
    **migration**, **console command** and **view**.
  - A controller comes with its view, and CRUD produces a controller with `index`/`show`/`store`/
    `destroy`, a request class and both views — coherent with each other, in one step.
  - Names you leave blank are derived: `ProductController` gives `/products`, a `products` view and
    `products:run` for a command.
  - Files are placed using the project's own PSR-4 map, not a guess about layout.
  - **Nothing is ever overwritten.** If any file in a plan already exists, the whole plan stops and
    the existing file is offered for opening.
- **Tempest: Generate…** — the same generators from the command palette. Called programmatically
  with `{ generator, answers }`, `tempest.generate` writes straight away and returns the paths, so
  other extensions and tasks can drive it.
- `tempest.forge.templateDir` — point it at a folder of your own `.stub` files and they replace the
  built-in ones by name. Your team's conventions win over the extension's.

### Notes

The Forge owns its templates rather than shelling out to `tempest make:*`. That is what makes
multi-file CRUD and view generation possible, and it works even when PHP is not reachable — but it
means our templates can drift from the framework's as it evolves. A weekly CI job compares the two
on a fresh install and opens an issue when they differ, rather than letting the templates quietly go
stale.

## 1.2.0 — 2026-07-18

### Added

- **Lens** (*Tempest: Open Lens*) — dumps, logs and errors streamed into the editor, beside the
  code they came from. Nothing is installed in the project: the framework already writes both files
  under `.tempest/logs/`, and the Lens only reads them.
  - **Dumps** — every `dump()`, `lw()` and `ll()` with its call site preserved. Click the location
    to jump straight to the line that produced it, instead of hunting for it in a wrecked page
    layout.
  - **Log** — the application log with levels coloured, timestamps, and structured context kept.
  - **Error notifications** — a line logged at `ERROR` or above raises a notification with a
    shortcut to open the Lens. Bursts are collapsed so one failure does not produce a stack of
    toasts. Turn it off with `tempest.lens.notifyOnError`.
  - Live filtering, follow-tail toggle, and a Clear that empties the view without touching the file.
- Watching starts as soon as a project is detected, not when the panel opens, so an error that
  happens while you are elsewhere is still reported.
- Log paths are resolved from the project's own configuration rather than assumed, and the
  directory is watched instead of a file name, because the application log rotates daily.

### Notes

The framework's own `tail:debug` deletes the log before tailing it. The Lens never calls it, so
opening the panel never destroys dumps you had not read yet.

## 1.1.0 — 2026-07-18

### Added

- **Inspector** (*Tempest: Open Inspector*) — a panel that shows what the framework actually
  discovered in the open project:
  - **Routes** — method, URI, dynamic-route and middleware badges, and the controller behind each
    one. Click a route to open its controller at the right line; routes whose file cannot be
    resolved are shown but not clickable, instead of offering a dead link.
  - **Commands** — every console command the project has, grouped by prefix, each with a **Run**
    button that sends it to a real terminal where it can prompt, stream and be cancelled.
  - **Header** — Tempest and PHP versions, environment, database engine, and the state of the
    discovery cache, with a shortcut to clear it when it is on.
  - Live filtering across routes and commands, and a refresh that drops every cache.
- Route handlers are recovered by combining `routes --json` with the console's tabular output,
  because the JSON leaves `handler` empty. Controllers are resolved to files through the project's
  own PSR-4 map in `composer.json`. Both are tracked upstream as U-001; if it lands, the text
  parsing goes away.
- The extension log now records what the Inspector loaded, which tells a bug report apart from an
  empty project.

## 1.0.0 — 2026-07-18

First release under the **Tempest PHP IntelliSuite** name. It succeeds *Tempest PHP IntelliPhense*,
which was removed from the Marketplace; this is a new extension identity
(`luizmarin.tempest-intellisuite`), not an update of it.

The scope grew from an editor helper to the Tempest development ecosystem in VS Code. This release
lays the foundation and keeps every language feature of the predecessor intact.

### Added

- **Project detection** — a folder is treated as a Tempest project when the `tempest` console exists
  at its root. Everything that reads project data stays inert otherwise, so the extension is
  invisible in non-Tempest workspaces.
- **Console runner** — read-only execution of `tempest` commands with timeout, cancellation and full
  logging to the *Tempest IntelliSuite* output channel.
- **Data sources** with feature detection: the command manifest from `completion:generate` and the
  project report from `about --json`, cached per project. Support for a command is decided by asking
  the project what it has, never by comparing version numbers.
- **`.env` diagnostics** — invalid lines and duplicate keys, with a link back to the first
  definition. Scoped to Tempest projects.
- Commands: `Tempest: Show Extension Log`, `Tempest: Refresh Project Data`.
- Settings: `tempest.phpPath`, `tempest.consolePath`, `tempest.cli.timeout`,
  `tempest.completions.enabled`.

### Carried over from Tempest PHP IntelliPhense 0.1.3

- Tempest View language (`.view.php`) with its TextMate grammar: control-flow directives,
  expression attributes, `<x-…>` components and `{{ }}` / `{!! !!}` interpolation as embedded PHP.
- Built-in accent colours for Tempest View scopes, tuned separately for light and dark themes.
- Completions for discovery attributes with automatic `use` imports.
- Constructor autowiring suggestions for Tempest core services.
- Snippets for PHP and views.
