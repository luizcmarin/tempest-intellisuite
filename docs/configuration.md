# Configuration

All settings live under the `tempest.` prefix. Open *Settings* and search for "Tempest", or edit
`settings.json` directly.

## Settings

### `tempest.phpPath`

- **Type:** string · **Default:** `php` · **Scope:** machine-overridable

The PHP executable used to run the Tempest console. Change it when PHP is not on your `PATH`, or
when a project needs a specific version.

```jsonc
{ "tempest.phpPath": "/usr/bin/php8.5" }
```

### `tempest.consolePath`

- **Type:** string · **Default:** `tempest` · **Scope:** resource

Name of the Tempest console executable — and what project detection looks for: no console, no
Tempest project.

Every workspace folder is searched for that name at **any depth**, next to a `composer.json`, so
projects nested in a monorepo are found without configuring anything; `vendor`, `node_modules`,
build output and VCS directories are skipped. Set this to a path (relative to the workspace folder)
only to add a project the search cannot see — an explicit path is taken at its word and skips the
`composer.json` check.

Change it when your project keeps the console somewhere other than its root.

```jsonc
{ "tempest.consolePath": "bin/tempest" }
```

### `tempest.cli.timeout`

- **Type:** number · **Default:** `15000` · **Minimum:** `1000` · **Scope:** resource

Milliseconds to wait before giving up on a console command. Raise it on large projects where booting
the framework is slow; a timeout is reported in the log, never as a crash.

### `tempest.lens.notifyOnError`

- **Type:** boolean · **Default:** `true` · **Scope:** resource

Raise a notification when the application logs at `ERROR` level or above. Bursts are collapsed, so a
single failure that logs several lines produces one notification rather than a stack of them.

Turning it off does not stop the Lens from collecting — errors still appear in the panel, they just
do not interrupt you.

### `tempest.lens.historyMinutes`

- **Type:** number · **Default:** `60` · **Scope:** resource

How far back the Lens loads when it opens, in minutes.

The application log holds a whole day, and nothing is ever removed from it, so loading the file
whole puts a failure that was fixed hours ago next to what is happening now, with nothing to tell
them apart. Opening the panel would then read as "the application is broken" when the log is really
saying "the application *was* broken, this morning".

Only history is filtered — anything the application writes while the panel is open always appears,
however quiet it has been. Dumps are exempt as well: the debug log records no timestamps, and a
dump is something you deliberately wrote in order to look at it.

Set to `0` to load the entire log.

### `tempest.todo.tags`

- **Type:** string[] · **Default:** `["TODO", "FIXME", "HACK", "BUG", "NOTE", "XXX"]` · **Scope:** resource

Words the **Todos** sub-tab looks for. A word only counts when a comment marker (`//`, `#`, `/*`,
`*`, `<!--`, `--`) precedes it on the line, so `TODO` inside a string, a URL or a variable name is
not reported as a task. Matching is case-insensitive, and the tag is shown as the source writes it.

```jsonc
{ "tempest.todo.tags": ["TODO", "FIXME", "@deprecated"] }
```

### `tempest.todo.include`

- **Type:** string · **Default:** `**/*.{php,js,mjs,ts,tsx,jsx,css,scss,md,sql,sh,yaml,yml,json}` · **Scope:** resource

Which files the **Todos** sub-tab scans, as a glob relative to the project root. `vendor`,
`node_modules`, `.git`, build output and `.tempest` are always skipped, files over 512 KB are
ignored, and the scan stops at 4 000 files and 2 000 results — a tag list is a convenience and may
never be the reason the editor stutters.

```jsonc
{ "tempest.todo.include": "app/**/*.php" }
```

### `tempest.view.autoCloseTags`

- **Type:** boolean · **Default:** `true` · **Scope:** resource

Write the matching closing tag when you finish an opening one in a `.view.php` file.

This exists because those files have their own language id, so VS Code's built-in HTML editing does
not apply to them. Turn it off if you have another extension covering it, or if you prefer to type
closing tags yourself.

### `tempest.completions.enabled`

- **Type:** boolean · **Default:** `true` · **Scope:** resource

Suggestions for Discovery attributes and constructor autowiring while typing. Turn it off if another
extension already covers it and you find the suggestions redundant.

## Commands

| Command | What it does |
| ------- | ------------ |
| **Tempest: Open Inspector** | Opens the panel with routes, console commands and project status |
| **Tempest: Open Lens** | Opens the live stream of dumps, log output and errors |
| **Tempest: Install Lens Collectors** | Adds the two PHP files that capture query and request timings |
| **Tempest: Remove Lens Collectors** | Deletes them, and the data they gathered |
| **Tempest: Show Extension Log** | Opens the output channel with every console command that was run |
| **Tempest: Refresh Project Data** | Clears cached project data and re-scans the workspace |

Cached data is refreshed automatically when workspace folders or the relevant settings change. Use
*Refresh Project Data* after altering the project in a way the extension cannot see — adding a route
or a console command, for instance.

## Appearance

Accent colours for Tempest View scopes ship enabled and layer on top of any theme. Override them
under `editor.tokenColorCustomizations.textMateRules`:

```jsonc
{
  "editor.tokenColorCustomizations": {
    "textMateRules": [
      {
        "scope": "entity.name.tag.component.tempest",
        "settings": { "foreground": "#ff79c6" }
      }
    ]
  }
}
```

Scopes you can target: `entity.name.tag.component.tempest` (component tags),
`keyword.control.directive.tempest` (`:if`, `:foreach`…),
`entity.other.attribute-name.expression.tempest` (expression attributes),
`punctuation.section.embedded.*.tempest` (interpolation delimiters).
