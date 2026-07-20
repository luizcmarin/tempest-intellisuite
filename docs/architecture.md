# Architecture

## The idea

Other frameworks surface their internals through a **web panel**: a package installed in the app
exposes an HTTP API, and a separate SPA renders it. That costs the user a dependency, an endpoint, a
browser tab, and it has to be kept in sync with the framework.

We already own an editor extension, so the panel does not need to be a website. It can be a
**webview inside VS Code**, next to the code. That removes the package, the endpoint, the extra tab
and the sync problem at once. The user installs one extension and their Tempest project works by
symbiosis — nothing is added to `composer.json`.

## Layout

```text
┌─────────────────────────── VS Code ────────────────────────────┐
│                                                                │
│  Language features (host)          Webviews                    │
│  ├── TextMate grammar .view.php    ├── Workbench  (sidebar)    │
│  ├── Attribute completions         │      routes+todos / lens  │
│  ├── Autowiring hints              └      commands / health    │
│  └── Snippets                              ▲                   │
│                                            │ postMessage       │
│  ┌─────────────── core/ ───────────────────┴────────────────┐  │
│  │  ProjectRegistry — detects the console, owns the         │  │
│  │                    tempest.isTempestProject context key  │  │
│  │  CliRunner       — read-only, timeout, cancellation, log │  │
│  │  DataSources     — commands.json, about --json, cache    │  │
│  │  HealthReader    — requirements, permissions, caches     │  │
│  │  TodoScanner     — tag comments, bounded, cached         │  │
│  └──────────────────────────┬──────────────────────────────┘  │
└─────────────────────────────┼─────────────────────────────────┘
                              │ reads / runs
                    ┌─────────▼──────────┐
                    │  Tempest project   │
                    │  tempest   .env    │
                    │  .tempest/  app/   │
                    └────────────────────┘
```

**The webview never touches disk or spawns a process.** It exchanges typed messages with the host
and nothing else. That keeps the content security policy simple and each layer testable on its own.

## Data sources

Ordered by how much we trust them. Details of what each one returns are in
[upstream.md](upstream.md), including the two gaps we want fixed in the framework.

| Source | Gives | Confidence |
| ------ | ----- | ---------- |
| `completion:generate` → `commands.json` | every command with description and typed flags; versioned schema | highest — the basis for feature detection |
| `routes --json` | uri, method, parameters, middleware | high, but `handler` comes back empty |
| `about --json` | versions, environment, caches, database engine and path | high; values arrive wrapped in arrays |
| `.tempest/logs/*.log` | dumps and application logs | high; paths are configurable and rotate daily |
| `container:show`, `config:show`, `discovery:status` | services, resolved config, discovery state | low — ANSI tables only, no `--json` |
| `.tempest/cache/discovery/` | — | do not parse: hashed, no public contract |

Two rules follow from this table:

**Prefer JSON.** Console tables are presentation. They break with terminal width, colour and layout
changes. Where text parsing is unavoidable — currently only the route handler — it lives in one
isolated, tested module, and there is an upstream issue asking for the data properly.

**Detect features, never versions.** The published documentation describes 3.0 while a current
install is far beyond it, with roughly eight times as many console commands as the docs list. The
only reliable question is "does this project have this command?", which `commands.json` answers.

## What the extension deliberately does not do

**It does not change how you type.** Auto-inserting semicolons, rewriting quotes into template
literals and similar conveniences were considered — the Ecosistema Sang plugin this project borrowed
some code from has them — and left out. They have nothing to do with Tempest, they collide with
whatever formatter the user already runs, and a framework extension that silently edits code the
user did not ask it to touch is a framework extension people uninstall.

The one exception is tag auto-closing, and it earns its place: `.view.php` files have their own
language id, so VS Code's own HTML behaviour never applies to them. That is restoring an expected
behaviour, not inventing one, and it can be switched off.

**It does not bundle language services.** Full HTML tag and attribute completion inside views would
mean shipping `vscode-html-languageservice`, taking the extension from 48 KB to roughly two
megabytes. Emmet covers most of that need for three lines of configuration.

## Degradation

Every one of these is a normal state, not an error:

- no Tempest project in the workspace → panel features stay hidden, language features keep working;
- no PHP on `PATH` → data sources return `undefined` and say so in the log;
- `EACCES` inside `.tempest/` → expected, since parts of it are owned by the web server user while
  the extension runs as the editor user;
- a command missing from `commands.json` → the feature that needs it hides itself.

## Where things live

```text
src/
├── extension.ts        # activation: wires providers and core together
├── core/
│   ├── project.ts      # ProjectRegistry — detection, context key
│   ├── cli.ts          # CliRunner — read-only console execution
│   └── datasources.ts  # commands.json, about --json, caching
├── providers/          # language features
└── panel/              # webview (from 1.1)
templates/              # generator stubs, as data (from 1.3)
```
