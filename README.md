# Tempest PHP IntelliSuite

> The [Tempest](https://tempestphp.com) development ecosystem inside VS Code — first-class support
> for the framework's **Discovery** attributes and **Views**, and a developer panel that shows you
> what the framework is actually doing.
>
> **Nothing is installed in your project.** No Composer package, no endpoint, no configuration. Open
> a Tempest project and it works.
>
> One feature is the exception, and it asks first: query and request timings exist only in memory,
> so capturing them needs two small PHP files you install — and remove — on demand.

[![CI](https://github.com/luizcmarin/tempest-intellisuite/actions/workflows/ci.yml/badge.svg)](https://github.com/luizcmarin/tempest-intellisuite/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Tempest *discovers* your code: routes, console commands and scheduled tasks are declared with native
PHP attributes, with no registration files. That is the framework's greatest strength — and the
reason newcomers ask "what is actually registered right now?". This extension answers that question
without leaving the editor.

## Features

### 🎨 Syntax highlighting for `.view.php`

Registers the **Tempest View** language for `*.view.php` files with a dedicated TextMate grammar:

- **Control-flow directives** — `:if`, `:elseif`, `:else`, `:isset`, `:foreach`, `:forelse`, `:as`,
  `:apply` are highlighted as keywords, and their values as **embedded PHP**.
- **Expression attributes** — any `:attribute="…"` binding (e.g. `:value="$value"`, `:is="$name"`)
  gets PHP highlighting inside the quotes.
- **View components** — `<x-button />`, `<x-slot name="…" />`, `<x-template>`,
  `<x-component :is="…" />` are coloured as component tags, distinct from plain HTML.
- **Interpolation** — `{{ $escaped }}` and `{!! $raw !!}` are embedded PHP expressions.
- Plain HTML and `<?php … ?>` blocks keep their regular highlighting.

```html
<x-base :title="$this->post->title">
    <ul>
        <li :foreach="$this->reports as $report">{{ $report->title }}</li>
        <li :forelse>There is no report.</li>
    </ul>
    <x-button :label="$cta" />
</x-base>
```

Accent colours for these scopes ship enabled and layer on top of whatever theme you use — no theme
switch required. Override them under `editor.tokenColorCustomizations.textMateRules`.

### ⚡ Smart completions for Discovery attributes

Type `#[` in any PHP file and get Tempest's native attributes with ready-to-fill snippets, docs and
the matching `use` statement inserted automatically:

| Attribute                                                  | Snippet                                                    |
| ---------------------------------------------------------- | ---------------------------------------------------------- |
| `#[Get]` / `#[Post]` / `#[Put]` / `#[Patch]` / `#[Delete]` | `#[Get(uri: '/path')]`                                     |
| `#[ConsoleCommand]`                                        | `#[ConsoleCommand(name: 'app:command', description: '…')]` |
| `#[ConsoleArgument]`                                       | `#[ConsoleArgument(description: '…')]`                     |
| `#[Schedule]`                                              | `#[Schedule(Every::MINUTE)]` (also imports `Every`)        |
| `#[Singleton]`                                             | `#[Singleton]`                                             |

### 💉 Constructor autowiring, from your own container

Inside `__construct(…)`, the extension suggests everything your container can resolve — over a
hundred bindings in a stock install, **including the ones your project registered itself**. Pick one
and both the promoted property (e.g. `private Router $router`) and its `use` import are written for
you.

The services people actually reach for (`Console`, `Database`, `Router`, `ViewRenderer`,
`CommandBus`, `EventBus`, `Clock`, `HttpClient`, `Logger`, `Container`) stay pinned to the top. If
the container cannot be read — no PHP on `PATH`, a project that will not boot — the list falls back
to exactly those.

### ✍️ Views edit like HTML again

`.view.php` files have their own language id — that is what makes the grammar, the component
completions and the directive highlighting possible, but it also means VS Code's built-in HTML
editing does not reach them. So it is put back:

- **Emmet works.** `ul>li*3` expands as it would anywhere else.
- **Tags close themselves**, components included: finishing `<x-base :title="…">` writes the closing
  tag and leaves the cursor between the two. Void tags are left alone. Disable with
  `tempest.view.autoCloseTags`.
- **Tempest: Close Current Tag** closes the innermost tag still open above the cursor.

### 🏷️ `<x-…>` completes with your components

Type `<x-` in a view and get the components the project really has, yours ranked above the
framework's, each showing the file it comes from. Component discovery in Tempest is file-based, so
this needs no PHP and keeps up with a component the moment you save it.

### 🔗 Route URIs where links are written

Inside `href` and `action`, the URIs your app actually serves are offered — `GET` routes only, since
both attributes are navigations. A link to a route that does not exist is a broken page that no
compiler and no test will catch for you.

### 🔭 The panel — what Tempest actually discovered

Click the **Tempest icon in the activity bar** to see the framework's own view of your project,
without adding anything to it. One sidebar view, with **Routes**, **Lens**, **Commands** and
**Health** as tabs — the editor area stays yours.

Above the tabs sits everything that is true of the project rather than of one view: Tempest and PHP
versions, environment, database engine and the discovery cache state — plus three buttons: open the
refresh every source at once, and flip the editor between light and dark.

**Several projects in one window is normal.** Every workspace folder is searched, at any depth, for
a `tempest` console sitting next to a `composer.json` — so a monorepo or a folder full of client
projects works with no configuration. When more than one is found, **Project** becomes a picker and
the panel follows it.

- **Routes** — grouped by the namespace of their handler, so `App\Categories` heads the routes that
  feature exposes: in a Tempest app the folder already *is* the feature. Method, URI, dynamic and
  middleware badges, and the controller behind each route. Click one to jump straight to its method.
  Routes whose file cannot be resolved stay visible but are not clickable, so you never chase a dead
  link.
- **Todos** — the same tab's other half: every `TODO`, `FIXME`, `HACK`, `BUG`, `NOTE` and `XXX` in
  the project, grouped by file, a click away from the line that has it. A word only counts when a
  comment marker precedes it, so `TODO` inside a string is not reported as a task. Configure which
  words with `tempest.todo.tags`.
- **Commands** — every console command in the project, grouped, each with a **Run** button that
  sends it to a real terminal, where it can prompt you and be cancelled.
- When the discovery cache is on — which in development quietly serves code you have already
  changed — a **Clear** button appears on the line that reports it.
- Filter routes and commands as you type.

### 🩺 Health — will this project run, and if not, why

The tab turns **red with a count** the moment something is wrong, so a broken project says so from
the tab strip instead of from a stack trace half an hour later. It checks what Tempest itself
needs — the PHP version and `ext-*` list are read from the `tempest/framework` installed in *your*
`vendor/`, never hardcoded, so they keep telling the truth as the framework moves:

- **Internal storage.** `.tempest/` exists and is writable — the `CouldNotRegisterInternalStorage`
  everyone meets first. Including the version of it that confuses people: your terminal can write
  the directory and your web server, running as `www-data`, cannot.
- **Requirements.** PHP version, missing extensions, memory limit, `vendor/` installed.
- **Environment.** A `.env` at all, a `SIGNING_KEY` in it, keys added to `.env.example` and never
  to yours, and — in production only — `display_errors`.
- **Caches.** A discovery cache gone *Invalid*, which serves routes and components from a picture
  of code you have already changed.
- **Database.** The PDO driver for the configured engine, and for a default install the SQLite
  file itself.

Each failing check says what it measured, what that means, and offers **at most one action**: a
console command sent to a real terminal, or a shell line copied to your clipboard for you to read
before you run it. Nothing is repaired behind your back, and nothing is written to your project.

### ⚡ Lens — dumps and logs, beside your code

The **Lens** tab, which **Tempest: Open Panel: Lens** takes you straight to. `dump()` in a web app
writes into the page you were debugging; in a command it scrolls past. Here it lands beside your
code instead, and stays there while you work. Its four streams are sub-tabs of their own:

- **Dumps** keep their call site — click it to jump to the exact line that produced the output.
- **Log** shows the application log with levels coloured and context preserved.
- **Errors interrupt you when they should**: a line at `ERROR` or above raises a notification with a
  shortcut into the Lens, so a crash while you are looking elsewhere does not go unnoticed. Bursts
  are collapsed into one. Disable with `tempest.lens.notifyOnError`.
- Watching begins as soon as the project is detected, not when you open the panel.
- **It opens on the last hour, not on the whole day.** The log file keeps everything, so replaying it
  whole shows this morning's fixed crash exactly like a live one. `tempest.lens.historyMinutes`
  moves the window, or removes it. Live output is never filtered.
- **Clear** empties the view and then offers to empty the files behind it — naming each one and its
  size first, and truncating rather than deleting, so the application keeps writing to the same
  files.

Nothing is installed in your project for this — the framework already writes to `.tempest/logs/`,
and the Lens only reads. It never calls `tail:debug`, which would delete your dumps.

#### Queries and request timings — the one opt-in

Two more Lens streams need something the framework only keeps in memory, so they are off until you
turn them on:

- **Queries** — every statement with its duration, flagging the **slow** ones and the **repeated**
  ones. A statement that runs many times is what an N+1 looks like from outside the ORM, and it is
  counted ignoring bindings, so `… where id = ?` run two hundred times shows up as exactly that.
- **Requests** — method, URI, status, duration and peak memory.

**Tempest: Install Lens Collectors** writes two PHP files into your project, after showing you
exactly which. They only run in the local environment, they swallow their own errors so they can
never break a request, and **Tempest: Remove Lens Collectors** deletes them again along with
everything they collected.

### 🩺 `.env` diagnostics

Invalid lines and duplicate keys are flagged in `.env` files that belong to a Tempest project, with
a link back to the first definition of a duplicated key.

### ✂️ Snippets

PHP: `tempest:get`, `tempest:post`, `tempest:command`, `tempest:schedule`, `tempest:migration`.
Views: `:if`, `:foreach`, `x-template`, `x-slot`, `x-component`.

## Roadmap

The panel features are being built in order, each shipping on its own release:

| Release | Feature                                                                                   |
| ------- | ------------------------------------------------------------------------------------------- |
| 1.0     | ✅ Language features, project detection, `.env` diagnostics                                 |
| 1.1     | ✅ **Inspector** — routes, commands with one-click run, discovery cache status               |
| 1.2     | ✅ **Lens** — dumps, logs and errors streamed into the editor                                |
| 1.4     | ✅ **Lens+** — query tracker with slow-query and N+1 detection, request timings              |
| 1.5     | ✅ Project-aware IntelliSense — `<x-…>`, route URIs and container services from your project |

## Requirements

- VS Code **1.90+**
- A [Tempest](https://tempestphp.com) project — detected by the `tempest` console at its root
- PHP available on your `PATH` (configurable) for the panel features

Language features work in any PHP file. Everything that reads project data stays inert until a
Tempest project is detected.

## Settings

| Setting                       | Default   | What it does                                            |
| ----------------------------- | --------- | ------------------------------------------------------- |
| `tempest.phpPath`             | `php`     | PHP executable used to run the Tempest console          |
| `tempest.consolePath`         | `tempest` | Console executable, relative to the workspace folder    |
| `tempest.cli.timeout`         | `15000`   | Milliseconds before a console command is given up on    |
| `tempest.lens.notifyOnError`  | `true`    | Notify when the application logs at `ERROR` or above    |
| `tempest.view.autoCloseTags`  | `true`    | Close tags for you in `.view.php` files                 |
| `tempest.completions.enabled` | `true`    | Attribute and autowiring suggestions while typing       |
| `tempest.todo.tags`           | 6 tags    | Words the Todos tab looks for in comments               |
| `tempest.todo.include`        | source    | Glob of files the Todos tab scans                       |

## Privacy

No telemetry, no analytics, no network requests. Console commands run locally, read-only, and every
one of them is logged to the **Tempest IntelliSuite** output channel (`Tempest: Show Extension Log`)
so you can see exactly what ran.

## Contributing & development

This project uses [bun](https://bun.sh) and bundles with esbuild.

```bash
bun install          # dependencies
bun run typecheck    # tsc --noEmit
bun run build:bundle # esbuild → build/extension.js
```

Press **F5** (*Run Extension*) to open an Extension Development Host with the extension loaded, then
open a Tempest project in it.

See [CONTRIBUTING.md](CONTRIBUTING.md), and [docs/](docs/) for architecture and design notes.

## References

- [Tempest framework](https://github.com/tempestphp/tempest-framework)
- [Views](https://tempestphp.com/3.x/essentials/views) ·
  [Routing](https://tempestphp.com/3.x/essentials/routing) ·
  [Console commands](https://tempestphp.com/3.x/essentials/console-commands)

## License

[MIT](LICENSE) © Luiz Marin
